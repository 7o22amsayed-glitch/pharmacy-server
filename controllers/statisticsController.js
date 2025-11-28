// statisticsController.js

const db = require('../config/db');
const moment = require('moment');
const express = require('express');

// Helper function for executing queries
async function executeQuery(query, params = []) {
    try {
        const [results] = await db.query(query, params);
        return results;
    } catch (error) {
        // Log the error but return a clean error object to allow other stats to process
        console.error('Database error in statistics:', error.message, 'Query:', query);
        // Return an empty array/object in case of error to avoid breaking the frontend
        return { error: error.message, data: [] }; 
    }
}

// Helper function to get date ranges (Current and Previous Period)
function getDateRanges(range) {
    const now = moment();
    
    // Define current period (start/end)
    let currentStart, periodLabel;
    switch (range) {
        case 'today':
            currentStart = now.clone().startOf('day');
            periodLabel = 'اليوم';
            break;
        case 'yesterday':
            currentStart = now.clone().subtract(1, 'day').startOf('day');
            periodLabel = 'أمس';
            break;
        case 'week':
            currentStart = now.clone().startOf('isoWeek'); // Use ISO week (Mon-Sun)
            periodLabel = 'الأسبوع الحالي';
            break;
        case 'month':
            currentStart = now.clone().startOf('month');
            periodLabel = 'الشهر الحالي';
            break;
        case 'quarter':
            currentStart = now.clone().startOf('quarter');
            periodLabel = 'الربع الحالي';
            break;
        case 'year':
            currentStart = now.clone().startOf('year');
            periodLabel = 'العام الحالي';
            break;
        default:
            currentStart = now.clone().startOf('day');
            periodLabel = 'اليوم';
    }

    const currentEnd = now.clone().endOf('day'); // Always end today at the latest point

    // Calculate previous period
    const duration = moment.duration(currentEnd.diff(currentStart));
    const prevStart = currentStart.clone().subtract(duration);
    const prevEnd = currentEnd.clone().subtract(duration);
    
    // Adjust yesterday range specifically
    if (range === 'yesterday') {
        const dayDuration = moment.duration(1, 'day');
        prevStart.subtract(dayDuration);
        prevEnd.subtract(dayDuration);
    }
    
    return { 
        current: { 
            start: currentStart.format('YYYY-MM-DD HH:mm:ss'), 
            end: currentEnd.format('YYYY-MM-DD HH:mm:ss'),
            dateCondition: `created_at BETWEEN '${currentStart.format('YYYY-MM-DD HH:mm:ss')}' AND '${currentEnd.format('YYYY-MM-DD HH:mm:ss')}'`
        }, 
        previous: { 
            start: prevStart.format('YYYY-MM-DD HH:mm:ss'), 
            end: prevEnd.format('YYYY-MM-DD HH:mm:ss'),
            dateCondition: `created_at BETWEEN '${prevStart.format('YYYY-MM-DD HH:mm:ss')}' AND '${prevEnd.format('YYYY-MM-DD HH:mm:ss')}'`
        },
        label: periodLabel,
        range
    };
}

// Helper to calculate percentage change
function calculatePercentageChange(current, previous) {
    current = parseFloat(current) || 0;
    previous = parseFloat(previous) || 0;
    if (previous === 0) return current > 0 ? 100 : 0;
    return (((current - previous) / previous) * 100).toFixed(2);
}

