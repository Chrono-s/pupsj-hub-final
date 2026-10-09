const mysql = require('mysql2/promise');
require('dotenv').config();

// Normalize DB host: prefer IPv4 loopback '127.0.0.1' over 'localhost'
// to eliminate dual-stack (IPv6/IPv4) resolution latency and AggregateErrors in Node 18+
const rawHost = process.env.DB_HOST || '127.0.0.1';
const DB_HOST = (rawHost === 'localhost') ? '127.0.0.1' : rawHost;
const DB_PORT = parseInt(process.env.DB_PORT, 10) || 3306;
const DB_NAME = process.env.DB_NAME || 'pupsj_hub';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';

const DB_CONFIG = {
  host: DB_HOST,
  port: DB_PORT,
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 15,
  queueLimit: 0,
  connectTimeout: 10000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  timezone: '+00:00',
  dateStrings: false,
  multipleStatements: true,
};

const pool = mysql.createPool(DB_CONFIG);

// Bind event listener to underlying pool to prevent unhandled error crashes
if (pool.pool && typeof pool.pool.on === 'function') {
  pool.pool.on('error', (err) => {
    console.error('[DATABASE POOL ERROR]', err.message || err);
  });
}
pool.on = pool.pool?.on?.bind(pool.pool) || (() => {});

// Transient/connectivity error codes
const DB_CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'PROTOCOL_CONNECTION_LOST',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'ER_CON_COUNT_ERROR',
  'ER_ACCESS_DENIED_ERROR',
  'ER_BAD_DB_ERROR',
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
]);

/**
 * Checks whether an error represents a database connection or network failure
 * @param {Error|any} err
 * @returns {boolean}
 */
function isDbConnectionError(err) {
  if (!err) return false;
  if (err.code && DB_CONNECTION_ERROR_CODES.has(err.code)) return true;
  if (err.fatal === true) return true;
  if (err.name === 'AggregateError' && Array.isArray(err.errors)) {
    return err.errors.some((e) => isDbConnectionError(e));
  }
  const msg = err.message || '';
  return (
    msg.includes('ECONNREFUSED') ||
    msg.includes('Connection lost') ||
    msg.includes('connect ETIMEDOUT') ||
    msg.includes('Handshake inactivity timeout')
  );
}

// Health status tracking
let isHealthy = false;
let lastError = null;
let lastCheckedAt = null;
let retryTimer = null;

/**
 * Tests database connectivity and measures query round-trip latency
 * @returns {Promise<{ healthy: boolean, latencyMs?: number, error?: string, code?: string, host: string, port: number, database: string, lastCheckedAt: string }>}
 */
async function checkDbHealth() {
  const start = Date.now();
  try {
    await pool.query('SELECT 1');
    const latencyMs = Date.now() - start;
    isHealthy = true;
    lastError = null;
    lastCheckedAt = new Date().toISOString();
    return {
      healthy: true,
      latencyMs,
      host: DB_CONFIG.host,
      port: DB_CONFIG.port,
      database: DB_CONFIG.database,
      lastCheckedAt,
    };
  } catch (err) {
    isHealthy = false;
    lastError = err.message || 'Connection failed';
    lastCheckedAt = new Date().toISOString();
    return {
      healthy: false,
      error: lastError,
      code: err.code || 'DB_ERROR',
      host: DB_CONFIG.host,
      port: DB_CONFIG.port,
      database: DB_CONFIG.database,
      lastCheckedAt,
    };
  }
}

/**
 * Prints formatted diagnostic banner for database connection failure
 */
function printConnectionFailureBanner(err) {
  const isRefused = err?.code === 'ECONNREFUSED' || isDbConnectionError(err);
  console.error('\n' + '='.repeat(70));
  console.error('❌  DATABASE CONNECTION FAILED');
  console.error('─'.repeat(70));
  console.error(`  Target:    ${DB_CONFIG.host}:${DB_CONFIG.port}`);
  console.error(`  Database:  ${DB_CONFIG.database}`);
  console.error(`  User:      ${DB_CONFIG.user}`);
  console.error(`  Error:     ${err?.message || err?.code || 'Connection refused'}`);
  console.error('─'.repeat(70));
  console.error('  TROUBLESHOOTING:');
  if (isRefused) {
    console.error('  1. If using XAMPP: Open XAMPP Control Panel and click "Start" on MySQL.');
    console.error('  2. Verify MySQL is listening on port ' + DB_CONFIG.port + '.');
    console.error('  3. Verify your .env settings: DB_HOST=' + DB_CONFIG.host + ', DB_PORT=' + DB_CONFIG.port);
  } else {
    console.error('  1. Check your database credentials in the .env file.');
    console.error('  2. Verify that database "' + DB_CONFIG.database + '" exists.');
  }
  console.error('  Auto-reconnection is active. The server will resume once MySQL is running.');
  console.error('='.repeat(70) + '\n');
}

function scheduleReconnectRetry() {
  if (retryTimer) return;
  retryTimer = setInterval(async () => {
    const status = await checkDbHealth();
    if (status.healthy) {
      console.log(`\n✅ [DATABASE] MySQL connection re-established (${DB_CONFIG.host}:${DB_CONFIG.port} / ${DB_CONFIG.database})\n`);
      clearInterval(retryTimer);
      retryTimer = null;
    }
  }, 5000);
  if (retryTimer && typeof retryTimer.unref === 'function') {
    retryTimer.unref(); // Allow Node process to exit gracefully if shutting down
  }
}

/**
 * Initiates startup connection check with background auto-reconnect
 */
function initializeDatabase() {
  checkDbHealth()
    .then((status) => {
      if (status.healthy) {
        console.log(`[DATABASE] Connected to MySQL (${DB_CONFIG.host}:${DB_CONFIG.port} / ${DB_CONFIG.database}) [${status.latencyMs}ms]`);
      } else {
        printConnectionFailureBanner({ message: status.error, code: status.code });
        scheduleReconnectRetry();
      }
    })
    .catch((err) => {
      printConnectionFailureBanner(err);
      scheduleReconnectRetry();
    });
}

// Start initial check
initializeDatabase();

// Attach helper utilities to the exported pool object
pool.checkDbHealth = checkDbHealth;
pool.isDbConnectionError = isDbConnectionError;
pool.getDbStatus = () => ({
  healthy: isHealthy,
  lastError,
  lastCheckedAt,
  host: DB_CONFIG.host,
  port: DB_CONFIG.port,
  database: DB_CONFIG.database,
});
pool.dbConfig = {
  host: DB_CONFIG.host,
  port: DB_CONFIG.port,
  database: DB_CONFIG.database,
  user: DB_CONFIG.user,
};

module.exports = pool;
