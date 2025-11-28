const pool = require("./config/db");
const bcrypt = require("bcrypt");

const seedAdmin = async () => {
  const full_name = "مدير النظام";
  const email = "admin@pharmacy.com";
  const plainPassword = "123456"; // تقدر تغيرها
  const role = "admin";

  try {
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    const [existing] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
    if (existing.length) {
      console.log("❗ الأدمن موجود بالفعل.");
      return;
    }

    await pool.query(
      "INSERT INTO users (full_name, email, password, role) VALUES (?, ?, ?, ?)",
      [full_name, email, hashedPassword, role]
    );

    console.log("✅ تم إنشاء الأدمن بنجاح:");
    console.log("📧 البريد الإلكتروني:", email);
    console.log("🔑 كلمة المرور:", plainPassword);
  } catch (err) {
    console.error("❌ خطأ أثناء إنشاء الأدمن:", err);
  } finally {
    pool.end(); // إنهاء الاتصال
  }
};

seedAdmin();