// ===================== A. User & Staff Statistics =====================
const getUserStatistics = async (range) => {
    const { current, previous } = getDateRanges(range);

    const queries = {
        total_users: 'SELECT COUNT(*) as count FROM users',
        users_by_role: 'SELECT role, COUNT(*) as count FROM users GROUP BY role',
        new_customers_current: `SELECT COUNT(*) as count FROM customers WHERE ${current.dateCondition}`,
        new_customers_previous: `SELECT COUNT(*) as count FROM customers WHERE ${previous.dateCondition}`,
        
        staff_performance_summary: `
            SELECT 
                COUNT(DISTINCT staff_id) as active_staff_count,
                COALESCE(SUM(total), 0) as total_revenue
            FROM sales
            WHERE staff_id IS NOT NULL AND ${current.dateCondition.replace(/created_at/g, 'DATE(created_at)')} AND status = 'active'
        `,
        top_staff_by_sales_count: `
            SELECT 
                u.full_name, COUNT(s.id) as sales_count, COALESCE(SUM(s.total), 0) as total_revenue
            FROM users u
            JOIN sales s ON u.id = s.staff_id
            WHERE u.role IN ('admin', 'staff') AND ${current.dateCondition.replace(/created_at/g, 'DATE(s.created_at)')} AND s.status = 'active'
            GROUP BY u.id
            ORDER BY sales_count DESC
            LIMIT 5
        `,
        customer_debtors: `
            SELECT id, customer_name, remaining_amount, updated_at 
            FROM debts 
            WHERE remaining_amount > 0 
            ORDER BY remaining_amount DESC 
            LIMIT 5
        `
    };

    const results = {};
    for (const [key, query] of Object.entries(queries)) {
        results[key] = await executeQuery(query);
    }
    
    const currentNewCustomers = results.new_customers_current[0]?.count || 0;
    const previousNewCustomers = results.new_customers_previous[0]?.count || 0;
    results.new_customers_change = calculatePercentageChange(currentNewCustomers, previousNewCustomers);

    return results;
};


// ===================== B. Inventory & Product Statistics =====================
const getProductStatistics = async (range) => {
    const { current } = getDateRanges(range);
    const salesDateCondition = current.dateCondition.replace(/created_at/g, 'DATE(s.created_at)');
    
    const queries = {
        inventory_valuation: `
            SELECT 
                COUNT(*) as total_products,
                SUM(quantity) as total_quantity_boxes,
                COALESCE(SUM(price * quantity), 0) as inventory_retail_value,
                SUM(partial_strips) as total_strips
            FROM products
            WHERE available_in_pharmacy = TRUE
        `,
        stock_levels: `
            SELECT 
                SUM(CASE WHEN quantity = 0 THEN 1 ELSE 0 END) as out_of_stock,
                SUM(CASE WHEN quantity > 0 AND quantity < 5 THEN 1 ELSE 0 END) as low_stock,
                SUM(CASE WHEN quantity >= 20 THEN 1 ELSE 0 END) as high_stock
            FROM products
            WHERE available_in_pharmacy = TRUE
        `,
        expiry_status: `
            SELECT 
                COALESCE(SUM(CASE WHEN expiration_date < CURDATE() AND quantity > 0 THEN quantity ELSE 0 END), 0) as expired_quantity,
                COALESCE(SUM(CASE WHEN expiration_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY) AND quantity > 0 THEN quantity ELSE 0 END), 0) as expiring_soon_quantity
            FROM product_batches
            WHERE quantity > 0
        `,
        top_selling_products_in_period: `
            SELECT p.name, SUM(si.quantity) as total_boxes_sold, COALESCE(SUM(si.quantity * si.price), 0) as total_revenue
            FROM sale_items si
            JOIN products p ON si.product_id = p.id
            JOIN sales s ON si.sale_id = s.id
            WHERE ${salesDateCondition} AND s.status = 'active'
            GROUP BY p.id
            ORDER BY total_boxes_sold DESC
            LIMIT 10
        `,
        missing_products_count: `
            SELECT COUNT(*) as count FROM missing_products WHERE ordered = FALSE
        `
    };

    const results = {};
    for (const [key, query] of Object.entries(queries)) {
        results[key] = await executeQuery(query);
    }
    return results;
};


