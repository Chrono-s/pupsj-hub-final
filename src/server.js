const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const hpp = require('hpp');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const { firewall, getFirewallStats } = require('./middleware/firewall');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// ─────────────────────────────────────────────────────────────
//  TRUST PROXY (needed behind Nginx / Cloudflare / Heroku)
// ─────────────────────────────────────────────────────────────
app.set('trust proxy', 1);

// ─────────────────────────────────────────────────────────────
//  APPLICATION FIREWALL (runs first — blocks bad actors early)
// ─────────────────────────────────────────────────────────────
app.use(firewall);

// ─────────────────────────────────────────────────────────────
//  SECURITY HEADERS (Helmet) — hardened
// ─────────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://cdnjs.cloudflare.com',
          'https://cdn.jsdelivr.net',
          'https://cdn.sheetjs.com',
        ],
        scriptSrcAttr: ["'unsafe-inline'"], // required: app.js uses onclick="..." handlers
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://fonts.googleapis.com',
          'https://cdnjs.cloudflare.com',
        ],
        fontSrc: [
          "'self'",
          'data:',
          'https://fonts.gstatic.com',
          'https://cdnjs.cloudflare.com',
        ],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        // Allow embedding schedule links from Google, Canva, and Microsoft only.
        frameSrc: [
          "'self'",
          'https://docs.google.com',
          'https://sheets.google.com',
          'https://calendar.google.com',
          'https://drive.google.com',
          'https://www.canva.com',
          'https://canva.com',
          'https://onedrive.live.com',
          'https://1drv.ms',
          'https://view.office.com',
          'https://embed.office.com',
          'https://sway.office.com',
          'https://www.office.com',
          'https://office.com',
          'https://sway.cloud.microsoft',
          'https://www.sway.cloud.microsoft',
        ],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: IS_PROD ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: IS_PROD
      ? { maxAge: 31536000, includeSubDomains: true, preload: true }
      : false,
  })
);

// ─────────────────────────────────────────────────────────────
//  CORS — whitelist in production, warn if not configured
// ─────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      // Same-origin / curl / server-to-server
      if (!origin) return cb(null, true);
      if (!IS_PROD) return cb(null, true);
      // In production: REQUIRE configured origins
      if (ALLOWED_ORIGINS.length === 0) {
        console.error('[SECURITY] ALLOWED_ORIGINS not configured — blocking cross-origin request from:', origin);
        return cb(new Error('Not allowed by CORS'));
      }
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);

// ─────────────────────────────────────────────────────────────
//  BODY PARSERS (tight limits)
// ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// ─────────────────────────────────────────────────────────────
//  HTTP PARAMETER POLLUTION GUARD
// ─────────────────────────────────────────────────────────────
app.use(hpp());

// ─────────────────────────────────────────────────────────────
//  REQUEST LOGGING (Morgan)
// ─────────────────────────────────────────────────────────────
// In production: log concise request info. In dev: colored output.
app.use(morgan(IS_PROD ? 'combined' : 'dev', {
  skip: (req) => {
    // Skip logging for static assets in production to reduce noise
    return IS_PROD && !req.path.startsWith('/api');
  }
}));

// ─────────────────────────────────────────────────────────────
//  CSRF PROTECTION (Origin / Referer check — no extra package)
//  Blocks cross-site POST/PATCH/DELETE from foreign origins
// ─────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  // Only check state-changing API requests
  if (!req.path.startsWith('/api')) return next();
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();

  const origin = req.headers['origin'];
  const referer = req.headers['referer'];
  const host = req.headers['host'];

  // If no origin AND no referer, allow (same-origin requests in some browsers omit both)
  if (!origin && !referer) return next();

  // Build the expected origin from the host header
  const proto = req.protocol || 'http';
  const expectedOrigin = `${proto}://${host}`;

  // Check origin header first (most reliable)
  if (origin) {
    if (origin === expectedOrigin || origin === `http://${host}` || origin === `https://${host}`) {
      return next();
    }
    // In dev, also allow localhost variants
    if (!IS_PROD && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
      return next();
    }
    return res.status(403).json({ error: 'Request blocked: origin mismatch (CSRF protection)' });
  }

  // Fallback: check referer
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      const refererOrigin = refererUrl.origin;
      if (refererOrigin === expectedOrigin || refererOrigin === `http://${host}` || refererOrigin === `https://${host}`) {
        return next();
      }
      if (!IS_PROD && (refererOrigin.includes('localhost') || refererOrigin.includes('127.0.0.1'))) {
        return next();
      }
    } catch (e) {
      // Malformed referer — block it
    }
    return res.status(403).json({ error: 'Request blocked: referer mismatch (CSRF protection)' });
  }

  next();
});

