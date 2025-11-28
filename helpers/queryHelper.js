

const isPostgres = process.env.DB_CLIENT === "pg";

function formatQuery(sql) {
  if (isPostgres) return sql;
  // تحويل $1 → ? , $2 → ? , ...
  return sql.replace(/\$\d+/g, '?');
}

function getResultRows(result) {
  if (isPostgres) return result.rows;
  return result[0]; // mysql2 ترجع [rows, fields]
}

function getRowCount(result) {
  if (isPostgres) return result.rowCount;
  return result[0]?.affectedRows || 0;
}

module.exports = {
  formatQuery,
  getResultRows,
  getRowCount,
  isPostgres,
};
