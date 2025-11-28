// backend/controllers/saleController.js
const pool = require("../config/db");

exports.searchProduct = async (req, res) => {
  const { query } = req.query;
  console.log("Search request for:", query); // سجل الطلب الوارد

  try {
    const isBarcodeSearch = /^\d{8,}$/.test(query);
    console.log("Is barcode search:", isBarcodeSearch);

    let sql = `
      SELECT id, name, barcode, price, quantity, strips_per_box, partial_strips, 
             available_in_pharmacy, available_online 
      FROM products 
      WHERE ${isBarcodeSearch ? "barcode = ?" : "name LIKE ?"} 
      AND (available_in_pharmacy = 1 OR available_online = 1)
    `;
    let params = [isBarcodeSearch ? query : `%${query}%`];

    console.log("Executing SQL:", sql, "With params:", params); // سجل الاستعلام

    const [rows] = await pool.execute(sql, params);
    console.log("Found rows:", rows); // سجل النتائج

    if (rows.length > 0) {
      if (isBarcodeSearch && rows.length === 1) {
        // إذا تم العثور على منتج واحد (مثل مطابقة الباركود)، أعد كائن منتج واحد
        res.json({ success: true, product: rows[0] });
      } else {
        // بخلاف ذلك، أعد مصفوفة من المنتجات
        res.json({ success: true, products: rows });
      }
    } else {
      console.log("No products found for query:", query); // سجل حالات عدم العثور
      res.status(404).json({
        success: false,
        message: isBarcodeSearch
          ? "المنتج غير متوفر حاليًا في الفرع (الباركود: " + query + ")"
          : "المنتج غير موجود.",
      });
    }
  } catch (error) {
    console.error("Error searching product:", error);
    res.status(500).json({
      success: false,
      message: "خطأ في الخادم عند البحث عن المنتج.",
      error: error.message,
    });
  }
};

exports.searchProductByName = async (req, res) => {
  const { query } = req.query;
  console.log("Search request for:", query);

  try {
    // البحث بالاسم (العربي أو الإنجليزي)
    let sql = `
      SELECT id, name, english_name, barcode, price, quantity, strips_per_box, partial_strips, 
             available_in_pharmacy, available_online 
      FROM products 
      WHERE (name LIKE ? OR english_name LIKE ?)
      AND (available_in_pharmacy = 1 OR available_online = 1)
      ORDER BY 
        CASE 
          WHEN name = ? THEN 1
          WHEN name LIKE ? THEN 2
          WHEN english_name = ? THEN 3
          WHEN english_name LIKE ? THEN 4
          ELSE 5
        END,
        name
      LIMIT 10
    `;
    
    let params = [
      `%${query}%`, `%${query}%`,  // للبحث العام
      query, `${query}%`,          // للمطابقة التامة والبداية بالعربي
      query, `${query}%`           // للمطابقة التامة والبداية بالإنجليزي
    ];

    console.log("Executing SQL:", sql, "With params:", params);

    const [rows] = await pool.execute(sql, params);
    console.log("Found products:", rows.length);

    if (rows.length > 0) {
      res.json({ 
        success: true, 
        products: rows 
      });
    } else {
      console.log("No products found for query:", query);
      res.status(404).json({
        success: false,
        message: "لم يتم العثور على منتجات تطابق '" + query + "'",
      });
    }
  } catch (error) {
    console.error("Error searching product by name:", error);
    res.status(500).json({
      success: false,
      message: "خطأ في الخادم عند البحث عن المنتج.",
      error: error.message,
    });
  }
};

