const pool = require('../config/db');

// GET /api/discount-codes
exports.getAll = async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT 
        id, code, percentage, description, is_active,
        max_uses, valid_until, used_count,
        created_at, updated_at
      FROM discount_codes 
      ORDER BY created_at DESC
    `);
    
    // حساب الإحصائيات
    const stats = {
      total: rows.length,
      active: rows.filter(code => code.is_active).length,
      expired: rows.filter(code => 
        code.valid_until && new Date(code.valid_until) < new Date()
      ).length,
      totalDiscount: rows.reduce((sum, code) => sum + code.percentage, 0)
    };

    res.json({ 
      success: true, 
      data: rows,
      stats 
    });
  } catch (err) {
    console.error('Error fetching discount codes', err);
    res.status(500).json({ success: false, message: 'خطأ في الخادم.' });
  }
};

// POST /api/discount-codes
exports.create = async (req, res) => {
  const { 
    code, 
    percentage, 
    description = '', 
    max_uses = null, 
    valid_until = null,
    is_active = 1 
  } = req.body;

  if (!code || !percentage) {
    return res.status(400).json({ 
      success: false, 
      message: 'الكود ونسبة الخصم مطلوبان.' 
    });
  }

  try {
    const [result] = await pool.execute(
      `INSERT INTO discount_codes 
       (code, percentage, description, max_uses, valid_until, is_active) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        code.toUpperCase(), 
        percentage, 
        description,
        max_uses,
        valid_until,
        is_active
      ]
    );

    res.json({ 
      success: true, 
      message: 'تم إضافة كود الخصم بنجاح.',
      id: result.insertId 
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ 
        success: false, 
        message: 'كود الخصم موجود مسبقًا.' 
      });
    }
    console.error('Error adding discount code', err);
    res.status(500).json({ 
      success: false, 
      message: 'خطأ في إضافة كود الخصم.' 
    });
  }
};

