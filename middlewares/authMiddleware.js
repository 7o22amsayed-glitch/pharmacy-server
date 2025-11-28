const jwt = require("jsonwebtoken");
const pool = require("../config/db");

// التحقق من صحة التوكن
const protect = async (req, res, next) => {
  try {
    // 1. جلب التوكن من رأس الطلب
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    console.log('Auth Middleware - Token:', token ? 'Token exists' : 'No token provided');

    if (!token) {
      console.log('Auth Middleware - Error: No token provided');
      return res.status(401).json({ 
        success: false,
        message: "غير مصرح - لم يتم توفير توكن" 
      });
    }

    // 2. التحقق من صحة التوكن
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log('Auth Middleware - Decoded token:', decoded);
    } catch (jwtError) {
      console.error('Auth Middleware - JWT Verification Error:', jwtError.message);
      return res.status(401).json({ 
        success: false,
        message: `توكن غير صالح: ${jwtError.message}` 
      });
    }

    // 3. جلب بيانات المستخدم من قاعدة البيانات
    const [users] = await pool.query("SELECT id, full_name, email, role FROM users WHERE id = ?", [decoded.id]);
    
    if (!users.length) {
      console.log(`Auth Middleware - User not found with ID: ${decoded.id}`);
      return res.status(401).json({ 
        success: false,
        message: "المستخدم غير موجود" 
      });
    }

    // 4. إضافة بيانات المستخدم إلى الطلب
    const user = users[0];
    req.user = {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
    };

    console.log('Auth Middleware - User authenticated:', { id: user.id, role: user.role });
    next();
  } catch (error) {
    console.error("Auth Middleware - Unexpected error:", error);
    
    return res.status(500).json({ 
      success: false,
      message: `خطأ في المصادقة: ${error.message}` 
    });
  }
};

// التحقق من الصلاحيات
const restrictTo = (...roles) => {
  return (req, res, next) => {
    console.log('RestrictTo Middleware - Checking roles:', { 
      userRole: req.user?.role, 
      allowedRoles: roles 
    });
    
    if (!req.user || !roles.includes(req.user.role)) {
      console.log('RestrictTo Middleware - Access denied:', { 
        userRole: req.user?.role, 
        allowedRoles: roles 
      });
      return res.status(403).json({
        success: false,
        message: `ليس لديك صلاحية للوصول إلى هذا المصدر. تحتاج إلى دور: ${roles.join(' أو ')}`
      });
    }
    
    console.log('RestrictTo Middleware - Access granted');
    next();
  };
};

module.exports = { protect, restrictTo };
