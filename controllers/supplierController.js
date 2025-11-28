const pool = require("../config/db");

// ✅ إضافة مورد جديد
exports.createSupplier = async (req, res) => {
  const { name, phone } = req.body;
  if (!name) return res.status(400).json({ message: "اسم المورد مطلوب" });

  try {
    const [result] = await pool.query(
      "INSERT INTO suppliers (name, phone) VALUES (?, ?)",
      [name, phone || null]
    );
    res.status(201).json({ message: "✅ تم إنشاء المورد", id: result.insertId });
  } catch (err) {
    console.error("خطأ في إضافة المورد:", err);
    res.status(500).json({ message: "❌ فشل في إنشاء المورد", error: err.message });
  }
};

// ✅ جلب جميع الموردين مع إحصائيات مفصلة
exports.getAllSuppliers = async (req, res) => {
  try {
    const [suppliers] = await pool.query("SELECT * FROM suppliers ORDER BY created_at DESC");
    
    // جلب إحصائيات إضافية لكل مورد
    for (let supplier of suppliers) {
      // عدد المنتجات الموردة
      const [productCount] = await pool.query(
        "SELECT COUNT(DISTINCT product_id) as count FROM product_batches WHERE supplier_id = ?",
        [supplier.id]
      );
      supplier.total_products = productCount[0]?.count || 0;

      // إجمالي الكمية الموردة
      const [totalSupplied] = await pool.query(
        "SELECT SUM(initial_quantity) as total FROM product_batches WHERE supplier_id = ?",
        [supplier.id]
      );
      supplier.total_supplied = totalSupplied[0]?.total || 0;

      // عدد المرتجعات
      const [returnStats] = await pool.query(
        `SELECT COUNT(*) as count, SUM(pr.quantity) as total_quantity 
         FROM purchase_returns pr 
         JOIN product_batches pb ON pr.product_id = pb.product_id 
         WHERE pb.supplier_id = ?`,
        [supplier.id]
      );
      supplier.total_returns = returnStats[0]?.count || 0;
      supplier.returned_quantity = returnStats[0]?.total_quantity || 0;

      // آخر عملية توريد
      const [lastSupply] = await pool.query(
        "SELECT created_at FROM product_batches WHERE supplier_id = ? ORDER BY created_at DESC LIMIT 1",
        [supplier.id]
      );
      supplier.last_supply_date = lastSupply[0]?.created_at || null;
    }

    res.json(suppliers);
  } catch (err) {
    console.error("خطأ في جلب الموردين:", err);
    res.status(500).json({ message: "❌ فشل في جلب الموردين", error: err.message });
  }
};

// ✅ جلب مورد حسب ID مع تفاصيل كاملة
exports.getSupplierById = async (req, res) => {
  const { id } = req.params;
  try {
    // معلومات المورد الأساسية
    const [[supplier]] = await pool.query("SELECT * FROM suppliers WHERE id = ?", [id]);
    if (!supplier) return res.status(404).json({ message: "❌ المورد غير موجود" });

    // المنتجات الموردة
    const [products] = await pool.query(
      `SELECT p.*, pb.initial_quantity, pb.created_at,
              (SELECT SUM(initial_quantity) FROM product_batches 
               WHERE product_id = p.id AND supplier_id = ?) as total_supplied_to_product
       FROM product_batches pb
       JOIN products p ON pb.product_id = p.id
       WHERE pb.supplier_id = ? 
       ORDER BY pb.created_at DESC`,
      [id, id]
    );

    // المرتجعات
    const [returns] = await pool.query(
      `SELECT DISTINCT pr.*, p.name AS product_name, p.barcode,
       u.full_name AS returned_by_name
FROM purchase_returns pr
JOIN products p ON pr.product_id = p.id
JOIN product_batches pb ON p.id = pb.product_id AND pb.supplier_id = ?
LEFT JOIN users u ON pr.returned_by = u.id
WHERE pb.supplier_id = ?
ORDER BY pr.returned_at DESC`,
      [id, id]
    );

    // فواتير الشراء
    const [invoices] = await pool.query(
      `SELECT pi.*, 
              COUNT(pii.id) as items_count,
              SUM(pii.quantity) as total_quantity
       FROM purchase_invoices pi
       LEFT JOIN purchase_invoice_items pii ON pi.id = pii.invoice_id
       WHERE pi.supplier_id = ?
       GROUP BY pi.id
       ORDER BY pi.invoice_date DESC`,
      [id]
    );

    // إحصائيات عامة
    const [stats] = await pool.query(
      `SELECT 
        COUNT(DISTINCT pb.product_id) as total_products,
        SUM(pb.initial_quantity) as total_supplied,
        COUNT(pr.id) as total_returns,
        SUM(pr.quantity) as total_returned_quantity,
        COUNT(pi.id) as total_invoices,
        SUM(pi.total_amount) as total_invoiced_amount
       FROM product_batches pb
       LEFT JOIN purchase_returns pr ON pb.product_id = pr.product_id
       LEFT JOIN purchase_invoices pi ON pb.supplier_id = pi.supplier_id
       WHERE pb.supplier_id = ?`,
      [id]
    );

    supplier.products = products;
    supplier.returns = returns;
    supplier.invoices = invoices;
    supplier.stats = stats[0] || {};

    res.json(supplier);
  } catch (err) {
    console.error("خطأ في جلب المورد:", err);
    res.status(500).json({ message: "❌ فشل في جلب المورد", error: err.message });
  }
};

