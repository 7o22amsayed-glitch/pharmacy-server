const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const { login, logout, getMe } = require("../controllers/authController");

// مسارات المصادقة العامة
router.post("/login", login);
router.post("/logout", protect, logout);
router.get("/me", protect, getMe);

// مسارات محمية حسب الصلاحيات
const { restrictTo } = require("../middlewares/restrictTo");

router.get("/admin/protected", protect, restrictTo("admin"), (req, res) => {
  res.json({ 
    success: true,
    message: `أهلاً ${req.user.full_name}, لديك صلاحية الأدمن.` 
  });
});

router.get("/staff/protected", protect, restrictTo("staff"), (req, res) => {
  res.json({ 
    success: true,
    message: `أهلاً ${req.user.full_name}, لديك صلاحية الصيدلي.` 
  });
});

router.get("/delivery/protected", protect, restrictTo("delivery"), (req, res) => {
  res.json({ 
    success: true,
    message: `أهلاً ${req.user.full_name}, لديك صلاحية المندوب.` 
  });
});

module.exports = router;
