const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { authenticateToken, requireRole, ALL_MODULES } = require('../middleware/auth');
const { uploadCsv, uploadSystem } = require('../middleware/upload');
const { getFirewallStats } = require('../middleware/firewall');
const { sendPasswordResetEmail, sendWelcomeAdminEmail } = require('../services/email');

const VALID_DEPARTMENTS = ['BSIT', 'DIT', 'BSENTREP', 'BSPSYCH', 'BSEDUC', 'BSHM', 'BSFM'];
const STUDENT_ID_REGEX = /^\d{4}-\d{5}-SJ-\d$/;
const FACULTY_ID_REGEX = /^F-\d{4}$/;
const VALID_ALLOWED_ROLES = ['student', 'faculty'];

function getExpectedIdRegex(role) {
  return role === 'faculty' ? FACULTY_ID_REGEX : STUDENT_ID_REGEX;
}

function getRoleFormatHint(role) {
  return role === 'faculty' ? 'F-0001' : '2023-00191-SJ-0';
}

async function releaseStaleAllowedRegistrations(db) {
  await db.query(`
    UPDATE allowed_registrations ar
    SET is_used = false
    WHERE ar.is_used = true
      AND NOT EXISTS (
        SELECT 1
        FROM users u
        WHERE UPPER(TRIM(u.student_number)) = UPPER(TRIM(ar.id_number))
      )
  `);
}

async function purgeUserOwnedContent(db, userId) {
  await db.query(
    `UPDATE lost_found
     SET matched_with = NULL, updated_at = NOW()
     WHERE matched_with IN (SELECT id FROM lost_found WHERE reporter_id = ?)`,
    [userId]
  );
  await db.query("UPDATE announcements SET status = 'deleted', updated_at = NOW() WHERE author_id = ?", [userId]);
  await db.query("UPDATE events SET status = 'deleted', updated_at = NOW() WHERE author_id = ?", [userId]);
  await db.query("UPDATE document_templates SET status = 'deleted', updated_at = NOW() WHERE uploaded_by = ?", [userId]);
  await db.query("UPDATE document_categories SET status = 'deleted', updated_at = NOW() WHERE created_by = ?", [userId]);
  await db.query(
    `UPDATE document_templates
     SET status = 'deleted', updated_at = NOW()
     WHERE category_id IN (SELECT id FROM document_categories WHERE created_by = ?)`,
    [userId]
  );
  await db.query('DELETE FROM feedback WHERE user_id = ?', [userId]);
  await db.query('DELETE FROM chatbot_logs WHERE user_id = ?', [userId]);
  await db.query('DELETE FROM lost_found WHERE reporter_id = ?', [userId]);
}

// ──────────────────────────────────────────────
//  USER MANAGEMENT (Superadmin)
// ──────────────────────────────────────────────

