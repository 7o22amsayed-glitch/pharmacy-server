const express = require('express');
const router = express.Router();
const {
  getDrawerStatus,
  addManualTransaction,
  withdrawFromPiggyBank,
  startShift,
  endShift,
  getMyShifts,
  getAllShifts,
  getShiftDetails,
  getShiftStats,
  getShiftSales,
  getShiftTransactions,
  getShiftReturns
} = require("../controllers/drawerController");

const { protect, restrictTo } = require("../middlewares/authMiddleware");

// ✅ Get drawer status
router.get('/', protect, getDrawerStatus);

// ✅ Manual adjust (admins only)
router.post('/adjust', protect, restrictTo('admin'), addManualTransaction);

// ✅ Withdraw from piggy bank (admins only)
router.post('/piggy/withdraw', protect, restrictTo('admin'), withdrawFromPiggyBank);

// ✅ Shift start/end
router.post('/shift/start', protect, startShift);
router.post('/shift/end', protect, endShift);

// ✅ My shifts
router.get('/shifts/my', protect, getMyShifts);

// ✅ All shifts
router.get('/shifts/all', protect, getAllShifts);

// إضافة هذه الـ routes الجديدة
router.get("/shifts/:id", getShiftDetails);
router.get("/shifts/:id/sales", getShiftSales);
router.get("/shifts/:id/transactions", getShiftTransactions);
router.get("/shifts/:id/returns", getShiftReturns);
router.get("/shifts/:id/stats", getShiftStats);

module.exports = router;
