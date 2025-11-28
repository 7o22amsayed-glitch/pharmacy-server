const express = require('express');
const router = express.Router();
const { getAllDebts, addDebt, updateDebt, deleteDebt } = require('../controllers/debtController');
const { protect } = require("../middlewares/authMiddleware");

// All routes are protected
router.use(protect);

router.route('/')
    .get(getAllDebts)
    .post(addDebt);

router.route('/:id')
    .put(updateDebt)
    .delete(deleteDebt);

module.exports = router;
