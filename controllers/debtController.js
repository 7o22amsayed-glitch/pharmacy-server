const db = require('../config/db');

// @desc    Get all debts
// @route   GET /api/debts
// @access  Private
const getAllDebts = async (req, res) => {
    try {
        const [debts] = await db.query('SELECT * FROM debts ORDER BY created_at DESC');
        res.json(debts);
    } catch (error) {
        console.error('Error fetching debts:', error);
        res.status(500).json([]);
    }
};

// @desc    Add a new debt and decrease drawer balance
// @route   POST /api/debts
// @access  Private
const addDebt = async (req, res) => {
    const { customer_name, customer_id, amount, notes } = req.body;
    // افترض أن هوية المستخدم (userId) متاحة في req.user.id بعد المصادقة
    const userId = req.user ? req.user.id : 1; // استخدم 1 كقيمة افتراضية إذا لم يكن المستخدم مسجلاً

    if (!customer_name || !customer_id || !amount || amount <= 0) {
        return res.status(400).json({ success: false, message: 'يرجى إدخال اسم العميل ومبلغ صحيح' });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. إضافة الدين إلى جدول الديون
        const [result] = await connection.execute(
            'INSERT INTO debts (customer_name, customer_id, amount, notes) VALUES (?, ?, ?, ?)',
            [customer_name, customer_id, amount, notes]
        );
        const debtId = result.insertId;

        /* 2. خصم المبلغ من رصيد الدرج
        await connection.execute(
            'UPDATE cash_drawer SET balance = balance - ? WHERE id = 1',
            [amount]
        );
        */

        // 3. تسجيل حركة الخصم في سجل حركات الدرج
        const description = `مبيعات أجل`;
        await connection.execute(
            'INSERT INTO drawer_transactions (type, amount, description, from_staff_id, customer_id, debt_id) VALUES (?, ?, ?, ?, ?, ?)',
            ['debt_add', -parseFloat(amount), description, userId, customer_id, debtId]
        );

        await connection.commit();
        res.status(201).json({ success: true, message: 'تمت إضافة المديونية وخصمها من الدرج بنجاح', debtId });

    } catch (error) {
        await connection.rollback();
        console.error('Error adding debt:', error);
        res.status(500).json({ success: false, message: 'خطأ في الخادم أثناء إضافة الدين' });
    } finally {
        connection.release();
    }
};

// @desc    Update a debt (pay off) and increase drawer balance
// @route   PUT /api/debts/:id
// @access  Private
const updateDebt = async (req, res) => {
    const { id } = req.params;
    const { amount_paid, customer_id } = req.body; // نستخدم amount_paid مباشرة كما هو من الـ frontend
    const userId = req.user ? req.user.id : 1;

    if (amount_paid === undefined || amount_paid < 0) {
        return res.status(400).json({ message: 'المبلغ المدفوع مطلوب ويجب أن يكون قيمة موجبة' });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. جلب بيانات الدين الحالية
        const [[currentDebt]] = await connection.execute('SELECT amount, amount_paid FROM debts WHERE id = ?', [id]);
        if (!currentDebt) {
            await connection.rollback();
            return res.status(404).json({ message: 'الدين غير موجود' });
        }

        const currentTotalPaid = parseFloat(currentDebt.amount_paid || 0);
        const newTotalPaid = parseFloat(amount_paid); // هذا هو المبلغ الإجمالي الجديد بعد الدفعة

        // التأكد من أن المبلغ المدفوع الجديد ليس أقل من الحالي
        if (newTotalPaid < currentTotalPaid) {
            await connection.rollback();
            return res.status(400).json({ message: 'المبلغ المدفوع الجديد لا يمكن أن يكون أقل من المبلغ المسدد سابقًا.' });
        }
        
        const paymentAmountForDrawer = newTotalPaid - currentTotalPaid;

        if (paymentAmountForDrawer <= 0 && newTotalPaid < parseFloat(currentDebt.amount)) {
            await connection.rollback();
            return res.status(400).json({ message: 'لا توجد دفعة جديدة لتسجيلها.' });
        }
        
        // 2. تحديث الدين في جدول الديون
        await connection.execute(
            'UPDATE debts SET amount_paid = ? WHERE id = ?',
            [newTotalPaid, id]
        );

        // 3. زيادة رصيد الدرج بالمبلغ المدفوع الجديد (الفرق الفعلي)
        if (paymentAmountForDrawer > 0) {
            await connection.execute(
                'UPDATE cash_drawer SET balance = balance + ? WHERE id = 1',
                [paymentAmountForDrawer]
            );

            // 4. تسجيل حركة الإيداع في سجل حركات الدرج
            const description = `سداد مبيعات أجل`;
            await connection.execute(
                'INSERT INTO drawer_transactions (type, amount, description, from_staff_id, debt_id, customer_id) VALUES (?, ?, ?, ?, ?, ?)',
                ['debt_payment', paymentAmountForDrawer, description, userId, id, customer_id]
            );
        }

        // 5. التحقق مما إذا كان الدين قد سدد بالكامل لحذفه
        if (newTotalPaid >= parseFloat(currentDebt.amount)) {
            await connection.execute('DELETE FROM debts WHERE id = ?', [id]);
            await connection.commit();
            return res.json({ message: 'تم سداد الدين بالكامل وتم حذفه بنجاح', debtDeleted: true });
        }

        await connection.commit();
        res.json({ message: 'تم تحديث الدين وإضافة الدفعة للدرج بنجاح', debtDeleted: false });

    } catch (error) {
        await connection.rollback();
        console.error('Error updating debt:', error);
        res.status(500).json({ message: 'خطأ في الخادم أثناء تحديث الدين' });
    } finally {
        connection.release();
    }
};



// @desc    Delete a debt
// @route   DELETE /api/debts/:id
// @access  Private
const deleteDebt = async (req, res) => {
    const { id } = req.params;
    try {
        // ملاحظة: حذف الدين هنا لا يعيد المبلغ للدرج تلقائيًا
        // إذا أردت ذلك، يجب إضافة منطق مشابه لمنطق السداد ولكن بالعكس
        const [result] = await db.query('DELETE FROM debts WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Debt not found' });
        }

        res.json({ success: true, message: 'Debt deleted successfully' });
    } catch (error) {
        console.error('Error deleting debt:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

module.exports = { getAllDebts, addDebt, updateDebt, deleteDebt };