// ===================== C. Sales & Revenue Statistics =====================
const getSalesStatistics = async (range) => {
    const { current, previous } = getDateRanges(range);
    
    // Query template for sales period
    const salesQueryTemplate = (condition) => `
        SELECT
            COALESCE(SUM(total), 0) as total_revenue,
            COALESCE(SUM(initial_total), 0) as gross_revenue,
            COALESCE(SUM(total) / NULLIF(COUNT(*), 0), 0) as avg_sale,
            COUNT(*) as total_sales_count
        FROM sales
        WHERE ${condition} AND status = 'active'
    `;

    // Query template for returns period
    const returnsQueryTemplate = (condition) => `
        SELECT
            COALESCE(SUM(return_total), 0) as total_returned_amount,
            COUNT(*) as total_returns_count
        FROM sale_returns
        WHERE ${condition.replace(/created_at/g, 'returned_at')}
    `;

    const currentSales = (await executeQuery(salesQueryTemplate(current.dateCondition)))[0];
    const previousSales = (await executeQuery(salesQueryTemplate(previous.dateCondition)))[0];
    const currentReturns = (await executeQuery(returnsQueryTemplate(current.dateCondition)))[0];
    const previousReturns = (await executeQuery(returnsQueryTemplate(previous.dateCondition)))[0];

    // Net Sales Calculation
    const currentRevenue = currentSales.total_revenue || 0;
    const currentReturnsAmount = currentReturns.total_returned_amount || 0;
    const netSalesCurrent = currentRevenue - currentReturnsAmount;

    const previousRevenue = previousSales.total_revenue || 0;
    const previousReturnsAmount = previousReturns.total_returned_amount || 0;
    const netSalesPrevious = previousRevenue - previousReturnsAmount;

    const results = {
        sales_summary: {
            current: currentSales,
            returns: currentReturns,
            net_sales_current: netSalesCurrent,
            net_sales_previous: netSalesPrevious,
            revenue_change: calculatePercentageChange(currentRevenue, previousRevenue),
            net_sales_change: calculatePercentageChange(netSalesCurrent, netSalesPrevious),
        },
        payment_methods: await executeQuery(`
            SELECT payment_method, COALESCE(SUM(total), 0) as sales_amount, COUNT(*) as sales_count
            FROM sales
            WHERE ${current.dateCondition} AND status = 'active'
            GROUP BY payment_method
            ORDER BY sales_amount DESC
        `),
        discount_summary: (await executeQuery(`
            SELECT
                COUNT(d.id) as total_discounts_count,
                COALESCE(SUM(d.amount), 0) as total_discount_amount
            FROM discounts d
            JOIN sales s ON d.sale_id = s.id
            WHERE ${current.dateCondition.replace(/created_at/g, 's.created_at')} AND s.status = 'active'
        `))[0]
    };
    return results;
};


// ===================== D. Financial Statistics (System Balances & Debts) =====================
const getFinancialStatistics = async (range) => {
    const { current } = getDateRanges(range);
    const transactionsCondition = current.dateCondition.replace(/created_at/g, 'DATE(created_at)');

    const queries = {
        system_balances: `
            SELECT
                (SELECT COALESCE(balance, 0) FROM cash_drawer LIMIT 1) as drawer_balance,
                (SELECT COALESCE(balance, 0) FROM admin_piggy_bank LIMIT 1) as admin_bank_balance
        `,
        debt_status: `
            SELECT
                COUNT(*) as total_debts_count,
                COALESCE(SUM(remaining_amount), 0) as total_remaining_debt
            FROM debts
            WHERE remaining_amount > 0
        `,
        transaction_summary: `
            SELECT
                COALESCE(SUM(CASE WHEN type = 'deposit' THEN amount ELSE 0 END), 0) as total_deposits,
                COALESCE(SUM(CASE WHEN type = 'withdrawal' THEN amount ELSE 0 END), 0) as total_withdrawals,
                COALESCE(SUM(CASE WHEN type = 'debt_payment' THEN amount ELSE 0 END), 0) as total_debt_payments
            FROM drawer_transactions
            WHERE ${transactionsCondition}
        `,
        shifts_summary: (await executeQuery(`
            SELECT
                COUNT(*) as total_shifts,
                COALESCE(SUM(total_sales), 0) as total_sales_amount,
                COALESCE(SUM(net_sales), 0) as net_sales_amount
            FROM shifts
            WHERE ${transactionsCondition.replace(/created_at/g, 'start_time')}
        `))[0]
    };

    const results = {};
    for (const [key, query] of Object.entries(queries)) {
        results[key] = await executeQuery(query);
    }
    // Flatten balances and debt status
    results.system_balances = results.system_balances[0];
    results.debt_status = results.debt_status[0];

    return results;
};