// ─────────────────────────────────────────────────────────────
//  BASIC WAF — block suspicious payloads
// ─────────────────────────────────────────────────────────────
const WAF_PATTERNS = [
  /<script\b/i,
  /javascript:\s*[^\s]/i,
  /on\w+\s*=\s*["'][^"']*["']/i, // inline event handlers in body
  /\bunion\s+select\b/i,
  /\bselect\s+.*\s+from\s+information_schema\b/i,
  /\bor\s+1\s*=\s*1\b/i,
  /\.\.(?:\/|\\)/,              // path traversal
];
function wafScan(value) {
  if (typeof value !== 'string') return false;
  return WAF_PATTERNS.some((re) => re.test(value));
}
function wafWalk(obj, depth = 0) {
  if (depth > 6 || obj == null) return false;
  if (typeof obj === 'string') return wafScan(obj);
  if (typeof obj !== 'object') return false;
  for (const k of Object.keys(obj)) {
    if (wafWalk(obj[k], depth + 1)) return true;
  }
  return false;
}
app.use((req, res, next) => {
  // Only scan API write requests — skip static / GETs for perf
  if (!req.path.startsWith('/api')) return next();
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  // Skip multipart uploads (binary) — multer handles validation separately
  const ct = req.headers['content-type'] || '';
  if (ct.startsWith('multipart/')) return next();
  if (wafWalk(req.body) || wafWalk(req.query)) {
    return res.status(400).json({ error: 'Request blocked by security filter' });
  }
  next();
});

// ─────────────────────────────────────────────────────────────
//  RATE LIMITING
// ─────────────────────────────────────────────────────────────
// Skip rate limiting for localhost and whitelisted QA tester IPs so testing is never throttled
const skipLocalhost = (req) => {
  const ip = req.ip || req.connection?.remoteAddress || '';
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip.startsWith('127.') ||
    ip.startsWith('::ffff:127.') ||
    (process.env.ALLOWED_IPS && process.env.ALLOWED_IPS.split(',').map(s => s.trim()).includes(ip))
  );
};

// Global API limiter — applies to every /api/* route
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 300,                  // 300 requests / IP / 15 min
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipLocalhost,
  message: { error: 'Too many requests — please slow down.' },
});
app.use('/api/', apiLimiter);

// Tight limiter for auth endpoints — stops brute force
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: skipLocalhost,
  message: { error: 'Too many login attempts — try again in 15 minutes.' },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// Strict limiter for DB-writing upload endpoints (CSV + images)
const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 min
  max: 15,                   // 15 uploads / IP / 10 min
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipLocalhost,
  message: { error: 'Upload limit reached. Please wait a few minutes before uploading again.' },
});
// Attach upload limiter only to known upload paths
app.use((req, res, next) => {
  if (req.method !== 'POST' && req.method !== 'PATCH') return next();
  const p = req.path;
  const isUpload =
    p.endsWith('/upload') ||
    p === '/api/auth/me/avatar' ||
    p === '/api/lost-found' ||
    p === '/api/announcements' ||
    p === '/api/events' ||
    p === '/api/documents';
  if (isUpload) return uploadLimiter(req, res, next);
  next();
});

// ─────────────────────────────────────────────────────────────
//  STATIC FILES (directory listing disabled)
// ─────────────────────────────────────────────────────────────
app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    maxAge: IS_PROD ? '7d' : 0,
    dotfiles: 'deny',           // block .env, .git, etc.
    index: false,               // disable directory index/listing
    setHeaders: (res, filePath) => {
      if (
        filePath.endsWith('sw.js') ||
        filePath.endsWith('index.html') ||
        filePath.endsWith(path.join('js', 'app.js')) ||
        filePath.endsWith(path.join('css', 'app.css')) ||
        filePath.endsWith('manifest.json')
      ) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
      // Prevent MIME-type sniffing on uploads
      if (filePath.includes('uploads')) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Disposition', 'inline');
      }
    },
  })
);

