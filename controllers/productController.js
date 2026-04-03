const path = require("path");
const fs = require("fs");
const pool = require("../config/db");

// ====================================================================
//  1. إنشاء منتج جديد - معدّل لنظام الدُفعات
// ====================================================================
exports.createProduct = async (req, res) => {
  const {
    name,
    english_name,
    barcode,
    description,
    active,
    company,
    location_in_pharmacy,
    category_id,
    price,
    quantity, // الكمية الأولية للدفعة الأولى
    expiration_date, // تاريخ صلاحية الدفعة الأولى
    strips_per_box,
    available_in_pharmacy,
    available_online,
    supplier_id,
  } = req.body;

  const image_filename = req.file ? req.file.filename : null;

  // تنسيق التاريخ ليكون متوافقًا مع MySQL (YYYY-MM-DD)
  let formattedExpirationDate = null;
  if (expiration_date && typeof expiration_date === "string") {
    const dateObj = new Date(expiration_date);
    formattedExpirationDate = new Date(
      dateObj.getTime() - dateObj.getTimezoneOffset() * 60000
    )
      .toISOString()
      .slice(0, 10);
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // الخطوة 1️⃣: إضافة المنتج إلى جدول products
    const [productResult] = await conn.query(
      `INSERT INTO products 
      (name, english_name, barcode, description, active, company, location_in_pharmacy, image_url, 
       category_id, price, quantity, strips_per_box, available_in_pharmacy, available_online, supplier_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        english_name || null,
        barcode,
        description || null,
        active || null,
        company || null,
        location_in_pharmacy || null,
        image_filename,
        category_id,
        price,
        quantity || 0,
        strips_per_box || null,
        available_in_pharmacy === "true" ? 1 : 0,
        available_online === "true" ? 1 : 0,
        supplier_id || null,
      ]
    );

    const newProductId = productResult.insertId;

    // الخطوة 2️⃣: إنشاء فاتورة شراء للمورد الحالي
    const [invoiceResult] = await conn.query(
      `INSERT INTO purchase_invoices (supplier_id, total_amount) VALUES (?, 0)`,
      [supplier_id]
    );
    const invoiceId = invoiceResult.insertId;

    let totalAmount = 0;

    // الخطوة 3️⃣: إضافة أول دفعة إن وُجدت كمية وتاريخ صلاحية
    if (quantity > 0 && formattedExpirationDate) {
      await conn.query(
        `INSERT INTO product_batches 
         (product_id, supplier_id, quantity, initial_quantity, strips_count, initial_strips_count, expiration_date)
         VALUES (?, ?, ?, ?, 0, 0, ?)`,
        [newProductId, supplier_id, quantity, quantity, formattedExpirationDate]
      );

      // تسجيل تفاصيل الفاتورة
      await conn.query(
        `INSERT INTO purchase_invoice_items 
         (invoice_id, product_id, quantity, expiration_date)
         VALUES (?, ?, ?, ?)`,
        [invoiceId, newProductId, quantity, formattedExpirationDate]
      );

      totalAmount = price * quantity;
    }

    // الخطوة 4️⃣: تحديث إجمالي الفاتورة
    await conn.query(
      `UPDATE purchase_invoices SET total_amount = ? WHERE id = ?`,
      [totalAmount, invoiceId]
    );

    await conn.commit();

    res.status(201).json({
      message: "✅ تمت إضافة المنتج والدفعة الأولى والفاتورة بنجاح",
      productId: newProductId,
      invoiceId,
      image_url: image_filename,
    });
  } catch (err) {
    await conn.rollback();
    console.error("❌ Error creating product with batch/invoice:", err);
    res.status(500).json({
      message: "حدث خطأ أثناء إضافة المنتج أو الفاتورة",
      error: err.message,
    });
  } finally {
    conn.release();
  }
};


exports.updateProductById = async (req, res) => {
  const { id } = req.params;

  const {
    name,
    english_name,
    barcode,
    description,
    active,
    company,
    location_in_pharmacy,
    category_id,
    price,
    quantity,
    strips_per_box,
    supplier_id,
    available_in_pharmacy,
    available_online,
    partial_strips,
  } = req.body;

  console.log("FILE:", req.file); // ⬅️ مهم جدًا لمعرفة هل الصورة وصلت أم لا

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // Fetch old product
    const [[oldProduct]] = await conn.query(
      `SELECT image_url FROM products WHERE id = ?`,
      [id]
    );

    if (!oldProduct) {
      await conn.rollback();
      return res.status(404).json({ message: "المنتج غير موجود" });
    }

    // Determine image (new or old)
    const newImage = req.file ? req.file.path : oldProduct.image_url;

    // Build update fields
    const fields = [];
    const values = [];

    const add = (field, value) => {
      if (value !== undefined && value !== null) {
        fields.push(`${field} = ?`);
        values.push(value);
      }
    };

    add("name", name);
    add("english_name", english_name);
    add("barcode", barcode);
    add("description", description);
    add("active", active);
    add("company", company);
    add("location_in_pharmacy", location_in_pharmacy);
    add("category_id", category_id);
    add("price", price);
    add("quantity", quantity);
    add("strips_per_box", strips_per_box);
    add("supplier_id", supplier_id);
    add("partial_strips", partial_strips);

    // Boolean values
    add(
      "available_online",
      available_online === "true"
        ? 1
        : available_online === "false"
        ? 0
        : undefined
    );

    add(
      "available_in_pharmacy",
      available_in_pharmacy === "true"
        ? 1
        : available_in_pharmacy === "false"
        ? 0
        : undefined
    );

    // Update image
    add("image_url", newImage);

    if (fields.length === 0) {
      await conn.rollback();
      return res.status(400).json({ message: "لا توجد بيانات لتحديثها" });
    }

    // Execute update
    const updateQuery = `UPDATE products SET ${fields.join(", ")} WHERE id = ?`;
    values.push(id);

    await conn.query(updateQuery, values);
    await conn.commit();

    res.json({
      message: "تم تحديث المنتج بنجاح",
      image_url: newImage,
    });
  } catch (err) {
    await conn.rollback();
    console.error("❌ Error updating product:", err);
    res.status(500).json({ message: "خطأ أثناء التحديث", error: err.message });
  } finally {
    conn.release();
  }
};





exports.searchProductByName = async (req, res) => {
  const { name } = req.params;
  
  if (!name || name.trim().length < 3) {
    return res.status(400).json({ message: "يرجى إدخال 3 أحرف على الأقل للبحث" });
  }

  try {
    const searchTerm = `%${name.trim()}%`;
    
    const [products] = await pool.query(
      `SELECT 
        p.*, 
        c.name AS category_name,
        s.name AS supplier_name
       FROM products p 
       LEFT JOIN categories c ON p.category_id = c.id 
       LEFT JOIN suppliers s ON p.supplier_id = s.id
       WHERE p.name LIKE ? OR p.english_name LIKE ? OR p.barcode = ?
       ORDER BY 
         CASE 
           WHEN p.barcode = ? THEN 1
           WHEN p.name LIKE ? THEN 2 
           WHEN p.english_name LIKE ? THEN 3 
           ELSE 4 
         END,
         p.name ASC
       LIMIT 10`,
      [searchTerm, searchTerm, name.trim(), name.trim(), searchTerm, searchTerm]
    );

    if (products.length > 0) {
      const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
      
      const productsWithImages = products.map(product => ({
        ...product,
        image_url: product.image_url && !product.image_url.startsWith("http")
          ? `${baseUrl}/uploads/${product.image_url}`
          : product.image_url,
      }));

      res.json(productsWithImages);
    } else {
      res.status(404).json({ message: "لم يتم العثور على منتج بهذا الاسم" });
    }
  } catch (err) {
    console.error(`❌ Error searching product by name (${name}):`, err);
    res.status(500).json({ 
      message: "حدث خطأ أثناء البحث عن المنتج", 
      error: err.message 
    });
  }
};




/*

// ====================================================================
//  3. وظيفة جديدة: إضافة مخزون (دفعة جديدة) لمنتج موجود
// ====================================================================
exports.addStock = async (req, res) => {
  const { id } = req.params; // product_id
  const { quantity, expiration_date, supplier_id } = req.body;

  if (!quantity || !expiration_date) {
    return res.status(400).json({ message: "الكمية وتاريخ الصلاحية مطلوبان" });
  }

  if (isNaN(parseInt(quantity, 10)) || parseInt(quantity, 10) <= 0) {
    return res.status(400).json({ message: "الكمية يجب أن تكون رقماً موجباً" });
  }

  // تنسيق التاريخ
  const dateObj = new Date(expiration_date);
  const formattedExpirationDate = new Date(
    dateObj.getTime() - dateObj.getTimezoneOffset() * 60000
  )
    .toISOString()
    .slice(0, 10);

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // الخطوة 1: التأكد من وجود المنتج وجلب معلومات الشرائط
    const [[product]] = await conn.query(
      "SELECT id, strips_per_box FROM products WHERE id = ?",
      [id]
    );
    if (!product) {
      return res.status(404).json({ message: "المنتج غير موجود" });
    }

    // Always start new stock with 0 partial strips
    const totalStrips = 0;

    await conn.query(
      "UPDATE products SET quantity = quantity + ? WHERE id = ?",
      [quantity, id]
    );
    await conn.query(
      "INSERT INTO product_batches (product_id, supplier_id, quantity, initial_quantity, strips_count, initial_strips_count, expiration_date) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, supplier_id, quantity, quantity, 0, 0, formattedExpirationDate]
    );

    // الخطوة 3: (اختياري) تسجيل عملية التوريد
    if (supplier_id) {
      await conn.query(
        `INSERT INTO product_suppliers (product_id, supplier_id, supplied_quantity) VALUES (?, ?, ?)`,
        [id, supplier_id, quantity]
      );
    }
      

    await conn.commit();

    res
      .status(200)
      .json({ message: `✅ تمت إضافة ${quantity} قطعة إلى مخزون المنتج` });
  } catch (err) {
    await conn.rollback();
    console.error("❌ Error adding stock:", err);
    res
      .status(500)
      .json({ message: "حدث خطأ أثناء إضافة المخزون", error: err.message });
  } finally {
    conn.release();
  }
};
*/

exports.addPurchaseInvoice = async (req, res) => {
  const { supplier_id, items } = req.body;

  if (!supplier_id || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "المورد والمنتجات مطلوبين" });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // إنشاء الفاتورة
    const [invoiceResult] = await conn.query(
      `INSERT INTO purchase_invoices (supplier_id) VALUES (?)`,
      [supplier_id]
    );
    const invoiceId = invoiceResult.insertId;

    let totalAmount = 0;

    for (const item of items) {
      const { product_id, quantity, expiration_date, price } = item;
      if (!product_id || !quantity || !expiration_date) continue;

      // 🔹 تحديث سعر المنتج إذا كان مختلفاً عن السعر الحالي
      const [[product]] = await conn.query(
        `SELECT price, strips_per_box FROM products WHERE id = ?`,
        [product_id]
      );
      if (!product) continue;

      // إذا كان السعر مختلفاً، قم بتحديثه
      if (price && parseFloat(price) !== parseFloat(product.price)) {
        await conn.query(
          `UPDATE products SET price = ? WHERE id = ?`,
          [price, product_id]
        );
      }

      // تحديث الكمية في جدول المنتجات
      await conn.query(
        `UPDATE products SET quantity = quantity + ? WHERE id = ?`,
        [quantity, product_id]
      );

      // إضافة دفعة جديدة
      await conn.query(
        `INSERT INTO product_batches 
          (product_id, supplier_id, quantity, initial_quantity, strips_count, initial_strips_count, expiration_date)
         VALUES (?, ?, ?, ?, 0, 0, ?)`,
        [product_id, supplier_id, quantity, quantity, expiration_date]
      );

      // تسجيل تفاصيل الفاتورة
      await conn.query(
        `INSERT INTO purchase_invoice_items (invoice_id, product_id, quantity, expiration_date, unit_price) VALUES (?, ?, ?, ?, ?)`,
        [invoiceId, product_id, quantity, expiration_date, price || product.price]
      );

      // إجمالي الفاتورة
      totalAmount += (price || product.price) * quantity;
    }

    // تحديث إجمالي الفاتورة
    await conn.query(
      `UPDATE purchase_invoices SET total_amount = ? WHERE id = ?`,
      [totalAmount, invoiceId]
    );

    await conn.commit();

    res.json({ message: "✅ تم حفظ الفاتورة بنجاح", invoice_id: invoiceId });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ message: "❌ خطأ أثناء حفظ الفاتورة" });
  } finally {
    conn.release();
  }
};


// ====================================================================
//  4. جلب جميع المنتجات
// ====================================================================

exports.getAllProducts = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    const { 
      category_id, 
      searchTerm, 
      inStockOnly, 
      sortOption,
      quantity_filter,
      expiration_filter,
      availability_filter, // هذا للتصفية الاختيارية فقط
      price_min,
      price_max,
      company,
      // إزالة المعامل for_online_store أو جعله اختياريًا
      for_online_store = false 
    } = req.query;

    let queryParams = [];
    let whereClause = "WHERE 1=1";

    if (for_online_store === 'true') {
      whereClause += " AND p.available_online = 1";
    } 

     if (inStockOnly === 'true') {
      whereClause += " AND p.quantity > 0";
    }

     if (price_min) {
      whereClause += " AND p.price >= ?";
      queryParams.push(parseFloat(price_min));
    }
    
    if (price_max) {
      whereClause += " AND p.price <= ?";
      queryParams.push(parseFloat(price_max));
    }

    if (availability_filter && availability_filter !== 'all') {
      switch (availability_filter) {
        case 'pharmacy':
          whereClause += " AND p.available_in_pharmacy = 1";
          break;
        case 'online':
          whereClause += " AND p.available_online = 1";
          break;
        case 'both':
          whereClause += " AND p.available_in_pharmacy = 1 AND p.available_online = 1";
          break;
      }
    }

    // باقي شروط التصفية تبقى كما هي...
    if (searchTerm) {
      whereClause += " AND (p.name LIKE ? OR p.english_name LIKE ? OR p.barcode LIKE ?)";
      const term = `%${searchTerm}%`;
      queryParams.push(term, term, term);
    }
    
    if (category_id) {
      whereClause += " AND p.category_id = ?";
      queryParams.push(category_id);
    }

    if (company) {
      whereClause += " AND p.company = ?";
      queryParams.push(company);
    }

    // تصفية الكمية
    if (quantity_filter) {
      switch (quantity_filter) {
        case 'low':
          whereClause += " AND p.quantity <= 10";
          break;
        case 'medium':
          whereClause += " AND p.quantity > 10 AND p.quantity <= 50";
          break;
        case 'high':
          whereClause += " AND p.quantity > 50";
          break;
      }
    }

    // تصفية السعر
    if (price_min) {
      whereClause += " AND p.price >= ?";
      queryParams.push(parseFloat(price_min));
    }
    
    if (price_max) {
      whereClause += " AND p.price <= ?";
      queryParams.push(parseFloat(price_max));
    }

    // الترتيب
    let orderByClause = "ORDER BY p.name ASC";
    switch (sortOption) {
      case "price-asc":
        orderByClause = "ORDER BY p.price ASC";
        break;
      case "price-desc":
        orderByClause = "ORDER BY p.price DESC";
        break;
      case "quantity-asc":
        orderByClause = "ORDER BY p.quantity ASC";
        break;
      case "quantity-desc":
        orderByClause = "ORDER BY p.quantity DESC";
        break;
      case "name-asc":
        orderByClause = "ORDER BY p.name ASC";
        break;
      case "name-desc":
        orderByClause = "ORDER BY p.name DESC";
        break;
      default:
        orderByClause = "ORDER BY p.name ASC";
        break;
    }

    // استعلام العدد الكلي
    const countSql = `SELECT COUNT(*) as total FROM products p ${whereClause}`;
    const [countResult] = await pool.query(countSql, queryParams);
    const totalItems = countResult[0].total;

    // استعلام جلب المنتجات
    const dataSql = `
      SELECT 
        p.*, 
        c.name AS category_name,
        s.name AS supplier_name
      FROM products p 
      LEFT JOIN categories c ON p.category_id = c.id 
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      ${whereClause}
      ${orderByClause}
      LIMIT ? OFFSET ?
    `;

    const dataParams = [...queryParams, limit, offset];
    const [rows] = await pool.query(dataSql, dataParams);

    // معالجة رابط الصورة
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;

    const products = rows.map((p) => ({
      ...p,
      image_url: p.image_url && !p.image_url.startsWith("http")
        ? `${baseUrl}/uploads/${p.image_url}`
        : p.image_url,
    }));

    // إرسال البيانات
    res.json({
      success: true,
      data: products,
      pagination: {
        totalItems,
        currentPage: page,
        totalPages: Math.ceil(totalItems / limit),
        itemsPerPage: limit,
        hasNextPage: page < Math.ceil(totalItems / limit),
        hasPrevPage: page > 1
      }
    });
  } catch (err) {
    console.error("❌ Error fetching paginated products:", err);
    res.status(500).json({ 
      message: "حدث خطأ أثناء جلب المنتجات", 
      error: err.message 
    });
  }
};

// ====================================================================
//  5. جلب منتج بالباركود
// ====================================================================
exports.getProductByBarcode = async (req, res) => {
  const { barcode } = req.params;
  try {
    const [[product]] = await pool.query(
      `SELECT p.*, c.name AS category_name 
       FROM products p 
       LEFT JOIN categories c ON p.category_id = c.id 
       WHERE p.barcode = ?`,
      [barcode]
    );

    if (product) {
      const baseUrl =
        process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
      product.image_url =
        product.image_url && !product.image_url.startsWith("http")
          ? `${baseUrl}/uploads/${product.image_url}`
          : product.image_url;
      res.json(product);
    } else {
      res.status(404).json({ message: "المنتج غير موجود" });
    }
  } catch (err) {
    console.error(`❌ Error fetching product by barcode (${barcode}):`, err);
    res
      .status(500)
      .json({ message: "حدث خطأ أثناء جلب المنتج", error: err.message });
  }
};

// ====================================================================
//  6. حذف منتج
// ====================================================================
exports.deleteProduct = async (req, res) => {
  const { id } = req.params;
  try {
    const [[product]] = await pool.query(
      "SELECT image_url FROM products WHERE id = ?",
      [id]
    );

    if (!product) {
      return res.status(404).json({ message: "المنتج غير موجود" });
    }

    if (product.image_url) {
      const filePath = path.join(__dirname, "../uploads", product.image_url);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    await pool.query("DELETE FROM products WHERE id = ?", [id]);
    res.json({ message: "✅ تم حذف المنتج" });
  } catch (err) {
    console.error("❌ Error deleting product:", err);
    res
      .status(500)
      .json({ message: "حدث خطأ أثناء الحذف", error: err.message });
  }
};

// ====================================================================
//  7. جلب المنتجات حسب التصنيف
// ====================================================================
exports.getProductsByCategory = async (req, res) => {
  const { categoryId } = req.params;

  try {
    const [rows] = await pool.query(
      `
      SELECT p.*, c.name AS category_name, s.name AS supplier_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      WHERE p.category_id = ? AND p.available_online = TRUE
      ORDER BY p.name ASC
    `,
      [categoryId]
    );

    const baseUrl =
      process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
    const updated = rows.map((p) => ({
      ...p,
      image_url: p.image_url ? `${baseUrl}/uploads/${p.image_url}` : null,
    }));

    res.json(updated);
  } catch (err) {
    console.error(
      `❌ Error fetching products by category (${categoryId}):`,
      err
    );
    res.status(500).json({
      message: "حدث خطأ أثناء جلب المنتجات حسب التصنيف",
      error: err.message,
    });
  }
};

// ====================================================================
//  8. جلب المنتجات بطيئة الحركة
// ====================================================================
exports.getSlowMovingProducts = async (req, res) => {
  try {
    const query = `
      SELECT 
        p.*,
        DATEDIFF(NOW(), latest_sale.last_sale) as days_since_last_sale
      FROM products p
      LEFT JOIN (
        SELECT
          si.product_id,
          MAX(s.created_at) as last_sale
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        GROUP BY si.product_id
      ) as latest_sale ON p.id = latest_sale.product_id
      WHERE 
        latest_sale.last_sale IS NULL 
        OR latest_sale.last_sale < DATE_SUB(NOW(), INTERVAL 30 DAY)
      ORDER BY days_since_last_sale DESC
    `;

    const [products] = await pool.query(query);

    const baseUrl =
      process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
    const productsWithFullImageUrls = products.map((p) => ({
      ...p,
      image_url:
        p.image_url && !p.image_url.startsWith("http")
          ? `${baseUrl}/uploads/${p.image_url}`
          : p.image_url,
    }));

    res.json({
      success: true,
      products: productsWithFullImageUrls,
    });
  } catch (error) {
    console.error("Error fetching slow moving products:", error);
    res.status(500).json({
      success: false,
      message: "خطأ في جلب المنتجات بطيئة الحركة",
    });
  }
};

// ====================================================================
//  9. جلب عدد المنتجات بطيئة الحركة
// ====================================================================
exports.getSlowMovingProductsCount = async (req, res) => {
  try {
    const query = `
      SELECT COUNT(*) AS count
      FROM products p
      WHERE
        (
          -- منتجات لم تُبع أبداً: نعرضها لو مر 90 يوم على إنشائها
          (p.last_sale_date IS NULL AND p.created_at <= DATE_SUB(NOW(), INTERVAL 90 DAY))
          OR
          -- منتجات لها آخر بيع: نعرضها لو آخر بيع قبل 90 يوم
          (p.last_sale_date IS NOT NULL AND p.last_sale_date <= DATE_SUB(NOW(), INTERVAL 90 DAY))
        )
    `;

    const [rows] = await pool.query(query);
    const count = rows && rows[0] ? parseInt(rows[0].count, 10) || 0 : 0;

    res.json({
      success: true,
      count,
    });
  } catch (error) {
    console.error("Error fetching slow moving products count:", error);
    res.status(500).json({
      success: false,
      message: "خطأ في جلب عدد المنتجات بطيئة الحركة",
      count: 0,
    });
  }
};

exports.getProductBatches = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100; // يمكن زيادة الحد للدفعات
    const offset = (page - 1) * limit;

    const query = `
      SELECT 
        pb.*,
        p.name AS product_name,
        p.price AS product_price,
        p.strips_per_box,
        s.name AS supplier_name
      FROM product_batches pb
      LEFT JOIN products p ON pb.product_id = p.id
      LEFT JOIN suppliers s ON pb.supplier_id = s.id
      WHERE pb.quantity > 0
      ORDER BY pb.product_id, pb.expiration_date ASC
      LIMIT ? OFFSET ?
    `;

    const [batches] = await pool.query(query, [limit, offset]);

    // جلب العدد الكلي للدفعات
    const [countResult] = await pool.query(
      "SELECT COUNT(*) as total FROM product_batches WHERE quantity > 0"
    );
    const totalItems = countResult[0].total;

    res.json({
      success: true,
      data: batches,
      pagination: {
        totalItems,
        currentPage: page,
        totalPages: Math.ceil(totalItems / limit),
        itemsPerPage: limit
      }
    });
  } catch (error) {
    console.error("Error fetching product batches:", error);
    res.status(500).json({
      success: false,
      message: "خطأ في جلب تفاصيل الدفعات",
    });
  }
};



// ====================================================================
//  10. جلب جميع التصنيفات
// ====================================================================
exports.getAllCategories = async (req, res) => {
  try {
    const [categories] = await pool.query(
      "SELECT id, name FROM categories ORDER BY name ASC"
    );
    res.json({
      success: true,
      data: categories
    });
  } catch (err) {
    console.error("❌ Error fetching categories:", err);
    res.status(500).json({
      message: "حدث خطأ أثناء جلب التصنيفات",
      error: err.message,
    });
  }
};


// ====================================================================
//  11. جلب جميع الشركات/المصنعين
// ====================================================================
exports.getAllCompanies = async (req, res) => {
  try {
    // جلب أسماء الشركات الفريدة من جدول المنتجات
    const [companies] = await pool.query(
      "SELECT DISTINCT company as name FROM products WHERE company IS NOT NULL AND company != '' ORDER BY company ASC"
    );
    
    // إضافة id افتراضي لكل شركة باستخدام الاسم نفسه كمعرف
    const companiesWithIds = companies.map((company, index) => ({
      id: company.name, // استخدام اسم الشركة كمعرف
      name: company.name
    }));
    
    res.json({
      success: true,
      data: companiesWithIds,
    });
    
  } catch (error) {
    console.error("Error fetching all companies:", error);
    res.status(500).json({
      success: false,
      message: "خطأ في جلب قائمة الشركات",
    });
  }
};