exports.completeSale = async (req, res) => {
  const {
    saleItems,
    staffId,
    paymentMethod = "cash",
    discountAmount = 0,
    discountPercentage = 0,
    customerId = null, // قد يرسل الفرونت customerId
    newCustomer = null, // أو يرسل object { name, phone } لإنشاء عميل جديد
    paidAmount = 0, // المبلغ المدفوع الآن (قد يكون أقل من الإجمالي => مديونية)
  } = req.body;

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 1) لو فيه newCustomer نضيفه ونجيب الـ id
    let resolvedCustomerId = customerId;
    let resolvedCustomerName = null;
    if (newCustomer && newCustomer.name) {
      const [cRes] = await connection.execute(
        "INSERT INTO customers (name, phone) VALUES (?, ?)",
        [newCustomer.name, newCustomer.phone || null]
      );
      resolvedCustomerId = cRes.insertId;
      resolvedCustomerName = newCustomer.name;
    } else if (customerId) {
      const [[cust]] = await connection.execute(
        "SELECT name FROM customers WHERE id = ?",
        [customerId]
      );
      resolvedCustomerName = cust ? cust.name : null;
    }

    // 2) حساب الإجمالي
    let totalSaleAmount = 0;
    const saleItemsWithDetails = [];

    for (const item of saleItems) {
      const [[product]] = await connection.execute(
        "SELECT id, name, price, strips_per_box, partial_strips FROM products WHERE id = ?",
        [item.productId]
      );

      if (!product) {
        throw new Error(`المنتج بالمعرف ${item.productId} غير موجود.`);
      }

      const stripsPerBox =
        product.strips_per_box > 0 ? product.strips_per_box : 1;
      let itemPrice;
      let quantityInBaseUnit = item.quantity;

      if (item.unitType === "box") {
        itemPrice = parseFloat(product.price);
        quantityInBaseUnit = item.quantity * stripsPerBox;
      } else {
        if (stripsPerBox === 1) {
          throw new Error(`المنتج ${product.name} لا يمكن بيعه بالشريط.`);
        }
        itemPrice = parseFloat(product.price) / stripsPerBox;
      }

      totalSaleAmount += itemPrice * item.quantity;

      saleItemsWithDetails.push({
        ...item,
        price: itemPrice,
        quantityInBaseUnit,
        stripsPerBox,
        productName: product.name,
      });
    }

    // 3) الخصومات
    let appliedDiscountPercentage = 0;
    let appliedDiscountAmount = 0;
    if (typeof discountPercentage === "number" && discountPercentage > 0) {
      appliedDiscountPercentage = discountPercentage;
      appliedDiscountAmount = +(
        totalSaleAmount *
        (appliedDiscountPercentage / 100)
      ).toFixed(2);
    } else if (typeof discountAmount === "number" && discountAmount > 0) {
      appliedDiscountAmount = discountAmount;
      appliedDiscountPercentage = +(
        (discountAmount / totalSaleAmount) *
        100
      ).toFixed(2);
    }
    let finalAmount = +(totalSaleAmount - appliedDiscountAmount).toFixed(2);

    // 4) خصم الكميات من الباتشات
    for (const item of saleItemsWithDetails) {
      if (item.unitType === "strip") {
        await deductStripsFromBatches(
          connection,
          item.productId,
          item.quantity
        );
      } else {
        await deductBoxesFromBatches(connection, item.productId, item.quantity);
      }
      await updateProductTotals(connection, item.productId);
    }

    // 5) إنشاء سجل البيع
    const [saleResult] = await connection.execute(
      "INSERT INTO sales (staff_id, total, payment_method, customer_id, paid_amount, initial_total) VALUES (?, ?, ?, ?, ?, ?)",
      [
        staffId,
        finalAmount,
        paymentMethod,
        resolvedCustomerId,
        parseFloat(paidAmount) || 0,
        finalAmount,
      ]
    );
    const saleId = saleResult.insertId;

    // تفاصيل البيع
    const saleItemsValues = saleItemsWithDetails
      .map(
        (item) =>
          `(${saleId}, ${item.productId}, ${item.quantity}, ${item.price}, '${item.unitType}')`
      )
      .join(", ");
    if (saleItemsValues) {
      await connection.execute(
        `INSERT INTO sale_items (sale_id, product_id, quantity, price, unit_type) VALUES ${saleItemsValues}`
      );
    }

    // 6) تحديث الدرج لو فيه دفعة
    const paidNow = +(paidAmount || 0);
    if (paidNow > 0) {
      await connection.execute(
        "UPDATE cash_drawer SET balance = balance + ? WHERE id = 1",
        [paidNow]
      );
      await connection.execute(
        "INSERT INTO drawer_transactions (type, amount, description, from_staff_id, sale_id, customer_id) VALUES (?, ?, ?, ?, ?, ?)",
        [
          "sale_payment",
          paidNow,
          `دفعة من بيع #${saleId}`,
          staffId,
          saleId,
          resolvedCustomerId,
        ]
      );
    }

    // 7) تسجيل الدين لو فيه باقي
    const remainingDebt = +(finalAmount - paidNow).toFixed(2);
    if (remainingDebt > 0) {
      const debtCustomerName =
        resolvedCustomerName || req.body.customerName || "عميل نقدي";

      const [debtRes] = await connection.execute(
        `INSERT INTO debts (customer_id, customer_name, amount, amount_paid, notes, user_id, origin_sale_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          resolvedCustomerId,
          debtCustomerName,
          finalAmount,
          paidNow,
          `باقي فاتورة #${saleId}`,
          staffId,
          saleId,
        ]
      );

      const debtId = debtRes.insertId;

      // await connection.execute(
      //   "INSERT INTO drawer_transactions (type, amount, description, from_staff_id, debt_id, customer_id, sale_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      //   [
      //     "debt_registered",
      //     -remainingDebt,
      //     `تسجيل باقي فاتورة #${saleId}`,
      //     staffId,
      //     debtId,
      //     resolvedCustomerId,
      //     saleId,
      //   ]
      // );
    }

    // 8) سجل الخصم إن وجد
    if (appliedDiscountAmount > 0) {
      await connection.execute(
        "INSERT INTO discounts (sale_id, percentage, amount, created_by) VALUES (?, ?, ?, ?)",
        [saleId, appliedDiscountPercentage, appliedDiscountAmount, staffId]
      );
    }

    // 9) تحديث إجمالي البيع والدفعة
    await connection.execute("UPDATE sales SET paid_amount = ? WHERE id = ?", [
      paidNow,
      saleId,
    ]);

    // 10) توليد باركود للفاتورة
    const barcode = `S${saleId}${Date.now().toString().slice(-6)}`;
    await connection.execute(
      "UPDATE sales SET invoice_barcode = ? WHERE id = ?",
      [barcode, saleId]
    );

    await connection.commit();
    connection.release();

    res.status(201).json({
      success: true,
      message: "تمت عملية البيع بنجاح.",
      saleId,
      invoiceBarcode: barcode,
      customerName:
        resolvedCustomerName || req.body.customerName || "عميل نقدي",
      items: saleItemsWithDetails.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        unitType: item.unitType,
        quantity: item.quantity,
        unitPrice: item.price,
        total: +(item.price * item.quantity).toFixed(2),
      })),
      totals: {
        totalBeforeDiscount: totalSaleAmount,
        discountAmount: appliedDiscountAmount,
        finalAmount,
        paidAmount: paidNow,
        debtAmount: remainingDebt,
      },
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    console.error("Error completing sale:", error);
    res.status(500).json({
      success: false,
      message: error.message || "خطأ في الخادم عند إتمام عملية البيع.",
    });
  }
};

