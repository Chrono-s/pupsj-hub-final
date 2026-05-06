const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
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

// Get all users (admin)
router.get('/users', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { status } = req.query;
    let query = `SELECT id, student_number, email, first_name, last_name, role, department, 
                        is_verified, is_active, created_at FROM users WHERE role != 'admin'`;
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

// Verify user
router.patch('/users/:id/verify', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    await pool.query('UPDATE users SET is_verified = true, updated_at = NOW() WHERE id = $1', [req.params.id]);
    res.json({ message: 'User verified' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to verify user' });
  }
});

// Deactivate user
router.patch('/users/:id/deactivate', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    await pool.query('UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1', [req.params.id]);
    res.json({ message: 'User deactivated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to deactivate user' });
  }
});

// Activate user
router.patch('/users/:id/activate', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    await pool.query('UPDATE users SET is_active = true, updated_at = NOW() WHERE id = $1', [req.params.id]);
    res.json({ message: 'User activated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to activate user' });
  }
});

// Delete user
router.delete('/users/:id', authenticateToken, requireRole('admin'), async (req, res) => {
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
    if (userResult.rows[0].role === 'admin') {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Cannot delete admin account' });
    }

    const studentNumber = userResult.rows[0].student_number;
    await purgeUserOwnedContent(client, req.params.id);
    await client.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    await client.query(
      'UPDATE allowed_registrations SET is_used = false WHERE UPPER(TRIM(id_number)) = UPPER(TRIM($1))',
      [studentNumber]
    );
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

// List allowed registrations
router.get('/allowed-registrations', authenticateToken, requireRole('admin'), async (req, res) => {
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

// Add single allowed registration
router.post('/allowed-registrations', authenticateToken, requireRole('admin'), async (req, res) => {
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

// CSV upload for allowed registrations
router.post('/allowed-registrations/upload', authenticateToken, requireRole('admin'), uploadCsv.single('file'), async (req, res) => {
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
        await pool.query(
          'INSERT INTO allowed_registrations (id_number, department, role, added_by) VALUES ($1, $2, $3, $4) ON CONFLICT (id_number) DO NOTHING',
          [idNum, department, role, req.user.id]
        );
        added.push(idNum);
      } catch (dbErr) {
        skipped.push({ id_number: idNum, reason: 'Database error' });
      }
    }

    res.json({
      message: `Processed ${lines.length - startIdx} entries`,
      added: added.length,
      skipped: skipped.length,
      errors
    });
  } catch (err) {
    console.error('CSV upload error:', err);
    res.status(500).json({ error: 'Failed to process CSV file' });
  }
});

// Bulk delete allowed registrations
router.delete('/allowed-registrations', authenticateToken, requireRole('admin'), async (req, res) => {
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

// Delete allowed registration
router.delete('/allowed-registrations/:id', authenticateToken, requireRole('admin'), async (req, res) => {
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

// Get allowed registrations stats
router.get('/allowed-registrations/stats', authenticateToken, requireRole('admin'), async (req, res) => {
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


module.exports = router;

