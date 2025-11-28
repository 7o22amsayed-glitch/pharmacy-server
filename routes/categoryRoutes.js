const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const categoryController = require("../controllers/categoryController");

// Public routes
router.get("/", categoryController.getAllCategories);

// Protected routes
router.use(protect);
router.post("/", categoryController.createCategory);

module.exports = router;
