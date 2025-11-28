const pool = require("../config/db");

// ✅ جلب كل التصنيفات
exports.getAllCategories = async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM categories ORDER BY name ASC");
    res.json(rows);
  } catch (err) {
    console.error("Error fetching categories:", err);
    res.status(500).json({ message: "خطأ أثناء جلب التصنيفات" });
  }
};

// ✅ إضافة تصنيف جديد
exports.createCategory = async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ message: "الاسم مطلوب" });
  }

  try {
    const [existing] = await pool.query("SELECT * FROM categories WHERE name = ?", [name]);
    if (existing.length > 0) {
      return res.status(400).json({ message: "التصنيف موجود بالفعل" });
    }

    const [result] = await pool.query("INSERT INTO categories (name) VALUES (?)", [name]);
    res.status(201).json({ id: result.insertId, name });
  } catch (err) {
    console.error("Error creating category:", err);
    res.status(500).json({ message: "فشل في إضافة التصنيف" });
  }
};
