const multer = require("multer");
const path = require("path");
const fs = require("fs");

// إعداد التخزين لـ Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "../uploads");
    // التأكد من وجود مجلد uploads، وإنشائه إذا لم يكن موجودًا
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // إنشاء اسم فريد للملف
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

// فلترة أنواع الملفات المسموح بها (فقط الصور)
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("الرجاء رفع ملف صورة فقط."), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 1024 * 1024 * 5, // 5MB limit
  },
});

module.exports = upload;