const pool = require("../config/db");

// دالة مساعدة للبحث عن فاتورة البيع بالباركود
exports.getSaleByBarcode = async (req, res) => {
  const { barcode } = req.params;

  try {
    const [sales] = await pool.query(
      `
            SELECT 
                s.id as saleId,
                s.invoice_barcode as invoiceBarcode,
                s.total as totalAmount,           -- 👈 هنا صح
                s.paid_amount as paidAmount,
                s.created_at as createdAt,
                c.name as customerName,
                d.amount as discountAmount,
                d.percentage as discountPercentage,
                u.full_name as staffName
            FROM sales s
            LEFT JOIN customers c ON s.customer_id = c.id
            LEFT JOIN discounts d ON s.id = d.sale_id
            LEFT JOIN users u ON s.staff_id = u.id
            WHERE s.invoice_barcode = ?
        `,
      [barcode]
    );

    if (sales.length === 0) {
      return res.status(404).json({ message: "الفاتورة غير موجودة" });
    }

    const sale = sales[0];

    // جلب عناصر الفاتورة
    const [items] = await pool.query(
      `
            SELECT 
                si.product_id as productId,
                p.name as productName,
                si.quantity,
                si.unit_type as unitType,
                si.price
            FROM sale_items si
            LEFT JOIN products p ON si.product_id = p.id
            WHERE si.sale_id = ?
        `,
      [sale.saleId]
    );

    sale.items = items;

    res.json(sale);
  } catch (error) {
    console.error("Error fetching sale by barcode:", error);
    res
      .status(500)
      .json({ message: "فشل في جلب بيانات الفاتورة", error: error.message });
  }
};

