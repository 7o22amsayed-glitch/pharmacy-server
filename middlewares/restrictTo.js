const restrictTo = (...roles) => {
    return (req, res, next) => {
      if (!roles.includes(req.user.role)) {
        return res.status(403).json({ message: "لا تملك صلاحية الوصول" });
      }
      next();
    };
  };
  
  module.exports = { restrictTo };
  