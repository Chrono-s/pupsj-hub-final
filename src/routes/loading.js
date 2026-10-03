const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken, requireRole, requirePermission } = require('../middleware/auth');
const { notifyUser, notifyAdmins, safeNotify } = require('../services/notifications');

const VALID_TERMS = ['SUMMER', 'FIRST_SEMESTER', 'SECOND_SEMESTER'];
const VALID_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const MOD = requirePermission('loading_requests'); // admin gate for this feature

function isValidTerm(t) { return VALID_TERMS.includes(t); }
function isValidYear(y) { return typeof y === 'string' && /^\d{4}-\d{4}$/.test(y.trim()); }

async function getActiveSetting(key) {
  const [rows] = await pool.query('SELECT `value` FROM system_settings WHERE `key` = ?', [key]);
  return rows[0]?.value || null;
}

// All known programs (matches the catalog)
const ALL_PROGRAMS = ['BSA','BSBAFM','BSEDEN','BSENT','BSHM','BSIT','BSPSY','DIT'];

// ──────────────────────────────────────────────────────────────
//  FACULTY — SPECIALIZATION / PROFILE REVIEW
// ──────────────────────────────────────────────────────────────

// Faculty submits (or re-submits) their credentials for admin review.
// Works for first submission, updates while pending, and re-submission after approval.
router.post('/profile/submit', authenticateToken, requireRole('faculty'), async (req, res) => {
  try {
    const [userRows] = await pool.query('SELECT faculty_profile_status, faculty_credentials FROM users WHERE id = ?', [req.user.id]);
    if (!userRows.length) return res.status(404).json({ error: 'User not found' });
    const prevStatus = userRows[0].faculty_profile_status;

    let cred = userRows[0].faculty_credentials;
    if (typeof cred === 'string') {
      try { cred = JSON.parse(cred); } catch (_) {}
    }
    if (!cred || !(cred.specializations?.length)) {
      return res.status(400).json({ error: 'Please fill in at least one specialization before submitting.' });
    }

    await pool.query(
      "UPDATE users SET faculty_profile_status='pending', faculty_profile_remarks=NULL, updated_at=NOW() WHERE id = ?",
      [req.user.id]
    );

    const isResubmit = prevStatus === 'approved' || prevStatus === 'pending';
    await safeNotify('profile-submitted', () => notifyAdmins(pool, {
      title: isResubmit ? 'Faculty specialization updated' : 'Faculty specialization submitted',
      message: `${req.user.first_name} ${req.user.last_name} ${isResubmit ? 'updated' : 'submitted'} their specialization for program assignment.`,
      type: 'general', link: '/admin',
    }, [req.user.id]));

    res.json({ message: isResubmit ? 'Profile updated and re-submitted for review.' : 'Profile submitted for review.' });
  } catch (err) {
    console.error('[Loading] profile submit error:', err);
    res.status(500).json({ error: 'Failed to submit profile' });
  }
});

// Faculty gets their allowed programs (assigned after approval).
router.get('/my-programs', authenticateToken, requireRole('faculty'), async (req, res) => {
  try {
    const [[statusRows], [programsRows]] = await Promise.all([
      pool.query('SELECT faculty_profile_status, faculty_profile_remarks, faculty_credentials, employment_type FROM users WHERE id = ?', [req.user.id]),
      pool.query('SELECT program FROM faculty_allowed_programs WHERE faculty_id = ? ORDER BY program', [req.user.id]),
    ]);
    const u = statusRows[0] || {};
    res.json({
      status: u.faculty_profile_status || null,
      remarks: u.faculty_profile_remarks || null,
      credentials: u.faculty_credentials || null,
      employment_type: u.employment_type || null,
      programs: programsRows.map(r => r.program),
    });
  } catch (err) {
    console.error('[Loading] my-programs error:', err);
    res.status(500).json({ error: 'Failed to load profile status' });
  }
});

// ──────────────────────────────────────────────────────────────
//  FACULTY ENDPOINTS
// ──────────────────────────────────────────────────────────────

// Available offerings for a term — filtered to the faculty's assigned programs,
// excludes already-approved offerings and the faculty's own pending/approved requests.
router.get('/offerings', authenticateToken, async (req, res) => {
  try {
    const term = String(req.query.term || '').trim();
    if (!isValidTerm(term)) return res.status(400).json({ error: 'Valid term is required' });
    const academicYear = req.query.academic_year
      ? String(req.query.academic_year).trim()
      : await getActiveSetting('active_year');

    // Only approved faculty may browse offerings
    if (req.user.role === 'faculty') {
      const [profileRows] = await pool.query(
        'SELECT faculty_profile_status FROM users WHERE id = ?', [req.user.id]
      );
      if (profileRows[0]?.faculty_profile_status !== 'approved') {
        return res.status(403).json({ error: 'Your specialization profile must be approved before you can view offerings.' });
      }
    }

    // Fetch assigned programs for this faculty
    const [progRows] = await pool.query(
      'SELECT program FROM faculty_allowed_programs WHERE faculty_id = ?', [req.user.id]
    );
    const allowedPrograms = progRows.map(r => r.program);
    if (!allowedPrograms.length) {
      return res.json([]); // no programs assigned yet
    }

    const [rows] = await pool.query(
      `SELECT o.id, o.term, o.academic_year, o.subject_code, o.subject_name, o.program, o.section,
              o.day_of_week, o.start_time, o.end_time, o.room,
              c.subject_type,
              (SELECT COUNT(*) FROM loading_requests rp
                WHERE rp.offering_id = o.id AND rp.status = 'pending') AS pending_count
       FROM class_offerings o
       LEFT JOIN courses c ON o.course_id = c.id
       WHERE o.term = ? AND o.is_active = TRUE
         AND (? IS NULL OR o.academic_year = ? OR o.academic_year IS NULL)
         AND o.program IN (?)
         AND NOT EXISTS (
           SELECT 1 FROM loading_requests r
           WHERE r.offering_id = o.id AND r.status = 'approved')
         AND NOT EXISTS (
           SELECT 1 FROM loading_requests r2
           WHERE r2.offering_id = o.id AND r2.faculty_id = ?
             AND r2.status IN ('pending', 'approved'))
         AND NOT EXISTS (
           SELECT 1 FROM loading_requests r3
           JOIN class_offerings o2 ON r3.offering_id = o2.id
           WHERE r3.faculty_id = ?
             AND r3.status = 'approved'
             AND r3.term = ?
             AND (? IS NULL OR r3.academic_year = ? OR r3.academic_year IS NULL)
             AND o2.day_of_week = o.day_of_week
             AND o2.start_time < o.end_time
             AND o2.end_time > o.start_time)
       ORDER BY o.subject_name ASC, o.day_of_week ASC, o.start_time ASC`,
      [term, academicYear, academicYear, allowedPrograms, req.user.id, req.user.id, term, academicYear, academicYear]
    );
    res.json(rows);
  } catch (err) {
    console.error('[Loading] offerings error:', err);
    res.status(500).json({ error: 'Failed to load offerings' });
  }
});

