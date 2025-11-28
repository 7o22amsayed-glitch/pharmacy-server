const db = require("../config/db");

// @desc    Get the current drawer balance, piggy bank balance and recent transactions
// @route   GET /api/drawer
// @access  Private
const getDrawerStatus = async (req, res) => {
  try {
    const [[drawer]] = await db.query(
      "SELECT balance FROM cash_drawer WHERE id = 1"
    );
    const [[piggyBank]] = await db.query(
      "SELECT balance FROM admin_piggy_bank WHERE id = 1"
    ); // Fetch piggy bank balance

    const [transactions] = await db.query(`
      SELECT 
        dt.id,
        dt.type,
        dt.amount,
        dt.description,
        dt.from_staff_id,
        dt.customer_id,
        dt.created_at,
        u.full_name  AS user_name,
        s.full_name  AS from_staff_name,
        c.name       AS customer_name
      FROM drawer_transactions dt
      LEFT JOIN users u ON dt.user_id = u.id         
      LEFT JOIN users s ON dt.from_staff_id = s.id    
      LEFT JOIN customers c ON dt.customer_id = c.id
      ORDER BY dt.created_at DESC
      LIMIT 200
    `);

    res.json({
      success: true,
      balance: drawer.balance,
      piggyBankBalance: piggyBank ? piggyBank.balance : 0, // Ensure piggyBank exists
      transactions,
    });
  } catch (error) {
    console.error("Error fetching drawer status:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

// @desc    Manually add or withdraw cash from the drawer
// @route   POST /api/drawer/adjust
// @access  Admin
const addManualTransaction = async (req, res) => {
  const { amount, type, description, from_staff_id = null } = req.body;
  const userId = req.user.id; // Assuming user ID is available in req.user

  if (
    !amount ||
    isNaN(parseFloat(amount)) ||
    parseFloat(amount) <= 0 ||
    !type ||
    (type !== "manual_add" && type !== "manual_withdraw")
  ) {
    return res
      .status(400)
      .json({ success: false, message: "بيانات غير صالحة للمعاملة." });
  }

  // Ensure numeric with two decimals max
  let transactionAmount = parseFloat(amount);
  transactionAmount = parseFloat(transactionAmount.toFixed(2));

  // Guard against exceeding DECIMAL(10,2) range (max 99,999,999.99)
  if (transactionAmount > 99999999.99) {
    return res
      .status(400)
      .json({ success: false, message: "المبلغ كبير جدًا." });
  }

  let drawerAmountChange = 0;
  let piggyBankAmountChange = 0;

  if (type === "manual_add") {
    drawerAmountChange = transactionAmount;
    piggyBankAmountChange = -transactionAmount; // Add to drawer, deduct from piggy bank
  } else if (type === "manual_withdraw") {
    drawerAmountChange = -transactionAmount;
    piggyBankAmountChange = transactionAmount; // Withdraw from drawer, add to piggy bank
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Log the transaction in drawer_transactions table
    await connection.query(
      "INSERT INTO drawer_transactions (type, amount, description, from_staff_id, user_id) VALUES (?, ?, ?, ?, ?)",
      [type, drawerAmountChange, description, from_staff_id, userId]
    );

    // 2. Update the main cash drawer balance
    await connection.query(
      "UPDATE cash_drawer SET balance = balance + ? WHERE id = 1",
      [drawerAmountChange]
    );

    // 3. Update the admin piggy bank balance
    await connection.query(
      "UPDATE admin_piggy_bank SET balance = balance + ? WHERE id = 1",
      [piggyBankAmountChange]
    );

    await connection.commit();

    res.json({ success: true, message: "تم تعديل الدرج والخزنة بنجاح." });
  } catch (error) {
    await connection.rollback();
    console.error("Error adjusting drawer and piggy bank:", error);
    res.status(500).json({
      success: false,
      message: "خطأ في الخادم أثناء تعديل الدرج والخزنة.",
    });
  } finally {
    connection.release();
  }
};

// سحب مباشر من الخزنة بواسطة المدير
const withdrawFromPiggyBank = async (req, res) => {
  const { amount, description } = req.body;
  const userId = req.user.id;

  if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
    return res
      .status(400)
      .json({ success: false, message: "المبلغ غير صالح." });
  }

  let transactionAmount = parseFloat(amount);
  transactionAmount = parseFloat(transactionAmount.toFixed(2));

  if (transactionAmount > 99999999.99) {
    return res
      .status(400)
      .json({ success: false, message: "المبلغ كبير جدًا." });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // سجل العملية في جدول خاص (ممكن نعيد استخدام نفس الجدول لو عايز)
    await connection.query(
      "INSERT INTO drawer_transactions (type, amount, description, user_id) VALUES (?, ?, ?, ?)",
      [
        "piggy_withdraw",
        -transactionAmount,
        description || "سحب من الخزنة",
        userId,
      ]
    );

    // خصم من الخزنة
    const [rows] = await connection.query(
      "SELECT balance FROM admin_piggy_bank WHERE id = 1"
    );

    if (!rows.length || rows[0].balance < transactionAmount) {
      await connection.rollback();
      return res
        .status(400)
        .json({ success: false, message: "الرصيد غير كافي في الخزنة." });
    }

    await connection.query(
      "UPDATE admin_piggy_bank SET balance = balance - ? WHERE id = 1",
      [transactionAmount]
    );

    await connection.commit();
    res.json({ success: true, message: "تم السحب من الخزنة بنجاح." });
  } catch (error) {
    await connection.rollback();
    console.error("Error withdrawing from piggy bank:", error);
    res.status(500).json({ success: false, message: "خطأ في الخادم." });
  } finally {
    connection.release();
  }
};

// POST /shifts/start
const startShift = async (req, res) => {
  const userId = req.user.id;
  const [existing] = await db.query(
    "SELECT * FROM shifts WHERE user_id=? AND end_time IS NULL",
    [userId]
  );
  if (existing.length > 0) {
    return res.status(400).json({ message: "يوجد شفت مفتوح بالفعل" });
  }

  await db.query("INSERT INTO shifts (user_id, start_time) VALUES (?, NOW())", [
    userId,
  ]);
  res.json({ success: true, message: "تم بدء الشفت" });
};

// POST /shifts/end
// في ملف drawerController.js - تحديث دالة endShift
const endShift = async (req, res) => {
  const userId = req.user.id;

  try {
    const [shift] = await db.query(
      "SELECT * FROM shifts WHERE user_id=? AND end_time IS NULL ORDER BY id DESC LIMIT 1",
      [userId]
    );
    
    if (!shift.length) {
      return res.status(400).json({ message: "لا يوجد شفت مفتوح" });
    }

    const openShift = shift[0];
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      // حساب المبيعات والمعاملات خلال فترة الشفت
      const [salesResult] = await connection.query(
        `SELECT 
          COALESCE(SUM(CASE WHEN type IN ('sale', 'sale_payment') THEN amount ELSE 0 END), 0) as total_sales,
          COUNT(*) as total_transactions
         FROM drawer_transactions 
         WHERE (from_staff_id = ? OR user_id = ?) 
         AND created_at BETWEEN ? AND NOW()`,
        [userId, userId, openShift.start_time]
      );

      const totalSales = parseFloat(salesResult[0].total_sales) || 0;
      const totalTransactions = parseInt(salesResult[0].total_transactions) || 0;

      // تحديث الشفت
      await connection.query(
        "UPDATE shifts SET end_time=NOW(), total_sales=?, total_transactions=? WHERE id=?",
        [totalSales, totalTransactions, openShift.id]
      );

      await connection.commit();

      res.json({
        success: true,
        message: "تم إنهاء الشفت بنجاح",
        report: {
          total_sales: totalSales,
          total_transactions: totalTransactions
        },
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("Error ending shift:", error);
    res.status(500).json({ 
      success: false, 
      message: "خطأ في إنهاء الشفت" 
    });
  }
};


// في drawerController.js - إضافة دالة جديدة للإحصائيات
const getShiftStats = async (req, res) => {
  try {
    const shiftId = req.params.id;
    
    const [shift] = await db.query(
      "SELECT * FROM shifts WHERE id = ?",
      [shiftId]
    );

    if (!shift.length) {
      return res.status(404).json({ success: false, message: "الشفت غير موجود" });
    }

    // حساب إحصائيات الشفت
    const [stats] = await db.query(
      `SELECT 
        COALESCE(SUM(CASE WHEN type IN ('sale', 'sale_payment') THEN amount ELSE 0 END), 0) as totalSales,
        COUNT(*) as transactionsCount,
        COALESCE(SUM(CASE WHEN type = 'return' THEN amount ELSE 0 END), 0) as totalReturns
       FROM drawer_transactions 
       WHERE (from_staff_id = ? OR user_id = ?) 
       AND created_at BETWEEN ? AND COALESCE(?, NOW())`,
      [shift[0].user_id, shift[0].user_id, shift[0].start_time, shift[0].end_time]
    );

    res.json({
      totalSales: parseFloat(stats[0].totalSales) || 0,
      transactionsCount: parseInt(stats[0].transactionsCount) || 0,
      totalReturns: parseFloat(stats[0].totalReturns) || 0
    });
  } catch (error) {
    console.error("Error fetching shift stats:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

// GET /api/shifts/my
const getMyShifts = async (req, res) => {
  const userId = req.user.id;
  const [rows] = await db.query(
    "SELECT * FROM shifts WHERE user_id=? ORDER BY start_time DESC",
    [userId]
  );
  res.json(rows);
};

// GET /api/shifts/all
const getAllShifts = async (req, res) => {
  const [rows] = await db.query(
    `SELECT s.*, u.full_name
     FROM shifts s
     JOIN users u ON s.user_id = u.id
     ORDER BY s.start_time DESC`
  );
  res.json(rows);
};

// @desc    Get shift details
// @route   GET /api/shifts/:id
// @access  Admin
const getShiftDetails = async (req, res) => {
  try {
    const [shift] = await db.query(
      `SELECT 
        s.*, 
        u.full_name,
        CASE 
          WHEN s.end_time IS NULL THEN 'مفتوح'
          ELSE 'مغلق'
        END as status
       FROM shifts s 
       JOIN users u ON s.user_id = u.id 
       WHERE s.id = ?`,
      [req.params.id]
    );

    if (!shift.length) {
      return res.status(404).json({ success: false, message: "الشفت غير موجود" });
    }

    // التصحيح هنا: تغيير success: false إلى success: true
    res.json({ success: true, data: shift[0] });
  } catch (error) {
    console.error("Error fetching shift details:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

// @desc    Get shift sales
// @route   GET /api/shifts/:id/sales
// @access  Admin
const getShiftSales = async (req, res) => {
  try {
    const [sales] = await db.query(
      `SELECT s.*, c.name as customer_name 
       FROM sales s 
       LEFT JOIN customers c ON s.customer_id = c.id 
       WHERE s.staff_id = (SELECT user_id FROM shifts WHERE id = ?)
       AND s.created_at BETWEEN 
         (SELECT start_time FROM shifts WHERE id = ?) 
         AND COALESCE((SELECT end_time FROM shifts WHERE id = ?), NOW())
       ORDER BY s.created_at DESC`,
      [req.params.id, req.params.id, req.params.id]
    );

    res.json(sales);
  } catch (error) {
    console.error("Error fetching shift sales:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

// @desc    Get shift transactions
// @route   GET /api/shifts/:id/transactions
// @access  Admin
const getShiftTransactions = async (req, res) => {
  try {
    const [transactions] = await db.query(
      `SELECT dt.*, u.full_name as user_name 
       FROM drawer_transactions dt 
       LEFT JOIN users u ON dt.from_staff_id = u.id 
       WHERE dt.from_staff_id = (SELECT user_id FROM shifts WHERE id = ?)
       AND dt.created_at BETWEEN 
         (SELECT start_time FROM shifts WHERE id = ?) 
         AND COALESCE((SELECT end_time FROM shifts WHERE id = ?), NOW())
       ORDER BY dt.created_at DESC`,
      [req.params.id, req.params.id, req.params.id]
    );

    res.json(transactions);
  } catch (error) {
    console.error("Error fetching shift transactions:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

// @desc    Get shift returns
// @route   GET /api/shifts/:id/returns
// @access  Admin
const getShiftReturns = async (req, res) => {
  try {
    const [returns] = await db.query(
      `SELECT sr.*, p.name as product_name, u.full_name 
       FROM sale_returns sr 
       JOIN products p ON sr.product_id = p.id 
       JOIN users u ON sr.returned_by = u.id 
       WHERE sr.returned_by = (SELECT user_id FROM shifts WHERE id = ?)
       AND sr.returned_at BETWEEN 
         (SELECT start_time FROM shifts WHERE id = ?) 
         AND COALESCE((SELECT end_time FROM shifts WHERE id = ?), NOW())
       ORDER BY sr.returned_at DESC`,
      [req.params.id, req.params.id, req.params.id]
    );

    res.json(returns);
  } catch (error) {
    console.error("Error fetching shift returns:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
};

// تحديث التصدير في الـ controller
module.exports = {
  getDrawerStatus,
  addManualTransaction,
  withdrawFromPiggyBank,
  startShift,
  endShift,
  getMyShifts,
  getAllShifts,
  getShiftDetails,
  getShiftStats,
  getShiftSales,
  getShiftTransactions,
  getShiftReturns
};

