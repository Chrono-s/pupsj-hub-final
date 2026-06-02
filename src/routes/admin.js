const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, requireRole, ALL_MODULES } = require('../middleware/auth');
const { uploadCsv } = require('../middleware/upload');
const { getFirewallStats } = require('../middleware/firewall');

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
  // Remove references from other lost/found rows before deleting the owner's rows.
  await db.query(
    `UPDATE lost_found
     SET matched_with = NULL, updated_at = NOW()
     WHERE matched_with IN (SELECT id FROM lost_found WHERE reporter_id = $1)`,
    [userId]
  );

  await db.query("UPDATE announcements SET status = 'deleted', updated_at = NOW() WHERE author_id = $1", [userId]);
  await db.query("UPDATE events SET status = 'deleted', updated_at = NOW() WHERE author_id = $1", [userId]);
  await db.query("UPDATE document_templates SET status = 'deleted', updated_at = NOW() WHERE uploaded_by = $1", [userId]);
  await db.query("UPDATE document_categories SET status = 'deleted', updated_at = NOW() WHERE created_by = $1", [userId]);
  await db.query(
    `UPDATE document_templates
     SET status = 'deleted', updated_at = NOW()
     WHERE category_id IN (SELECT id FROM document_categories WHERE created_by = $1)`,
    [userId]
  );
  await db.query('DELETE FROM feedback WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM chatbot_logs WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM lost_found WHERE reporter_id = $1', [userId]);
}

// Get all users (superadmin only)
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
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Verify user (superadmin only)
router.patch('/users/:id/verify', authenticateToken, requireRole('superadmin'), async (req, res) => {
  try {
    await pool.query('UPDATE users SET is_verified = true, updated_at = NOW() WHERE id = $1', [req.params.id]);
    res.json({ message: 'User verified' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to verify user' });
  }
});

// Deactivate user (superadmin only)
router.patch('/users/:id/deactivate', authenticateToken, requireRole('superadmin'), async (req, res) => {
  try {
    await pool.query('UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1', [req.params.id]);
    res.json({ message: 'User deactivated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to deactivate user' });
  }
});

// Activate user (superadmin only)
router.patch('/users/:id/activate', authenticateToken, requireRole('superadmin'), async (req, res) => {
  try {
    await pool.query('UPDATE users SET is_active = true, updated_at = NOW() WHERE id = $1', [req.params.id]);
    res.json({ message: 'User activated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to activate user' });
  }
});

// Delete user (superadmin only)
router.delete('/users/:id', authenticateToken, requireRole('superadmin'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      'SELECT student_number, role FROM users WHERE id = $1',
      [req.params.id]
    );
    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }
    if (userResult.rows[0].role === 'superadmin') {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Cannot delete superadmin account' });
    }

    const studentNumber = userResult.rows[0].student_number;
    await purgeUserOwnedContent(client, req.params.id);
    await client.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    if (studentNumber) {
      await client.query(
        'UPDATE allowed_registrations SET is_used = false WHERE UPPER(TRIM(id_number)) = UPPER(TRIM($1))',
        [studentNumber]
      );
    }
    await releaseStaleAllowedRegistrations(client);

    await client.query('COMMIT');
    res.json({ message: 'User deleted' });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    res.status(500).json({ error: 'Failed to delete user' });
  } finally {
    client.release();
  }
});

