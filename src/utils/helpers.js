/**
 * PUPSJ HUB - Common Utilities & Helpers
 */

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Validate UUID format
 */
function isValidUuid(id) {
  return typeof id === 'string' && UUID_REGEX.test(id.trim());
}

/**
 * Safely parse JSON strings (e.g. from MySQL JSON / text columns)
 */
function safeJsonParse(val, fallback = []) {
  if (val === null || val === undefined) return fallback;
  if (typeof val !== 'string') return val;
  try {
    const parsed = JSON.parse(val);
    return parsed !== null ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

/**
 * Format user full name
 */
function getActorName(user, fallback = 'A user') {
  if (!user) return fallback;
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return name || fallback;
}

/**
 * Normalize pagination parameters
 */
function getPagination(query = {}, defaultLimit = 20, maxLimit = 100) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const rawLimit = parseInt(query.limit, 10) || defaultLimit;
  const limit = Math.max(1, Math.min(maxLimit, rawLimit));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

/**
 * Normalizes email address
 */
function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

/**
 * Formats time string (HH:MM:SS -> HH:MM)
 */
function formatTime(t) {
  if (!t) return '';
  const [h, m] = String(t).split(':');
  return `${String(parseInt(h, 10) || 0).padStart(2, '0')}:${m || '00'}`;
}

/**
 * Formats file size in bytes to human-readable string
 */
function formatFileSize(bytes) {
  const b = parseInt(bytes, 10);
  if (isNaN(b) || b < 0) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

module.exports = {
  isValidUuid,
  safeJsonParse,
  getActorName,
  getPagination,
  normalizeEmail,
  formatTime,
  formatFileSize,
};
