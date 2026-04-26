const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const { RouterOSAPI } = require("node-routeros");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// بيانات Supabase
const supabase = createClient(
  "https://zvzjxrfjrbgybyqcaxbe.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2emp4cmZqcmJneWJ5cWNheGJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMTE2OTIsImV4cCI6MjA5Mjc4NzY5Mn0.SEsZTmft-qWnS8P4nDmHVjZ7ZsUf0xq3fmBtPJIvJZs"
);

// بيانات MikroTik
const mikrotik = {
  host: "e7e00eb9bd43.sn.mynetname.net",
  user: "admin",
  password: "71107#660",
  port: 8728
};

// الصفحة الرئيسية
app.get("/", (req, res) => {
  res.send("API شغال ✅");
});

// إنشاء مستخدم
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

// تسجيل الدخول
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

// سحب كرت من MikroTik
app.get("/api/getCard", async (req, res) => {
  const conn = new RouterOSAPI(mikrotik);

  try {
    await conn.connect();

    const data = await conn.write("/ip/hotspot/user/print");

    await conn.close();

    res.json(data[0]);
  } catch (e) {
    res.json({ error: e.message });
  }
});

app.listen(PORT, () => console.log("Server Started"));