// --- واجهة createSale القديمة للحفاظ على التوافق مع المسارات القديمة ---
// ببساطة تستدعي الدالة completeSale الحالية.
exports.createSale = async (req, res) => {
  return exports.completeSale(req, res);
};

// دالة مساعدة لخصم الشرائط من الدُفعات مع تحويل العلب عند الحاجة
async function deductStripsFromBatches(
  connection,
  productId,
  quantityToDeduct
) {
  // جلب معلومات المنتج
  const [[product]] = await connection.execute(
    "SELECT strips_per_box FROM products WHERE id = ?",
    [productId]
  );

  if (!product) {
    throw new Error(`المنتج غير موجود (ID: ${productId})`);
  }

  const stripsPerBox = product.strips_per_box || 1;

  // جلب الدفعات مع العلب والشرائط
  const [batches] = await connection.execute(
    "SELECT id, quantity, strips_count FROM product_batches WHERE product_id = ? AND (quantity > 0 OR strips_count > 0) ORDER BY expiration_date ASC, created_at ASC",
    [productId]
  );

  let remainingToDeduct = quantityToDeduct;

  for (const batch of batches) {
    if (remainingToDeduct <= 0) break;

    // أولاً: خصم من الشرائط المتوفرة
    if (batch.strips_count > 0) {
      const deductFromStrips = Math.min(batch.strips_count, remainingToDeduct);

      await connection.execute(
        "UPDATE product_batches SET strips_count = strips_count - ? WHERE id = ?",
        [deductFromStrips, batch.id]
      );

      remainingToDeduct -= deductFromStrips;
    }

    // ثانياً: إذا لا تزال هناك حاجة، حول العلب إلى شرائط
    if (remainingToDeduct > 0 && batch.quantity > 0) {
      const boxesToConvert = Math.min(
        batch.quantity,
        Math.ceil(remainingToDeduct / stripsPerBox)
      );

      const stripsFromBoxes = boxesToConvert * stripsPerBox;
      const actualDeduct = Math.min(stripsFromBoxes, remainingToDeduct);
      const leftoverStrips = stripsFromBoxes - actualDeduct;

      // خصم العلب وإضافة الشرائط المتبقية
      await connection.execute(
        "UPDATE product_batches SET quantity = quantity - ?, strips_count = strips_count + ? WHERE id = ?",
        [boxesToConvert, leftoverStrips, batch.id]
      );

      remainingToDeduct -= actualDeduct;
    }
  }

  if (remainingToDeduct > 0) {
    throw new Error(
      `الكمية المتوفرة للمنتج ${productId} غير كافية. المطلوب: ${quantityToDeduct}, المتبقي: ${remainingToDeduct}`
    );
  }
}

