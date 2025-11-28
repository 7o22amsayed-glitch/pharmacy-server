const express = require('express');
const router = express.Router();
const purchaseReturnController = require('../controllers/purchaseReturnController');

// POST: إنشاء مردود شراء
router.post('/', purchaseReturnController.createPurchaseReturn);

// GET: جلب جميع مردودات الشراء
router.get('/', purchaseReturnController.getAllPurchaseReturns);

// GET: جلب الدفعات المتاحة للمنتج
router.get('/batches/:productId', purchaseReturnController.getProductBatches);

module.exports = router;