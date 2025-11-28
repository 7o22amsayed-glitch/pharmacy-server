const pool = require("../config/db");
const bcrypt = require("bcrypt");
const generateToken = require("../utils/generateToken");

exports.login = async (req, res) => {
  const { email, password } = req.body;

  try {
    // التحقق من وجود البريد الإلكتروني
    const [users] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);

    if (!users.length) {
      return res.status(400).json({ 
        success: false,
        message: "البريد الإلكتروني أو كلمة المرور غير صحيحة" 
      });
    }

    const user = users[0];

    // التحقق من كلمة المرور
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ 
        success: false,
        message: "البريد الإلكتروني أو كلمة المرور غير صحيحة" 
      });
    }

    // إنشاء توكن جديد
    const token = generateToken(user.id, user.role);

    // إرجاع التوكن في الاستجابة بدلاً من الكوكيز
    const userData = {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
      token: token // إضافة التوكن إلى بيانات المستخدم
    };

    res.json({
      success: true,
      message: 'تم تسجيل الدخول بنجاح',
      user: userData
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ 
      success: false,
      message: 'حدث خطأ في الخادم',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

exports.logout = (req, res) => {
  res.json({ 
    success: true,
    message: 'تم تسجيل الخروج بنجاح' 
  });
};

exports.getMe = async (req, res) => {
  try {
    // إرجاع بيانات المستخدم من الطلب (تم التحقق من المصادقة بالفعل)
    const { id, full_name, email, role } = req.user;
    res.json({ 
      success: true,
      user: {
        id,
        full_name,
        email,
        role
      }
    });
  } catch (err) {
    console.error("Get me error:", err);
    res.status(500).json({ 
      success: false,
      message: 'حدث خطأ في الخادم'
    });
  }
};