// دالة مساعدة لخصم العلب من الدُفعات
async function deductBoxesFromBatches(connection, productId, quantityToDeduct) {
  const [batches] = await connection.execute(
    "SELECT id, quantity FROM product_batches WHERE product_id = ? AND quantity > 0 ORDER BY expiration_date ASC, created_at ASC",
    [productId]
  );

  const totalAvailableQuantity = batches.reduce(
    (sum, batch) => sum + batch.quantity,
    0
  );

  if (totalAvailableQuantity < quantityToDeduct) {
    throw new Error(
      `الكمية المتوفرة للمنتج ${productId} في الدُفعات غير كافية. المطلوب: ${quantityToDeduct}, المتوفر: ${totalAvailableQuantity}`
    );
  }

  let remainingToDeduct = quantityToDeduct;

  for (const batch of batches) {
    if (remainingToDeduct <= 0) break;

    const deductAmount = Math.min(batch.quantity, remainingToDeduct);

    await connection.execute(
      "UPDATE product_batches SET quantity = quantity - ? WHERE id = ?",
      [deductAmount, batch.id]
    );

    remainingToDeduct -= deductAmount;
  }
}

// دالة مساعدة لتحديث إجمالي الكمية في جدول products
async function updateProductTotals(connection, productId) {
  const [[{ total_quantity }]] = await connection.execute(
    "SELECT SUM(quantity) as total_quantity FROM product_batches WHERE product_id = ?",
    [productId]
  );
  const [[{ strips_count }]] = await connection.execute(
    "SELECT SUM(strips_count) as strips_count FROM product_batches WHERE product_id = ?",
    [productId]
  );
  // لاحظ أن جدول products يستخدم عمود partial_strips لتخزين الشرائط المتبقية
  await connection.execute(
    "UPDATE products SET quantity = ?, partial_strips = ? WHERE id = ?",
    [total_quantity || 0, strips_count || 0, productId]
  );
}