// Faculty submits a request for a specific offering.
router.post('/requests', authenticateToken, requireRole('faculty'), async (req, res) => {
  try {
    const { offering_id, notes } = req.body;
    if (!offering_id) return res.status(400).json({ error: 'offering_id is required' });

    // Check faculty approval status
    const [profileRows] = await pool.query(
      'SELECT faculty_profile_status FROM users WHERE id = ?', [req.user.id]
    );
    if (profileRows[0]?.faculty_profile_status !== 'approved') {
      return res.status(403).json({ error: 'Your specialization profile must be approved before you can submit loading requests.' });
    }

    // Fetch the offering
    const [offRows] = await pool.query(
      `SELECT * FROM class_offerings WHERE id = ? AND is_active = TRUE`, [offering_id]
    );
    if (offRows.length === 0) return res.status(404).json({ error: 'Offering not found' });
    const offering = offRows[0];

    // Must belong to an assigned program
    const [progRows] = await pool.query(
      'SELECT 1 FROM faculty_allowed_programs WHERE faculty_id = ? AND program = ?',
      [req.user.id, offering.program]
    );
    if (!progRows.length) {
      return res.status(403).json({ error: `You are not assigned to the ${offering.program} program.` });
    }

    // Offering already approved for someone else?
    const [taken] = await pool.query(
      `SELECT 1 FROM loading_requests WHERE offering_id = ? AND status = 'approved'`, [offering_id]
    );
    if (taken.length > 0) {
      return res.status(409).json({ error: 'This offering has already been assigned to another faculty member.' });
    }

    // Faculty already requested this offering?
    const [dup] = await pool.query(
      `SELECT 1 FROM loading_requests WHERE offering_id = ? AND faculty_id = ? AND status IN ('pending','approved')`,
      [offering_id, req.user.id]
    );
    if (dup.length > 0) {
      return res.status(409).json({ error: 'You already have an active request for this offering.' });
    }

    const warnings = [];

    // Contention warning: other faculty have pending requests for this offering
    const [contention] = await pool.query(
      `SELECT COUNT(*) AS n FROM loading_requests WHERE offering_id = ? AND status = 'pending'`,
      [offering_id]
    );
    if (contention[0].n > 0) {
      warnings.push(`${contention[0].n} other faculty have also requested this offering.`);
    }

    // Self-overlap check: does faculty have another approved/pending request overlapping this time?
    const [selfOverlap] = await pool.query(
      `SELECT o.subject_name, o.day_of_week, o.start_time, o.end_time
       FROM loading_requests r JOIN class_offerings o ON r.offering_id = o.id
       WHERE r.faculty_id = ? AND r.status IN ('pending','approved')
         AND r.term = ?
         AND (? IS NULL OR r.academic_year = ? OR (r.academic_year IS NULL AND ? IS NULL))
         AND o.day_of_week = ? AND o.start_time < ? AND ? < o.end_time`,
      [req.user.id, offering.term, offering.academic_year || null, offering.academic_year || null, offering.academic_year || null, offering.day_of_week, offering.end_time, offering.start_time]
    );
    if (selfOverlap.length > 0) {
      const c = selfOverlap[0];
      warnings.push(`This overlaps another slot you requested: ${c.subject_name} (${c.day_of_week} ${c.start_time}-${c.end_time}).`);
    }

    const newId = uuidv4();
    await pool.query(
      `INSERT INTO loading_requests (id, offering_id, faculty_id, term, academic_year, remarks, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [newId, offering_id, req.user.id, offering.term, offering.academic_year || null, notes ? notes.trim() : null]
    );
    const [insRows] = await pool.query('SELECT * FROM loading_requests WHERE id = ?', [newId]);

    await safeNotify('loading-requested', () => notifyAdmins(pool, {
      title: 'New loading request',
      message: `${req.user.first_name} ${req.user.last_name} requested ${offering.subject_name}.`,
      type: 'general', link: '/admin',
    }, [req.user.id]));

    res.status(201).json({ request: insRows[0], warnings });
  } catch (err) {
    console.error('[Loading] submit request error:', err);
    res.status(500).json({ error: 'Failed to submit loading request' });
  }
});

// Master schedule — view-all approved assignments for a term (Stage 4 / calendar view).
router.get('/master', authenticateToken, async (req, res) => {
  try {
    const term = String(req.query.term || '').trim();
    if (!isValidTerm(term)) return res.status(400).json({ error: 'Valid term is required' });
    const academicYear = req.query.academic_year ? String(req.query.academic_year).trim() : null;
    const mineOnly = req.query.mine === 'true';

    const params = [term];
    let q = `
      SELECT r.id AS request_id, r.term, r.academic_year,
             f.id AS faculty_id, CONCAT(f.first_name, ' ', f.last_name) AS faculty_name,
             f.department AS faculty_department, f.employment_type,
             o.subject_code, o.subject_name, o.program, o.section,
             o.day_of_week, o.start_time, o.end_time, o.room
      FROM loading_requests r
      JOIN class_offerings o ON r.offering_id = o.id
      JOIN users f ON r.faculty_id = f.id
      WHERE r.term = ? AND r.status = 'approved'`;
    if (academicYear) {
      params.push(academicYear);
      q += ` AND r.academic_year = ?`;
    }
    if (mineOnly) {
      params.push(req.user.id);
      q += ` AND r.faculty_id = ?`;
    }
    q += ` ORDER BY o.day_of_week ASC, o.start_time ASC, o.subject_name ASC`;

    const [rows] = await pool.query(q, params);
    res.json(rows);
  } catch (err) {
    console.error('[Loading] master schedule error:', err);
    res.status(500).json({ error: 'Failed to load schedule' });
  }
});

// Faculty's own requests (pending, approved, rejected, returned) for the current user.
router.get('/my-requests', authenticateToken, requireRole('faculty'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.id, r.status, r.term, r.academic_year, r.remarks, r.admin_remarks, r.created_at, r.reviewed_at,
              r.offering_id,
              o.subject_code, o.subject_name, o.program, o.section,
              o.day_of_week, o.start_time, o.end_time, o.room,
              c.subject_type
       FROM loading_requests r
       JOIN class_offerings o ON r.offering_id = o.id
       LEFT JOIN courses c ON o.course_id = c.id
       WHERE r.faculty_id = ?
       ORDER BY r.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[Loading] my-requests error:', err);
    res.status(500).json({ error: 'Failed to load your requests' });
  }
});

// Faculty withdraws a pending request.
router.delete('/requests/:id', authenticateToken, requireRole('faculty'), async (req, res) => {
  try {
    const [delResult] = await pool.query(
      `DELETE FROM loading_requests WHERE id = ? AND faculty_id = ? AND status = 'pending'`,
      [req.params.id, req.user.id]
    );
    if (delResult.affectedRows === 0) {
      return res.status(404).json({ error: 'Pending request not found or cannot be withdrawn' });
    }
    res.json({ message: 'Request withdrawn' });
  } catch (err) {
    console.error('[Loading] withdraw request error:', err);
    res.status(500).json({ error: 'Failed to withdraw request' });
  }
});

// ──────────────────────────────────────────────────────────────
//  ADMIN — FACULTY SPECIALIZATION REVIEW (Stage 1)
// ──────────────────────────────────────────────────────────────

// List faculty specialization profiles. Filter by status: 'pending'|'approved'|'rejected'|'all'.
router.get('/admin/specializations', authenticateToken, requireRole('admin'), MOD, async (req, res) => {
  try {
    const { status } = req.query;
    const params = [];
    let q = `
      SELECT u.id, u.first_name, u.last_name, u.email, u.department,
             u.faculty_profile_status, u.faculty_profile_remarks,
             u.faculty_credentials, u.employment_type,
             u.updated_at,
             COALESCE(
               (SELECT JSON_ARRAYAGG(fap.program)
                FROM faculty_allowed_programs fap
                WHERE fap.faculty_id = u.id),
               JSON_ARRAY()
             ) AS allowed_programs
      FROM users u
      WHERE u.role = 'faculty'`;

    if (status) {
      params.push(status);
      q += ` AND u.faculty_profile_status = ?`;
    }
    q += ` ORDER BY u.last_name ASC, u.first_name ASC`;

    const [rows] = await pool.query(q, params);
    res.json(rows);
  } catch (err) {
    console.error('[Loading] specializations list error:', err);
    res.status(500).json({ error: 'Failed to list specializations' });
  }
});

// Admin approves faculty profile and assigns allowed programs.
router.post('/admin/specializations/:id/approve', authenticateToken, requireRole('admin'), MOD, async (req, res) => {
  const { programs } = req.body;
  if (!Array.isArray(programs) || programs.length === 0) {
    return res.status(400).json({ error: 'Assign at least one program to approve this faculty.' });
  }
  const invalid = programs.filter(p => !ALL_PROGRAMS.includes(p));
  if (invalid.length) {
    return res.status(400).json({ error: `Invalid programs: ${invalid.join(', ')}` });
  }

  const client = await pool.getConnection();
  try {
    await client.beginTransaction();
    await client.query(
      "UPDATE users SET faculty_profile_status='approved', faculty_profile_remarks=NULL, updated_at=NOW() WHERE id = ? AND role='faculty'",
      [req.params.id]
    );

    await client.query('DELETE FROM faculty_allowed_programs WHERE faculty_id = ?', [req.params.id]);

    const progValues = programs.map(p => [uuidv4(), req.params.id, p, req.user.id]);
    const placeholders = progValues.map(() => '(?, ?, ?, ?)').join(', ');
    await client.query(
      `INSERT INTO faculty_allowed_programs (id, faculty_id, program, assigned_by) VALUES ${placeholders}`,
      progValues.flat()
    );

    await client.commit();

    await safeNotify('profile-approved', () => notifyUser(pool, req.params.id, {
      title: 'Specialization profile approved',
      message: `Your specialization has been reviewed. You are now assigned to: ${programs.join(', ')}. You can now submit loading requests.`,
      type: 'general', link: '/dashboard',
    }));

    res.json({ message: 'Profile approved and programs assigned.' });
  } catch (err) {
    try { await client.rollback(); } catch (_) {}
    console.error('[Loading] approve profile error:', err);
    res.status(500).json({ error: 'Failed to approve profile' });
  } finally {
    client.release();
  }
});

// Admin rejects profile with required remarks.
router.post('/admin/specializations/:id/reject', authenticateToken, requireRole('admin'), MOD, async (req, res) => {
  const remarks = (req.body.remarks || '').trim();
  if (!remarks) {
    return res.status(400).json({ error: 'Remarks are required when returning a profile.' });
  }
  try {
    await pool.query(
      "UPDATE users SET faculty_profile_status='rejected', faculty_profile_remarks = ?, updated_at=NOW() WHERE id = ? AND role='faculty'",
      [remarks, req.params.id]
    );

    await safeNotify('profile-rejected', () => notifyUser(pool, req.params.id, {
      title: 'Specialization profile returned',
      message: `Please update your specialization profile: ${remarks}`,
      type: 'general', link: '/dashboard',
    }));

    res.json({ message: 'Profile rejected with feedback.' });
  } catch (err) {
    console.error('[Loading] reject profile error:', err);
    res.status(500).json({ error: 'Failed to reject profile' });
  }
});

// Admin revokes approval (sets status to null and clears allowed programs).
router.post('/admin/specializations/:id/revoke', authenticateToken, requireRole('admin'), MOD, async (req, res) => {
  const remarks = (req.body.remarks || '').trim() || null;
  const client = await pool.getConnection();
  try {
    await client.beginTransaction();
    await client.query(
      "UPDATE users SET faculty_profile_status=NULL, faculty_profile_remarks = ?, updated_at=NOW() WHERE id = ? AND role='faculty'",
      [remarks, req.params.id]
    );
    await client.query('DELETE FROM faculty_allowed_programs WHERE faculty_id = ?', [req.params.id]);
    await client.commit();

    await safeNotify('profile-revoked', () => notifyUser(pool, req.params.id, {
      title: 'Specialization approval revoked',
      message: `Your program assignment has been removed${remarks ? ': ' + remarks : '.'} Please re-submit your specialization profile for review.`,
      type: 'general', link: '/dashboard',
    }));

    res.json({ message: 'Approval revoked.' });
  } catch (err) {
    try { await client.rollback(); } catch (_) {}
    console.error('[Loading] revoke profile error:', err);
    res.status(500).json({ error: 'Failed to revoke approval' });
  } finally {
    client.release();
  }
});

// Admin updates program assignment directly without re-approving credentials.
router.put('/admin/specializations/:id/programs', authenticateToken, requireRole('admin'), MOD, async (req, res) => {
  const { programs } = req.body;
  if (!Array.isArray(programs) || programs.length === 0) {
    return res.status(400).json({ error: 'Assign at least one program.' });
  }
  const invalid = programs.filter(p => !ALL_PROGRAMS.includes(p));
  if (invalid.length) {
    return res.status(400).json({ error: `Invalid programs: ${invalid.join(', ')}` });
  }

  const client = await pool.getConnection();
  try {
    await client.beginTransaction();
    await client.query('DELETE FROM faculty_allowed_programs WHERE faculty_id = ?', [req.params.id]);
    const progValues = programs.map(p => [uuidv4(), req.params.id, p, req.user.id]);
    const placeholders = progValues.map(() => '(?, ?, ?, ?)').join(', ');
    await client.query(
      `INSERT INTO faculty_allowed_programs (id, faculty_id, program, assigned_by) VALUES ${placeholders}`,
      progValues.flat()
    );
    await client.commit();
    res.json({ message: 'Assigned programs updated.' });
  } catch (err) {
    try { await client.rollback(); } catch (_) {}
    console.error('[Loading] update programs error:', err);
    res.status(500).json({ error: 'Failed to update assigned programs' });
  } finally {
    client.release();
  }
});

// ──────────────────────────────────────────────────────────────
//  ADMIN — COURSE CATALOG (Reference)
// ──────────────────────────────────────────────────────────────

router.get('/admin/catalog', authenticateToken, requireRole('admin'), MOD, async (req, res) => {
  try {
    const { type, program } = req.query;
    const params = [];
    let q = 'SELECT * FROM courses WHERE 1=1';
    if (type) { params.push(type); q += ` AND subject_type = ?`; }
    if (program) { params.push(program); q += ` AND program = ?`; }
    q += ' ORDER BY program ASC, year_level ASC, term ASC, subject_code ASC';
    const [rows] = await pool.query(q, params);
    res.json(rows);
  } catch (err) {
    console.error('[Loading] catalog error:', err);
    res.status(500).json({ error: 'Failed to load catalog' });
  }
});

// ──────────────────────────────────────────────────────────────
//  ADMIN — CLASS OFFERINGS (Stage 2)
// ──────────────────────────────────────────────────────────────

// List offerings for a term with live demand counters.
router.get('/admin/offerings', authenticateToken, requireRole('admin'), MOD, async (req, res) => {
  try {
    const term = String(req.query.term || '').trim();
    if (!isValidTerm(term)) return res.status(400).json({ error: 'Valid term is required' });
    const academicYear = req.query.academic_year ? String(req.query.academic_year).trim() : null;

    const params = [term];
    let q = `
      SELECT o.*, o.start_time AS start_time, o.end_time AS end_time,
             c.subject_type,
             (SELECT COUNT(*) FROM loading_requests r
               WHERE r.offering_id = o.id AND r.status = 'pending')  AS pending_count,
             (SELECT COUNT(*) FROM loading_requests r
               WHERE r.offering_id = o.id AND r.status = 'approved') AS approved_count,
             (SELECT f.last_name FROM loading_requests r
                JOIN users f ON r.faculty_id = f.id
               WHERE r.offering_id = o.id AND r.status = 'approved'
               LIMIT 1) AS assigned_faculty
      FROM class_offerings o
      LEFT JOIN courses c ON o.course_id = c.id
      WHERE o.term = ?`;
    if (academicYear) {
      params.push(academicYear);
      q += ` AND o.academic_year = ?`;
    }
    q += ` ORDER BY o.subject_name ASC, o.day_of_week ASC, o.start_time ASC`;

    const [rows] = await pool.query(q, params);
    res.json(rows);
  } catch (err) {
    console.error('[Loading] admin offerings error:', err);
    res.status(500).json({ error: 'Failed to load offerings' });
  }
});

// Returns [{from:'HH:MM', to:'HH:MM'}, ...] for gaps >= minGap minutes.
function computeFreeWindows(booked, dayStart = '07:00', dayEnd = '21:00', minGap = 30) {
  const toMin = t => { const [h, m] = String(t).split(':'); return +h * 60 + +m; };
  const fromMin = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const sorted = booked
    .map(s => ({ s: toMin(s.start_time), e: toMin(s.end_time) }))
    .sort((a, b) => a.s - b.s);
  const free = [];
  let cur = toMin(dayStart);
  const end = toMin(dayEnd);
  for (const slot of sorted) {
    if (slot.s > cur && slot.s - cur >= minGap) free.push({ from: fromMin(cur), to: fromMin(slot.s) });
    cur = Math.max(cur, slot.e);
  }
  if (end > cur && end - cur >= minGap) free.push({ from: fromMin(cur), to: fromMin(end) });
  return free;
}

// Find an existing active offering that would clash with the given slot:
// same term + day with overlapping time AND the same room or the same section.
// Returns the clashing row or null.
async function findOfferingClash(b, excludeId) {
  const params = [b.term, b.day_of_week, b.end_time, b.start_time, b.room || null, b.section || null, b.academic_year || null, b.academic_year || null];
  let q = `SELECT subject_name, room, section, start_time, end_time
           FROM class_offerings
           WHERE is_active = TRUE AND term = ? AND day_of_week = ?
             AND start_time < ? AND ? < end_time
             AND ( (room IS NOT NULL AND room = ?)
                OR (section IS NOT NULL AND section = ?) )
             AND (? IS NULL OR academic_year = ? OR academic_year IS NULL)`;
  if (excludeId) { params.push(excludeId); q += ` AND id <> ?`; }
  const [rows] = await pool.query(q + ' LIMIT 1', params);
  return rows[0] || null;
}

// b = the NEW offering body being created/updated
function clashMessage(c, b) {
  const t = `${String(c.start_time).slice(0,5)}–${String(c.end_time).slice(0,5)}`;
  const roomConflict    = b.room    && c.room    && b.room    === c.room;
  const sectionConflict = b.section && c.section && b.section === c.section;

  if (roomConflict && sectionConflict) {
    return `Room ${c.room} and Section ${c.section} are both already scheduled for "${c.subject_name}" at ${t} on this day. Use a different room, section, or time.`;
  }
  if (roomConflict) {
    return `Room ${c.room} is already occupied by "${c.subject_name}" at ${t} on this day. ` +
           `Use a different room or time. Tip: to run parallel sections of the same subject at the same time, assign each section a different room.`;
  }
  if (sectionConflict) {
    return `Section ${c.section} already has "${c.subject_name}" at ${t} on this day. ` +
           `Use a different section code, room, or time.`;
  }
  return `Scheduling conflict with "${c.subject_name}" at ${t} on this day. Use a different room, section, or time.`;
}

// ── Live conflict-check endpoint (no insert — used by the form before submit) ──
router.post('/admin/offerings/check-conflict', authenticateToken, requireRole('admin'), MOD, async (req, res) => {
  try {
    const { term, day_of_week, start_time, end_time, room, section, exclude_id, course_id, academic_year } = req.body;

    if (!term || !day_of_week || !start_time || !end_time) {
      return res.json({ clear: null, message: 'Fill in day, start, and end time to check.' });
    }
    if (start_time >= end_time) {
      return res.json({ clear: false, message: 'Start time must be before end time.' });
    }

    if (section && course_id) {
      const params = [course_id, section];
      let dupQ = `SELECT subject_name FROM class_offerings
                  WHERE course_id = ? AND section = ? AND is_active = TRUE`;
      if (exclude_id) { params.push(exclude_id); dupQ += ` AND id <> ?`; }
      if (academic_year) { params.push(academic_year); dupQ += ` AND (academic_year = ? OR academic_year IS NULL)`; }
      const [dupRows] = await pool.query(dupQ + ' LIMIT 1', params);
      if (dupRows.length) {
        return res.json({ clear: false, message: `Section ${section} already has "${dupRows[0].subject_name}" as an offering. The same subject cannot be added twice to the same section.` });
      }
    }

    const b = { term, day_of_week, start_time, end_time, room: room || null, section: section || null, academic_year: academic_year || null };
    const clash = await findOfferingClash(b, exclude_id || null);

    if (clash) {
      return res.json({ clear: false, message: clashMessage(clash, b) });
    }
    return res.json({ clear: true, message: 'No conflicts — this slot is available.' });
  } catch (err) {
    console.error('[Loading] check-conflict error:', err);
    res.status(500).json({ error: 'Failed to check conflict' });
  }
});

function validateOfferingBody(b) {
  if (!isValidTerm(b.term)) return 'Valid term is required';
  if (!b.subject_name || !String(b.subject_name).trim()) return 'Subject is required';
  if (!VALID_DAYS.includes(b.day_of_week)) return 'Valid day_of_week is required';
  if (!b.start_time || !b.end_time) return 'Start and end time are required';
  if (b.start_time >= b.end_time) return 'Start time must be before end time';
  if (b.academic_year && !isValidYear(b.academic_year)) return 'Academic year must be format YYYY-YYYY';
  return null;
}

router.post('/admin/offerings', authenticateToken, requireRole('admin'), MOD, async (req, res) => {
  try {
    const b = {
      term: req.body.term,
      academic_year: req.body.academic_year ? String(req.body.academic_year).trim() : null,
      course_id: req.body.course_id || null,
      subject_name: req.body.subject_name,
      subject_code: req.body.subject_code || null,
      program: req.body.program || null,
      section: req.body.section ? String(req.body.section).trim() : null,
      day_of_week: req.body.day_of_week,
      start_time: req.body.start_time,
      end_time: req.body.end_time,
      room: req.body.room ? String(req.body.room).trim() : null,
    };

    const err = validateOfferingBody(b);
    if (err) return res.status(400).json({ error: err });

    const clash = await findOfferingClash(b, null);
    if (clash) return res.status(409).json({ error: clashMessage(clash, b) });

    let { subject_code, subject_name, program, course_id } = b;

    if (b.section && course_id) {
      const [dupRows] = await pool.query(
        `SELECT subject_name FROM class_offerings
         WHERE course_id = ? AND section = ? AND is_active = TRUE
           AND (? IS NULL OR academic_year = ? OR academic_year IS NULL) LIMIT 1`,
        [course_id, b.section, b.academic_year || null, b.academic_year || null]
      );
      if (dupRows.length) {
        return res.status(409).json({
          error: `Section ${b.section} already has "${dupRows[0].subject_name}" as an offering. The same subject cannot be added twice to the same section.`
        });
      }
    }
    if (course_id) {
      const [cRows] = await pool.query('SELECT subject_code, subject_name, program FROM courses WHERE id = ?', [course_id]);
      if (cRows.length) {
        subject_code = subject_code || cRows[0].subject_code;
        subject_name = subject_name || cRows[0].subject_name;
        program = program || cRows[0].program;
      }
    }

    const newOfferingId = uuidv4();
    await pool.query(
      `INSERT INTO class_offerings
         (id, term, academic_year, course_id, subject_code, subject_name, program, section, day_of_week, start_time, end_time, room, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [newOfferingId, b.term, b.academic_year || null, course_id || null, subject_code || null, String(subject_name).trim(),
       program || null, b.section || null, b.day_of_week, b.start_time, b.end_time, b.room || null, req.user.id]
    );
    const [insOffering] = await pool.query('SELECT * FROM class_offerings WHERE id = ?', [newOfferingId]);
    res.status(201).json(insOffering[0]);
  } catch (err) {
    console.error('[Loading] create offering error:', err);
    res.status(500).json({ error: 'Failed to create offering' });
  }
});

router.patch('/admin/offerings/:id', authenticateToken, requireRole('admin'), MOD, async (req, res) => {
  try {
    const [existingRows] = await pool.query('SELECT * FROM class_offerings WHERE id = ?', [req.params.id]);
    if (existingRows.length === 0) return res.status(404).json({ error: 'Offering not found' });
    const ex = existingRows[0];

    const b = {
      term: req.body.term || ex.term,
      academic_year: req.body.academic_year !== undefined ? req.body.academic_year : ex.academic_year,
      course_id: req.body.course_id !== undefined ? req.body.course_id : ex.course_id,
      subject_name: req.body.subject_name !== undefined ? req.body.subject_name : ex.subject_name,
      subject_code: req.body.subject_code !== undefined ? req.body.subject_code : ex.subject_code,
      program: req.body.program !== undefined ? req.body.program : ex.program,
      section: req.body.section !== undefined ? req.body.section : ex.section,
      day_of_week: req.body.day_of_week || ex.day_of_week,
      start_time: req.body.start_time || ex.start_time,
      end_time: req.body.end_time || ex.end_time,
      room: req.body.room !== undefined ? req.body.room : ex.room,
      is_active: req.body.is_active !== undefined ? req.body.is_active : ex.is_active,
    };

    const err = validateOfferingBody(b);
    if (err) return res.status(400).json({ error: err });

    const clash = await findOfferingClash(b, req.params.id);
    if (clash) return res.status(409).json({ error: clashMessage(clash, b) });

    let { subject_code, subject_name, program, course_id } = b;
    if (course_id) {
      const [cRows] = await pool.query('SELECT subject_code, subject_name, program FROM courses WHERE id = ?', [course_id]);
      if (cRows.length) {
        subject_code = subject_code || cRows[0].subject_code;
        subject_name = subject_name || cRows[0].subject_name;
        program = program || cRows[0].program;
      }
    }

    if (b.section && course_id) {
      const [dupRows] = await pool.query(
        `SELECT subject_name FROM class_offerings
         WHERE course_id = ? AND section = ? AND is_active = TRUE AND id <> ?
           AND (? IS NULL OR academic_year = ? OR academic_year IS NULL) LIMIT 1`,
        [course_id, b.section, req.params.id, b.academic_year || null, b.academic_year || null]
      );
      if (dupRows.length) {
        return res.status(409).json({
          error: `Section ${b.section} already has "${dupRows[0].subject_name}" as an offering. The same subject cannot be added twice to the same section.`
        });
      }
    }

    await pool.query(
      `UPDATE class_offerings SET
         course_id=?, subject_code=?, subject_name=?, program=?, section=?,
         day_of_week=?, start_time=?, end_time=?, room=?, is_active=?
       WHERE id=?`,
      [course_id || null, subject_code || null, String(subject_name).trim(), program || null, b.section || null,
       b.day_of_week, b.start_time, b.end_time, b.room || null,
       b.is_active === undefined ? true : !!b.is_active, req.params.id]
    );
    const [updatedRows] = await pool.query('SELECT * FROM class_offerings WHERE id = ?', [req.params.id]);
    res.json(updatedRows[0]);
  } catch (err) {
    console.error('[Loading] update offering error:', err);
    res.status(500).json({ error: 'Failed to update offering' });
  }
});

router.delete('/admin/offerings/:id', authenticateToken, requireRole('admin'), MOD, async (req, res) => {
  try {
    const [delResult] = await pool.query('DELETE FROM class_offerings WHERE id = ?', [req.params.id]);
    if (delResult.affectedRows === 0) return res.status(404).json({ error: 'Offering not found' });
    res.json({ message: 'Offering deleted' });
  } catch (err) {
    console.error('[Loading] delete offering error:', err);
    res.status(500).json({ error: 'Failed to delete offering' });
  }
});

// ──────────────────────────────────────────────────────────────
//  ADMIN — REVIEW (Stage 3)
// ──────────────────────────────────────────────────────────────

// All requests for a term, with faculty + offering details.
router.get('/admin/requests', authenticateToken, requireRole('admin'), MOD, async (req, res) => {
  try {
    const { term, status } = req.query;
    const academicYear = String(req.query.academic_year || '').trim() || null;
    const params = [];
    let q = `
      SELECT r.id, r.status, r.term, r.academic_year, r.remarks, r.admin_remarks, r.created_at, r.reviewed_at,
             r.offering_id,
             f.id AS faculty_id, CONCAT(f.first_name, ' ', f.last_name) AS faculty_name,
             f.department AS faculty_department, f.position AS faculty_position,
             f.faculty_credentials,
             o.subject_code, o.subject_name, o.program, o.section,
             o.day_of_week, o.start_time, o.end_time, o.room
      FROM loading_requests r
      JOIN class_offerings o ON r.offering_id = o.id
      JOIN users f ON r.faculty_id = f.id
      WHERE 1=1`;
    if (term && isValidTerm(term)) { params.push(term); q += ` AND r.term = ?`; }
    if (academicYear) { params.push(academicYear); q += ` AND r.academic_year = ?`; }
    if (status) { params.push(status); q += ` AND r.status = ?`; }
    q += ` ORDER BY o.subject_name ASC, r.created_at ASC`;
    const [rows] = await pool.query(q, params);
    res.json(rows);
  } catch (err) {
    console.error('[Loading] admin requests error:', err);
    res.status(500).json({ error: 'Failed to load requests' });
  }
});

// Approve — transactional.
router.post('/admin/requests/:id/approve', authenticateToken, requireRole('admin'), MOD, async (req, res) => {
  const client = await pool.getConnection();
  try {
    await client.beginTransaction();
    const [reqRows] = await client.query(
      `SELECT r.*, o.subject_code, o.subject_name, o.program, o.section,
              o.day_of_week, o.start_time, o.end_time, o.room
       FROM loading_requests r JOIN class_offerings o ON r.offering_id = o.id
       WHERE r.id = ? FOR UPDATE`,
      [req.params.id]
    );
    if (reqRows.length === 0) {
      await client.rollback();
      return res.status(404).json({ error: 'Request not found' });
    }
    const lr = reqRows[0];
    if (lr.status === 'approved') {
      await client.rollback();
      return res.status(409).json({ error: 'Already approved' });
    }

    // Offering already taken by someone else?
    const [taken] = await client.query(
      `SELECT 1 FROM loading_requests WHERE offering_id = ? AND status = 'approved' AND id <> ?`,
      [lr.offering_id, lr.id]
    );
    if (taken.length > 0) {
      await client.rollback();
      return res.status(409).json({ error: 'This offering is already assigned to another faculty.' });
    }

    // HARD conflict check: any approved offering overlapping in time on the same faculty, room, or section
    const [conflictRows] = await client.query(
      `SELECT o.subject_name, o.day_of_week, o.room,
              o.start_time, o.end_time,
              CONCAT(u.first_name, ' ', u.last_name) AS blocking_faculty,
              CASE WHEN r.faculty_id = ? THEN 'faculty'
                   WHEN o.room = ? AND o.room IS NOT NULL THEN 'room'
                   ELSE 'section' END AS dim
       FROM loading_requests r
       JOIN class_offerings o ON r.offering_id = o.id
       JOIN users u ON r.faculty_id = u.id
       WHERE r.status = 'approved' AND r.id <> ?
         AND r.term = ?
         AND (? IS NULL OR r.academic_year = ? OR (r.academic_year IS NULL AND ? IS NULL))
         AND o.day_of_week = ? AND o.start_time < ? AND ? < o.end_time
         AND ( r.faculty_id = ?
            OR (o.room = ? AND o.room IS NOT NULL)
            OR (o.section = ? AND o.section IS NOT NULL) )
       LIMIT 1`,
      [lr.faculty_id, lr.room, lr.id, lr.term, lr.academic_year || null, lr.academic_year || null, lr.academic_year || null, lr.day_of_week, lr.end_time, lr.start_time, lr.faculty_id, lr.room, lr.section]
    );
    if (conflictRows.length > 0) {
      const c = conflictRows[0];
      await client.rollback();

      const [availRoomsRows] = await pool.query(
        `SELECT DISTINCT o.room
         FROM class_offerings o
         WHERE o.room IS NOT NULL AND o.is_active = TRUE
           AND o.room NOT IN (
             SELECT DISTINCT co.room
             FROM loading_requests lr2
             JOIN class_offerings co ON lr2.offering_id = co.id
             WHERE lr2.status = 'approved'
               AND lr2.term = ?
               AND (? IS NULL OR lr2.academic_year = ? OR (lr2.academic_year IS NULL AND ? IS NULL))
               AND co.day_of_week = ?
               AND co.start_time < ? AND ? < co.end_time
               AND co.room IS NOT NULL
           )
         ORDER BY o.room`,
        [lr.term, lr.academic_year || null, lr.academic_year || null, lr.academic_year || null, lr.day_of_week, lr.end_time, lr.start_time]
      );

      let availTimes = [];
      if (lr.room) {
        const [bookedRows] = await pool.query(
          `SELECT o.start_time, o.end_time
           FROM loading_requests lr2
           JOIN class_offerings o ON lr2.offering_id = o.id
           WHERE lr2.status = 'approved'
             AND lr2.term = ?
             AND (? IS NULL OR lr2.academic_year = ? OR (lr2.academic_year IS NULL AND ? IS NULL))
             AND o.day_of_week = ? AND o.room = ?
           ORDER BY o.start_time`,
          [lr.term, lr.academic_year || null, lr.academic_year || null, lr.academic_year || null, lr.day_of_week, lr.room]
        );
        availTimes = computeFreeWindows(bookedRows);
      }

      return res.status(409).json({
        error: `Schedule conflict (${c.dim}): "${c.subject_name}" on ${c.day_of_week} ${c.start_time}–${c.end_time} is already assigned.`,
        conflict: {
          type: c.dim,
          blocking_subject: c.subject_name,
          blocking_faculty: c.blocking_faculty,
          day: c.day_of_week,
          start_time: c.start_time,
          end_time: c.end_time,
          room: c.room || lr.room,
        },
        recommendations: {
          available_rooms: availRoomsRows.map(r => r.room),
          available_times: availTimes,
        },
      });
    }

    // Approve
    await client.query(
      `UPDATE loading_requests SET status='approved', reviewed_by=?, reviewed_at=NOW(), updated_at=NOW() WHERE id=?`,
      [req.user.id, lr.id]
    );

    // Mirror into faculty_schedules
    const facSchedId = uuidv4();
    await client.query(
      `INSERT INTO faculty_schedules (id, faculty_id, subject_code, subject_name, day_of_week, start_time, end_time, room, section, department, term, academic_year)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [facSchedId, lr.faculty_id, lr.subject_code || 'N/A', lr.subject_name, lr.day_of_week, lr.start_time, lr.end_time, lr.room, lr.section, lr.program, lr.term, lr.academic_year || null]
    );

    // Auto-reject competing pending requests for the same offering.
    const [losers] = await client.query(
      `SELECT faculty_id FROM loading_requests WHERE offering_id = ? AND status = 'pending' AND id <> ?`,
      [lr.offering_id, lr.id]
    );
    await client.query(
      `UPDATE loading_requests
         SET status='rejected', admin_remarks='Offering assigned to another faculty.', reviewed_by=?, reviewed_at=NOW(), updated_at=NOW()
       WHERE offering_id=? AND status='pending' AND id<>?`,
      [req.user.id, lr.offering_id, lr.id]
    );

    await client.commit();

    await safeNotify('loading-approved', () => notifyUser(pool, lr.faculty_id, {
      title: 'Loading request approved',
      message: `Your request for ${lr.subject_name} (${lr.day_of_week} ${lr.start_time}-${lr.end_time}) was approved.`,
      type: 'general', link: '/dashboard',
    }));
    for (const row of losers) {
      await safeNotify('loading-autoreject', () => notifyUser(pool, row.faculty_id, {
        title: 'Loading request not granted',
        message: `${lr.subject_name} was assigned to another faculty.`,
        type: 'general', link: '/dashboard',
      }));
    }

    res.json({ message: 'Request approved' });
  } catch (err) {
    try { await client.rollback(); } catch (_) {}
    if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062 || err.code === '23505') {
      return res.status(409).json({ error: 'This offering was just assigned to another faculty.' });
    }
    console.error('[Loading] approve error:', err);
    res.status(500).json({ error: 'Failed to approve request' });
  } finally {
    client.release();
  }
});

async function setReviewStatus(req, res, status, defaultMsg) {
  try {
    const adminRemarks = (req.body.admin_remarks || '').trim() || null;
    const [reqRows] = await pool.query(
      `SELECT lr.faculty_id, lr.term, co.subject_name
       FROM loading_requests lr
       JOIN class_offerings co ON lr.offering_id = co.id
       WHERE lr.id = ? AND lr.status IN ('pending', 'returned')`,
      [req.params.id]
    );
    if (reqRows.length === 0) return res.status(404).json({ error: 'Pending request not found' });
    const row = reqRows[0];

    await pool.query(
      `UPDATE loading_requests SET status = ?, admin_remarks = ?, reviewed_by = ?, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = ? AND status IN ('pending', 'returned')`,
      [status, adminRemarks, req.user.id, req.params.id]
    );

    await safeNotify(`loading-${status}`, () => notifyUser(pool, row.faculty_id, {
      title: defaultMsg,
      message: `${row.subject_name}${adminRemarks ? ` — ${adminRemarks}` : ''}`,
      type: 'general', link: '/dashboard',
    }));
    res.json({ message: defaultMsg });
  } catch (err) {
    console.error(`[Loading] ${status} error:`, err);
    res.status(500).json({ error: `Failed to ${status} request` });
  }
}

router.post('/admin/requests/:id/reject', authenticateToken, requireRole('admin'), MOD, (req, res) =>
  setReviewStatus(req, res, 'rejected', 'Loading request rejected'));

router.post('/admin/requests/:id/return', authenticateToken, requireRole('admin'), MOD, (req, res) =>
  setReviewStatus(req, res, 'returned', 'Loading request returned for revision'));

// ──────────────────────────────────────────────────────────────
//  ADMIN — RESCHEDULE AN APPROVED REQUEST
// ──────────────────────────────────────────────────────────────

router.patch('/admin/requests/:id/reschedule', authenticateToken, requireRole('admin'), MOD, async (req, res) => {
  const client = await pool.getConnection();
  try {
    const { day_of_week, start_time, end_time, room } = req.body;

    if (!VALID_DAYS.includes(day_of_week))
      return res.status(400).json({ error: 'Valid day_of_week is required' });
    if (!start_time || !end_time)
      return res.status(400).json({ error: 'Start and end time are required' });
    if (start_time >= end_time)
      return res.status(400).json({ error: 'Start time must be before end time' });

    await client.beginTransaction();

    const [reqRows] = await client.query(
      `SELECT r.id, r.faculty_id, r.offering_id, r.status, r.term,
              o.subject_name, o.section, o.program,
              o.day_of_week  AS old_day,
              o.start_time   AS old_start,
              o.end_time     AS old_end,
              o.room         AS old_room,
              CONCAT(u.first_name, ' ', u.last_name) AS faculty_name
       FROM loading_requests r
       JOIN class_offerings o ON r.offering_id = o.id
       JOIN users u ON r.faculty_id = u.id
       WHERE r.id = ? FOR UPDATE`,
      [req.params.id]
    );
    if (!reqRows.length) {
      await client.rollback();
      return res.status(404).json({ error: 'Request not found' });
    }
    const lr = reqRows[0];
    if (lr.status !== 'approved') {
      await client.rollback();
      return res.status(400).json({ error: 'Only approved requests can be rescheduled' });
    }

    const newRoom = (room || '').trim() || null;

    // 1. Offering-level: same room or section at new time
    const [offeringClash] = await client.query(
      `SELECT o.subject_name, o.room, o.section,
              o.start_time, o.end_time
       FROM class_offerings o
       WHERE o.is_active = TRUE AND o.term = ? AND o.day_of_week = ?
         AND o.start_time < ? AND ? < o.end_time
         AND o.id <> ?
         AND ( (o.room IS NOT NULL AND o.room = ?)
            OR (o.section IS NOT NULL AND o.section = ?) )
       LIMIT 1`,
      [lr.term, day_of_week, end_time, start_time, lr.offering_id, newRoom, lr.section]
    );
    if (offeringClash.length) {
      const c = offeringClash[0];
      await client.rollback();
      return res.status(409).json({
        error: clashMessage(c, { room: newRoom, section: lr.section }),
      });
    }

    // 2. Faculty double-booking at new time
    const [facultyClash] = await client.query(
      `SELECT o.subject_name, o.day_of_week,
              o.start_time, o.end_time
       FROM loading_requests lr2
       JOIN class_offerings o ON lr2.offering_id = o.id
       WHERE lr2.status = 'approved' AND lr2.id <> ?
         AND lr2.faculty_id = ?
         AND o.day_of_week = ?
         AND o.start_time < ? AND ? < o.end_time
       LIMIT 1`,
      [lr.id, lr.faculty_id, day_of_week, end_time, start_time]
    );
    if (facultyClash.length) {
      const c = facultyClash[0];
      await client.rollback();
      return res.status(409).json({
        error: `${lr.faculty_name} already has "${c.subject_name}" on ${c.day_of_week} ${c.start_time}–${c.end_time}. Choose a different day or time.`,
      });
    }

    // Update offering
    await client.query(
      `UPDATE class_offerings
         SET day_of_week = ?, start_time = ?, end_time = ?, room = ?
       WHERE id = ?`,
      [day_of_week, start_time, end_time, newRoom, lr.offering_id]
    );

    // Update faculty_schedules mirror
    await client.query(
      `UPDATE faculty_schedules
         SET day_of_week = ?, start_time = ?, end_time = ?, room = ?, updated_at = NOW()
       WHERE faculty_id = ?
         AND subject_name = ?
         AND day_of_week  = ?
         AND start_time   = ?
         AND end_time     = ?
         AND (term = ? OR term IS NULL)`,
      [day_of_week, start_time, end_time, newRoom,
       lr.faculty_id, lr.subject_name,
       lr.old_day, lr.old_start, lr.old_end, lr.term]
    );

    await client.commit();

    const fmt = t => { const [h, m] = String(t).split(':'); const n = +h; return `${n > 12 ? n-12 : n||12}:${m} ${n < 12 ? 'AM' : 'PM'}`; };
    await safeNotify('loading-rescheduled', () => notifyUser(pool, lr.faculty_id, {
      title: 'Your schedule was updated',
      message: `${lr.subject_name} has been moved to ${day_of_week} ${fmt(start_time)}–${fmt(end_time)}${newRoom ? ` in Room ${newRoom}` : ''}.`,
      type: 'general', link: '/dashboard',
    }));

    res.json({ message: 'Schedule updated successfully.' });
  } catch (err) {
    try { await client.rollback(); } catch (_) {}
    console.error('[Loading] reschedule error:', err);
    res.status(500).json({ error: 'Failed to reschedule' });
  } finally {
    client.release();
  }
});

// ──────────────────────────────────────────────────────────────
//  ADMIN — EXPORT (Stage 4)
// ──────────────────────────────────────────────────────────────

router.get('/admin/export', authenticateToken, requireRole('admin'), MOD, async (req, res) => {
  try {
    const term = String(req.query.term || '').trim();
    if (!isValidTerm(term)) return res.status(400).json({ error: 'Valid term is required' });
    const [rows] = await pool.query(
      `SELECT CONCAT(f.last_name, ', ', f.first_name) AS faculty, o.subject_code, o.subject_name,
              o.program, o.section, o.day_of_week, o.start_time AS start_time,
              o.end_time AS end_time, o.room
       FROM loading_requests r
       JOIN class_offerings o ON r.offering_id = o.id
       JOIN users f ON r.faculty_id = f.id
       WHERE r.term = ? AND r.status = 'approved'
       ORDER BY faculty ASC, o.day_of_week ASC, o.start_time ASC`,
      [term]
    );
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = 'Faculty,Subject Code,Subject,Program,Section,Day,Start,End,Room';
    const lines = rows.map(r =>
      [r.faculty, r.subject_code, r.subject_name, r.program, r.section, r.day_of_week, r.start_time, r.end_time, r.room].map(esc).join(','));
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="loading-${term}.csv"`);
    res.send([header, ...lines].join('\n'));
  } catch (err) {
    console.error('[Loading] export error:', err);
    res.status(500).json({ error: 'Failed to export' });
  }
});

module.exports = router;
