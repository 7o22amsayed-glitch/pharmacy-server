const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const cookieParser = require("cookie-parser");

const productRoutes = require('./routes/productRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const saleRoutes = require('./routes/saleRoutes');
const orderRoutes = require('./routes/orderRoutes');
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const supplierRoutes = require("./routes/supplierRoutes");
const missingProductRoutes = require("./routes/missingProductRoutes");
const discountRoutes = require("./routes/discountRoutes");
const debtRoutes = require('./routes/debtRoutes');
const drawerRoutes = require('./routes/drawerRoutes');
const statisticsRouter = require('./routes/statisticsRoutes');
const purchaseReturnRoutes = require('./routes/purchaseReturnRoutes');
const saleReturnRoutes = require('./routes/saleReturnRoutes');
const discountCodeRoutes = require('./routes/discountCodeRoutes');
const customerRoutes = require('./routes/customerRoutes');
const app = express();

// Middleware لتحليل JSON
app.use(express.json());

// Middleware للكوكيز
app.use(cookieParser());
/*, 'ngrok-skip-browser-warning'*/
 /*  origin: 'https://pharmacy-client-tau.vercel.app',*/
  //  origin: 'http://localhost:5173',

 const corsOptions = {
origin: 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS','PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'], // أضف هنا
  exposedHeaders: ['Authorization'],
  preflightContinue: false,
  optionsSuccessStatus: 204
};
app.use(cors(corsOptions));

// Middleware للتسجيل
app.use(morgan('dev'));

// تجهيز مجلد الرفع
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// خدمة الملفات الثابتة (الصور)
app.use('/uploads', express.static(uploadDir));

// Routes
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/sales', saleRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/missing', missingProductRoutes);
app.use('/api/discounts', discountRoutes);
app.use('/api/debts', debtRoutes);
app.use('/api/drawer', drawerRoutes);
app.use('/api/statistics', statisticsRouter);
app.use('/api/purchaseReturns', purchaseReturnRoutes);
app.use('/api/saleReturns', saleReturnRoutes);
app.use('/api/discount-codes', discountCodeRoutes);
app.use('/api/customers', customerRoutes);
// نقطة البداية
app.get('/', (req, res) => {
  res.send(' Hypermarket API is running...');
});

module.exports = app;