// ✅ جلب تقرير مفصل عن المورد
exports.getSupplierReport = async (req, res) => {
  const { id } = req.params;
  const { startDate, endDate } = req.query;

  try {
    let dateCondition = "";
    let queryParams = [id];

    if (startDate && endDate) {
      dateCondition = " AND pb.created_at BETWEEN ? AND ?";
      queryParams.push(startDate, endDate);
    }

    // تقرير المنتجات الموردة
    const [supplyReport] = await pool.query(
      `SELECT p.id, p.name, p.barcode, p.english_name,
              SUM(pb.initial_quantity) as total_supplied,
              COUNT(pb.id) as supply_times,
              MIN(pb.created_at) as first_supply,
              MAX(pb.created_at) as last_supply
       FROM product_batches pb
       JOIN products p ON pb.product_id = p.id
       WHERE pb.supplier_id = ? ${dateCondition}
       GROUP BY p.id
       ORDER BY total_supplied DESC`,
      queryParams
    );

    // تقرير المرتجعات
    const [returnReport] = await pool.query(
      `SELECT p.id, p.name, p.barcode,
              SUM(pr.quantity) as total_returned,
              COUNT(pr.id) as return_times,
              MIN(pr.returned_at) as first_return,
              MAX(pr.returned_at) as last_return
       FROM purchase_returns pr
       JOIN products p ON pr.product_id = p.id
       JOIN product_batches pb ON p.id = pb.product_id AND pb.supplier_id = ?
       WHERE pb.supplier_id = ? ${dateCondition.replace('pb.created_at', 'pr.returned_at')}
       GROUP BY p.id
       ORDER BY total_returned DESC`,
      [id, ...queryParams.slice(1)]
    );

    // إحصائيات شهرية
    const [monthlyStats] = await pool.query(
      `SELECT 
        DATE_FORMAT(pb.created_at, '%Y-%m') as month,
        COUNT(DISTINCT pb.product_id) as products_count,
        SUM(pb.initial_quantity) as supplied_quantity,
        COUNT(pb.id) as supply_transactions
       FROM product_batches pb
       WHERE pb.supplier_id = ? AND pb.created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
       GROUP BY DATE_FORMAT(pb.created_at, '%Y-%m')
       ORDER BY month DESC`,
      [id]
    );

    res.json({
      supply_report: supplyReport,
      return_report: returnReport,
      monthly_stats: monthlyStats
    });
  } catch (err) {
    console.error("خطأ في جلب تقرير المورد:", err);
    res.status(500).json({ message: "❌ فشل في جلب التقرير", error: err.message });
  }
};

// ✅ تعديل مورد
exports.updateSupplier = async (req, res) => {
  const { id } = req.params;
  const { name, phone } = req.body;
  try {
    const [result] = await pool.query(
      "UPDATE suppliers SET name = ?, phone = ? WHERE id = ?",
      [name, phone || null, id]
    );
    if (result.affectedRows === 0)
      return res.status(404).json({ message: "❌ المورد غير موجود" });

    res.json({ message: "✅ تم تحديث بيانات المورد" });
  } catch (err) {
    console.error("خطأ في تعديل المورد:", err);
    res.status(500).json({ message: "❌ فشل في تعديل المورد", error: err.message });
  }
};

// ✅ حذف مورد
exports.deleteSupplier = async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM product_batches WHERE supplier_id = ?", [id]);
    const [result] = await pool.query("DELETE FROM suppliers WHERE id = ?", [id]);

    if (result.affectedRows === 0)
      return res.status(404).json({ message: "❌ المورد غير موجود" });

    res.json({ message: "✅ تم حذف المورد" });
  } catch (err) {
    console.error("خطأ في حذف المورد:", err);
    res.status(500).json({ message: "❌ فشل في حذف المورد", error: err.message });
  }
};