// Get all users
router.get('/users', authenticateToken, requireRole('superadmin'), async (req, res) => {
  try {
    const { status } = req.query;
    let query = `SELECT id, student_number, email, first_name, last_name, role, department,
                        year_level, section, is_verified, is_active, created_at
                 FROM users WHERE role != 'superadmin'`;
    const params = [];

    if (status === 'pending') {
      query += ' AND is_verified = false';
    } else if (status === 'verified') {
      query += ' AND is_verified = true';
    }

    query += ' ORDER BY created_at DESC';
    const [rows] = await pool.query(query, params);
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Verify user
router.patch('/users/:id/verify', authenticateToken, requireRole('superadmin'), async (req, res) => {
  try {
    await pool.query('UPDATE users SET is_verified = true, updated_at = NOW() WHERE id = ?', [req.params.id]);
    res.json({ message: 'User verified' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to verify user' });
  }
});

// Deactivate user
router.patch('/users/:id/deactivate', authenticateToken, requireRole('superadmin'), async (req, res) => {
  try {
    await pool.query('UPDATE users SET is_active = false, updated_at = NOW() WHERE id = ?', [req.params.id]);
    res.json({ message: 'User deactivated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to deactivate user' });
  }
});

// Activate user
router.patch('/users/:id/activate', authenticateToken, requireRole('superadmin'), async (req, res) => {
  try {
    await pool.query('UPDATE users SET is_active = true, updated_at = NOW() WHERE id = ?', [req.params.id]);
    res.json({ message: 'User activated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to activate user' });
  }
});

// Send password reset email
router.post('/users/:id/reset-password', authenticateToken, requireRole('superadmin'), async (req, res) => {
  try {
    const [userRows] = await pool.query('SELECT id, first_name, email, is_active FROM users WHERE id = ?', [req.params.id]);
    if (userRows.length === 0) return res.status(404).json({ error: 'User not found' });
    const user = userRows[0];

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000);
    await pool.query(
      `UPDATE users SET password_reset_token = ?, password_reset_expires = ?, updated_at = NOW() WHERE id = ?`,
      [resetToken, resetExpires, user.id]
    );

    await sendPasswordResetEmail(user.email, user.first_name, resetToken);
    res.json({ message: `Password reset link sent to ${user.email}` });
  } catch (err) {
    console.error('Admin reset password error:', err);
    res.status(500).json({ error: 'Failed to send password reset email: ' + err.message });
  }
});

// Delete user
router.delete('/users/:id', authenticateToken, requireRole('superadmin'), async (req, res) => {
  const client = await pool.getConnection();
  try {
    await client.beginTransaction();

    const [userRows] = await client.query(
      'SELECT student_number, role FROM users WHERE id = ?',
      [req.params.id]
    );
    if (userRows.length === 0) {
      await client.rollback();
      return res.status(404).json({ error: 'User not found' });
    }
    if (userRows[0].role === 'superadmin') {
      await client.rollback();
      return res.status(403).json({ error: 'Cannot delete superadmin account' });
    }

    const studentNumber = userRows[0].student_number;
    await purgeUserOwnedContent(client, req.params.id);
    await client.query('DELETE FROM users WHERE id = ?', [req.params.id]);
    if (studentNumber) {
      await client.query(
        'UPDATE allowed_registrations SET is_used = false WHERE UPPER(TRIM(id_number)) = UPPER(TRIM(?))',
        [studentNumber]
      );
    }
    await releaseStaleAllowedRegistrations(client);

    await client.commit();
    res.json({ message: 'User deleted' });
  } catch (err) {
    try { await client.rollback(); } catch (_) {}
    res.status(500).json({ error: 'Failed to delete user' });
  } finally {
    client.release();
  }
});

// ──────────────────────────────────────────────
//  DASHBOARD & MONITORING STATS (Admin)
// ──────────────────────────────────────────────

router.get('/stats', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const [[usersRows], [announcementsRows], [eventsRows], [lostFoundRows], [allowedRegsRows]] = await Promise.all([
      pool.query(`SELECT
        COUNT(*) as total,
        SUM(IF(is_verified = false, 1, 0)) as pending
        FROM users WHERE role != 'admin'`),
      pool.query(`SELECT
        SUM(IF(status = 'active', 1, 0)) as total,
        SUM(IF(status = 'pending', 1, 0)) as pending
        FROM announcements`),
      pool.query(`SELECT
        SUM(IF(status = 'active', 1, 0)) as total,
        SUM(IF(status = 'pending', 1, 0)) as pending
        FROM events`),
      pool.query(`SELECT
        COUNT(*) as total,
        SUM(IF(status = 'open', 1, 0)) as \`open\`
        FROM lost_found`),
      pool.query(`SELECT
        COUNT(*) as total,
        SUM(IF(is_used = false, 1, 0)) as unused
        FROM allowed_registrations`)
    ]);

    res.json({
      users: { total: parseInt(usersRows[0]?.total || 0, 10), pending: parseInt(usersRows[0]?.pending || 0, 10) },
      announcements: { total: parseInt(announcementsRows[0]?.total || 0, 10), pending: parseInt(announcementsRows[0]?.pending || 0, 10) },
      events: { total: parseInt(eventsRows[0]?.total || 0, 10), pending: parseInt(eventsRows[0]?.pending || 0, 10) },
      lostFound: { total: parseInt(lostFoundRows[0]?.total || 0, 10), open: parseInt(lostFoundRows[0]?.open || 0, 10) },
      allowedRegistrations: { total: parseInt(allowedRegsRows[0]?.total || 0, 10), unused: parseInt(allowedRegsRows[0]?.unused || 0, 10) }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

router.get('/firewall', authenticateToken, requireRole('admin'), (req, res) => {
  res.json(getFirewallStats());
});

// ──────────────────────────────────────────────
//  ALLOWED REGISTRATIONS (Superadmin)
// ──────────────────────────────────────────────

router.get('/allowed-registrations', authenticateToken, requireRole('superadmin'), async (req, res) => {
  try {
    await releaseStaleAllowedRegistrations(pool);
    const { department, status } = req.query;
    let query = 'SELECT * FROM allowed_registrations';
    const params = [];
    const conditions = [];

    if (department && VALID_DEPARTMENTS.includes(department)) {
      params.push(department);
      conditions.push(`department = ?`);
    }
    if (status === 'used') {
      conditions.push('is_used = true');
    } else if (status === 'unused') {
      conditions.push('is_used = false');
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY created_at DESC';

    const [rows] = await pool.query(query, params);
    res.json(rows || []);
  } catch (err) {
    console.error('List allowed registrations error:', err);
    res.status(500).json({ error: 'Failed to fetch allowed registrations' });
  }
});

router.post('/allowed-registrations', authenticateToken, requireRole('superadmin'), async (req, res) => {
  try {
    const { id_number } = req.body;
    const role = typeof req.body.role === 'string' ? req.body.role.trim().toLowerCase() : '';
    const department = req.body.department || null;

    if (!id_number || !role) {
      return res.status(400).json({ error: 'ID number and role are required' });
    }
    if (!VALID_ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be student or faculty' });
    }
    if (role === 'student' && !department) {
      return res.status(400).json({ error: 'Department is required for student IDs' });
    }
    if (department && !VALID_DEPARTMENTS.includes(department)) {
      return res.status(400).json({ error: `Invalid department. Must be one of: ${VALID_DEPARTMENTS.join(', ')}` });
    }

    const trimmed = id_number.trim().toUpperCase();
    const expectedRegex = getExpectedIdRegex(role);
    if (!expectedRegex.test(trimmed)) {
      return res.status(400).json({ error: `Invalid ID format for ${role}. Expected format: ${getRoleFormatHint(role)}` });
    }

    const [existingRows] = await pool.query('SELECT id FROM allowed_registrations WHERE id_number = ?', [trimmed]);
    if (existingRows.length > 0) {
      return res.status(400).json({ error: 'This ID number is already in the allowed list' });
    }

    const newId = uuidv4();
    await pool.query(
      'INSERT INTO allowed_registrations (id, id_number, department, role, added_by) VALUES (?, ?, ?, ?, ?)',
      [newId, trimmed, department, role, req.user.id]
    );
    const [fetchRows] = await pool.query('SELECT * FROM allowed_registrations WHERE id = ?', [newId]);
    res.status(201).json(fetchRows[0]);
  } catch (err) {
    console.error('Add allowed registration error:', err);
    res.status(500).json({ error: 'Failed to add allowed registration' });
  }
});

router.post('/allowed-registrations/upload', authenticateToken, requireRole('superadmin'), uploadCsv.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded' });

    const role = typeof req.body.role === 'string' ? req.body.role.trim().toLowerCase() : '';
    const department = req.body.department || null;

    if (!VALID_ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be student or faculty' });
    }
    if (role === 'student' && !department) {
      return res.status(400).json({ error: 'Department is required for student CSV uploads' });
    }
    if (department && !VALID_DEPARTMENTS.includes(department)) {
      return res.status(400).json({ error: `Invalid department. Must be one of: ${VALID_DEPARTMENTS.join(', ')}` });
    }

    const csvText = req.file.buffer.toString('utf-8');
    const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    let startIdx = 0;
    if (lines.length > 0 && /id.number|student.number|id_number/i.test(lines[0])) {
      startIdx = 1;
    }

    const added = [];
    const skipped = [];
    const errors = [];

    for (let i = startIdx; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
      const idNum = (cols[0] || '').toUpperCase();
      if (!idNum) continue;

      const expectedRegex = getExpectedIdRegex(role);
      if (!expectedRegex.test(idNum)) {
        errors.push({
          line: i + 1,
          id_number: idNum,
          reason: `Invalid format for ${role}. Expected ${getRoleFormatHint(role)}`
        });
        continue;
      }

      try {
        const [existingRows] = await pool.query('SELECT 1 FROM allowed_registrations WHERE id_number = ?', [idNum]);
        if (existingRows.length > 0) {
          skipped.push(idNum);
          continue;
        }

        const newId = uuidv4();
        await pool.query(
          'INSERT INTO allowed_registrations (id, id_number, department, role, added_by) VALUES (?, ?, ?, ?, ?)',
          [newId, idNum, department, role, req.user.id]
        );
        added.push(idNum);
      } catch (dbErr) {
        skipped.push(idNum);
      }
    }

    res.json({
      message: `Processed ${lines.length - startIdx} entries`,
      added: added.length,
      skipped: skipped.length,
      skippedIds: skipped,
      errors
    });
  } catch (err) {
    console.error('CSV upload error:', err);
    res.status(500).json({ error: 'Failed to process CSV file' });
  }
});

router.delete('/allowed-registrations', authenticateToken, requireRole('superadmin'), async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids must be a non-empty array' });
  }

  const client = await pool.getConnection();
  try {
    await client.beginTransaction();

    let removedCount = 0;
    let deletedUsersCount = 0;

    for (const id of ids) {
      const [regRows] = await client.query('SELECT id_number FROM allowed_registrations WHERE id = ?', [id]);
      if (regRows.length === 0) continue;

      const idNumber = regRows[0].id_number;
      const [linkedUsersRows] = await client.query(
        'SELECT id FROM users WHERE UPPER(TRIM(student_number)) = UPPER(TRIM(?))', [idNumber]
      );
      for (const user of linkedUsersRows) {
        await purgeUserOwnedContent(client, user.id);
      }
      const [deleteResult] = await client.query(
        'DELETE FROM users WHERE UPPER(TRIM(student_number)) = UPPER(TRIM(?))', [idNumber]
      );
      await client.query('DELETE FROM allowed_registrations WHERE id = ?', [id]);
      removedCount++;
      deletedUsersCount += deleteResult.affectedRows;
    }

    await client.commit();
    res.json({
      message: `${removedCount} ID${removedCount !== 1 ? 's' : ''} removed` +
               (deletedUsersCount > 0 ? `, ${deletedUsersCount} account${deletedUsersCount !== 1 ? 's' : ''} deleted` : '')
    });
  } catch (err) {
    try { await client.rollback(); } catch (_) {}
    console.error('Bulk delete allowed-registrations error:', err);
    res.status(500).json({ error: 'Failed to bulk-remove IDs' });
  } finally {
    client.release();
  }
});

router.delete('/allowed-registrations/:id', authenticateToken, requireRole('superadmin'), async (req, res) => {
  const client = await pool.getConnection();
  try {
    await client.beginTransaction();

    const [regRows] = await client.query('SELECT id_number FROM allowed_registrations WHERE id = ?', [req.params.id]);
    if (regRows.length === 0) {
      await client.rollback();
      return res.status(404).json({ error: 'Allowed ID not found' });
    }

    const idNumber = regRows[0].id_number;
    const [linkedUsersRows] = await client.query(
      'SELECT id FROM users WHERE UPPER(TRIM(student_number)) = UPPER(TRIM(?))', [idNumber]
    );
    for (const user of linkedUsersRows) {
      await purgeUserOwnedContent(client, user.id);
    }
    const [deleteUsersResult] = await client.query(
      'DELETE FROM users WHERE UPPER(TRIM(student_number)) = UPPER(TRIM(?))', [idNumber]
    );
    await client.query('DELETE FROM allowed_registrations WHERE id = ?', [req.params.id]);

    await client.commit();
    res.json({
      message: deleteUsersResult.affectedRows > 0
        ? 'Removed from allowed list and deleted matching registered account'
        : 'Removed from allowed list'
    });
  } catch (err) {
    try { await client.rollback(); } catch (_) {}
    res.status(500).json({ error: 'Failed to remove allowed registration' });
  } finally {
    client.release();
  }
});

router.get('/allowed-registrations/stats', authenticateToken, requireRole('superadmin'), async (req, res) => {
  try {
    await releaseStaleAllowedRegistrations(pool);
    const [rows] = await pool.query(`
      SELECT department,
             COUNT(*) as total,
             SUM(IF(is_used = true, 1, 0)) as used,
             SUM(IF(is_used = false, 1, 0)) as unused
      FROM allowed_registrations
      GROUP BY department
      ORDER BY department
    `);
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ──────────────────────────────────────────────
//  SCHEDULES OVERVIEW (Admin)
// ──────────────────────────────────────────────

router.get('/schedules-overview', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const query = `
       SELECT * FROM (
         SELECT 
           CAST(cs.id AS CHAR) AS id, 
           COALESCE(cs.subject_code, '') AS subject_code, 
           COALESCE(cs.subject_name, '') AS subject_name, 
           COALESCE(cs.day_of_week, '') AS day_of_week,
           CAST(cs.start_time AS CHAR) AS start_time, 
           CAST(cs.end_time AS CHAR) AS end_time, 
           COALESCE(cs.room, 'TBA') AS room,
           COALESCE(CONCAT(u.first_name, ' ', u.last_name), cs.instructor, 'N/A') AS instructor,
           COALESCE(cs.department, '') AS department, 
           COALESCE(cs.section, '') AS section, 
           COALESCE(cs.year_level, '') AS year_level, 
           cs.created_at,
           'OFFICIAL' AS source
         FROM class_schedules cs
         LEFT JOIN users u ON cs.faculty_user_id = u.id

         UNION ALL

         SELECT 
           CAST(fs.id AS CHAR) AS id, 
           COALESCE(fs.subject_code, '') AS subject_code, 
           COALESCE(fs.subject_name, '') AS subject_name, 
           COALESCE(fs.day_of_week, '') AS day_of_week,
           CAST(fs.start_time AS CHAR) AS start_time, 
           CAST(fs.end_time AS CHAR) AS end_time, 
           COALESCE(fs.room, 'TBA') AS room,
           CONCAT(COALESCE(f.first_name, ''), ' ', COALESCE(f.last_name, '')) AS instructor,
           COALESCE(fs.department, '') AS department, 
           COALESCE(fs.section, '') AS section, 
           COALESCE(fs.year_level, '') AS year_level, 
           fs.created_at,
           'FACULTY' AS source
         FROM faculty_schedules fs
         LEFT JOIN users f ON fs.faculty_id = f.id
       ) AS overview
       ORDER BY department ASC, year_level ASC, section ASC, day_of_week ASC, start_time ASC`;

    const [rows] = await pool.query(query);
    res.json(rows || []);
  } catch (err) {
    console.error('[Admin] Schedules overview error:', err.message);
    res.status(500).json({ error: 'Failed to fetch schedules overview detail: ' + err.message });
  }
});

// ──────────────────────────────────────────────
//  SYSTEM SETTINGS & ASSETS (Admin)
// ──────────────────────────────────────────────

router.get('/system-settings', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT `key`, `value` FROM system_settings');
    const settings = {};
    (rows || []).forEach(row => {
      settings[row.key] = row.value;
    });
    res.json(settings);
  } catch (err) {
    console.error('Fetch admin system settings error:', err);
    res.status(500).json({ error: 'Failed to fetch system settings' });
  }
});

router.post('/system-settings', authenticateToken, requireRole('admin'), async (req, res) => {
  const settings = req.body;
  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ error: 'Settings object is required' });
  }

  const client = await pool.getConnection();
  try {
    await client.beginTransaction();
    for (const [key, value] of Object.entries(settings)) {
      await client.query(`
        INSERT INTO system_settings (\`key\`, value, updated_at)
        VALUES (?, ?, NOW())
        ON DUPLICATE KEY UPDATE
        value = VALUES(value), updated_at = NOW()
      `, [key, String(value)]);
    }
    await client.commit();
    res.json({ message: 'System settings updated successfully' });
  } catch (err) {
    try { await client.rollback(); } catch (_) {}
    console.error('Update system settings error:', err);
    res.status(500).json({ error: 'Failed to update system settings' });
  } finally {
    client.release();
  }
});

