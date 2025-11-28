const express = require('express');
const router = express.Router();
const discountController = require('../controllers/discountController');
const { protect, restrictTo } = require('../middlewares/authMiddleware'); // Assuming you have auth middleware

router.get('/log', protect, restrictTo('admin'), discountController.getDiscountLog); // Only admins can view

module.exports = router;