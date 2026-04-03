-- مسح قاعدة البيانات إذا كانت موجودة لضمان إنشاء نظيف
DROP DATABASE IF EXISTS pharmacySystem_db;

-- إنشاء القاعدة
CREATE DATABASE IF NOT EXISTS pharmacySystem_db CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE pharmacySystem_db;

-- 👥 جدول المستخدمين
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(255),
  email VARCHAR(255) UNIQUE,
  password VARCHAR(255),
  role ENUM('admin', 'staff') DEFAULT 'staff',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 📚 جدول التصنيفات
CREATE TABLE categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE
);

-- 👨‍🔧 جدول الموردين
CREATE TABLE suppliers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 💊 جدول المنتجات
CREATE TABLE products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  english_name VARCHAR(255),
  barcode VARCHAR(255) UNIQUE,
  description TEXT,
  active VARCHAR(255) DEFAULT NULL,
  company VARCHAR(255) DEFAULT NULL,
  location_in_pharmacy VARCHAR(255),
  image_url VARCHAR(500),
  category_id INT,
  price DECIMAL(10,2) NOT NULL,
  quantity INT NOT NULL DEFAULT 0,
  strips_per_box INT DEFAULT NULL,
  available_in_pharmacy BOOLEAN DEFAULT TRUE,
  available_online BOOLEAN DEFAULT TRUE,
  last_sale_date DATETIME DEFAULT NULL,
  supplier_id INT DEFAULT NULL,
  partial_strips INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id)
);
CREATE INDEX idx_products_name ON products(name);
CREATE INDEX idx_products_category ON products(category_id);


SET GLOBAL local_infile = 1;
LOAD DATA LOCAL INFILE 'F:/myprojects/pharmacyon/pharmacy-server/products_finall.csv'
INTO TABLE products
CHARACTER SET utf8mb4
FIELDS TERMINATED BY ','
OPTIONALLY ENCLOSED BY '"'
LINES TERMINATED BY '\r\n'
IGNORE 1 LINES
(
    name, 
    english_name, 
    @v_barcode, 
    description, 
    active, 
    company, 
    location_in_pharmacy, 
    image_url, 
    @v_category_id, 
    price, 
    quantity, 
    strips_per_box,
    available_in_pharmacy, 
    available_online, 
    @v_last_sale_date, 
    @v_supplier_id, 
    partial_strips,
    @dummy_created_at,      -- capturing extra column 18
    @dummy_updated_at       -- capturing extra column 19
)
SET 
    barcode = NULLIF(@v_barcode, ''),
    category_id = NULLIF(@v_category_id, ''),
    last_sale_date = NULLIF(@v_last_sale_date, ''),
    supplier_id = NULLIF(@v_supplier_id, '');
--مش مهمه
-- 📦 ربط المنتجات بالموردين
CREATE TABLE product_suppliers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  supplier_id INT NOT NULL,
  supplied_quantity INT NOT NULL,
  supplied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

-- 📦 جدول دفعات المنتجات (Product Batches)
CREATE TABLE product_batches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  supplier_id INT NOT NULL,
  quantity INT NOT NULL DEFAULT 0,
  initial_quantity INT NOT NULL DEFAULT 0,
  strips_count INT NOT NULL DEFAULT 0,
  initial_strips_count INT NOT NULL DEFAULT 0,
  expiration_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  INDEX idx_product_batches_product_id (product_id),
  INDEX idx_product_batches_expiration (expiration_date)
);

INSERT INTO product_batches (
  product_id,
  supplier_id,
  quantity,
  initial_quantity,
  strips_count,
  initial_strips_count,
  expiration_date
)
VALUES (
  2,
  1,
  1,
  1,
  0,
  0,
  '2027-12-31'
);

