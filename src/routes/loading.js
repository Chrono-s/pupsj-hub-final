const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, requireRole, requirePermission } = require('../middleware/auth');
const { notifyUser, notifyAdmins, safeNotify } = require('../services/notifications');

const VALID_TERMS = ['SUMMER', 'FIRST_SEMESTER', 'SECOND_SEMESTER'];
const VALID_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const MOD = requirePermission('loading_requests'); // admin gate for this feature

function isValidTerm(t) { return VALID_TERMS.includes(t); }

// ──────────────────────────────────────────────────────────────
//  FACULTY ENDPOINTS
// ──────────────────────────────────────────────────────────────

// Available offerings for a term — excludes offerings already APPROVED to
// someone else, and offerings the faculty already has a pending/approved
// request for. Joined with course type/program so the client can build the
// cascading Term -> Type -> Program -> Subject dropdowns.
router.get('/offerings', authenticateToken, async (req, res) => {
  try {
    const term = String(req.query.term || '').trim();
    if (!isValidTerm(term)) return res.status(400).json({ error: 'Valid term is required' });

    const result = await pool.query(
      `SELECT o.id, o.term, o.subject_code, o.subject_name, o.program, o.section,
              o.day_of_week, o.start_time::TEXT, o.end_time::TEXT, o.room,
              c.subject_type
       FROM class_offerings o
       LEFT JOIN courses c ON o.course_id = c.id
       WHERE o.term = $1 AND o.is_active = TRUE
         AND NOT EXISTS (
           SELECT 1 FROM loading_requests r
           WHERE r.offering_id = o.id AND r.status = 'approved')
         AND NOT EXISTS (
           SELECT 1 FROM loading_requests r2
           WHERE r2.offering_id = o.id AND r2.faculty_id = $2
             AND r2.status IN ('pending', 'approved'))
       ORDER BY o.subject_name ASC, o.day_of_week ASC, o.start_time ASC`,
      [term, req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[Loading] offerings error:', err);
    res.status(500).json({ error: 'Failed to load offerings' });
  }
});

// Submit a loading request. Saved as 'pending'. Runs a SOFT conflict check and
// returns warnings (does not block — multiple faculty may request the same slot).
router.post('/requests', authenticateToken, requireRole('faculty'), async (req, res) => {
  try {
    const { offering_id, remarks } = req.body;
    if (!offering_id) return res.status(400).json({ error: 'offering_id is required' });

    const offRes = await pool.query(
      `SELECT * FROM class_offerings WHERE id = $1 AND is_active = TRUE`, [offering_id]
    );
    if (offRes.rows.length === 0) return res.status(404).json({ error: 'Offering not found' });
    const offering = offRes.rows[0];

    // Already taken?
    const taken = await pool.query(
      `SELECT 1 FROM loading_requests WHERE offering_id = $1 AND status = 'approved'`, [offering_id]
    );
    if (taken.rows.length > 0) {
      return res.status(409).json({ error: 'This subject offering has already been assigned to another faculty.' });
    }

    // Duplicate request by the same faculty?
    const dup = await pool.query(
      `SELECT 1 FROM loading_requests WHERE offering_id = $1 AND faculty_id = $2 AND status IN ('pending','approved')`,
      [offering_id, req.user.id]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: 'You already have a request for this offering.' });
    }

    // Soft warnings
    const warnings = [];
    const contention = await pool.query(
      `SELECT COUNT(*)::int AS n FROM loading_requests WHERE offering_id = $1 AND status = 'pending'`,
      [offering_id]
    );
    if (contention.rows[0].n > 0) {
      warnings.push(`${contention.rows[0].n} other faculty have also requested this offering.`);
    }
    const selfOverlap = await pool.query(
      `SELECT o.subject_name, o.day_of_week, o.start_time::TEXT, o.end_time::TEXT
       FROM loading_requests r JOIN class_offerings o ON r.offering_id = o.id
       WHERE r.faculty_id = $1 AND r.status IN ('pending','approved')
         AND o.day_of_week = $2 AND o.start_time < $3 AND $4 < o.end_time`,
      [req.user.id, offering.day_of_week, offering.end_time, offering.start_time]
    );
    if (selfOverlap.rows.length > 0) {
      const c = selfOverlap.rows[0];
      warnings.push(`This overlaps another slot you requested: ${c.subject_name} (${c.day_of_week} ${c.start_time}-${c.end_time}).`);
    }

    const ins = await pool.query(
      `INSERT INTO loading_requests (faculty_id, offering_id, term, remarks, status)
       VALUES ($1, $2, $3, $4, 'pending') RETURNING *`,
      [req.user.id, offering_id, offering.term, (remarks || '').trim() || null]
    );

    await safeNotify('loading-request-submitted', () => notifyAdmins(pool, {
      title: 'New loading request',
      message: `${req.user.first_name} ${req.user.last_name} requested ${offering.subject_name}.`,
      type: 'general',
      link: '/admin',
    }, [req.user.id]));

    res.status(201).json({ request: ins.rows[0], warnings });
  } catch (err) {
    console.error('[Loading] submit error:', err);
    res.status(500).json({ error: 'Failed to submit request' });
  }
});