// ===================== E. Supplier & Purchase Statistics =====================
const getSupplierStatistics = async (range) => {
    const { current } = getDateRanges(range);
    const dateCondition = current.dateCondition.replace(/created_at/g, 'DATE(invoice_date)');

    const queries = {
        purchase_summary: `
            SELECT
                COUNT(*) as total_invoices,
                COALESCE(SUM(total_amount), 0) as total_purchase_amount,
                COALESCE(AVG(total_amount), 0) as avg_invoice_amount
            FROM purchase_invoices
            WHERE ${dateCondition}
        `,
        top_suppliers_by_value: `
            SELECT s.name, COALESCE(SUM(pi.total_amount), 0) as total_purchased_value, COUNT(pi.id) as total_invoices_count
            FROM suppliers s
            JOIN purchase_invoices pi ON s.id = pi.supplier_id
            WHERE ${dateCondition}
            GROUP BY s.id
            ORDER BY total_purchased_value DESC
            LIMIT 5
        `,
        purchase_returns_summary: (await executeQuery(`
            SELECT
                COUNT(*) as total_returns_count,
                COALESCE(SUM(quantity), 0) as total_quantity_returned
            FROM purchase_returns pr
            WHERE ${current.dateCondition.replace(/created_at/g, 'returned_at')}
        `))[0]
    };

    const results = {};
    for (const [key, query] of Object.entries(queries)) {
        results[key] = await executeQuery(query);
    }
    return results;
};

// ===================== F. Orders (Web/Delivery) Statistics =====================
const getOrderStatistics = async (range) => {
    const { current } = getDateRanges(range);
    const dateCondition = current.dateCondition.replace(/created_at/g, 'DATE(created_at)');

    const queries = {
        orders_summary: `
            SELECT
                COUNT(*) as total_orders,
                COALESCE(SUM(total), 0) as total_orders_value,
                COALESCE(AVG(total), 0) as avg_order_value
            FROM orders
            WHERE ${dateCondition}
        `,
        orders_by_status: `
            SELECT status, COUNT(*) as count, COALESCE(SUM(total), 0) as total_value
            FROM orders
            WHERE ${dateCondition}
            GROUP BY status
            ORDER BY count DESC
        `,
        orders_by_delivery_method: `
            SELECT delivery_method, COUNT(*) as count
            FROM orders
            WHERE ${dateCondition}
            GROUP BY delivery_method
        `
    };

    const results = {};
    for (const [key, query] of Object.entries(queries)) {
        results[key] = await executeQuery(query);
    }
    return results;
};


// ===================== G. Chart/Advanced Data Helpers =====================

