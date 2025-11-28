const pool = require("../config/db");
const path = require("path");
const fs = require("fs");

// === createOrder ===
exports.createOrder = async (req, res) => {
  const { total, delivery_address, phone, payment_method, delivery_method } =
    req.body;

  const prescription_images =
    req.files && req.files.length > 0
      ? JSON.stringify(req.files.map((file) => file.filename))
      : null;

  // التحقق من البيانات الأساسية
  if (
    !total ||
    !delivery_method ||
    (delivery_method === "delivery" && !delivery_address)
  ) {
    if (req.files && req.files.length > 0) {
      req.files.forEach((file) => {
        const filePath = path.join(__dirname, "../uploads", file.filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      });
    }
    return res
      .status(400)
      .json({ message: "الرجاء إدخال البيانات المطلوبة بشكل صحيح." });
  }

  try {
    // لو عندك عمود user_id في جدول orders تستعمله، ضيفه هنا. لو مش موجود احذف param الأخير.
    const [orderResult] = await pool.query(
      `INSERT INTO orders 
        (total, delivery_address, phone, payment_method, delivery_method, prescription_image, status, user_id)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        total,
        delivery_method === "pickup" ? "استلام من الصيدلية" : delivery_address,
        phone || null,
        payment_method || null,
        delivery_method,
        prescription_images,
        req.user ? req.user.id : null,
      ]
    );

    const orderId = orderResult.insertId;

    res.status(201).json({
      message: "تم إنشاء الطلب بنجاح",
      order: {
        id: orderId,
        total,
        delivery_method,
        status: "pending",
      },
    });
  } catch (err) {
    console.error("Error creating order:", err);
    // لو فشل وأضفت ملفات، قد تحتاج لحذفها هنا (اختياري)
    res
      .status(500)
      .json({ message: "حدث خطأ أثناء إنشاء الطلب", error: err.message });
  }
};

// === createOrderWithItems ===
exports.createOrderWithItems = async (req, res) => {
  const {
    total,
    delivery_method,
    delivery_address,
    phone,
    notes,
    payment_method,
    discount_code,
    discount_percent,
    items, // مصفوفة المنتجات
  } = req.body;

  if (
    !total ||
    !delivery_method ||
    !items ||
    !Array.isArray(items) ||
    items.length === 0
  ) {
    return res.status(400).json({ message: "البيانات المطلوبة غير مكتملة." });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [orderResult] = await connection.query(
      `INSERT INTO orders 
        (total, delivery_address, phone, notes, payment_method, delivery_method, 
         discount_code, discount_percent, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        total,
        delivery_address,
        phone,
        notes || null,
        payment_method,
        delivery_method,
        discount_code || null,
        discount_percent || 0,
      ]
    );
    const orderId = orderResult.insertId;

    // لكل عنصر: ندرجه مرة واحدة ثم نخصم من الدُفعات مع تسجيل الحركة في order_item_batches
    for (const item of items) {
      const { product_id, quantity, price, unit_type = "box" } = item;

      if (!product_id || !quantity || !price) {
        throw new Error(`بيانات المنتج غير مكتملة: ${JSON.stringify(item)}`);
      }

      // جلب معلومات المنتج
      const [[product]] = await connection.query(
        "SELECT strips_per_box, partial_strips FROM products WHERE id = ?",
        [product_id]
      );

      if (!product) {
        throw new Error(`المنتج ${product_id} غير موجود.`);
      }

      const stripsPerBox = product.strips_per_box || 1;

      // التحقق من المخزون المتاح حسب نوع الوحدة
      if (unit_type === "box") {
        const [[{ total_boxes }]] = await connection.query(
          "SELECT SUM(quantity) as total_boxes FROM product_batches WHERE product_id = ?",
          [product_id]
        );

        if (!total_boxes || total_boxes < quantity) {
          throw new Error(
            `الكمية المطلوبة للمنتج ${product_id} غير متوفرة بالعلب.`
          );
        }
      } else if (unit_type === "strip") {
        const [[{ total_boxes, total_partial_strips }]] =
          await connection.query(
            "SELECT SUM(quantity) as total_boxes, SUM(strips_count) as total_partial_strips FROM product_batches WHERE product_id = ?",
            [product_id]
          );

        const totalAvailableStrips =
          (total_boxes || 0) * stripsPerBox + (total_partial_strips || 0);

        if (totalAvailableStrips < quantity) {
          throw new Error(
            `الكمية المطلوبة للمنتج ${product_id} غير متوفرة بالشرائط.`
          );
        }
      }

      // إدراج عنصر الطلب مرة واحدة
      const [orderItemRes] = await connection.query(
        `INSERT INTO order_items (order_id, product_id, quantity, price, unit_type)
         VALUES (?, ?, ?, ?, ?)`,
        [orderId, product_id, quantity, price, unit_type]
      );

      const order_item_id = orderItemRes.insertId;

      // خصم وتسجيل الخصم بالتوافق مع نوع الوحدة
      if (unit_type === "box") {
        await deductBoxesFromBatches(
          connection,
          product_id,
          quantity,
          order_item_id
        );
      } else {
        await deductStripsFromBatches(
          connection,
          product_id,
          quantity,
          order_item_id
        );
      }

      // تحديث Totals بعد الخصم
      await updateProductTotals(connection, product_id);
    }

    // تحديث عداد كوبونات الخصم (لو موجود)
    if (discount_code) {
      await connection.query(
        `UPDATE discount_codes 
         SET used_count = used_count + 1 
         WHERE code = ? AND is_active = 1`,
        [discount_code]
      );
    }

    await connection.commit();

    res.status(201).json({
      message: "تم إنشاء الطلب ومنتجاته بنجاح!",
      order: {
        id: orderId,
        discount_code: discount_code,
      },
    });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error("Error in createOrderWithItems transaction:", err);
    res
      .status(500)
      .json({ message: err.message || "حدث خطأ أثناء إنشاء الطلب." });
  } finally {
    if (connection) connection.release();
  }
};

// === getAllOrders === (لم أغير المنطق الأساسي، فقط تأكدت من العمل مع prescription JSON)
exports.getAllOrders = async (req, res) => {
  try {
    const [orders] = await pool.query(`
      SELECT 
        o.id,
        o.total,
        o.delivery_address,
        o.prescription_image,
        o.status,
        o.created_at,
        o.phone,
        o.payment_method,
        o.delivery_method,
        o.discount_code,
        o.discount_percent
      FROM orders o
      ORDER BY o.created_at DESC
    `);

    for (let order of orders) {
      const [items] = await pool.query(
        `
        SELECT 
          oi.id as order_item_id,
          oi.product_id,
          oi.quantity,
          oi.price,
          oi.unit_type,
          p.name AS product_name,
          p.image_url
        FROM order_items oi
        JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = ?
        `,
        [order.id]
      );

      order.items = items.map((item) => ({
        ...item,
        image_url: item.image_url
          ? `${req.protocol}://${req.get("host")}/uploads/${item.image_url}`
          : null,
      }));

      if (order.prescription_image) {
        try {
          order.prescription_image = JSON.parse(order.prescription_image).map(
            (image) => `${req.protocol}://${req.get("host")}/uploads/${image}`
          );
        } catch (e) {
          order.prescription_image = null;
        }
      }
    }

    res.json(orders);
  } catch (err) {
    console.error("Error fetching orders:", err);
    res.status(500).json({
      message: "حدث خطأ أثناء جلب الطلبات",
      error: err.message,
    });
  }
};

// === updateOrderStatus ===
exports.updateOrderStatus = async (req, res) => {
  const { id } = req.params;
  const { status, staff_id } = req.body; // pending, completed, cancelled

  if (!["pending", "completed", "cancelled"].includes(status)) {
    return res.status(400).json({ message: "حالة الطلب غير صالحة." });
  }

  let connection;

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // 1) جلب الطلب القديم
    const [[order]] = await connection.query(
      "SELECT * FROM orders WHERE id = ?",
      [id]
    );

    if (!order) throw new Error("الطلب غير موجود.");

    if (order.status === status) {
      connection.release();
      return res.json({ message: `الطلب #${id} بالفعل في حالة ${status}` });
    }

    // ============================================================
    //          💡 تحديد نوع الطلب  (روشتة / متجر)
    // ============================================================
    const isPrescription = !!order.prescription_image; 
    // true = روشتة — false = طلب متجر أونلاين

    // لو الطلب روشتة → فقط حدّث الحالة وخلاص
    if (isPrescription) {
      await connection.query(
        "UPDATE orders SET status = ? WHERE id = ?",
        [status, id]
      );

      await connection.commit();
      return res.json({
        message: `تم تحديث حالة الطلب (روشتة) #${id} إلى: ${status} بدون أي عمليات مالية.`,
      });
    }

    // ================================================================
    //        المتبقي من الكود التالي يتم تنفيذه فقط لطلبات المتجر
    // ================================================================

    // 2) لو الحالة الجديدة = cancelled → رجّع الكمية للمخزون
    if (status === "cancelled") {
      const [deductions] = await connection.query(
        `SELECT oib.batch_id, oib.deducted_quantity, oi.product_id
         FROM order_item_batches oib
         JOIN order_items oi ON oib.order_item_id = oi.id
         WHERE oi.order_id = ?`,
        [id]
      );

      const updatedProducts = new Set();

      for (const d of deductions) {
        await connection.query(
          `UPDATE product_batches SET quantity = quantity + ? WHERE id = ?`,
          [d.deducted_quantity, d.batch_id]
        );
        updatedProducts.add(d.product_id);
      }

      await connection.query(
        `DELETE oib FROM order_item_batches oib
         JOIN order_items oi ON oib.order_item_id = oi.id
         WHERE oi.order_id = ?`,
        [id]
      );

      for (const pid of updatedProducts) {
        await updateProductTotals(connection, pid);
      }
    }

    // 3) تحديث الحالة
    await connection.query(
      "UPDATE orders SET status = ? WHERE id = ?",
      [status, id]
    );

    // 4) سجل عملية مالية فقط إن كانت أول مرة يتحول إلى completed
    if (status === "completed" && order.status === "pending") {
      const amount = parseFloat(order.total);

      await connection.query(
        `UPDATE cash_drawer SET balance = balance + ?`,
        [amount]
      );

      await connection.query(
        `
        INSERT INTO drawer_transactions 
        (type, amount, description, from_staff_id, user_id, sale_id, debt_id, customer_id, supplier_id, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          "order_completed",
          amount,
          `تم إنهاء الطلب رقم ${id}`,
          staff_id || null,
          null,
          null,
          null,
          null,
          null,
          `تم إنهاء الطلب رقم ${id}`
        ]
      );
    }

    await connection.commit();

    res.json({ message: `تم تحديث حالة الطلب #${id} إلى: ${status}` });

  } catch (err) {
    if (connection) await connection.rollback();
    console.error("Error updating order status:", err);
    res.status(500).json({
      message: "حدث خطأ أثناء تحديث حالة الطلب.",
      error: err.message,
    });
  } finally {
    if (connection) connection.release();
  }
};


// === deductStripsFromBatches (مُعدّلة لتسجيل order_item_batches) ===
async function deductStripsFromBatches(
  connection,
  productId,
  quantityToDeduct,
  order_item_id
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

  const [batches] = await connection.execute(
    "SELECT id, quantity, strips_count FROM product_batches WHERE product_id = ? AND (quantity > 0 OR strips_count > 0) ORDER BY expiration_date ASC, created_at ASC",
    [productId]
  );

  let remainingToDeduct = quantityToDeduct;

  for (const batch of batches) {
    if (remainingToDeduct <= 0) break;

    // 1) خصم من الشرائط المتاحة
    if (batch.strips_count > 0) {
      const deductFromStrips = Math.min(batch.strips_count, remainingToDeduct);

      await connection.execute(
        "UPDATE product_batches SET strips_count = strips_count - ? WHERE id = ?",
        [deductFromStrips, batch.id]
      );

      // تسجيل حركة الخصم
      await connection.query(
        `INSERT INTO order_item_batches (order_item_id, batch_id, deducted_quantity)
         VALUES (?, ?, ?)`,
        [order_item_id, batch.id, deductFromStrips]
      );

      remainingToDeduct -= deductFromStrips;
    }

    // 2) لو لازال مطلوب، نحول علب إلى شرائط داخل نفس الدفعة
    if (remainingToDeduct > 0 && batch.quantity > 0) {
      // كم علبة نحتاج نحول (لا يزيد عن العلب المتوفرة)
      const boxesNeeded = Math.min(
        batch.quantity,
        Math.ceil(remainingToDeduct / stripsPerBox)
      );

      const stripsFromBoxes = boxesNeeded * stripsPerBox;
      const actualDeduct = Math.min(stripsFromBoxes, remainingToDeduct);
      const leftoverStrips = stripsFromBoxes - actualDeduct; // تصبح شرائط متبقية في نفس الدفعة

      // نخصم العلب ونضيف الشرائط المتبقية (لو في left)
      await connection.execute(
        "UPDATE product_batches SET quantity = quantity - ?, strips_count = strips_count + ? WHERE id = ?",
        [boxesNeeded, leftoverStrips, batch.id]
      );

      // نسجل الجزء المقتطع فعلًا (actualDeduct) كسحب من هذه الدفعة
      await connection.query(
        `INSERT INTO order_item_batches (order_item_id, batch_id, deducted_quantity)
         VALUES (?, ?, ?)`,
        [order_item_id, batch.id, actualDeduct]
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

// === deductBoxesFromBatches (مع تسجيل order_item_batches) ===
async function deductBoxesFromBatches(
  connection,
  product_id,
  quantity,
  order_item_id
) {
  let remaining = quantity;

  const [batches] = await connection.query(
    `SELECT id, quantity FROM product_batches 
     WHERE product_id = ? AND quantity > 0 
     ORDER BY expiration_date ASC`,
    [product_id]
  );

  for (const batch of batches) {
    if (remaining <= 0) break;

    if (batch.quantity >= remaining) {
      await connection.query(
        "UPDATE product_batches SET quantity = quantity - ? WHERE id = ?",
        [remaining, batch.id]
      );

      await connection.query(
        `INSERT INTO order_item_batches (order_item_id, batch_id, deducted_quantity)
         VALUES (?, ?, ?)`,
        [order_item_id, batch.id, remaining]
      );

      remaining = 0;
    } else {
      await connection.query(
        "UPDATE product_batches SET quantity = 0 WHERE id = ?",
        [batch.id]
      );

      await connection.query(
        `INSERT INTO order_item_batches (order_item_id, batch_id, deducted_quantity)
         VALUES (?, ?, ?)`,
        [order_item_id, batch.id, batch.quantity]
      );

      remaining -= batch.quantity;
    }
  }

  if (remaining > 0) {
    throw new Error(`الكمية المطلوبة غير متوفرة. المتبقي: ${remaining}`);
  }
}

// === updateProductTotals (لم أغيرها) ===
async function updateProductTotals(connection, productId) {
  const [[{ total_quantity }]] = await connection.execute(
    "SELECT SUM(quantity) as total_quantity FROM product_batches WHERE product_id = ?",
    [productId]
  );
  const [[{ strips_count }]] = await connection.execute(
    "SELECT SUM(strips_count) as strips_count FROM product_batches WHERE product_id = ?",
    [productId]
  );
  await connection.execute(
    "UPDATE products SET quantity = ?, partial_strips = ? WHERE id = ?",
    [total_quantity || 0, strips_count || 0, productId]
  );
}