// PUT /api/discount-codes/:id
exports.update = async (req, res) => {
  const { id } = req.params;
  const { 
    code, 
    percentage, 
    description, 
    max_uses, 
    valid_until, 
    is_active 
  } = req.body;

  // التحقق من وجود البيانات المطلوبة
  if (!code || percentage === undefined) {
    return res.status(400).json({ 
      success: false, 
      message: 'الكود ونسبة الخصم مطلوبان.' 
    });
  }

  try {
    // التحقق من وجود الكود
    const [existing] = await pool.execute(
      'SELECT id FROM discount_codes WHERE id = ?',
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'كود الخصم غير موجود.' 
      });
    }

    // التحقق من عدم تكرار الكود (باستثناء الكود الحالي)
    const [duplicate] = await pool.execute(
      'SELECT id FROM discount_codes WHERE code = ? AND id != ?',
      [code.toUpperCase(), id]
    );

    if (duplicate.length > 0) {
      return res.status(409).json({ 
        success: false, 
        message: 'كود الخصم موجود مسبقًا.' 
      });
    }

    await pool.execute(
      `UPDATE discount_codes 
       SET code = ?, percentage = ?, description = ?, 
           max_uses = ?, valid_until = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        code.toUpperCase(), 
        percentage, 
        description,
        max_uses,
        valid_until,
        is_active,
        id
      ]
    );

    res.json({ 
      success: true, 
      message: 'تم تحديث كود الخصم بنجاح.' 
    });
  } catch (err) {
    console.error('Error updating discount code', err);
    res.status(500).json({ 
      success: false, 
      message: 'خطأ في تحديث كود الخصم.' 
    });
  }
};

// PATCH /api/discount-codes/:id/toggle-status
exports.toggleStatus = async (req, res) => {
  const { id } = req.params;

  try {
    // الحصول على الحالة الحالية
    const [codes] = await pool.execute(
      'SELECT is_active FROM discount_codes WHERE id = ?',
      [id]
    );

    if (codes.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'كود الخصم غير موجود.' 
      });
    }

    const newStatus = !codes[0].is_active;

    await pool.execute(
      'UPDATE discount_codes SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [newStatus, id]
    );

    res.json({ 
      success: true, 
      message: `تم ${newStatus ? 'تفعيل' : 'تعطيل'} الكود بنجاح.`,
      is_active: newStatus 
    });
  } catch (err) {
    console.error('Error toggling discount code status', err);
    res.status(500).json({ 
      success: false, 
      message: 'خطأ في تغيير حالة الكود.' 
    });
  }
};

// DELETE /api/discount-codes/:id
exports.remove = async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await pool.execute(
      'DELETE FROM discount_codes WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'كود الخصم غير موجود.' 
      });
    }

    res.json({ 
      success: true, 
      message: 'تم حذف كود الخصم بنجاح.' 
    });
  } catch (err) {
    console.error('Error deleting discount code', err);
    res.status(500).json({ 
      success: false, 
      message: 'خطأ في حذف كود الخصم.' 
    });
  }
};

// GET /api/discount-codes/validate/:code
exports.validate = async (req, res) => {
  const { code } = req.params;

  try {
    const [rows] = await pool.execute(
      `SELECT 
        id, percentage, max_uses, used_count, valid_until 
       FROM discount_codes 
       WHERE code = ? AND is_active = 1`,
      [code.toUpperCase()]
    );

    if (rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'كود الخصم غير صالح أو غير موجود.' 
      });
    }

    const discountCode = rows[0];
    const now = new Date();

    // التحقق من الصلاحية
    if (discountCode.valid_until && new Date(discountCode.valid_until) < now) {
      return res.status(400).json({ 
        success: false, 
        message: 'كود الخصم منتهي الصلاحية.' 
      });
    }

    // التحقق من الحد الأقصى للاستخدام
    if (discountCode.max_uses && discountCode.used_count >= discountCode.max_uses) {
      return res.status(400).json({ 
        success: false, 
        message: 'تم تجاوز الحد الأقصى لاستخدام هذا الكود.' 
      });
    }

    res.json({ 
      success: true, 
      percentage: discountCode.percentage,
      code_id: discountCode.id 
    });
  } catch (err) {
    console.error('Error validating discount code', err);
    res.status(500).json({ 
      success: false, 
      message: 'خطأ في التحقق من كود الخصم.' 
    });
  }
};

// POST /api/discount-codes/:id/use
exports.useCode = async (req, res) => {
  const { id } = req.params;
  const { user_id, order_id } = req.body;

  try {
    // بداية transaction
    await pool.execute('START TRANSACTION');

    // التحقق من صحة الكود
    const [codes] = await pool.execute(
      `SELECT max_uses, used_count, valid_until 
       FROM discount_codes 
       WHERE id = ? AND is_active = 1`,
      [id]
    );

    if (codes.length === 0) {
      await pool.execute('ROLLBACK');
      return res.status(404).json({ 
        success: false, 
        message: 'كود الخصم غير صالح.' 
      });
    }

    const discountCode = codes[0];
    const now = new Date();

    // التحقق من الصلاحية
    if (discountCode.valid_until && new Date(discountCode.valid_until) < now) {
      await pool.execute('ROLLBACK');
      return res.status(400).json({ 
        success: false, 
        message: 'كود الخصم منتهي الصلاحية.' 
      });
    }

    // التحقق من الحد الأقصى للاستخدام
    if (discountCode.max_uses && discountCode.used_count >= discountCode.max_uses) {
      await pool.execute('ROLLBACK');
      return res.status(400).json({ 
        success: false, 
        message: 'تم تجاوز الحد الأقصى لاستخدام هذا الكود.' 
      });
    }

    // تحديث عدد مرات الاستخدام
    await pool.execute(
      'UPDATE discount_codes SET used_count = used_count + 1 WHERE id = ?',
      [id]
    );



    await pool.execute('COMMIT');

    res.json({ 
      success: true, 
      message: 'تم استخدام كود الخصم بنجاح.' 
    });
  } catch (err) {
    await pool.execute('ROLLBACK');
    console.error('Error using discount code', err);
    res.status(500).json({ 
      success: false, 
      message: 'خطأ في استخدام كود الخصم.' 
    });
  }
};

// GET /api/discount-codes/stats
exports.getStats = async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT 
        COUNT(*) as total,
        SUM(is_active = 1) as active,
        SUM(valid_until < NOW() AND is_active = 1) as expired,
        AVG(percentage) as average_discount,
        SUM(used_count) as total_uses
      FROM discount_codes
    `);

    const stats = rows[0];

    res.json({
      success: true,
      data: {
        total: stats.total,
        active: stats.active,
        expired: stats.expired,
        averageDiscount: Math.round(stats.average_discount || 0),
        totalUses: stats.total_uses
      }
    });
  } catch (err) {
    console.error('Error fetching discount codes stats', err);
    res.status(500).json({ 
      success: false, 
      message: 'خطأ في جلب الإحصائيات.' 
    });
  }
};