-- 📑 جدول فواتير الشراء
CREATE TABLE purchase_invoices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  supplier_id INT NOT NULL,
  invoice_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  total_amount DECIMAL(12,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

-- 📦 تفاصيل المنتجات داخل الفاتورة
CREATE TABLE purchase_invoice_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoice_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL,
  unit_price DECIMAL(10,2),
  expiration_date DATE NOT NULL,
  FOREIGN KEY (invoice_id) REFERENCES purchase_invoices(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

-- جدول العملاء (Customers)
CREATE TABLE IF NOT EXISTS customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(50) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 💰 جدول المبيعات
CREATE TABLE sales (
  id INT AUTO_INCREMENT PRIMARY KEY,
  staff_id INT NULL,
  customer_id INT DEFAULT NULL,
  total DECIMAL(10,2) NOT NULL,
  initial_total INT NOT NULL DEFAULT 0,
  paid_amount DECIMAL(10,2) DEFAULT 0,
  payment_method ENUM('cash', 'card') DEFAULT 'cash',
  invoice_barcode VARCHAR(120) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (staff_id) REFERENCES users(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
);

-- 💊 تفاصيل المنتجات داخل عملية البيع
CREATE TABLE sale_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sale_id INT,
  product_id INT,
  quantity INT,
  price DECIMAL(10,2),
  unit_type ENUM('box', 'strip') NOT NULL DEFAULT 'box',
  FOREIGN KEY (sale_id) REFERENCES sales(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

-- 💸 الخصومات
CREATE TABLE discounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sale_id INT NOT NULL,
  amount DECIMAL(10,2),
  percentage DECIMAL(5,2),
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sale_id) REFERENCES sales(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- 📜 جدول المنتجات الناقصة (Missing Products)
CREATE TABLE missing_products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ordered BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

-- 🧾 جدول الطلبات
CREATE TABLE orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  total DECIMAL(10,2),
  delivery_address TEXT,
  prescription_image VARCHAR(500),
  phone VARCHAR(20),
  discount_code VARCHAR(50) DEFAULT NULL,
  discount_percent DECIMAL(5,2) DEFAULT 0.00,
  notes TEXT DEFAULT NULL,
  payment_method VARCHAR(20),
  delivery_method ENUM('pickup', 'delivery') DEFAULT 'pickup',
  status ENUM('pending', 'completed', 'cancelled') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE orders
ADD COLUMN user_id INT NULL,
ADD CONSTRAINT fk_orders_user
FOREIGN KEY (user_id) REFERENCES users(id)
ON DELETE SET NULL;


-- 📦 تفاصيل المنتجات داخل الطلب
CREATE TABLE order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT,
  product_id INT,
  quantity INT,
  price DECIMAL(10,2),
  unit_type ENUM('box', 'strip') DEFAULT 'box',
  display_name VARCHAR(255),
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

-- دفعات الطلبات
CREATE TABLE order_item_batches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_item_id INT NOT NULL,
  batch_id INT NOT NULL,
  deducted_quantity INT NOT NULL,
  FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
  FOREIGN KEY (batch_id) REFERENCES product_batches(id) ON DELETE CASCADE
);

-- 🔁 مرتجع مشتريات
CREATE TABLE purchase_returns (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  batch_id INT,
  quantity INT NOT NULL,
  reason TEXT,
  supplier_id INT,
  returned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  returned_by INT,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (batch_id) REFERENCES product_batches(id),
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  FOREIGN KEY (returned_by) REFERENCES users(id)
);

-- 🔁 مرتجع مبيعات
CREATE TABLE sale_returns (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  sale_id INT NULL,
  quantity INT NOT NULL,
  unit_type ENUM('box', 'strip') NOT NULL DEFAULT 'box' COMMENT 'نوع الوحدة المرتجعة: علبة أو شريط',
  invoice_barcode VARCHAR(100) NULL,
  return_total DECIMAL(10,2) DEFAULT 0,
  returned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  returned_by INT,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
  FOREIGN KEY (returned_by) REFERENCES users(id)
);

-- 💰 جدول الدرج النقدي (Cash Drawer)
CREATE TABLE cash_drawer (
  id INT AUTO_INCREMENT PRIMARY KEY,
  balance DECIMAL(10,2) DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 🏦 جدول حصالة الإدارة (Admin Piggy Bank)
CREATE TABLE admin_piggy_bank (
  id INT AUTO_INCREMENT PRIMARY KEY,
  balance DECIMAL(10,2) DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- جدول الشفتات (Shifts)
CREATE TABLE shifts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NULL,
  total_sales DECIMAL(10,2) DEFAULT 0,
  total_transactions INT DEFAULT 0,
  total_returns DECIMAL(10,2) DEFAULT 0,
  net_sales DECIMAL(10,2) DEFAULT 0,
  duration_minutes INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);


-- 💳 مديونيات العملاء
CREATE TABLE debts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_name VARCHAR(255) NOT NULL,
  customer_id INT NULL,
  origin_sale_id INT NULL,
  amount DECIMAL(10,2) NOT NULL,
  amount_paid DECIMAL(10,2) DEFAULT 0.00,
  remaining_amount DECIMAL(10,2) GENERATED ALWAYS AS (`amount` - `amount_paid`) STORED,
  notes TEXT DEFAULT NULL,
  user_id INT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp(),
  updated_at TIMESTAMP NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (origin_sale_id) REFERENCES sales(id) ON DELETE SET NULL
);

-- 💵 سجل حركات الدرج النقدي (Drawer Transactions)
CREATE TABLE drawer_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  type VARCHAR(50) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  description VARCHAR(255) DEFAULT NULL,
  from_staff_id INT NULL,
  customer_id INT NULL,
  supplier_id INT NULL,
  user_id INT,
  sale_id INT DEFAULT NULL,
  debt_id INT DEFAULT NULL,
  notes VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE SET NULL,
  FOREIGN KEY (debt_id) REFERENCES debts(id) ON DELETE SET NULL,
  FOREIGN KEY (from_staff_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL ON UPDATE CASCADE,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL ON UPDATE CASCADE
);



-- 🏷️ جدول أكواد الخصم
CREATE TABLE discount_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  percentage INT NOT NULL CHECK (percentage > 0 AND percentage <= 100),
  description TEXT NULL,
  max_uses INT NULL,
  valid_until DATETIME NULL,
  used_count INT DEFAULT 0,
  created_by INT NULL,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- إدخال البيانات الأولية
INSERT INTO cash_drawer (id, balance) VALUES (1, 0) ON DUPLICATE KEY UPDATE id = id;
INSERT INTO admin_piggy_bank (id, balance) VALUES (1, 0) ON DUPLICATE KEY UPDATE id = id;