exports.getSalesHistory = async (req, res) => {
  try {
    const [rows] = await pool.execute(`
        SELECT
          s.id AS saleId,
          s.total AS saleTotal,
          s.payment_method AS paymentMethod,
          s.created_at AS saleDate,
          u.full_name AS staffName,
          c.name AS customerName,
          IFNULL(SUM(d.amount),0) AS amountDiscount,
          IFNULL(SUM(d.percentage),0) AS percentageDiscount,
          IFNULL(SUM(db.amount),0) AS debtAmount,
          IFNULL(SUM(db.amount_paid),0) AS amountPaid,
          IFNULL(SUM(db.remaining_amount),0) AS remainingAmount
        FROM sales s
        LEFT JOIN users u ON s.staff_id = u.id
        LEFT JOIN discounts d ON d.sale_id = s.id
        LEFT JOIN debts db ON db.origin_sale_id = s.id
        LEFT JOIN customers c ON c.id = s.customer_id
        GROUP BY s.id, s.total, s.payment_method, s.created_at, u.full_name
        ORDER BY s.created_at DESC
      `);
    res.json({ success: true, sales: rows });
  } catch (error) {
    console.error("Error fetching sales history:", error);
    res
      .status(500)
      .json({ success: false, message: "خطأ في الخادم عند جلب سجل المبيعات." });
  }
};

exports.getSaleDetails = async (req, res) => {
  const { saleId } = req.params;
  try {
    // الحصول على تفاصيل العناصر داخل عملية البيع
    const [saleItems] = await pool.execute(
      `
        SELECT
          si.quantity,
          si.price,
          si.unit_type AS unitType, -- جديد: جلب unit_type
          p.name AS productName,
          p.barcode,
          p.strips_per_box -- تضمين strips_per_box لفهم نوع الوحدة المباعة
        FROM sale_items si
        JOIN products p ON si.product_id = p.id
        WHERE si.sale_id = ?
      `,
      [saleId]
    );

    // الحصول على معلومات البيع العامة
    const [saleInfo] = await pool.execute(
      `
    SELECT
      s.id AS saleId,
      s.total AS saleTotal,
      s.payment_method AS paymentMethod,
      s.created_at AS saleDate,
      u.full_name AS staffName,
      c.name AS customerName
    FROM sales s
    LEFT JOIN users u ON s.staff_id = u.id
    LEFT JOIN customers c ON c.id = s.customer_id
    WHERE s.id = ?
  `,
      [saleId]
    );

    if (saleInfo.length > 0) {
      // تحويل السعر إلى رقم لعناصر البيع
      const parsedSaleItems = saleItems.map((item) => ({
        ...item,
        price: parseFloat(item.price), // التأكد من أن السعر رقم
      }));

      // الحصول على تفاصيل الخصم لهذا البيع
      const [discounts] = await pool.execute(
        `SELECT 
                d.id AS discountId,
                d.amount AS discountAmount,
                d.percentage AS discountPercentage,
                COALESCE(u.full_name, su.full_name) AS employeeName,
                s.id AS saleId
             FROM discounts d
             LEFT JOIN users u ON d.created_by = u.id
             LEFT JOIN sales s ON d.sale_id = s.id
             LEFT JOIN users su ON s.staff_id = su.id
             WHERE d.sale_id = ?`,
        [saleId]
      );

      const [debts] = await pool.execute(
        `SELECT 
        d.id AS debtId,
        d.customer_name AS customerName,
        d.amount AS debtAmount,
        d.amount_paid AS debtPaid,
        d.remaining_amount AS debtRemaining,
        d.notes AS debtNotes,
        d.user_id AS debtUserId,
        d.created_at AS debtCreatedAt,
        d.updated_at AS debtUpdatedAt
     FROM debts d
     WHERE d.origin_sale_id = ?`,
        [saleId]
      );

      res.json({
        success: true,
        sale: saleInfo[0],
        items: parsedSaleItems,
        discounts,
        debts,
      });
    } else {
      res.status(404).json({ success: false, message: "البيع غير موجود." });
    }
  } catch (error) {
    console.error("Error fetching sale details:", error);
    res
      .status(500)
      .json({ success: false, message: "خطأ في الخادم عند جلب تفاصيل البيع." });
  }
};