const getSalesTrendsChartData = async (range) => {
    const { current } = getDateRanges(range);
  
    let labelColumn = '';
    let groupBy = '';
    let orderBy = '';
  
    switch (range) {
      case 'today':
        // نريد الساعات كما هي من MySQL بدون تحويل توقيت
        labelColumn = 'HOUR(created_at)';
        groupBy = 'HOUR(created_at)';
        orderBy = 'HOUR(created_at)';
        break;
  
      case 'week':
        // نعرض الأيام (1=الأحد)
        labelColumn = 'DAYOFWEEK(created_at)';
        groupBy = 'DAYOFWEEK(created_at)';
        orderBy = 'DAYOFWEEK(created_at)';
        break;
  
      case 'month':
        // نعرض الأسابيع داخل الشهر
        labelColumn = 'WEEK(created_at, 1) - WEEK(DATE_SUB(created_at, INTERVAL DAYOFMONTH(created_at)-1 DAY), 1) + 1';
        groupBy = 'WEEK(created_at, 1) - WEEK(DATE_SUB(created_at, INTERVAL DAYOFMONTH(created_at)-1 DAY), 1) + 1';
        orderBy = '1';
        break;
  
      case 'quarter':
        // نفس فكرة الشهر، تجمع كل أسبوع داخل الربع
        labelColumn = 'WEEK(created_at, 1)';
        groupBy = 'WEEK(created_at, 1)';
        orderBy = 'WEEK(created_at, 1)';
        break;
  
      case 'year':
        labelColumn = 'MONTH(created_at)';
        groupBy = 'MONTH(created_at)';
        orderBy = 'MONTH(created_at)';
        break;
  
      default:
        labelColumn = 'DATE(created_at)';
        groupBy = 'DATE(created_at)';
        orderBy = 'DATE(created_at)';
    }
  
    const query = `
      SELECT
        ${labelColumn} AS label,
        COUNT(*) AS sales_count,
        COALESCE(SUM(total), 0) AS total_amount
      FROM sales
      WHERE ${current.dateCondition} AND status = 'active'
      GROUP BY ${groupBy}
      ORDER BY ${orderBy} ASC
    `;
  
    return await executeQuery(query);
  };
  

  const getPeriodComparisonData = async (range) => {
    const { current, previous, label } = getDateRanges(range);
  
    const query = `
      SELECT
          'current' as period,
          COALESCE(SUM(total), 0) as total_revenue,
          COUNT(id) as total_sales
      FROM sales
      WHERE ${current.dateCondition} AND status = 'active'
      
      UNION ALL
      
      SELECT
          'previous' as period,
          COALESCE(SUM(total), 0) as total_revenue,
          COUNT(id) as total_sales
      FROM sales
      WHERE ${previous.dateCondition} AND status = 'active'
    `;
  
    const results = (await executeQuery(query)) || [];
  
    const currentData = results.find(r => r.period === 'current') || { total_revenue: 0, total_sales: 0 };
    const previousData = results.find(r => r.period === 'previous') || { total_revenue: 0, total_sales: 0 };
  
    // نحسب التغيرات فقط لو فيه أي مبيعات
    const revenueChange = calculatePercentageChange(currentData.total_revenue, previousData.total_revenue);
    const salesChange = calculatePercentageChange(currentData.total_sales, previousData.total_sales);
  
    return {
      label,
      current: currentData,
      previous: previousData,
      revenue_change: revenueChange,
      sales_change: salesChange
    };
  };
  

const getInventoryStatusChartData = async () => {
    const query = `
        SELECT 
            SUM(CASE WHEN quantity = 0 THEN 1 ELSE 0 END) as out_of_stock,
            SUM(CASE WHEN quantity > 0 AND quantity < 5 THEN 1 ELSE 0 END) as low_stock,
            SUM(CASE WHEN quantity >= 5 AND quantity < 20 THEN 1 ELSE 0 END) as medium_stock,
            SUM(CASE WHEN quantity >= 20 THEN 1 ELSE 0 END) as high_stock
        FROM products
        WHERE available_in_pharmacy = TRUE
    `;
    return (await executeQuery(query))[0];
};

const getStaffPerformanceChartData = async (range) => {
    const { current } = getDateRanges(range);
    const dateCondition = current.dateCondition.replace(/created_at/g, 'DATE(s.created_at)');

    const query = `
        SELECT 
            u.full_name as staff_name,
            COALESCE(SUM(s.total), 0) as total_sales,
            COUNT(s.id) as sales_count
        FROM users u
        LEFT JOIN sales s ON u.id = s.staff_id
        WHERE u.role IN ('admin', 'staff') AND ${dateCondition} AND s.status = 'active'
        GROUP BY u.id, u.full_name
        HAVING sales_count > 0 OR total_sales > 0
        ORDER BY total_sales DESC
        LIMIT 10
    `;
    return await executeQuery(query);
};

const getProductsDistributionChartData = async () => {
    const query = `
        SELECT c.name as category, COUNT(p.id) as product_count
        FROM products p
        JOIN categories c ON p.category_id = c.id
        WHERE p.available_in_pharmacy = TRUE
        GROUP BY c.id, c.name
        ORDER BY product_count DESC
    `;
    return await executeQuery(query);
};

