const pool = require("../config/db");
const bcrypt = require("bcrypt");

exports.registerUser = async (req, res) => {
  const { full_name, email, password, role } = req.body;

  // ✅ التحقق من البيانات
  if (!full_name || !email || !password || !role) {
    return res.status(400).json({ message: "يرجى إدخال جميع البيانات المطلوبة." });
  }

  if (!["staff"].includes(role)) {
    return res.status(400).json({ message: "الدور يجب أن يكون staff فقط." });
  }

  try {
    // ✅ التأكد من عدم وجود مستخدم بنفس الإيميل
    const [existing] = await pool.query("SELECT id FROM users WHERE email = ?", [email]);
    if (existing.length > 0) {
      return res.status(409).json({ message: "هذا البريد الإلكتروني مستخدم بالفعل." });
    }

    // ✅ تشفير الباسورد
    const hashedPassword = await bcrypt.hash(password, 10);

    // ✅ إنشاء المستخدم
    await pool.query(
      "INSERT INTO users (full_name, email, password, role) VALUES (?, ?, ?, ?)",
      [full_name, email, hashedPassword, role]
    );

    res.status(201).json({ message: `تم إنشاء مستخدم ${role} بنجاح.` });
  } catch (err) {
    console.error("❌ registerUser error:", err);
    res.status(500).json({ message: "حدث خطأ أثناء إنشاء المستخدم", error: err.message });
  }
};


// controllers/userController.js
exports.getAllStaff = async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT id, full_name, email, role FROM users WHERE role = 'staff'");
    res.json(rows);
  } catch (err) {
    console.error("❌ getAllStaff error:", err);
    res.status(500).json({ message: "حدث خطأ أثناء جلب المستخدمين" });
  }
};


exports.deleteUser = async (req, res) => {
  const { id } = req.params;
  try {
    const [result] = await pool.query("DELETE FROM users WHERE id = ?", [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "المستخدم غير موجود" });
    }
    res.json({ message: "تم حذف المستخدم بنجاح" });
  } catch (err) {
    res.status(500).json({ message: "حدث خطأ أثناء الحذف" });
  }
};


exports.updateUser = async (req, res) => {
  const { id } = req.params;
  const { full_name, email, password } = req.body;

  try {
    let query = "UPDATE users SET full_name = ?, email = ?" + (password ? ", password = ?" : "") + " WHERE id = ?";
    let params = [full_name, email];
    
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      params.push(hashedPassword);
    }

    params.push(id);
    await pool.query(query, params);

    res.json({ message: "تم تحديث بيانات المستخدم بنجاح" });
  } catch (err) {
    console.error("❌ updateUser error:", err);
    res.status(500).json({ message: "حدث خطأ أثناء التحديث" });
  }
};
