const express = require("express");
const router = express.Router();
const orderController = require("../controllers/orderController");
const upload = require("../middlewares/upload");


// Middleware لرفع صورة الروشتة (اختياري)
// تم تغيير اسم الحقل ليتوافق مع الفرونت اند
router.post("/", upload.array("prescription_images", 10), orderController.createOrder);


// ✅ مسار جديد لإنشاء الطلب مع المنتجات في عملية واحدة
router.post("/create-with-items", orderController.createOrderWithItems);

// لجلب جميع الطلبات (للوحة التحكم مثلاً)
router.get("/", orderController.getAllOrders);

// لتحديث حالة طلب معين
router.put("/:id/status", orderController.updateOrderStatus);

module.exports = router;