// دالة إنشاء مردود مرتبط بالفاتورة
exports.createSaleReturnWithInvoice = async (req, res) => {
  const {
    originalSaleId,
    items,
    newTotalAmount,
    discountAmount,
    discountPercentage,
    paidAmount,
    staffId,
  } = req.body;

  let connection;

  if (!items || items.length === 0) {
    return res.status(400).json({ message: "لا توجد عناصر للإرجاع" });
  }

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    for (const item of items) {
      // 1️⃣ التأكد من الكمية المباعة قبل الإرجاع
      const [saleItemRows] = await connection.query(
        "SELECT id, quantity FROM sale_items WHERE sale_id = ? AND product_id = ? AND unit_type = ?",
        [originalSaleId, item.product_id, item.unit_type]
      );

      if (saleItemRows.length === 0) {
        throw new Error(
          `لا يمكن إرجاع المنتج ID:${item.product_id} لأنه غير موجود في الفاتورة`
        );
      }

      const saleItem = saleItemRows[0];

      if (item.quantity > saleItem.quantity) {
        throw new Error(
          `لا يمكن إرجاع كمية أكبر من المباعة للمنتج ID:${item.product_id}`
        );
      }

      // 2️⃣ تسجيل المرتجع
      await connection.query(
        `INSERT INTO sale_returns 
    (product_id, quantity, unit_type, returned_by, sale_id, invoice_barcode, return_total) 
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          item.product_id,
          item.quantity,
          item.unit_type,
          staffId,
          originalSaleId,
          req.body.invoiceBarcode || null, // جاي من الفرونت
          (item.quantity * item.price).toFixed(2), // إجمالي المرتجع للمنتج
        ]
      );

      // 3️⃣ تحديث الكمية في sale_items
      const newSaleItemQty = saleItem.quantity - item.quantity;
      await connection.query(
        "UPDATE sale_items SET quantity = ? WHERE id = ?",
        [newSaleItemQty, saleItem.id]
      );

      // 4️⃣ إرجاع الكمية للمخزون
      await returnToStockAndUpdateTotals(connection, item);
    }

    // ⬅️ 5️⃣ هات بيانات الفاتورة الأصلية قبل أي تعديل
    const [originalSaleRow] = await connection.query(
      "SELECT paid_amount FROM sales WHERE id = ?",
      [originalSaleId]
    );
    const originalPaid = originalSaleRow[0].paid_amount;

    // 6️⃣ حدث بيانات الفاتورة
    await connection.query(
      "UPDATE sales SET total = ?, paid_amount = ? WHERE id = ?",
      [newTotalAmount, paidAmount, originalSaleId]
    );

    // قبل حساب الخصومات
    const totalBeforeReturn = items.reduce(
      (sum, item) => sum + item.quantity * item.price,
      0
    );

    let finalDiscountAmount = discountAmount || 0;
    let finalDiscountPercentage = discountPercentage || 0;

    // حساب الخصم العكسي عند غياب أحدهما
    if (finalDiscountAmount > 0 && !finalDiscountPercentage) {
      finalDiscountPercentage = (finalDiscountAmount / totalBeforeReturn) * 100;
    } else if (finalDiscountPercentage > 0 && !finalDiscountAmount) {
      finalDiscountAmount = totalBeforeReturn * (finalDiscountPercentage / 100);
    }

    // تأكد إنهم رقمين عشريين منسقين
    finalDiscountAmount = parseFloat(finalDiscountAmount.toFixed(2));
    finalDiscountPercentage = parseFloat(finalDiscountPercentage.toFixed(2));

    // 7️⃣ تحديث الخصومات
    const [existingDiscount] = await connection.query(
      "SELECT id FROM discounts WHERE sale_id = ?",
      [originalSaleId]
    );

    if (existingDiscount.length > 0) {
      await connection.query(
        "UPDATE discounts SET amount = ?, percentage = ? WHERE sale_id = ?",
        [finalDiscountAmount, finalDiscountPercentage, originalSaleId]
      );
    } else if (discountAmount > 0 || discountPercentage > 0) {
      await connection.query(
        "INSERT INTO discounts (sale_id, amount, percentage, created_by) VALUES (?, ?, ?, ?)",
        [originalSaleId, finalDiscountAmount, finalDiscountPercentage, staffId]
      );
    }

    // بعد ما تجيب الفاتورة الأصلية من جدول المبيعات
    const [saleRow] = await connection.query(
      "SELECT customer_id, total, paid_amount FROM sales WHERE id = ?",
      [originalSaleId]
    );

    if (!saleRow.length) {
      throw new Error("الفاتورة غير موجودة");
    }

    const customerId = saleRow[0].customer_id; // ⬅️ هنا جيبنا رقم العميل من الفاتورة

    // 8️⃣ تحديث حركة الدرج لو فيه فرق
    const paidDifference = paidAmount - originalPaid;

    if (paidDifference !== 0) {
      await connection.execute(
        "UPDATE cash_drawer SET balance = balance + ? WHERE id = 1",
        [paidDifference]
      );

      const transactionType = paidDifference > 0 ? "deposit" : "withdrawal";
      const description =
        paidDifference > 0
          ? "زيادة في المدفوعات بعد المرتجع"
          : "نقص في المدفوعات بعد المرتجع";

      await connection.execute(
        "INSERT INTO drawer_transactions (type, amount, description, from_staff_id, sale_id, customer_id) VALUES (?, ?, ?, ?, ?, ?)",
        [
          transactionType,
          Math.abs(paidDifference),
          description,
          staffId,
          originalSaleId,
          customerId,
        ]
      );
    }

    // هل فيه دين مسجل للعميل مرتبط بالفاتورة الأصلية؟
    const [existingDebt] = await connection.query(
      "SELECT id FROM debts WHERE origin_sale_id = ? AND customer_id = ?",
      [originalSaleId, customerId]
    );

    const newDebtAmount = saleRow[0].total - saleRow[0].paid_amount;

    if (existingDebt.length > 0) {
      // تحديث الدين الحالي
      await connection.query(
        "UPDATE debts SET amount = ?, amount_paid = ?, updated_at = NOW() WHERE id = ?",
        [saleRow[0].total, saleRow[0].paid_amount, existingDebt[0].id]
      );
    } else if (newDebtAmount > 0) {
      // إنشاء دين جديد لو لسه ماكانش موجود
      await connection.query(
        "INSERT INTO debts (customer_id, customer_name, amount, amount_paid, origin_sale_id, user_id) VALUES (?, (SELECT name FROM customers WHERE id = ?), ?, ?, ?, ?)",
        [
          customerId,
          customerId,
          saleRow[0].total,
          saleRow[0].paid_amount,
          originalSaleId,
          staffId,
        ]
      );
    }

    // بعد تحديث أو إنشاء الدين
    if (existingDebt.length > 0) {
      const [oldDebtQuery] = await connection.query(
        "SELECT amount, amount_paid FROM debts WHERE id = ?",
        [existingDebt[0].id]
      );
      const oldDebt = oldDebtQuery[0];

      // فرق الدين قبل وبعد
      const oldDebtAmount = oldDebt.amount - oldDebt.amount_paid;
      const debtDifference = newDebtAmount - oldDebtAmount;

      if (debtDifference !== 0) {
        const description =
          debtDifference > 0
            ? `زيادة في الدين بعد المرتجع (فاتورة #${originalSaleId})`
            : `نقص في الدين بعد المرتجع (فاتورة #${originalSaleId})`;

        await connection.execute(
          "INSERT INTO drawer_transactions (type, amount, description, from_staff_id, sale_id, customer_id, debt_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [
            "debt_adjustment",
            -debtDifference, // عشان يبان الفرق كحركة في الدرج
            description,
            staffId,
            originalSaleId,
            customerId,
            existingDebt[0].id,
          ]
        );
      }
    }

    await connection.commit();

    // 8️⃣ جلب الفاتورة الجديدة
    const [newInvoice] = await connection.query(
      `
        SELECT 
            s.id as saleId,
            s.invoice_barcode as invoiceBarcode,
            s.total as totalAmount,
            s.paid_amount as paidAmount,
            s.created_at as createdAt,
            c.name as customerName,
            d.amount as discountAmount,
            d.percentage as discountPercentage
        FROM sales s
        LEFT JOIN customers c ON s.customer_id = c.id
        LEFT JOIN discounts d ON s.id = d.sale_id
        WHERE s.id = ?
      `,
      [originalSaleId]
    );

    const [newItems] = await connection.query(
      `
        SELECT 
            p.name as productName,
            si.quantity,
            si.unit_type as unitType,
            si.price,
            (si.quantity * si.price) as total
        FROM sale_items si
        LEFT JOIN products p ON si.product_id = p.id
        WHERE si.sale_id = ?
      `,
      [originalSaleId]
    );

    newInvoice[0].items = newItems;

    res.status(201).json({
      message: "تم تسجيل المرتجع وتحديث الفاتورة بنجاح!",
      newInvoice: newInvoice[0],
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    console.error("Error creating sale return with invoice:", error.message);

    const statusCode = error.message?.startsWith("لا يمكن إرجاع") ? 400 : 500;

    res.status(statusCode).json({
      message: error.message || "حدث خطأ أثناء إنشاء مردود المبيعات",
      details: error.sqlMessage || null,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

// Helper function to get product details from the database.
const getProductDetails = async (productId, connection) => {
  const conn = connection || pool;
  const [product] = await conn.query("SELECT * FROM products WHERE id = ?", [
    productId,
  ]);
  return product[0];
};

// Helper function to validate return quantity against initial quantities
const validateReturnQuantity = async (
  conn,
  productId,
  quantityToReturn,
  unitType
) => {
  const product = await getProductDetails(productId, conn);
  if (!product) {
    throw new Error(`المنتج غير موجود`);
  }

  // Get all batches for this product ordered by expiration date (newest first)
  const [batches] = await conn.query(
    "SELECT * FROM product_batches WHERE product_id = ? ORDER BY expiration_date DESC",
    [productId]
  );

  if (batches.length === 0) {
    throw new Error(`لا توجد دفعات لهذا المنتج`);
  }

  // Calculate total initial quantities (convert everything to strips for accurate calculation)
  let totalInitialStrips = 0;
  let totalCurrentStrips = 0;

  for (const batch of batches) {
    // Convert initial quantities to strips
    const initialBoxesAsStrips =
      (batch.initial_quantity || 0) * product.strips_per_box;
    const initialStrips = batch.initial_strips_count || 0;
    totalInitialStrips += initialBoxesAsStrips + initialStrips;

    // Convert current quantities to strips
    const currentBoxesAsStrips = (batch.quantity || 0) * product.strips_per_box;
    const currentStrips = batch.strips_count || 0;
    totalCurrentStrips += currentBoxesAsStrips + currentStrips;
  }

  // Calculate total sold strips
  const totalSoldStrips = totalInitialStrips - totalCurrentStrips;

  if (unitType === "strip") {
    if (quantityToReturn > totalSoldStrips) {
      throw new Error(
        `لا يمكن إرجاع ${quantityToReturn} شريط. تم بيع ${totalSoldStrips} شريط فقط`
      );
    }
  } else {
    // box
    // Convert return quantity to strips for comparison
    const returnQuantityAsStrips = quantityToReturn * product.strips_per_box;
    if (returnQuantityAsStrips > totalSoldStrips) {
      const maxBoxesCanReturn = Math.floor(
        totalSoldStrips / product.strips_per_box
      );
      throw new Error(
        `لا يمكن إرجاع ${quantityToReturn} علبة. يمكن إرجاع ${maxBoxesCanReturn} علبة كحد أقصى`
      );
    }
  }

  return { product, batches };
};

// Helper function to return strips to batches (handles conversion to boxes first)
const returnStripsToStock = async (conn, productId, quantityToReturn) => {
  // أحضر تفاصيل المنتج لمعرفة عدد الشرائط في العلبة
  const product = await getProductDetails(productId, conn);

  // 1. حوّل كل عدد شرائط كامل إلى علب أولاً
  const boxesEquivalent = Math.floor(quantityToReturn / product.strips_per_box);
  const remainingStrips = quantityToReturn % product.strips_per_box;

  if (boxesEquivalent > 0) {
    // أعد العلب المكافئة أولاً
    await returnBoxesToStock(conn, productId, boxesEquivalent);
  }

  if (remainingStrips === 0) return; // لا شرائط متبقية لإرجاعها

  // 2. ارجع الشرائط المتبقية
  const [batches] = await conn.query(
    "SELECT * FROM product_batches WHERE product_id = ? ORDER BY expiration_date DESC",
    [productId]
  );

  let remaining = remainingStrips;

  for (const batch of batches) {
    if (remaining <= 0) break;
    const currentStrips = batch.strips_count || 0;

    // السعة المتاحة في هذه الدفعة
    let capacity;
    if (batch.initial_strips_count && batch.initial_strips_count > 0) {
      capacity = (batch.initial_strips_count || 0) - currentStrips;
    } else {
      // إذا لم يكن هناك شرائط أولية، يمكننا تعبئة الدفعة حتى strips_per_box
      capacity = product.strips_per_box - currentStrips;
    }

    if (capacity <= 0) continue;

    const toReturn = Math.min(remaining, capacity);

    await conn.query(
      "UPDATE product_batches SET strips_count = strips_count + ? WHERE id = ?",
      [toReturn, batch.id]
    );

    remaining -= toReturn;
  }

  if (remaining > 0) {
    throw new Error(`لا يمكن إرجاع ${remaining} شريط إضافي`);
  }
};

// Helper function to return boxes to batches (newest expiration first)
const returnBoxesToStock = async (conn, productId, quantityToReturn) => {
  // Get batches ordered by expiration date (newest first)
  const [batches] = await conn.query(
    "SELECT * FROM product_batches WHERE product_id = ? ORDER BY expiration_date DESC",
    [productId]
  );

  let remainingToReturn = quantityToReturn;

  for (const batch of batches) {
    if (remainingToReturn <= 0) break;

    const currentBoxes = batch.quantity || 0;
    const initialBoxes = batch.initial_quantity || 0;
    const maxCanReturn = initialBoxes - currentBoxes; // Maximum we can return to this batch

    if (maxCanReturn > 0) {
      const toReturnToBatch = Math.min(remainingToReturn, maxCanReturn);

      await conn.query(
        "UPDATE product_batches SET quantity = quantity + ? WHERE id = ?",
        [toReturnToBatch, batch.id]
      );

      remainingToReturn -= toReturnToBatch;
    }
  }

  if (remainingToReturn > 0) {
    throw new Error(`لا يمكن إرجاع ${remainingToReturn} علبة إضافية`);
  }
};

// Helper function to update product totals after stock changes
const updateProductTotals = async (conn, productId) => {
  const [[totals]] = await conn.query(
    "SELECT SUM(quantity) as total_boxes, SUM(strips_count) as total_strips FROM product_batches WHERE product_id = ?",
    [productId]
  );

  await conn.query(
    "UPDATE products SET quantity = ?, partial_strips = ? WHERE id = ?",
    [totals.total_boxes || 0, totals.total_strips || 0, productId]
  );
};

// Main helper function to add returned items back to stock and update totals.
const returnToStockAndUpdateTotals = async (conn, item) => {
  try {
    // 1. Validate the return quantity
    const { product } = await validateReturnQuantity(
      conn,
      item.product_id,
      item.quantity,
      item.unit_type
    );

    // 2. Return items to stock based on unit type
    if (item.unit_type === "strip") {
      await returnStripsToStock(conn, item.product_id, item.quantity);
    } else {
      // box
      await returnBoxesToStock(conn, item.product_id, item.quantity);
    }

    // 3. Update product totals
    await updateProductTotals(conn, item.product_id);

    console.log(
      `✅ تم إرجاع ${item.quantity} ${
        item.unit_type === "strip" ? "شريط" : "علبة"
      } من ${product.name} بنجاح`
    );
  } catch (error) {
    console.error(`❌ خطأ في إرجاع المنتج:`, error.message);
    throw error;
  }
};

exports.createSaleReturns = async (req, res) => {
  // We only expect 'items' and 'staffId' from the frontend now.
  const { items, staffId } = req.body;
  let connection;

  if (!items || items.length === 0) {
    return res.status(400).json({ message: "No items to return." });
  }

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    for (const item of items) {
      // 1. Insert each returned item into the `sale_returns` table.
      await connection.query(
        "INSERT INTO sale_returns (product_id, quantity, unit_type, returned_by) VALUES (?, ?, ?, ?)",
        [item.product_id, item.quantity, item.unit_type, staffId || null]
      );

      // 2. Add the quantity back to stock and update product totals.
      await returnToStockAndUpdateTotals(connection, item);

      await connection.execute(
        "UPDATE cash_drawer SET balance = balance - ? WHERE id = 1",
        [item.total_amount]
      );

      await connection.execute(
        "INSERT INTO drawer_transactions (type, amount, description, user_id) VALUES (?, ?, ?, ?)",
        ["return", item.total_amount, "مردود مبيعات نقديه", staffId]
      );
    }

    await connection.commit();
    res.status(201).json({ message: "Sale return created successfully!" });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    console.error("Error creating sale return:", error.message);

    // أخطاء التحقق (مثل تجاوز الكمية) نعيدها بكود 400 لتمييزها في الواجهة
    const statusCode = error.message?.startsWith("لا يمكن إرجاع") ? 400 : 500;

    res.status(statusCode).json({
      message: error.message || "حدث خطأ أثناء إنشاء مردود المبيعات",
      details: error.sqlMessage || null,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

exports.getSaleReturns = async (req, res) => {
  try {
    const [rows] = await pool.query(`
        SELECT 
          sr.id,
          sr.returned_at,
          p.name AS product_name,
          sr.quantity,
          sr.unit_type,
          u.full_name AS staff_name,
          sr.return_total AS total,
          c.name AS customer_name,
          s.invoice_barcode AS invoice_code
        FROM sale_returns sr
        LEFT JOIN products p ON sr.product_id = p.id
        LEFT JOIN users u ON sr.returned_by = u.id
        LEFT JOIN sales s ON sr.sale_id = s.id
        LEFT JOIN customers c ON s.customer_id = c.id
        ORDER BY sr.returned_at DESC
        LIMIT 10000;
      `);

    res.json(rows);
  } catch (error) {
    console.error("Error fetching sale returns:", error);
    res.status(500).json({
      message: "Failed to fetch sale returns.",
      error: error.message,
    });
  }
};

exports.getSaleReturnDetails = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await pool.query(
      `
            SELECT 
                sr.id, sr.returned_at,
                p.name as product_name, p.barcode,
                sr.quantity, sr.unit_type,
                u.full_name as staff_name
            FROM sale_returns sr
            LEFT JOIN products p ON sr.product_id = p.id
            LEFT JOIN users u ON sr.returned_by = u.id
            WHERE sr.id = ?
        `,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Return record not found." });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error(`Error fetching details for return ${id}:`, error);
    res.status(500).json({
      message: "Failed to fetch return details.",
      error: error.message,
    });
  }
};

exports.handleFullReturn = async (req, res) => {
  const { saleId, refundMethod = "cash", createdBy } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // القفل وقراءة الفاتورة
    const [salesRows] = await conn.query(
      "SELECT * FROM sales WHERE id = ? FOR UPDATE",
      [saleId]
    );
    if (!salesRows.length) throw new Error("Sale not found");
    const sale = salesRows[0];

    // قراءة البنود
    const [items] = await conn.query(
      "SELECT * FROM sale_items WHERE sale_id = ? FOR UPDATE",
      [saleId]
    );
    // قراءة الخصم والدين
    const [discountRows] = await conn.query(
      "SELECT * FROM discounts WHERE sale_id = ? FOR UPDATE",
      [saleId]
    );
    const [debtRows] = await conn.query(
      "SELECT * FROM debts WHERE origin_sale_id = ? FOR UPDATE",
      [saleId]
    );

    // حساب مبلغ المرتجع (ببساطة استرجاع المبلغ المدفوع بالكامل هنا)
    const amountToRefund = parseFloat(sale.paid_amount || sale.total || 0);

    // رفع الكميات للمخزون
    for (const it of items) {
      await conn.query(
        "UPDATE products SET quantity = quantity + ? WHERE id = ?",
        [it.quantity, it.product_id]
      );
      // -- إذا عندك batches، هنا يجب تحديث batches منطقياً (الأفضل تخزين batch id في sale_items)
    }

    // تعطيل الخصم المرتبط
    await conn.query("UPDATE discounts SET active = 0 WHERE sale_id = ?", [
      saleId,
    ]);

    // حذف/إغلاق الديون (مثال: حذف دين)
    if (debtRows.length) {
      for (const d of debtRows) {
        await conn.query("DELETE FROM debts WHERE id = ?", [d.id]);
      }
    }

    // سجل عملية المرتجع (snapshot)
    const originalSnapshot = {
      sale,
      items,
      discounts: discountRows,
      debts: debtRows,
    };
    await conn.query(
      "INSERT INTO sale_returns_log (sale_id, return_type, items_json, original_sale_snapshot, amount_returned, refund_method, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        saleId,
        "full",
        JSON.stringify(items),
        JSON.stringify(originalSnapshot),
        amountToRefund,
        refundMethod,
        createdBy || null,
      ]
    );

    // علّم الفاتورة
    await conn.query(
      "UPDATE sales SET status = ?, total = 0, paid_amount = 0 WHERE id = ?",
      ["returned", saleId]
    );

    await conn.commit();
    res.json({
      success: true,
      message: "تم إرجاع الفاتورة بالكامل وتم تحديث المخزون.",
    });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({
      success: false,
      message: err.message || "Error processing full return",
    });
  } finally {
    conn.release();
  }
};

exports.handlePartialReturn = async (req, res) => {
  /*
    payload:
    {
      originalSaleId,
      items: [{ product_id, quantity, unit_type, price, total_amount }],
      discountAmount, discountPercentage,
      paidAmount, refundMethod, staffId
    }
  */
  const payload = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const saleId = payload.originalSaleId;
    const [salesRows] = await conn.query(
      "SELECT * FROM sales WHERE id = ? FOR UPDATE",
      [saleId]
    );
    if (!salesRows.length) throw new Error("Sale not found");
    const sale = salesRows[0];

    // اقرأ البنود الحالية
    const [saleItems] = await conn.query(
      "SELECT * FROM sale_items WHERE sale_id = ? FOR UPDATE",
      [saleId]
    );

    // تحقّق من صلاحية الكميات
    const itemsToReturn = payload.items.map((i) => ({
      ...i,
      quantity: parseInt(i.quantity, 10),
    }));
    for (const it of itemsToReturn) {
      const si = saleItems.find(
        (s) => s.product_id === it.product_id && s.unit_type === it.unit_type
      );
      if (!si)
        throw new Error(`Item not found in sale: product ${it.product_id}`);
      if (it.quantity > si.quantity - (si.canceled_quantity || 0)) {
        throw new Error(
          `Return quantity exceeds sold quantity for product ${it.product_id}`
        );
      }
    }

    // احسب قيمة المرتجع
    const returnAmount = itemsToReturn.reduce(
      (s, it) => s + it.quantity * parseFloat(it.price || 0),
      0
    );

    // حدّث sale_items و products
    for (const it of itemsToReturn) {
      await conn.query(
        "UPDATE sale_items SET quantity = quantity - ?, canceled_quantity = canceled_quantity + ? WHERE sale_id = ? AND product_id = ? AND unit_type = ?",
        [it.quantity, it.quantity, saleId, it.product_id, it.unit_type]
      );
      // زيادة المخزون
      await conn.query(
        "UPDATE products SET quantity = quantity + ? WHERE id = ?",
        [it.quantity, it.product_id]
      );
    }

    // إعادة حساب الإجمالي بعد المرتجع (قبل تطبيق الخصم الجديد)
    const [remainingItems] = await conn.query(
      "SELECT product_id, unit_type, quantity, price FROM sale_items WHERE sale_id = ?",
      [saleId]
    );
    const remainingTotalBeforeDiscount = remainingItems.reduce(
      (s, r) => s + parseFloat(r.price) * parseFloat(r.quantity),
      0
    );

    // تطبيق الخصم الجديد (إذا أُدخل)
    let afterDiscount = remainingTotalBeforeDiscount;
    if (payload.discountAmount && parseFloat(payload.discountAmount) > 0) {
      afterDiscount = Math.max(
        0,
        afterDiscount - parseFloat(payload.discountAmount)
      );
    } else if (
      payload.discountPercentage &&
      parseFloat(payload.discountPercentage) > 0
    ) {
      afterDiscount =
        afterDiscount * (1 - parseFloat(payload.discountPercentage) / 100);
    }

    // تحديث سجل sales
    const newPaidAmount = parseFloat(
      payload.paidAmount || sale.paid_amount || 0
    );
    await conn.query(
      "UPDATE sales SET total = ?, paid_amount = ?, invoice_barcode = invoice_barcode WHERE id = ?",
      [afterDiscount, newPaidAmount, saleId]
    );

    // تحديث/إنشاء دين إذا لزم
    const remainingDebt = Math.max(0, afterDiscount - newPaidAmount);
    // إبحث عن دين موجود مرتبط بهذه الفاتورة
    const [debts] = await conn.query(
      "SELECT * FROM debts WHERE origin_sale_id = ? FOR UPDATE",
      [saleId]
    );
    if (remainingDebt > 0) {
      if (debts.length) {
        await conn.query(
          "UPDATE debts SET amount = ?, amount_paid = ?, updated_at = NOW() WHERE id = ?",
          [remainingDebt, Math.max(0, newPaidAmount - 0), debts[0].id]
        );
      } else {
        await conn.query(
          "INSERT INTO debts (customer_name, amount, amount_paid, user_id, customer_id, origin_sale_id) VALUES (?, ?, ?, ?, ?, ?)",
          [
            sale.customer_id ? sale.customer_id : sale.customer_name || "عميل",
            remainingDebt,
            Math.max(0, newPaidAmount - 0),
            payload.staffId || null,
            sale.customer_id || null,
            saleId,
          ]
        );
      }
    } else {
      // إن لم يعد هناك مديونية، حذف أو تعطيل
      if (debts.length) {
        await conn.query("DELETE FROM debts WHERE id = ?", [debts[0].id]);
      }
    }

    // سجل المرتجع (original snapshot + new)
    const originalSnapshot = { sale, items: saleItems };
    const newSnapshot = {
      remainingItems,
      totalAfter: afterDiscount,
      paidAmount: newPaidAmount,
    };

    await conn.query(
      "INSERT INTO sale_returns_log (sale_id, return_type, items_json, original_sale_snapshot, new_sale_snapshot, amount_returned, refund_method, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        saleId,
        "partial",
        JSON.stringify(itemsToReturn),
        JSON.stringify(originalSnapshot),
        JSON.stringify(newSnapshot),
        returnAmount,
        payload.refundMethod || "cash",
        payload.staffId || null,
      ]
    );

    await conn.commit();
    res.json({
      success: true,
      message: "تم تسجيل المرتجع جزئياً وتحديث الفاتورة بنجاح",
      data: { newTotal: afterDiscount, remainingDebt },
    });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({
      success: false,
      message: err.message || "Error processing partial return",
    });
  } finally {
    conn.release();
  }
};
