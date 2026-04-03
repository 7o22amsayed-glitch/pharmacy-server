const express = require("express");
const router = express.Router();


const productController = require("../controllers/productController");
const { protect, restrictTo } = require("../middlewares/authMiddleware");
const uploadImage = require("../middlewares/upload");

// Routes
// Public routes
router.get("/", productController.getAllProducts);
router.get("/categories", productController.getAllCategories); // 🔹 الرابط الجديد
router.get("/companies", productController.getAllCompanies); // 🔹 المسار الجديد للشركات
router.get("/barcode/:barcode", productController.getProductByBarcode);
router.get("/category/:categoryId", productController.getProductsByCategory);
router.get("/search/:name", productController.searchProductByName); // 🔹 الرابط الجديد
router.get("/batches", productController.getProductBatches);
router.post("/purchase-invoice", productController.addPurchaseInvoice);

// Protected routes (require authentication)
router.use(protect);

// Restrict the following routes to admin and staff only
router.use(restrictTo('admin', 'staff'));

// Product management routes
//router.post("/:id/add-stock", productController.addStock);
router.post("/", uploadImage.single("image"), productController.createProduct);
router.put("/:id", uploadImage.single("image"), productController.updateProductById);
router.delete("/:id", productController.deleteProduct);

// Admin-only routes for reports
router.get("/slow-moving", restrictTo('admin'), productController.getSlowMovingProducts);
router.get("/slow-moving/count", restrictTo('admin'), productController.getSlowMovingProductsCount);

module.exports = router;