// ─────────────────────────────────────────────────────────────
//  API ROUTES
// ─────────────────────────────────────────────────────────────
app.get('/api/system-settings', async (req, res) => {
  const pool = require('./config/database');
  try {
    const [rows] = await pool.query('SELECT `key`, `value` FROM system_settings');
    const settings = {};
    rows.forEach(row => {
      settings[row.key] = row.value;
    });
    res.json(settings);
  } catch (err) {
    console.error('Fetch system settings error:', err);
    res.status(500).json({ error: 'Failed to fetch system settings' });
  }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/notifications', require('./routes/notifications'));

// ── TEST EMAIL ENDPOINT (Remove after debugging) ─────────────────────────────
app.get('/api/test-email', async (req, res) => {
  const { sendVerificationEmail } = require('./services/email');
  const testEmail = req.query.email || 'test@example.com';
  try {
    console.log(`[Test] Attempting to send test email to ${testEmail}...`);
    await sendVerificationEmail(testEmail, 'Test User', 'test-token-123');
    res.json({ 
      success: true, 
      message: `Test email sent to ${testEmail}. Check server logs for confirmation.`,
      config: {
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT,
        user: process.env.EMAIL_USER,
        from: process.env.EMAIL_FROM,
        passSet: !!process.env.EMAIL_PASS
      }
    });
  } catch (err) {
    console.error('[Test] Email test failed:', err.message);
    res.status(500).json({ 
      error: 'Email test failed', 
      details: err.message,
      config: {
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT,
        user: process.env.EMAIL_USER,
        from: process.env.EMAIL_FROM,
        passSet: !!process.env.EMAIL_PASS
      }
    });
  }
});
app.use('/api/announcements', require('./routes/announcements'));
app.use('/api/events', require('./routes/events'));
app.use('/api/lost-found', require('./routes/lostfound'));
app.use('/api/feedback', require('./routes/feedback'));
app.use('/api/schedules', require('./routes/schedules'));
app.use('/api/loading', require('./routes/loading'));
app.use('/api/chatbot', require('./routes/chatbot'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/faculty-schedules', require('./routes/facultySchedules'));
app.use('/api/faculty', require('./routes/faculty'));
app.use('/api/section-schedules', require('./routes/sectionSchedules'));
app.use('/api/pages', require('./routes/pages'));
app.use('/api/queueing', require('./routes/queueing'));

app.get('/queue-display/:officeCode', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'queue-display.html'));
});
app.get('/queue-monitor/:officeCode', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'queue-monitor.html'));
});
app.get('/queue-walk-in', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'queue-walk-in.html'));
});

// API 404 — any /api/* route that wasn't matched returns JSON (never HTML)
app.use('/api', (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
});

// SPA fallback — serve index.html for all non-API routes
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ─────────────────────────────────────────────────────────────
//  ERROR HANDLER (production-safe logging)
// ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File too large. Maximum size is 5MB.' });
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: 'Too many files. Maximum is 5.' });
  }
  if (
    err.message &&
    (err.message.includes('Only image files') ||
      err.message.includes('File type not allowed') ||
      err.message.includes('Only CSV files') ||
      err.message.includes('Unrecognized file type'))
  ) {
    return res.status(400).json({ error: err.message });
  }
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'CORS policy blocked this request.' });
  }
  // In production: log minimal info. In dev: log full stack.
  if (IS_PROD) {
    console.error(`[ERROR] ${req.method} ${req.path} — ${err.message}`);
  } else {
    console.error(err.stack);
  }
  res.status(500).json({ error: 'Something went wrong!' });
});

// ─────────────────────────────────────────────────────────────
//  DATABASE CONNECTION CHECK
// ─────────────────────────────────────────────────────────────
const pool = require('./config/database');
pool.query('SELECT 1')
  .then(() => {
    console.log('Database connected successfully.');
  })
  .catch((err) => {
    console.error('Database connection warning:', err.message);
  });

app.listen(PORT, () => {
  console.log(`PUPSJ HUB Server running on http://localhost:${PORT}`);
  console.log(`   Mode: ${IS_PROD ? 'PRODUCTION' : 'development'}`);
  if (IS_PROD && ALLOWED_ORIGINS.length === 0) {
    console.warn('⚠️  WARNING: ALLOWED_ORIGINS is not set. Configure it in .env for CORS security.');
  }
});

module.exports = app;
