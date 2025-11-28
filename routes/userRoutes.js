const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const { restrictTo } = require("../middlewares/restrictTo");
const { registerUser, getAllStaff, updateUser, deleteUser } = require("../controllers/userController");

// ✅ هذا الراوت مسموح به فقط للأدمن
router.post("/add-user", protect, restrictTo("admin"), registerUser);

// ✅ هذا الراوت مسموح به فقط للأدمن
router.get("/staff", protect, restrictTo("admin"), getAllStaff);

router.put("/staff/:id", protect, restrictTo("admin"), updateUser);
router.delete("/staff/:id", protect, restrictTo("admin"), deleteUser);

module.exports = router;
