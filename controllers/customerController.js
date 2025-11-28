// controllers/customerController.js
const pool = require("../config/db");

// ➕ إضافة عميل جديد
exports.addCustomer = async (req, res) => {
  try {
    const { name, phone } = req.body;

    if (!name) {
      return res.status(400).json({ message: "اسم العميل مطلوب" });
    }

    const [result] = await pool.query(
      "INSERT INTO customers (name, phone) VALUES (?, ?)",
      [name, phone || null]
    );

    res.status(201).json({ id: result.insertId, name, phone, message: "تم إضافة العميل بنجاح" });
  } catch (error) {
    console.error("Error adding customer:", error);
    res.status(500).json({ message: "فشل في إضافة العميل" });
  }
};  

// 📋 جلب كل العملاء
exports.getCustomers = async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM customers ORDER BY name ASC");
    res.json(rows);
  } catch (error) {
    console.error("Error fetching customers:", error);
    res.status(500).json({ message: "فشل في جلب العملاء" });
  }
};

// 🔍 البحث عن عميل بالاسم أو الهاتف
exports.searchCustomers = async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) return res.json([]);

    const [rows] = await pool.query(
      "SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? ORDER BY name ASC",
      [`%${query}%`, `%${query}%`]
    );

    res.json(rows);
  } catch (error) {
    console.error("Error searching customers:", error);
    res.status(500).json({ message: "فشل في البحث عن العملاء" });
  }
};

// ✏️ تعديل عميل
exports.updateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone} = req.body;

    const [result] = await pool.query(
      "UPDATE customers SET name = ?, phone = ? WHERE id = ?",
      [name, phone, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "العميل غير موجود" });
    }

    res.json({ message: "تم تحديث بيانات العميل بنجاح" });
  } catch (error) {
    console.error("Error updating customer:", error);
    res.status(500).json({ message: "فشل في تعديل العميل" });
  }
};

// ❌ حذف عميل
exports.deleteCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.query("DELETE FROM customers WHERE id = ?", [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "العميل غير موجود" });
    }

    res.json({ message: "تم حذف العميل بنجاح" });
  } catch (error) {
    console.error("Error deleting customer:", error);
    res.status(500).json({ message: "فشل في حذف العميل" });
  }
};

// 📋 بحث عن عميل
exports.searchCustomers = async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) return res.json([]);

    const [rows] = await pool.query(
      "SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? ORDER BY name ASC",
      [`%${query}%`, `%${query}%`]
    );

    res.json(rows);
  } catch (error) {
    console.error("Error fetching customers:", error);
    res.status(500).json({ message: "فشل في جلب العملاء" });
  }
};