const getPaymentMethodsChartData = async (range) => {
    const { current } = getDateRanges(range);
    const dateCondition = current.dateCondition.replace(/created_at/g, 'DATE(created_at)');

    const query = `
        SELECT payment_method, COALESCE(SUM(total), 0) as total_amount
        FROM sales
        WHERE ${dateCondition} AND status = 'active'
        GROUP BY payment_method
        ORDER BY total_amount DESC
    `;
    return await executeQuery(query);
};


// ===================== H. Main Comprehensive Controller Logic =====================

const getComprehensiveStatistics = async (req, res) => {
    const range = req.query.range || 'today';

    try {
        // Run all core statistic functions in parallel
        const [
            userStats,
            productStats,
            salesStats,
            financialStats,
            supplierStats,
            orderStats
        ] = await Promise.all([
            getUserStatistics(range),
            getProductStatistics(range),
            getSalesStatistics(range),
            getFinancialStatistics(range),
            getSupplierStatistics(range),
            getOrderStatistics(range)
        ]);

        const allStats = {
            range: getDateRanges(range).label,
            user: userStats,
            inventory: productStats,
            sales: salesStats,
            finance: financialStats,
            supplier: supplierStats,
            orders: orderStats
        };

        res.json({
            success: true,
            data: allStats,
            timestamp: new Date().toISOString(),
            range: range
        });

    } catch (error) {
        console.error('Error in comprehensive statistics:', error);
        res.status(500).json({
            success: false,
            message: 'فشل في جلب الإحصائيات الشاملة',
            error: error.message
        });
    }
};

// ===================== I. API Controller Exports =====================

module.exports = {
    getComprehensiveStatistics,

    // Individual Data Groups APIs
    getUserStatistics: async (req, res) => { const data = await getUserStatistics(req.query.range || 'today'); res.json({ success: true, data }); },
    getProductStatistics: async (req, res) => { const data = await getProductStatistics(req.query.range || 'today'); res.json({ success: true, data }); },
    getSalesStatistics: async (req, res) => { const data = await getSalesStatistics(req.query.range || 'today'); res.json({ success: true, data }); },
    getOrderStatistics: async (req, res) => { const data = await getOrderStatistics(req.query.range || 'today'); res.json({ success: true, data }); },
    getSupplierStatistics: async (req, res) => { const data = await getSupplierStatistics(req.query.range || 'today'); res.json({ success: true, data }); },
    getFinancialStatistics: async (req, res) => { const data = await getFinancialStatistics(req.query.range || 'today'); res.json({ success: true, data }); },
    getInventoryStatistics: async (req, res) => { const data = await getProductStatistics(req.query.range || 'today'); res.json({ success: true, data }); }, // Reuse Product Stats

    // Chart Data APIs (Used by Frontend Hooks)
    getSalesTrendsChartData: async (req, res) => { 
        const data = await getSalesTrendsChartData(req.query.range || 'month'); 
        res.json({ success: true, data }); 
    },
    getProductsDistributionChartData: async (req, res) => { 
        const data = await getProductsDistributionChartData(); 
        res.json({ success: true, data }); 
    },
    getStaffPerformanceChartData: async (req, res) => { 
        const data = await getStaffPerformanceChartData(req.query.range || 'month'); 
        res.json({ success: true, data }); 
    },
    getInventoryStatusChartData: async (req, res) => { 
        const data = await getInventoryStatusChartData(); 
        res.json({ success: true, data }); 
    },
    getPaymentMethodsChartData: async (req, res) => { 
        const data = await getPaymentMethodsChartData(req.query.range || 'month'); 
        res.json({ success: true, data }); 
    },
    getPeriodComparisonData: async (req, res) => { 
        const data = await getPeriodComparisonData(req.query.range || 'month'); 
        res.json({ success: true, data }); 
    },
    // Keep getAdvancedAnalytics as a container if needed, but the individual chart routes are better.
    getAdvancedAnalytics: async (req, res) => {
        const range = req.query.range || 'month';
        const data = {
            periodComparison: await getPeriodComparisonData(range),
            salesTrends: await getSalesTrendsChartData(range)
        };
        res.json({ success: true, data });
    }
};