/**
 * PUPSJ HUB — Application Firewall (no external dependencies)
 *
 * Features:
 *  1. Auto-blocks IPs that trigger too many 4xx/5xx errors (attack detection)
 *  2. Blocks known malicious request patterns (path traversal, scanners, etc.)
 *  3. Blocks suspicious user-agents (bots, scanners, exploit tools)
 *  4. Manual IP blacklist via environment variable
 *  5. Logs blocked requests for monitoring
 */

// ─── Configuration ──────────────────────────────────────────
const BAN_THRESHOLD = 20;          // errors before auto-ban
const BAN_WINDOW_MS = 10 * 60 * 1000;  // 10-minute sliding window
const BAN_DURATION_MS = 30 * 60 * 1000; // 30-minute ban

// ─── In-memory stores (reset on restart) ────────────────────
const errorCounts = new Map();   // ip → { count, firstSeen }
const bannedIPs = new Map();     // ip → unbanTime

// ─── Manual blacklist from env ──────────────────────────────
const BLACKLISTED_IPS = new Set(
  (process.env.BLOCKED_IPS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
);

// ─── Suspicious paths that scanners/bots probe ─────────────
const BLOCKED_PATHS = [
  /\/\.env/i,
  /\/\.git/i,
  /\/\.aws/i,
  /\/wp-admin/i,
  /\/wp-login/i,
  /\/wp-content/i,
  /\/wordpress/i,
  /\/phpmyadmin/i,
  /\/admin\.php/i,
  /\/shell/i,
  /\/cgi-bin/i,
  /\/etc\/passwd/i,
  /\/proc\/self/i,
  /\.sql$/i,
  /\.bak$/i,
  /\.old$/i,
  /\.orig$/i,
  /\.swp$/i,
  /\/config\.json$/i,
  /\/debug/i,
  /\/actuator/i,
  /\/telescope/i,
];

// ─── Suspicious user-agents (known exploit tools) ───────────
const BLOCKED_AGENTS = [
  /sqlmap/i,
  /nikto/i,
  /nmap/i,
  /masscan/i,
  /zgrab/i,
  /gobuster/i,
  /dirbuster/i,
  /wpscan/i,
  /hydra/i,
  /metasploit/i,
  /burpsuite/i,
  /nessus/i,
  /openvas/i,
  /python-requests\/2/i,  // Often used in automated attacks (not always malicious)
];

// ─── Cleanup stale entries every 5 minutes ──────────────────
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of errorCounts) {
    if (now - data.firstSeen > BAN_WINDOW_MS) errorCounts.delete(ip);
  }
  for (const [ip, unbanTime] of bannedIPs) {
    if (now > unbanTime) bannedIPs.delete(ip);
  }
}, 5 * 60 * 1000);

// ─── Track errors for auto-ban ──────────────────────────────
function trackError(ip) {
  const now = Date.now();
  const entry = errorCounts.get(ip);

  if (!entry || (now - entry.firstSeen > BAN_WINDOW_MS)) {
    errorCounts.set(ip, { count: 1, firstSeen: now });
    return;
  }

  entry.count++;
  if (entry.count >= BAN_THRESHOLD) {
    bannedIPs.set(ip, now + BAN_DURATION_MS);
    errorCounts.delete(ip);
    console.warn(`[FIREWALL] Auto-banned IP: ${ip} (${entry.count} errors in ${BAN_WINDOW_MS / 1000}s)`);
  }
}

// ─── Main firewall middleware ───────────────────────────────
function firewall(req, res, next) {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';

  // 1. Check manual blacklist
  if (BLACKLISTED_IPS.has(ip)) {
    console.warn(`[FIREWALL] Blocked blacklisted IP: ${ip} → ${req.method} ${req.path}`);
    return res.status(403).json({ error: 'Access denied' });
  }

  // 2. Check auto-ban list
  const unbanTime = bannedIPs.get(ip);
  if (unbanTime) {
    if (Date.now() < unbanTime) {
      return res.status(403).json({ error: 'Access temporarily blocked. Try again later.' });
    }
    bannedIPs.delete(ip); // Ban expired
  }

  // 3. Block suspicious paths
  for (const pattern of BLOCKED_PATHS) {
    if (pattern.test(req.path)) {
      console.warn(`[FIREWALL] Blocked suspicious path: ${ip} → ${req.method} ${req.path}`);
      trackError(ip);
      return res.status(403).json({ error: 'Access denied' });
    }
  }

  // 4. Block suspicious user-agents
  const ua = req.headers['user-agent'] || '';
  for (const pattern of BLOCKED_AGENTS) {
    if (pattern.test(ua)) {
      console.warn(`[FIREWALL] Blocked suspicious agent: ${ip} → "${ua.substring(0, 80)}"`);
      trackError(ip);
      return res.status(403).json({ error: 'Access denied' });
    }
  }

  // 5. Track 4xx/5xx responses for auto-ban
  const originalEnd = res.end;
  res.end = function (...args) {
    if (res.statusCode >= 400) {
      trackError(ip);
    }
    originalEnd.apply(res, args);
  };

  next();
}

// ─── Stats endpoint for admin monitoring ────────────────────
function getFirewallStats() {
  return {
    bannedIPs: bannedIPs.size,
    trackedIPs: errorCounts.size,
    blacklistedIPs: BLACKLISTED_IPS.size,
    bans: Array.from(bannedIPs.entries()).map(([ip, until]) => ({
      ip,
      remainingSeconds: Math.max(0, Math.round((until - Date.now()) / 1000))
    }))
  };
}

module.exports = { firewall, getFirewallStats };
