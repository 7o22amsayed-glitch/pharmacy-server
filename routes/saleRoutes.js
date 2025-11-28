// backend/routes/salesRoutes.js
const express = require('express');
const router = express.Router();
const saleController = require('../controllers/saleController');
const { protect, restrictTo } = require("../middlewares/authMiddleware");

router.get('/products/search', saleController.searchProduct);

router.get('/products/search-by-name', saleController.searchProductByName);

router.post('/complete-sale', protect, saleController.completeSale);

router.get('/history', protect, saleController.getSalesHistory);

router.get('/history/:saleId', protect, saleController.getSaleDetails);

router.get('/top-selling', protect, saleController.getTopSellingProducts);

router.get('/daily-summary', protect, saleController.getDailySalesSummary);

router.post('/close-drawer', protect, restrictTo('admin'), saleController.closeDrawer);


router.post('/', protect, saleController.createSale);

module.exports = router;