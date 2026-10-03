const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3306,
  database: process.env.DB_NAME || 'pupsj_hub',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,
  timezone: '+00:00',
  // Return dates as strings to avoid timezone shift issues
  dateStrings: false,
  multipleStatements: true,
});

pool.on = pool.pool?.on?.bind(pool.pool) || (() => {});

pool.getConnection()
  .then(conn => { conn.release(); })
  .catch(err => {
    console.error('MySQL connection error:', err.message);
  });

module.exports = pool;
