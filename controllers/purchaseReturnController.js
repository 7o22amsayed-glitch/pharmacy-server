const db = require('../config/db');

// إرجاع كمية من منتج وتخزين العملية - نظام متطور باختيار الدفعة
exports.createPurchaseReturn = async (req, res) => {
  const { product_id, batch_id, quantity, returned_by, reason, supplier_id } = req.body;

  if (!product_id || !batch_id || !quantity || quantity <= 0) {
    return res.status(400).json({ message: 'المنتج والدفعة والكمية مطلوبة.' });
  }

  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    // التحقق من وجود الدفعة وكميتها
    const [[batch]] = await conn.query(
      `SELECT pb.*, s.name as supplier_name 
       FROM product_batches pb 
       LEFT JOIN suppliers s ON pb.supplier_id = s.id 
       WHERE pb.id = ? AND pb.product_id = ?`,
      [batch_id, product_id]
    );

    if (!batch) {
      throw new Error('الدفعة المحددة غير موجودة.');
    }

    if (batch.quantity < quantity) {
      throw new Error(`الكمية المطلوبة للإرجاع (${quantity}) أكبر من الكمية المتوفرة في الدفعة (${batch.quantity}).`);
    }

    // تحديث كمية المنتج الرئيسية
    await conn.query(
      'UPDATE products SET quantity = quantity - ? WHERE id = ?',
      [quantity, product_id]
    );

    // تحديث كمية الدفعة - التصحيح هنا
    if (batch.quantity === quantity) {
      // إذا كانت الكمية تساوي الكمية المتبقية، احذف الدفعة
      await conn.query('DELETE FROM product_batches WHERE id = ?', [batch_id]);
    } else {
      // خفض الكمية من الدفعة المحددة فقط
      await conn.query(
        'UPDATE product_batches SET quantity = quantity - ? WHERE id = ?',
        [quantity, batch_id] // الترتيب مهم: أول ? = quantity, ثاني ? = batch_id
      );
    }

    // تخزين مردود المشتريات مع معلومات إضافية
    await conn.query(
      'INSERT INTO purchase_returns (product_id, batch_id, quantity, returned_by, reason, supplier_id) VALUES (?, ?, ?, ?, ?, ?)',
      [product_id, batch_id, quantity, returned_by || null, reason || null, supplier_id || batch.supplier_id]
    );

    await conn.commit();
    res.status(201).json({ 
      message: 'تم إرجاع الكميات وتسجيل العملية بنجاح.',
      batch_info: {
        supplier: batch.supplier_name,
        remaining_quantity: batch.quantity - quantity
      }
    });

  } catch (error) {
    await conn.rollback();
    console.error('Error in createPurchaseReturn:', error);
    res.status(500).json({ message: error.message || 'حدث خطأ أثناء معالجة الطلب.' });
  } finally {
    conn.release();
  }
};

// جلب كل عمليات مردود المشتريات
exports.getAllPurchaseReturns = async (req, res) => {
  try {
    const [results] = await db.query(`
      SELECT 
        pr.*, 
        p.name AS product_name,
        p.english_name AS product_english_name,
        s.name AS supplier_name,
        u.full_name AS returned_by_name,
        pb.expiration_date,
        pb.initial_quantity as batch_initial_quantity
      FROM purchase_returns pr
      LEFT JOIN products p ON pr.product_id = p.id
      LEFT JOIN suppliers s ON pr.supplier_id = s.id
      LEFT JOIN users u ON pr.returned_by = u.id
      LEFT JOIN product_batches pb ON pr.batch_id = pb.id
      ORDER BY pr.returned_at DESC
    `);
    res.json(results);
  } catch (error) {
    console.error('Error fetching purchase returns:', error);
    res.status(500).json({ message: 'حدث خطأ أثناء جلب البيانات.' });
  }
};

// جلب الدفعات المتاحة للمنتج
exports.getProductBatches = async (req, res) => {
  const { productId } = req.params;

  try {
    const [batches] = await db.query(`
      SELECT 
        pb.*,
        s.name as supplier_name,
        s.phone as supplier_phone,
        DATEDIFF(pb.expiration_date, CURDATE()) as days_until_expiry
      FROM product_batches pb
      LEFT JOIN suppliers s ON pb.supplier_id = s.id
      WHERE pb.product_id = ? AND pb.quantity > 0
      ORDER BY pb.expiration_date ASC
    `, [productId]);

    res.json(batches);
  } catch (error) {
    console.error('Error fetching product batches:', error);
    res.status(500).json({ message: 'حدث خطأ أثناء جلب الدفعات.' });
  }
};