// Faculty's own requests with offering details + status.
router.get('/requests/mine', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.term, r.status, r.remarks, r.admin_remarks, r.created_at, r.reviewed_at,
              o.subject_code, o.subject_name, o.program, o.section,
              o.day_of_week, o.start_time::TEXT, o.end_time::TEXT, o.room
       FROM loading_requests r
       JOIN class_offerings o ON r.offering_id = o.id
       WHERE r.faculty_id = $1
       ORDER BY r.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[Loading] mine error:', err);
    res.status(500).json({ error: 'Failed to load requests' });
  }
});

// Faculty withdraws their own pending request.
router.delete('/requests/:id', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM loading_requests WHERE id = $1 AND faculty_id = $2 AND status = 'pending' RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pending request not found' });
    }
    res.json({ message: 'Request withdrawn' });
  } catch (err) {
    console.error('[Loading] withdraw error:', err);
    res.status(500).json({ error: 'Failed to withdraw request' });
  }
});

// ──────────────────────────────────────────────────────────────
//  ADMIN — COURSE CATALOG (to build offerings)
// ──────────────────────────────────────────────────────────────

router.get('/admin/courses', authenticateToken, requireRole('admin'), MOD, async (req, res) => {
  try {
    const { type, program } = req.query;
    const params = [];
    let q = `SELECT id, subject_code, subject_name, subject_type, program
             FROM courses WHERE is_active = TRUE`;
    if (type) { params.push(type); q += ` AND subject_type = $${params.length}`; }
    if (program) { params.push(program); q += ` AND (program = $${params.length} OR program IS NULL)`; }
    q += ` ORDER BY subject_name ASC`;
    const result = await pool.query(q, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[Loading] courses error:', err);
    res.status(500).json({ error: 'Failed to load courses' });
  }
});

// ──────────────────────────────────────────────────────────────
//  ADMIN — OFFERINGS (Stage 0)
// ──────────────────────────────────────────────────────────────

// List offerings for a term, with who (if anyone) is approved on each.
router.get('/admin/offerings', authenticateToken, requireRole('admin'), MOD, async (req, res) => {
  try {
    const term = String(req.query.term || '').trim();
    if (!isValidTerm(term)) return res.status(400).json({ error: 'Valid term is required' });
    const result = await pool.query(
      `SELECT o.*, o.start_time::TEXT AS start_time, o.end_time::TEXT AS end_time,
              c.subject_type,
              af.first_name || ' ' || af.last_name AS approved_faculty,
              (SELECT COUNT(*)::int FROM loading_requests r
                 WHERE r.offering_id = o.id AND r.status = 'pending') AS pending_count
       FROM class_offerings o
       LEFT JOIN courses c ON o.course_id = c.id
       LEFT JOIN loading_requests ar ON ar.offering_id = o.id AND ar.status = 'approved'
       LEFT JOIN users af ON ar.faculty_id = af.id
       WHERE o.term = $1
       ORDER BY o.subject_name ASC, o.day_of_week ASC, o.start_time ASC`,
      [term]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[Loading] admin offerings error:', err);
    res.status(500).json({ error: 'Failed to load offerings' });
  }
});

function validateOfferingBody(b) {
  if (!isValidTerm(b.term)) return 'Valid term is required';
  if (!b.subject_name || !String(b.subject_name).trim()) return 'Subject is required';
  if (!VALID_DAYS.includes(b.day_of_week)) return 'Valid day_of_week is required';
  if (!b.start_time || !b.end_time) return 'Start and end time are required';
  if (b.start_time >= b.end_time) return 'Start time must be before end time';
  return null;
}

router.post('/admin/offerings', authenticateToken, requireRole('admin'), MOD, async (req, res) => {
  try {
    const b = req.body;
    const err = validateOfferingBody(b);
    if (err) return res.status(400).json({ error: err });

    // Resolve subject details from course_id if provided
    let { subject_code, subject_name, program, course_id } = b;
    if (course_id) {
      const c = await pool.query('SELECT subject_code, subject_name, program FROM courses WHERE id = $1', [course_id]);
      if (c.rows.length) {
        subject_code = subject_code || c.rows[0].subject_code;
        subject_name = subject_name || c.rows[0].subject_name;
        program = program || c.rows[0].program;
      }
    }

    const result = await pool.query(
      `INSERT INTO class_offerings
         (term, course_id, subject_code, subject_name, program, section, day_of_week, start_time, end_time, room, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [b.term, course_id || null, subject_code || null, String(subject_name).trim(),
       program || null, b.section || null, b.day_of_week, b.start_time, b.end_time, b.room || null, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[Loading] create offering error:', err);
    res.status(500).json({ error: 'Failed to create offering' });
  }
});

router.patch('/admin/offerings/:id', authenticateToken, requireRole('admin'), MOD, async (req, res) => {
  try {
    const b = req.body;
    const err = validateOfferingBody(b);
    if (err) return res.status(400).json({ error: err });
    const result = await pool.query(
      `UPDATE class_offerings SET
         subject_code=$1, subject_name=$2, program=$3, section=$4,
         day_of_week=$5, start_time=$6, end_time=$7, room=$8, is_active=$9
       WHERE id=$10 RETURNING *`,
      [b.subject_code || null, String(b.subject_name).trim(), b.program || null, b.section || null,
       b.day_of_week, b.start_time, b.end_time, b.room || null,
       b.is_active === undefined ? true : !!b.is_active, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Offering not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Loading] update offering error:', err);
    res.status(500).json({ error: 'Failed to update offering' });
  }
});

router.delete('/admin/offerings/:id', authenticateToken, requireRole('admin'), MOD, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM class_offerings WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Offering not found' });
    res.json({ message: 'Offering deleted' });
  } catch (err) {
    console.error('[Loading] delete offering error:', err);
    res.status(500).json({ error: 'Failed to delete offering' });
  }
});

// ──────────────────────────────────────────────────────────────
//  ADMIN — REVIEW (Stage 3)
// ──────────────────────────────────────────────────────────────

// All requests for a term, with faculty + offering details (frontend groups by offering).
router.get('/admin/requests', authenticateToken, requireRole('admin'), MOD, async (req, res) => {
  try {
    const { term, status } = req.query;
    const params = [];
    let q = `
      SELECT r.id, r.status, r.term, r.remarks, r.admin_remarks, r.created_at, r.reviewed_at,
             r.offering_id,
             f.id AS faculty_id, f.first_name || ' ' || f.last_name AS faculty_name,
             f.department AS faculty_department, f.position AS faculty_position,
             o.subject_code, o.subject_name, o.program, o.section,
             o.day_of_week, o.start_time::TEXT, o.end_time::TEXT, o.room
      FROM loading_requests r
      JOIN class_offerings o ON r.offering_id = o.id
      JOIN users f ON r.faculty_id = f.id
      WHERE 1=1`;
    if (term && isValidTerm(term)) { params.push(term); q += ` AND r.term = $${params.length}`; }
    if (status) { params.push(status); q += ` AND r.status = $${params.length}`; }
    q += ` ORDER BY o.subject_name ASC, r.created_at ASC`;
    const result = await pool.query(q, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[Loading] admin requests error:', err);
    res.status(500).json({ error: 'Failed to load requests' });
  }
});

// Approve — transactional. Runs HARD conflict checks (faculty/room/section
// overlap), enforces single-approval-per-offering, mirrors the load into
// faculty_schedules, auto-rejects competing pending requests, and notifies.
router.post('/admin/requests/:id/approve', authenticateToken, requireRole('admin'), MOD, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const reqRes = await client.query(
      `SELECT r.*, o.subject_code, o.subject_name, o.program, o.section,
              o.day_of_week, o.start_time::TEXT AS start_time, o.end_time::TEXT AS end_time, o.room
       FROM loading_requests r JOIN class_offerings o ON r.offering_id = o.id
       WHERE r.id = $1 FOR UPDATE OF r`,
      [req.params.id]
    );
    if (reqRes.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Request not found' }); }
    const lr = reqRes.rows[0];
    if (lr.status === 'approved') { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Already approved' }); }

    // Offering already taken by someone else?
    const taken = await client.query(
      `SELECT 1 FROM loading_requests WHERE offering_id = $1 AND status = 'approved' AND id <> $2`,
      [lr.offering_id, lr.id]
    );
    if (taken.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This offering is already assigned to another faculty.' });
    }

    // HARD conflict check: any approved offering overlapping in time on the same
    // faculty, room, or section.
    const conflict = await client.query(
      `SELECT o.subject_name, o.day_of_week, o.start_time::TEXT AS start_time, o.end_time::TEXT AS end_time,
              CASE WHEN r.faculty_id = $1 THEN 'faculty'
                   WHEN o.room = $5 AND o.room IS NOT NULL THEN 'room'
                   ELSE 'section' END AS dim
       FROM loading_requests r JOIN class_offerings o ON r.offering_id = o.id
       WHERE r.status = 'approved' AND r.id <> $6
         AND o.day_of_week = $2 AND o.start_time < $3 AND $4 < o.end_time
         AND ( r.faculty_id = $1
            OR (o.room = $5 AND o.room IS NOT NULL)
            OR (o.section = $7 AND o.section IS NOT NULL) )
       LIMIT 1`,
      [lr.faculty_id, lr.day_of_week, lr.end_time, lr.start_time, lr.room, lr.id, lr.section]
    );
    if (conflict.rows.length > 0) {
      const c = conflict.rows[0];
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Schedule conflict (${c.dim}): overlaps ${c.subject_name} on ${c.day_of_week} ${c.start_time}-${c.end_time}.`
      });
    }

    // Approve
    await client.query(
      `UPDATE loading_requests SET status='approved', reviewed_by=$1, reviewed_at=NOW(), updated_at=NOW() WHERE id=$2`,
      [req.user.id, lr.id]
    );

    // Mirror into faculty_schedules so it shows in the existing schedule views.
    await client.query(
      `INSERT INTO faculty_schedules (faculty_id, subject_code, subject_name, day_of_week, start_time, end_time, room, section, department)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [lr.faculty_id, lr.subject_code || 'N/A', lr.subject_name, lr.day_of_week, lr.start_time, lr.end_time, lr.room, lr.section, lr.program]
    );

    // Auto-reject competing pending requests for the same offering.
    const losers = await client.query(
      `UPDATE loading_requests
         SET status='rejected', admin_remarks='Offering assigned to another faculty.', reviewed_by=$1, reviewed_at=NOW(), updated_at=NOW()
       WHERE offering_id=$2 AND status='pending' AND id<>$3
       RETURNING faculty_id`,
      [req.user.id, lr.offering_id, lr.id]
    );

    await client.query('COMMIT');

    await safeNotify('loading-approved', () => notifyUser(pool, lr.faculty_id, {
      title: 'Loading request approved',
      message: `Your request for ${lr.subject_name} (${lr.day_of_week} ${lr.start_time}-${lr.end_time}) was approved.`,
      type: 'general', link: '/dashboard',
    }));
    for (const row of losers.rows) {
      await safeNotify('loading-autoreject', () => notifyUser(pool, row.faculty_id, {
        title: 'Loading request not granted',
        message: `${lr.subject_name} was assigned to another faculty.`,
        type: 'general', link: '/dashboard',
      }));
    }

    res.json({ message: 'Request approved' });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    if (err.code === '23505') { // unique_violation on uniq_approved_offering
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
    const result = await pool.query(
      `UPDATE loading_requests SET status=$1, admin_remarks=$2, reviewed_by=$3, reviewed_at=NOW(), updated_at=NOW()
       WHERE id=$4 AND status IN ('pending','returned') RETURNING faculty_id, term,
         (SELECT subject_name FROM class_offerings WHERE id = loading_requests.offering_id) AS subject_name`,
      [status, adminRemarks, req.user.id, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Pending request not found' });
    const row = result.rows[0];
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
//  ADMIN — EXPORT (Stage 4)
// ──────────────────────────────────────────────────────────────

router.get('/admin/export', authenticateToken, requireRole('admin'), MOD, async (req, res) => {
  try {
    const term = String(req.query.term || '').trim();
    if (!isValidTerm(term)) return res.status(400).json({ error: 'Valid term is required' });
    const result = await pool.query(
      `SELECT f.last_name || ', ' || f.first_name AS faculty, o.subject_code, o.subject_name,
              o.program, o.section, o.day_of_week, o.start_time::TEXT AS start_time,
              o.end_time::TEXT AS end_time, o.room
       FROM loading_requests r
       JOIN class_offerings o ON r.offering_id = o.id
       JOIN users f ON r.faculty_id = f.id
       WHERE r.term = $1 AND r.status = 'approved'
       ORDER BY faculty ASC, o.day_of_week ASC, o.start_time ASC`,
      [term]
    );
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = 'Faculty,Subject Code,Subject,Program,Section,Day,Start,End,Room';
    const lines = result.rows.map(r =>
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