// Dashboard stats
router.get('/stats', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const [users, announcements, events, lostFound, allowedRegs] = await Promise.all([
      pool.query("SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE is_verified = false) as pending FROM users WHERE role != 'admin'"),
      pool.query("SELECT COUNT(*) FILTER (WHERE status = 'active') as total, COUNT(*) FILTER (WHERE status = 'pending') as pending FROM announcements"),
      pool.query("SELECT COUNT(*) FILTER (WHERE status = 'active') as total, COUNT(*) FILTER (WHERE status = 'pending') as pending FROM events"),
      pool.query("SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'open') as open FROM lost_found"),
      pool.query("SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE is_used = false) as unused FROM allowed_registrations")
    ]);

    res.json({
      users: { total: parseInt(users.rows[0].total), pending: parseInt(users.rows[0].pending) },
      announcements: { total: parseInt(announcements.rows[0].total), pending: parseInt(announcements.rows[0].pending) },
      events: { total: parseInt(events.rows[0].total), pending: parseInt(events.rows[0].pending) },
      lostFound: { total: parseInt(lostFound.rows[0].total), open: parseInt(lostFound.rows[0].open) },
      allowedRegistrations: { total: parseInt(allowedRegs.rows[0].total), unused: parseInt(allowedRegs.rows[0].unused) }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Firewall stats (admin monitoring)
router.get('/firewall', authenticateToken, requireRole('admin'), (req, res) => {
  res.json(getFirewallStats());
});

// ════════════════════════════════════════════
//  ALLOWED REGISTRATIONS
// ════════════════════════════════════════════

// List allowed registrations (superadmin only)
router.get('/allowed-registrations', authenticateToken, requireRole('superadmin'), async (req, res) => {
  try {
    await releaseStaleAllowedRegistrations(pool);
    const { department, status } = req.query;
    let query = 'SELECT * FROM allowed_registrations';
    const params = [];
    const conditions = [];

    if (department && VALID_DEPARTMENTS.includes(department)) {
      params.push(department);
      conditions.push(`department = $${params.length}`);
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

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('List allowed registrations error:', err);
    res.status(500).json({ error: 'Failed to fetch allowed registrations' });
  }
});

// Add single allowed registration (superadmin only)
router.post('/allowed-registrations', authenticateToken, requireRole('superadmin'), async (req, res) => {
  try {
    const { id_number } = req.body;
    const role = typeof req.body.role === 'string' ? req.body.role.trim().toLowerCase() : '';
    // Faculty are institution-wide — department is optional for faculty, required for students
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

    const existing = await pool.query('SELECT id FROM allowed_registrations WHERE id_number = $1', [trimmed]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'This ID number is already in the allowed list' });
    }

    const result = await pool.query(
      'INSERT INTO allowed_registrations (id_number, department, role, added_by) VALUES ($1, $2, $3, $4) RETURNING *',
      [trimmed, department, role, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Add allowed registration error:', err);
    res.status(500).json({ error: 'Failed to add allowed registration' });
  }
});

// CSV upload for allowed registrations (superadmin only)
router.post('/allowed-registrations/upload', authenticateToken, requireRole('superadmin'), uploadCsv.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded' });

    const role = typeof req.body.role === 'string' ? req.body.role.trim().toLowerCase() : '';
    // Faculty are institution-wide — department is optional for faculty, required for students
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

    // Skip header if it looks like one
    let startIdx = 0;
    if (lines.length > 0 && /id.number|student.number|id_number/i.test(lines[0])) {
      startIdx = 1;
    }

    const added = [];
    const skipped = [];
    const errors = [];

    for (let i = startIdx; i < lines.length; i++) {
      // Each line should contain an ID number (first column if CSV has multiple)
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
        const existing = await pool.query('SELECT 1 FROM allowed_registrations WHERE id_number = $1', [idNum]);
        if (existing.rows.length > 0) {
          skipped.push(idNum);
          continue;
        }

        await pool.query(
          'INSERT INTO allowed_registrations (id_number, department, role, added_by) VALUES ($1, $2, $3, $4)',
          [idNum, department, role, req.user.id]
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

// Bulk delete allowed registrations (superadmin only)
router.delete('/allowed-registrations', authenticateToken, requireRole('superadmin'), async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids must be a non-empty array' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let removedCount = 0;
    let deletedUsersCount = 0;

    for (const id of ids) {
      const regResult = await client.query(
        'SELECT id_number FROM allowed_registrations WHERE id = $1', [id]
      );
      if (regResult.rows.length === 0) continue; // skip already-gone entries

      const idNumber = regResult.rows[0].id_number;
      const linkedUsers = await client.query(
        'SELECT id FROM users WHERE UPPER(TRIM(student_number)) = UPPER(TRIM($1))', [idNumber]
      );
      for (const user of linkedUsers.rows) {
        await purgeUserOwnedContent(client, user.id);
      }
      const deleted = await client.query(
        'DELETE FROM users WHERE UPPER(TRIM(student_number)) = UPPER(TRIM($1)) RETURNING id', [idNumber]
      );
      await client.query('DELETE FROM allowed_registrations WHERE id = $1', [id]);
      removedCount++;
      deletedUsersCount += deleted.rowCount;
    }

    await client.query('COMMIT');
    res.json({
      message: `${removedCount} ID${removedCount !== 1 ? 's' : ''} removed` +
               (deletedUsersCount > 0 ? `, ${deletedUsersCount} account${deletedUsersCount !== 1 ? 's' : ''} deleted` : '')
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Bulk delete allowed-registrations error:', err);
    res.status(500).json({ error: 'Failed to bulk-remove IDs' });
  } finally {
    client.release();
  }
});

// Delete allowed registration (superadmin only)
router.delete('/allowed-registrations/:id', authenticateToken, requireRole('superadmin'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const regResult = await client.query(
      'SELECT id_number FROM allowed_registrations WHERE id = $1',
      [req.params.id]
    );
    if (regResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Allowed ID not found' });
    }

    const idNumber = regResult.rows[0].id_number;
    const linkedUsers = await client.query(
      'SELECT id FROM users WHERE UPPER(TRIM(student_number)) = UPPER(TRIM($1))',
      [idNumber]
    );
    for (const user of linkedUsers.rows) {
      await purgeUserOwnedContent(client, user.id);
    }
    const deletedUsers = await client.query(
      'DELETE FROM users WHERE UPPER(TRIM(student_number)) = UPPER(TRIM($1)) RETURNING id',
      [idNumber]
    );
    await client.query('DELETE FROM allowed_registrations WHERE id = $1', [req.params.id]);

    await client.query('COMMIT');
    res.json({
      message: deletedUsers.rowCount > 0
        ? 'Removed from allowed list and deleted matching registered account'
        : 'Removed from allowed list'
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    res.status(500).json({ error: 'Failed to remove allowed registration' });
  } finally {
    client.release();
  }
});

// Get allowed registrations stats (superadmin only)
router.get('/allowed-registrations/stats', authenticateToken, requireRole('superadmin'), async (req, res) => {
  try {
    await releaseStaleAllowedRegistrations(pool);
    const result = await pool.query(`
      SELECT department,
             COUNT(*) as total,
             COUNT(*) FILTER (WHERE is_used = true) as used,
             COUNT(*) FILTER (WHERE is_used = false) as unused
      FROM allowed_registrations
      GROUP BY department
      ORDER BY department
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Schedules Overview (Admin)
router.get('/schedules-overview', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const query = `
       SELECT * FROM (
         SELECT 
           cs.id::TEXT, 
           COALESCE(cs.subject_code, '')::TEXT AS subject_code, 
           COALESCE(cs.subject_name, '')::TEXT AS subject_name, 
           COALESCE(cs.day_of_week, '')::TEXT AS day_of_week,
           cs.start_time::TEXT, 
           cs.end_time::TEXT, 
           COALESCE(cs.room, 'TBA')::TEXT AS room,
           COALESCE(u.first_name || ' ' || u.last_name, cs.instructor, 'N/A')::TEXT AS instructor,
           COALESCE(cs.department, '')::TEXT AS department, 
           COALESCE(cs.section, '')::TEXT AS section, 
           COALESCE(cs.year_level, '')::TEXT AS year_level, 
           cs.created_at,
           'OFFICIAL' AS source
         FROM class_schedules cs
         LEFT JOIN users u ON cs.faculty_user_id = u.id

         UNION ALL

         SELECT 
           fs.id::TEXT, 
           COALESCE(fs.subject_code, '')::TEXT AS subject_code, 
           COALESCE(fs.subject_name, '')::TEXT AS subject_name, 
           COALESCE(fs.day_of_week, '')::TEXT AS day_of_week,
           fs.start_time::TEXT, 
           fs.end_time::TEXT, 
           COALESCE(fs.room, 'TBA')::TEXT AS room,
           (COALESCE(f.first_name, '') || ' ' || COALESCE(f.last_name, ''))::TEXT AS instructor,
           COALESCE(fs.department, '')::TEXT AS department, 
           COALESCE(fs.section, '')::TEXT AS section, 
           COALESCE(fs.year_level, '')::TEXT AS year_level, 
           fs.created_at,
           'FACULTY' AS source
         FROM faculty_schedules fs
         LEFT JOIN users f ON fs.faculty_id = f.id
       ) AS overview
       ORDER BY department ASC, year_level ASC, section ASC, day_of_week ASC, start_time ASC`;

    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error('[Admin] Schedules overview error:', err.message, err.stack);
    res.status(500).json({ error: 'Failed to fetch schedules overview detail: ' + err.message });
  }
});


// ════════════════════════════════════════════
//  SYSTEM MAINTENANCE / SETTINGS (Admin Only)
// ════════════════════════════════════════════

// Admin: Get all system settings
router.get('/system-settings', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query('SELECT key, value FROM system_settings');
    const settings = {};
    result.rows.forEach(row => {
      settings[row.key] = row.value;
    });
    res.json(settings);
  } catch (err) {
    console.error('Fetch admin system settings error:', err);
    res.status(500).json({ error: 'Failed to fetch system settings' });
  }
});

// Admin: Update system settings
router.post('/system-settings', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const settings = req.body;
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'Settings object is required' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [key, value] of Object.entries(settings)) {
        await client.query(`
          INSERT INTO system_settings (key, value, updated_at)
          VALUES ($1, $2, NOW())
          ON CONFLICT (key) DO UPDATE
          SET value = EXCLUDED.value, updated_at = NOW()
        `, [key, String(value)]);
      }
      await client.query('COMMIT');
      res.json({ message: 'System settings updated successfully' });
    } catch (dbErr) {
      await client.query('ROLLBACK');
      throw dbErr;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Update system settings error:', err);
    res.status(500).json({ error: 'Failed to update system settings' });
  }
});

const { uploadSystem } = require('../middleware/upload');
// Admin: Upload system images (logo or landing hero)
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


const bcrypt = require('bcryptjs');
const { sendWelcomeAdminEmail } = require('../services/email');

// Superadmin: Create new admin account (with module permissions)
router.post('/create-admin', authenticateToken, requireRole('superadmin'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { first_name, email, password, department, position } = req.body;
    // Which admin modules this account may access. Unknown modules are ignored.
    const modules = Array.isArray(req.body.modules)
      ? req.body.modules.filter(m => ALL_MODULES.includes(m))
      : [];

    if (!first_name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    // Generate unique student_number to satisfy check constraint
    const dummyId = `ADM-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    await client.query('BEGIN');
    const result = await client.query(`
      INSERT INTO users (student_number, email, password_hash, first_name, last_name, role, department, position, is_verified, is_active)
      VALUES ($1, $2, $3, $4, 'Admin', 'admin', $5, $6, true, true)
      RETURNING id, email, first_name, role, department, position, is_active, created_at
    `, [dummyId, normalizedEmail, passwordHash, first_name.trim(), department || null, position || null]);
    const newAdmin = result.rows[0];

    if (modules.length) {
      await client.query(
        `INSERT INTO admin_permissions (user_id, module, granted_by)
         SELECT $1, m, $2 FROM unnest($3::text[]) AS m
         ON CONFLICT (user_id, module) DO NOTHING`,
        [newAdmin.id, req.user.id, modules]
      );
    }
    await client.query('COMMIT');

    // Send welcome email asynchronously
    sendWelcomeAdminEmail(normalizedEmail, first_name.trim(), password).catch(err => {
      console.error('[Admin] Failed to send welcome email to new admin:', err.message);
    });

    res.status(201).json({ ...newAdmin, modules });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Create admin error:', err);
    res.status(500).json({ error: 'Failed to create admin account' });
  } finally {
    client.release();
  }
});

// Superadmin: list available modules + a given admin's current grants
router.get('/admins/:id/modules', authenticateToken, requireRole('superadmin'), async (req, res) => {
  try {
    const u = await pool.query("SELECT role FROM users WHERE id = $1", [req.params.id]);
    if (u.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const granted = await pool.query('SELECT module FROM admin_permissions WHERE user_id = $1', [req.params.id]);
    res.json({
      all_modules: ALL_MODULES,
      modules: granted.rows.map(r => r.module),
      is_superadmin: u.rows[0].role === 'superadmin',
    });
  } catch (err) {
    console.error('Get admin modules error:', err);
    res.status(500).json({ error: 'Failed to load modules' });
  }
});

// Superadmin: replace an admin's module grants
router.put('/admins/:id/modules', authenticateToken, requireRole('superadmin'), async (req, res) => {
  const client = await pool.connect();
  try {
    const modules = Array.isArray(req.body.modules)
      ? [...new Set(req.body.modules.filter(m => ALL_MODULES.includes(m)))]
      : [];
    const u = await pool.query("SELECT role FROM users WHERE id = $1", [req.params.id]);
    if (u.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    if (u.rows[0].role !== 'admin') {
      return res.status(400).json({ error: 'Only admin accounts have module permissions' });
    }

    await client.query('BEGIN');
    await client.query('DELETE FROM admin_permissions WHERE user_id = $1', [req.params.id]);
    if (modules.length) {
      await client.query(
        `INSERT INTO admin_permissions (user_id, module, granted_by)
         SELECT $1, m, $2 FROM unnest($3::text[]) AS m`,
        [req.params.id, req.user.id, modules]
      );
    }
    await client.query('COMMIT');
    res.json({ modules });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Update admin modules error:', err);
    res.status(500).json({ error: 'Failed to update modules' });
  } finally {
    client.release();
  }
});

// Superadmin: Promote admin to superadmin
router.patch('/users/:id/promote', authenticateToken, requireRole('superadmin'), async (req, res) => {
  try {
    const { id } = req.params;
    const checkUser = await pool.query('SELECT role FROM users WHERE id = $1', [id]);
    if (checkUser.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (checkUser.rows[0].role !== 'admin') {
      return res.status(400).json({ error: 'Only admin accounts can be promoted to superadmin' });
    }

    await pool.query("UPDATE users SET role = 'superadmin', updated_at = NOW() WHERE id = $1", [id]);
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
    if (!id_number) {
      return res.status(400).json({ error: 'ID number is required' });
    }
    const trimmed = id_number.trim().toUpperCase();

    // Fetch the target user's role and current ID number
    const userRes = await pool.query('SELECT role, student_number, department FROM users WHERE id = $1', [req.params.id]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const targetUser = userRes.rows[0];
    if (targetUser.role === 'superadmin') {
      return res.status(403).json({ error: 'Cannot modify superadmin ID' });
    }

    // Format validation checks (faculty vs student formats)
    if (targetUser.role !== 'admin') {
      const expectedRegex = getExpectedIdRegex(targetUser.role);
      if (!expectedRegex.test(trimmed)) {
        return res.status(400).json({ error: `Invalid ID format for ${targetUser.role}. Expected: ${getRoleFormatHint(targetUser.role)}` });
      }
    }

    // Check if duplicate ID exists for a different user
    const dupRes = await pool.query('SELECT id FROM users WHERE student_number = $1 AND id != $2', [trimmed, req.params.id]);
    if (dupRes.rows.length > 0) {
      return res.status(400).json({ error: 'This ID number is already registered to another user' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update the user's ID
      await client.query('UPDATE users SET student_number = $1, updated_at = NOW() WHERE id = $2', [trimmed, req.params.id]);

      // Sync with allowed_registrations
      if (targetUser.student_number) {
        const allowedCheck = await client.query('SELECT id FROM allowed_registrations WHERE UPPER(TRIM(id_number)) = UPPER(TRIM($1))', [targetUser.student_number]);
        if (allowedCheck.rows.length > 0) {
          await client.query('UPDATE allowed_registrations SET id_number = $1, is_used = true WHERE UPPER(TRIM(id_number)) = UPPER(TRIM($2))', [trimmed, targetUser.student_number]);
        } else {
          await client.query(
            'INSERT INTO allowed_registrations (id_number, department, role, is_used, added_by) VALUES ($1, $2, $3, true, $4) ON CONFLICT (id_number) DO UPDATE SET is_used = true',
            [trimmed, targetUser.department || null, targetUser.role, req.user.id]
          );
        }
      } else {
        await client.query(
          'INSERT INTO allowed_registrations (id_number, department, role, is_used, added_by) VALUES ($1, $2, $3, true, $4) ON CONFLICT (id_number) DO UPDATE SET is_used = true',
          [trimmed, targetUser.department || null, targetUser.role, req.user.id]
        );
      }

      await client.query('COMMIT');
      res.json({ message: 'User ID number updated successfully' });
    } catch (dbErr) {
      await client.query('ROLLBACK');
      throw dbErr;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Update user ID error:', err);
    res.status(500).json({ error: 'Failed to update user ID number: ' + err.message });
  }
});


module.exports = router;

