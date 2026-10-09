const { v4: uuidv4 } = require('uuid');

const GLOBAL_SCOPES = new Set(['GENERAL', 'CAMPUS']);

function uniqueIds(userIds) {
  return [...new Set((userIds || []).filter(Boolean))];
}

function normalizeDepartment(department) {
  const value = String(department || 'General').trim();
  return value || 'General';
}

function excludeIds(userIds, excludedUserIds = []) {
  const excluded = new Set(uniqueIds(excludedUserIds));
  return uniqueIds(userIds).filter((id) => !excluded.has(id));
}

async function createNotifications(db, userIds, payload) {
  const ids = uniqueIds(userIds);
  if (!ids.length || !payload?.title) return 0;

  const values = ids.map((id) => [
    uuidv4(),
    id,
    payload.title,
    payload.message || null,
    payload.type || 'general',
    payload.link || null,
  ]);

  const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
  const flatParams = values.flat();

  await db.query(
    `INSERT INTO notifications (id, user_id, title, message, type, link) VALUES ${placeholders}`,
    flatParams
  );

  return ids.length;
}

async function getAdminUserIds(db) {
  const [rows] = await db.query(
    `SELECT id
     FROM users
     WHERE role IN ('admin', 'superadmin')
       AND is_active = TRUE`
  );
  return (rows || []).map((row) => row.id);
}

async function getAudienceUserIds(db, department) {
  const scope = normalizeDepartment(department);

  if (GLOBAL_SCOPES.has(scope.toUpperCase())) {
    const [rows] = await db.query(
      `SELECT id
       FROM users
       WHERE is_active = TRUE`
    );
    return (rows || []).map((row) => row.id);
  }

  const [rows] = await db.query(
    `SELECT id
     FROM users
     WHERE is_active = TRUE
       AND (
         role IN ('admin', 'faculty')
         OR department = ?
       )`,
    [scope]
  );
  return (rows || []).map((row) => row.id);
}

async function notifyUser(db, userId, payload) {
  return createNotifications(db, [userId], payload);
}

async function notifyUsers(db, userIds, payload, excludedUserIds = []) {
  return createNotifications(db, excludeIds(userIds, excludedUserIds), payload);
}

async function notifyAdmins(db, payload, excludedUserIds = []) {
  const adminIds = await getAdminUserIds(db);
  return createNotifications(db, excludeIds(adminIds, excludedUserIds), payload);
}

async function notifyAudience(db, { department, excludeUserIds = [] }, payload) {
  const audienceIds = await getAudienceUserIds(db, department);
  return createNotifications(db, excludeIds(audienceIds, excludeUserIds), payload);
}

async function safeNotify(label, work) {
  try {
    return await work();
  } catch (err) {
    console.error(`[notifications] ${label}:`, err);
    return 0;
  }
}

module.exports = {
  createNotifications,
  notifyUser,
  notifyUsers,
  notifyAdmins,
  notifyAudience,
  safeNotify,
};
