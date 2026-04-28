const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const { RouterOSAPI } = require("node-routeros");

const app = express();
app.use(cors());
app.use(express.json());

// إظهار ملفات الموقع
app.use(express.static(__dirname));

// الصفحة الرئيسية
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

const PORT = process.env.PORT || 3000;

// =================== Supabase ===================
const supabase = createClient(
  "https://zvzjxrfjrbgybyqcaxbe.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2emp4cmZqcmJneWJ5cWNheGJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMTE2OTIsImV4cCI6MjA5Mjc4NzY5Mn0.SEsZTmft-qWnS8P4nDmHVjZ7ZsUf0xq3fmBtPJIvJZs"
);

// =================== MikroTik ===================
const mikrotik = {
  host: "e7e00eb9bd43.sn.mynetname.net",
  user: "admin",
  password: "71107#660",
  port: 8728
};

// =================== Functions ===================
async function connectMT() {
  const conn = new RouterOSAPI(mikrotik);
  await conn.connect();
  return conn;
}

async function getCardFromProfile(profile) {
  const conn = await connectMT();

  try {
    const users = await conn.write("/ip/hotspot/user/print", [
      `?profile=${profile}`
    ]);

    if (!users.length) {
      await conn.close();
      return null;
    }

    const card = users[0];

    await conn.write("/ip/hotspot/user/remove", [
      `=.id=${card[".id"]}`
    ]);

    await conn.close();

    return card.name;
  } catch (e) {
    await conn.close();
    throw e;
  }
}

// =================== Main ===================
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

// =================== Create User ===================
app.post("/api/createUser", async (req, res) => {
  const { name, password } = req.body;

  const code = Math.floor(100000 + Math.random() * 900000).toString();

  const { error } = await supabase.from("users").insert([
    {
      name,
      password,
      code,
      points: 0
    }
  ]);

  if (error) return res.json({ error: error.message });

  res.json({ success: true, code });
});

// =================== Login ===================
app.post("/api/login", async (req, res) => {
  const { code, password } = req.body;

  const { data } = await supabase
    .from("users")
    .select("*")
    .eq("code", code)
    .eq("password", password)
    .single();

  if (!data) return res.json({ error: "بيانات خطأ" });

  res.json({ user: data });
});

// =================== User Info ===================
app.get("/api/user/:code", async (req, res) => {
  const { code } = req.params;

  const { data } = await supabase
    .from("users")
    .select("*")
    .eq("code", code)
    .single();

  if (!data) return res.status(404).json({ error: "غير موجود" });

  res.json(data);
});

// =================== Add Card + منع التكرار + خصم السلفة ===================
app.post("/api/addCard", async (req, res) => {
  const { userCode, cardNumber } = req.body;

  const { data: user } = await supabase
    .from("users")
    .select("*")
    .eq("code", userCode)
    .single();

  if (!user) {
    return res.json({ error: "المستخدم غير موجود" });
  }

  // منع تكرار الكرت
  const { data: oldCard } = await supabase
    .from("used_cards")
    .select("*")
    .eq("card", cardNumber)
    .maybeSingle();

  if (oldCard) {
    return res.json({ error: "هذا الكرت مستخدم من قبل" });
  }

  let pointsAdded = 10;
  let newPoints = (user.points || 0) + pointsAdded;
  let loanRemaining = 0;

  // خصم السلفة تلقائي
  if (user.loan_remaining && user.loan_remaining > 0) {
    const debt = user.loan_remaining;

    if (newPoints >= debt) {
      newPoints -= debt;
      loanRemaining = 0;
    } else {
      loanRemaining = debt - newPoints;
      newPoints = 0;
    }
  }

  await supabase.from("users").update({
    points: newPoints,
    loan_remaining: loanRemaining
  }).eq("code", userCode);

  // حفظ الكرت كمستخدم
  await supabase.from("used_cards").insert([
    {
      card: cardNumber,
      user_code: userCode
    }
  ]);

  res.json({
    success: true,
    pointsAdded,
    newPoints,
    loanRemaining
  });
});

// =================== Reward ===================
app.post("/api/redeemReward", async (req, res) => {
  const { userCode, rewardName } = req.body;

  const { data } = await supabase
    .from("users")
    .select("*")
    .eq("code", userCode)
    .single();

  if (!data) return res.json({ error: "المستخدم غير موجود" });

  let cost = 50;
  if (rewardName === "كرت ابو 200") cost = 100;
  if (rewardName === "كرت VIP") cost = 200;

  if (data.points < cost)
    return res.json({ error: "نقاطك غير كافية" });

  try {
    const card = await getCardFromProfile("point-50");

    if (!card) return res.json({ error: "لا يوجد كروت" });

    await supabase
      .from("users")
      .update({ points: data.points - cost })
      .eq("code", userCode);

    res.json({
      success: true,
      username: card
    });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// =================== Loan ===================
app.post("/api/loan", async (req, res) => {
  const { userCode } = req.body;

  const { data } = await supabase
    .from("users")
    .select("*")
    .eq("code", userCode)
    .single();

  if (!data) return res.json({ error: "المستخدم غير موجود" });

  if ((data.points || 0) < 30)
    return res.json({ error: "تحتاج 30 نقطة" });

  try {
    const card = await getCardFromProfile("Selefny");

    if (!card) return res.json({ error: "لا يوجد كروت سلفني" });

    res.json({
      success: true,
      username: card,
      loanAmount: 30
    });
  } catch (e) {
    res.json({ error: e.message });
  }
});
// =================== Recover Code ===================
app.post("/api/recoverCode", async (req, res) => {
  const { name, password } = req.body;

  const { data } = await supabase
    .from("users")
    .select("*")
    .eq("name", name)
    .eq("password", password)
    .single();

  if (!data) {
    return res.json({ error: "البيانات غير صحيحة" });
  }

  res.json({
    success: true,
    code: data.code
  });
});

// =================== Admin Users ===================
app.get("/api/admin/users", async (req, res) => {
  const { data } = await supabase
    .from("users")
    .select("*")
    .order("id", { ascending: false });

  res.json(data || []);
});

// حذف مستخدم
app.delete("/api/admin/delete/:id", async (req, res) => {
  const { id } = req.params;

  await supabase.from("users").delete().eq("id", id);

  res.json({ success: true });
});

app.listen(PORT, () => console.log("Server Started"));
