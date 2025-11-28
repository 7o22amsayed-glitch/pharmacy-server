// statisticsRoutes.js

const express = require('express');
const router = express.Router();
const {
    getComprehensiveStatistics,
    getUserStatistics,
    getProductStatistics,
    getSalesStatistics,
    getOrderStatistics,
    getSupplierStatistics,
    getFinancialStatistics,
    getInventoryStatistics,
    getAdvancedAnalytics,
    // Chart Specific Exports
    getSalesTrendsChartData,
    getProductsDistributionChartData,
    getStaffPerformanceChartData,
    getInventoryStatusChartData,
    getPaymentMethodsChartData,
    getPeriodComparisonData
} = require("../controllers/statisticsController");

// ===================== Main Data Routes =====================

// نقطة نهاية شاملة (Comprehensive) لجميع إحصائيات لوحة التحكم
router.get('/comprehensive', getComprehensiveStatistics);

// نقاط نهاية المجموعات الفردية لمرونة أكبر
router.get('/user', getUserStatistics);
router.get('/product', getProductStatistics);
router.get('/sales', getSalesStatistics);
router.get('/order', getOrderStatistics);
router.get('/supplier', getSupplierStatistics);
router.get('/financial', getFinancialStatistics);
router.get('/inventory', getInventoryStatistics);

// ===================== Chart/Analytics Data Routes =====================

// مسارات خاصة ببيانات الرسوم البيانية والأدوات المتقدمة
router.get('/charts/sales-trends', getSalesTrendsChartData);
router.get('/charts/products-distribution', getProductsDistributionChartData);
router.get('/charts/staff-performance', getStaffPerformanceChartData);
router.get('/charts/inventory-status', getInventoryStatusChartData);
router.get('/charts/payment-methods', getPaymentMethodsChartData);
router.get('/analytics/period-comparison', getPeriodComparisonData);
router.get('/advanced', getAdvancedAnalytics);


module.exports = router;