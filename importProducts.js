const fs = require('fs');
const csv = require('csv-parser');
const mysql = require('mysql2/promise');

const PROGRESS_FILE = 'import_progress.json';

// حفظ مؤشر التقدم
function saveProgress(index) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ index }));
}

// تحميل مؤشر التقدم
function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE)).index;
  }
  return 0;
}

// إنشاء اتصال جديد
async function createConnection() {
  return mysql.createConnection({
    host: "yamabiko.proxy.rlwy.net",
    user: "root",
    password: "MGSllhdRVcNjOjXeDCUqbRyplNJPiTGT",
    database: "railway",
    port: 31468
  });
}

async function runImport() {
  let connection = await createConnection();

  console.log("📌 Connected to Railway!");

  const results = [];
  let inserted = 0;
  let duplicateFixed = 0;

  const startAt = loadProgress();
  console.log(`⏳ Resuming from row: ${startAt}`);

  fs.createReadStream('products_finall.csv')
    .pipe(csv())
    .on('data', (row) => results.push(row))
    .on('end', async () => {
      console.log(`📦 Total rows: ${results.length}`);

      for (let i = startAt; i < results.length; i++) {
        const item = results[i];

        try {
          let barcode = item.barcode || null;

          // تحقق من تكرار الباركود
          if (barcode) {
            const [rows] = await connection.execute(
              "SELECT id FROM products WHERE barcode = ? LIMIT 1",
              [barcode]
            );

            if (rows.length > 0) {
              console.log(`⚠️ Duplicate barcode ${barcode} → set to NULL`);
              barcode = null;
              duplicateFixed++;
            }
          }

          // الإدخال مع IGNORE لمنع التكرار إذا شغّلته مرة أخرى
          await connection.execute(
            `INSERT IGNORE INTO products
            (name, english_name, barcode, description, active, company, location_in_pharmacy, image_url,
              category_id, price, quantity, strips_per_box, available_in_pharmacy, available_online,
              last_sale_date, supplier_id, partial_strips)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              item.name || null,
              item.english_name || null,
              barcode,
              item.description || null,
              item.active || null,
              item.company || null,
              item.location_in_pharmacy || null,
              item.image_url || null,
              item.category_id || null,
              item.price || null,
              item.quantity || null,
              item.strips_per_box || null,
              item.available_in_pharmacy || null,
              item.available_online || null,
              item.last_sale_date || null,
              item.supplier_id || null,
              item.partial_strips || null
            ]
          );

          inserted++;

          // حفظ التقدم
          saveProgress(i);

        } catch (err) {
          console.log("❌ Error:", err.message);

          if (err.code === "ECONNRESET") {
            console.log("⚠️ Connection lost… reconnecting.");
            connection = await createConnection();
            i--; // ارجع خطوة للخلف لإعادة المحاولة
            continue;
          }
        }
      }

      console.log("🎉 Import Completed!");
      console.log(`✅ Inserted rows: ${inserted}`);
      console.log(`🟡 Duplicated barcodes set to NULL: ${duplicateFixed}`);

      connection.end();
    });
}

runImport();
