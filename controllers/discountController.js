const pool = require('../config/db');

exports.getDiscountLog = async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT
          d.id AS discountId,
          d.amount AS discountAmount,
          d.percentage AS discountPercentage,
          d.created_at AS discountDate,
          COALESCE(u.full_name, su.full_name) AS staffName,
          s.id AS saleId,
          s.total AS saleTotalAfterDiscount,
          c.name AS customerName                -- ✅ اسم العميل من جدول customers
      FROM discounts d
      LEFT JOIN users u ON d.created_by = u.id 
      LEFT JOIN sales s ON d.sale_id = s.id
      LEFT JOIN users su ON s.staff_id = su.id
      LEFT JOIN customers c ON s.customer_id = c.id   -- ✅ الربط مع العملاء
      ORDER BY d.created_at DESC
    `);

    res.json({ success: true, discountLog: rows });
  } catch (error) {
    console.error('Error fetching discount log:', error);
    res.status(500).json({ success: false, message: 'خطأ في الخادم عند جلب سجل الخصومات.' });
  }
};
