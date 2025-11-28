const express = require("express");
const router = express.Router();
const controller = require("../controllers/saleReturnController");


router.post("/", controller.createSaleReturns);
router.get("/", controller.getSaleReturns);
router.post("/full", controller.handleFullReturn);
router.post("/handlePartialReturn", controller.handlePartialReturn);

router.get('/:id', controller.getSaleReturnDetails);

// المسارات الجديدة للعمل مع الفواتير
router.get('/invoice/:barcode', controller.getSaleByBarcode);
router.post('/with-invoice', controller.createSaleReturnWithInvoice);

module.exports = router;
