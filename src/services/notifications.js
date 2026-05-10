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

  await db.query(
    `INSERT INTO notifications (user_id, title, message, type, link)
     SELECT user_id, $2, $3, $4, $5
     FROM unnest($1::uuid[]) AS user_id`,
    [
      ids,
      payload.title,
      payload.message || null,
      payload.type || 'general',
      payload.link || null,
    ]
  );

  return ids.length;
}

async function getAdminUserIds(db) {
  const result = await db.query(
    `SELECT id
     FROM users
     WHERE role = 'admin'
       AND is_active = TRUE`
  );
  return result.rows.map((row) => row.id);
}

async function getAudienceUserIds(db, department) {
  const scope = normalizeDepartment(department);

  if (GLOBAL_SCOPES.has(scope.toUpperCase())) {
    const result = await db.query(
      `SELECT id
       FROM users
       WHERE is_active = TRUE`
    );
    return result.rows.map((row) => row.id);
  }

  const result = await db.query(
    `SELECT id
     FROM users
     WHERE is_active = TRUE
       AND (
         role IN ('admin', 'faculty')
         OR department = $1
       )`,
    [scope]
  );
  return result.rows.map((row) => row.id);
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
