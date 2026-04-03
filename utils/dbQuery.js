const pool = require('../config/db');

async function dbQuery(sql, params = []) {

  try {
    const [rows] = await pool.query(sql, params);
    return rows;

  } catch (err) {

    if (
      err.code === "PROTOCOL_CONNECTION_LOST" ||
      err.code === "ECONNRESET"
    ) {

      console.log("Reconnecting to Railway MySQL...");

      const [rows] = await pool.query(sql, params);
      return rows;
    }

    throw err;
  }
}

module.exports = dbQuery;