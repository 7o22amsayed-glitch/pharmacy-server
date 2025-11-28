const express = require('express');
const router = express.Router();
const supplierController = require('../controllers/supplierController');

// 🟢 Routes for suppliers
router.post('/', supplierController.createSupplier);
router.get('/', supplierController.getAllSuppliers);
router.get('/report/:id', supplierController.getSupplierReport);
router.get('/:id', supplierController.getSupplierById);
router.put('/:id', supplierController.updateSupplier);
router.delete('/:id', supplierController.deleteSupplier);

module.exports = router;