exports.getTopSellingProducts = async (req, res) => {
  try {
    const [rows] = await pool.execute(`
        SELECT
          p.name AS productName,
          SUM(si.quantity) AS totalQuantitySold
        FROM sale_items si
        JOIN products p ON si.product_id = p.id
        GROUP BY p.id, p.name
        ORDER BY totalQuantitySold DESC
        LIMIT 5
      `);
    res.json({ success: true, topSellingProducts: rows });
  } catch (error) {
    console.error("Error fetching top selling products:", error);
    res.status(500).json({
      success: false,
      message: "خطأ في الخادم عند جلب المنتجات الأكثر مبيعًا.",
    });
  }
};

exports.getDailySalesSummary = async (req, res) => {
  try {
    // الحصول على تاريخ الإغلاق الأخير
    const [[lastDrawer]] = await pool.execute(
      "SELECT closing_date FROM daily_drawer ORDER BY closing_date DESC LIMIT 1"
    );
    const lastClosingDate = lastDrawer ? lastDrawer.closing_date : null;

    // حساب إجمالي المبيعات النقدية منذ الإغلاق الأخير
    const [rows] = await pool.execute(
      `
      SELECT SUM(total) as totalCashSales
      FROM sales
      WHERE payment_method = 'cash' AND created_at > ?
    `,
      [lastClosingDate || "1970-01-01"]
    ); // استخدم تاريخًا قديمًا جدًا إذا لم يكن هناك إغلاق موجود

    const totalCash = rows[0].totalCashSales || 0;

    res.json({
      success: true,
      totalCash: parseFloat(totalCash),
      lastClosingDate,
    });
  } catch (error) {
    console.error("Error fetching daily sales summary:", error);
    res.status(500).json({
      success: false,
      message: "خطأ في الخادم عند جلب ملخص المبيعات اليومية.",
    });
  }
};

exports.closeDrawer = async (req, res) => {
  const { expected_amount, actual_amount, difference, userId } = req.body;

  // استخدم تاريخ اليوم لتاريخ الإغلاق
  const closing_date = new Date().toISOString().slice(0, 10);

  try {
    // التحقق مما إذا كان الدرج لهذا اليوم قد تم إغلاقه بالفعل
    const [[existing]] = await pool.execute(
      "SELECT id FROM daily_drawer WHERE closing_date = ?",
      [closing_date]
    );

    if (existing) {
      return res
        .status(409)
        .json({ success: false, message: "تم إغلاق الدرج لهذا اليوم بالفعل." });
    }

    await pool.execute(
      `
            INSERT INTO daily_drawer (closing_date, expected_amount, actual_amount, difference, closed_by_user_id)
            VALUES (?, ?, ?, ?, ?)
        `,
      [closing_date, expected_amount, actual_amount, difference, userId]
    );

    res.json({ success: true, message: "تم إغلاق الدرج بنجاح." });
  } catch (error) {
    console.error("Error closing drawer:", error);
    res
      .status(500)
      .json({ success: false, message: "خطأ في الخادم عند إغلاق الدرج." });
  }
};
