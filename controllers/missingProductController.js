const pool = require('../config/db');

exports.addMissingProduct = async (req, res) => {
    const { productId } = req.body;
    try {
        // Check if the product already exists in missing_products and is not ordered
        const [existing] = await pool.execute(
            'SELECT id FROM missing_products WHERE product_id = ? AND ordered = FALSE',
            [productId]
        );

        if (existing.length > 0) {
            return res.status(409).json({ success: false, message: 'هذا المنتج موجود بالفعل في قائمة النواقص.' });
        }

        await pool.execute(
            'INSERT INTO missing_products (product_id) VALUES (?)',
            [productId]
        );
        res.json({ success: true, message: 'تمت إضافة المنتج إلى قائمة النواقص.' });
    } catch (error) {
        console.error('Error adding missing product:', error);
        res.status(500).json({ success: false, message: 'خطأ في الخادم عند إضافة المنتج إلى النواقص.' });
    }
};

exports.markProductAsOrdered = async (req, res) => {
    const { productId } = req.params;
    try {
        const [result] = await pool.execute(
            'UPDATE missing_products SET ordered = TRUE WHERE product_id = ? AND ordered = FALSE',
            [productId]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'المنتج غير موجود في قائمة النواقص أو تم الطلب عليه بالفعل.' });
        }
        res.json({ success: true, message: 'تم تحديث حالة المنتج إلى "تم الطلب عليه" في قائمة النواقص.' });
    } catch (error) {
        console.error('Error marking product as ordered:', error);
        res.status(500).json({ success: false, message: 'خطأ في الخادم عند تحديث حالة المنتج في النواقص.' });
    }
};

exports.getAllMissingProducts = async (req, res) => {
    try {
        const [rows] = await pool.execute(`
            SELECT
                mp.id,
                mp.added_at,
                mp.ordered,
                p.name AS productName,
                p.id AS productId,
                p.barcode,
                p.quantity AS currentStock,
                p.strips_per_box,
                p.partial_strips -- Added partial_strips to the result
            FROM missing_products mp
            JOIN products p ON mp.product_id = p.id
            ORDER BY mp.added_at DESC
        `);
        res.json({ success: true, missingProducts: rows });
    } catch (error) {
        console.error('Error fetching missing products:', error);
        res.status(500).json({ success: false, message: 'خطأ في الخادم عند جلب قائمة النواقص.' });
    }
};