router.post('/system-settings/upload', authenticateToken, requireRole('admin'), uploadSystem.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }
    const url = `/uploads/system/${req.file.filename}`;
    res.json({ url });
  } catch (err) {
    console.error('System image upload error:', err);
    res.status(500).json({ error: 'Failed to upload system image' });
  }
});

// ──────────────────────────────────────────────
//  ADMIN CREATION & PERMISSIONS (Superadmin)
// ──────────────────────────────────────────────

router.post('/create-admin', authenticateToken, requireRole('superadmin'), async (req, res) => {
  const client = await pool.getConnection();
  try {
    const { first_name, email, password, department, position } = req.body;
    const modules = Array.isArray(req.body.modules)
      ? req.body.modules.filter(m => ALL_MODULES.includes(m))
      : [];

    if (!first_name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const [existingRows] = await pool.query('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
    if (existingRows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const dummyId = `ADM-${Math.random().toString(36).substring(2, 11).toUpperCase()}`;
    const newAdminId = uuidv4();

    await client.beginTransaction();
    await client.query(`
      INSERT INTO users (id, student_number, email, password_hash, first_name, last_name, role, department, position, is_verified, is_active)
      VALUES (?, ?, ?, ?, ?, 'Admin', 'admin', ?, ?, true, true)
    `, [newAdminId, dummyId, normalizedEmail, passwordHash, first_name.trim(), department || null, position || null]);

    const [newAdminRows] = await client.query(
      'SELECT id, email, first_name, role, department, position, is_active, created_at FROM users WHERE id = ?',
      [newAdminId]
    );
    const newAdmin = newAdminRows[0];

    if (modules.length) {
      for (const m of modules) {
        await client.query(
          `INSERT IGNORE INTO admin_permissions (user_id, module, granted_by) VALUES (?, ?, ?)`,
          [newAdmin.id, m, req.user.id]
        );
      }
    }
    await client.commit();

    sendWelcomeAdminEmail(normalizedEmail, first_name.trim(), password).catch(err => {
      console.error('[Admin] Failed to send welcome email to new admin:', err.message);
    });

    res.status(201).json({ ...newAdmin, modules });
  } catch (err) {
    try { await client.rollback(); } catch (_) {}
    console.error('Create admin error:', err);
    res.status(500).json({ error: 'Failed to create admin account' });
  } finally {
    client.release();
  }
});

router.get('/admins/:id/modules', authenticateToken, requireRole('superadmin'), async (req, res) => {
  try {
    const [uRows] = await pool.query("SELECT role FROM users WHERE id = ?", [req.params.id]);
    if (uRows.length === 0) return res.status(404).json({ error: 'User not found' });
    const [grantedRows] = await pool.query('SELECT module FROM admin_permissions WHERE user_id = ?', [req.params.id]);
    res.json({
      all_modules: ALL_MODULES,
      modules: grantedRows.map(r => r.module),
      is_superadmin: uRows[0].role === 'superadmin',
    });
  } catch (err) {
    console.error('Get admin modules error:', err);
    res.status(500).json({ error: 'Failed to load modules' });
  }
});

router.put('/admins/:id/modules', authenticateToken, requireRole('superadmin'), async (req, res) => {
  const client = await pool.getConnection();
  try {
    const modules = Array.isArray(req.body.modules)
      ? [...new Set(req.body.modules.filter(m => ALL_MODULES.includes(m)))]
      : [];
    const [uRows] = await pool.query("SELECT role FROM users WHERE id = ?", [req.params.id]);
    if (uRows.length === 0) return res.status(404).json({ error: 'User not found' });
    if (uRows[0].role !== 'admin') {
      return res.status(400).json({ error: 'Only admin accounts have module permissions' });
    }

    await client.beginTransaction();
    await client.query('DELETE FROM admin_permissions WHERE user_id = ?', [req.params.id]);
    if (modules.length) {
      for (const m of modules) {
        const permId = uuidv4();
        await client.query(
          `INSERT INTO admin_permissions (id, user_id, module, granted_by) VALUES (?, ?, ?, ?)`,
          [permId, req.params.id, m, req.user.id]
        );
      }
    }
    await client.commit();
    res.json({ modules });
  } catch (err) {
    try { await client.rollback(); } catch (_) {}
    console.error('Update admin modules error:', err);
    res.status(500).json({ error: 'Failed to update modules' });
  } finally {
    client.release();
  }
});

router.patch('/users/:id/promote', authenticateToken, requireRole('superadmin'), async (req, res) => {
  try {
    const { id } = req.params;
    const [checkRows] = await pool.query('SELECT role FROM users WHERE id = ?', [id]);
    if (checkRows.length === 0) return res.status(404).json({ error: 'User not found' });
    if (checkRows[0].role !== 'admin') {
      return res.status(400).json({ error: 'Only admin accounts can be promoted to superadmin' });
    }

    await pool.query("UPDATE users SET role = 'superadmin', updated_at = NOW() WHERE id = ?", [id]);
    res.json({ message: 'Admin account promoted to superadmin successfully' });
  } catch (err) {
    console.error('Promote admin error:', err);
    res.status(500).json({ error: 'Failed to promote admin account' });
  }
});

// Update user ID number (superadmin only)
router.patch('/users/:id/id-number', authenticateToken, requireRole('superadmin'), async (req, res) => {
  try {
    const { id_number } = req.body;
    if (!id_number) return res.status(400).json({ error: 'ID number is required' });
    const trimmed = id_number.trim().toUpperCase();

    const [userRows] = await pool.query('SELECT role, student_number, department FROM users WHERE id = ?', [req.params.id]);
    if (userRows.length === 0) return res.status(404).json({ error: 'User not found' });
    const targetUser = userRows[0];
    if (targetUser.role === 'superadmin') {
      return res.status(403).json({ error: 'Cannot modify superadmin ID' });
    }

    if (targetUser.role !== 'admin') {
      const expectedRegex = getExpectedIdRegex(targetUser.role);
      if (!expectedRegex.test(trimmed)) {
        return res.status(400).json({ error: `Invalid ID format for ${targetUser.role}. Expected: ${getRoleFormatHint(targetUser.role)}` });
      }
    }

    const [dupRows] = await pool.query('SELECT id FROM users WHERE student_number = ? AND id != ?', [trimmed, req.params.id]);
    if (dupRows.length > 0) {
      return res.status(400).json({ error: 'This ID number is already registered to another user' });
    }

    const client = await pool.getConnection();
    try {
      await client.beginTransaction();
      await client.query('UPDATE users SET student_number = ?, updated_at = NOW() WHERE id = ?', [trimmed, req.params.id]);

      if (targetUser.student_number) {
        const [allowedCheckRows] = await client.query('SELECT id FROM allowed_registrations WHERE UPPER(TRIM(id_number)) = UPPER(TRIM(?))', [targetUser.student_number]);
        if (allowedCheckRows.length > 0) {
          await client.query('UPDATE allowed_registrations SET id_number = ?, is_used = true WHERE UPPER(TRIM(id_number)) = UPPER(TRIM(?))', [trimmed, targetUser.student_number]);
        } else {
          const newAllowedId = uuidv4();
          await client.query(
            'INSERT INTO allowed_registrations (id, id_number, department, role, is_used, added_by) VALUES (?, ?, ?, ?, true, ?) ON DUPLICATE KEY UPDATE is_used = true',
            [newAllowedId, trimmed, targetUser.department || null, targetUser.role, req.user.id]
          );
        }
      } else {
        const newAllowedId = uuidv4();
        await client.query(
          'INSERT INTO allowed_registrations (id, id_number, department, role, is_used, added_by) VALUES (?, ?, ?, ?, true, ?) ON DUPLICATE KEY UPDATE is_used = true',
          [newAllowedId, trimmed, targetUser.department || null, targetUser.role, req.user.id]
        );
      }

      await client.commit();
      res.json({ message: 'User ID number updated successfully' });
    } catch (dbErr) {
      await client.rollback();
      throw dbErr;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Update user ID error:', err);
    res.status(500).json({ error: 'Failed to update user ID number: ' + err.message });
  }
});

// Promote student year levels batch
router.post('/promote-year-levels', authenticateToken, requireRole('admin', 'superadmin'), async (req, res) => {
  const client = await pool.getConnection();
  try {
    await client.beginTransaction();

    const [breakdownRows] = await client.query(`
      SELECT year_level, CAST(COUNT(*) AS UNSIGNED) AS count
      FROM users
      WHERE role = 'student' AND year_level IN ('1st', '2nd', '3rd', '4th')
      GROUP BY year_level
    `);

    const [updateResult] = await client.query(`
      UPDATE users
      SET year_level = CASE year_level
        WHEN '1st' THEN '2nd'
        WHEN '2nd' THEN '3rd'
        WHEN '3rd' THEN '4th'
        WHEN '4th' THEN 'Graduated'
        ELSE year_level
      END,
      updated_at = NOW()
      WHERE role = 'student' AND year_level IN ('1st', '2nd', '3rd', '4th')
    `);

    await client.commit();
    res.json({
      message: `Semester updated successfully! ${updateResult.affectedRows} students advanced to the next level.`,
      updatedCount: updateResult.affectedRows,
      breakdown: breakdownRows
    });
  } catch (err) {
    try { await client.rollback(); } catch (_) {}
    console.error('Promote year levels error:', err);
    res.status(500).json({ error: 'Failed to update semester and promote year levels: ' + err.message });
  } finally {
    client.release();
  }
});

// Update a specific student's year level manually
router.patch('/users/:id/year-level', authenticateToken, requireRole('admin', 'superadmin'), async (req, res) => {
  try {
    const { year_level } = req.body;
    const allowed = ['1st', '2nd', '3rd', '4th', 'Graduated'];
    if (!allowed.includes(year_level)) {
      return res.status(400).json({ error: `Invalid year level. Allowed values: ${allowed.join(', ')}` });
    }

    const [checkRows] = await pool.query('SELECT id, first_name, last_name, role FROM users WHERE id = ?', [req.params.id]);
    if (checkRows.length === 0) return res.status(404).json({ error: 'User not found' });
    if (checkRows[0].role !== 'student') {
      return res.status(400).json({ error: 'Year level can only be assigned to students' });
    }

    await pool.query(
      'UPDATE users SET year_level = ?, updated_at = NOW() WHERE id = ?',
      [year_level, req.params.id]
    );
    const [fetchRows] = await pool.query(
      'SELECT id, student_number, first_name, last_name, year_level FROM users WHERE id = ?',
      [req.params.id]
    );

    res.json({
      message: `Updated year level to ${year_level} for ${checkRows[0].first_name} ${checkRows[0].last_name}`,
      user: fetchRows[0]
    });
  } catch (err) {
    console.error('Update student year level error:', err);
    res.status(500).json({ error: 'Failed to update student year level: ' + err.message });
  }
});

module.exports = router;
