// routes/discountCodes.js
const express = require('express');
const router = express.Router();
const discountCodeController = require('../controllers/discountCodeController');
const { protect, restrictTo } = require('../middlewares/authMiddleware');

// جميع الرواتب محمية وتتطلب صلاحية أدمن
router.get('/', protect, restrictTo('admin'), discountCodeController.getAll);
router.post('/', protect, restrictTo('admin'), discountCodeController.create);
router.put('/:id', protect, restrictTo('admin'), discountCodeController.update);
router.patch('/:id/toggle-status', protect, restrictTo('admin'), discountCodeController.toggleStatus);
router.delete('/:id', protect, restrictTo('admin'), discountCodeController.remove);

// التحقق من صحة الكود (متاح للجميع)
router.get('/validate/:code', discountCodeController.validate);

// استخدام الكود (محمي)
router.post('/:id/use', protect, discountCodeController.useCode);

// إحصائيات الأكواد (أدمن فقط)
router.get('/stats/overview', protect, restrictTo('admin'), discountCodeController.getStats);

module.exports = router;