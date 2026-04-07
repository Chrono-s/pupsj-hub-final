const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { uploadCsv } = require('../middleware/upload');

// ──────────────────────────────────────────────
//  CSV parsing helpers (zero-dependency)
// ──────────────────────────────────────────────

// Parse a single CSV line, handling quoted fields with embedded commas/quotes
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else {
      if (ch === ',') { out.push(cur); cur = ''; }
      else if (ch === '"') inQuotes = true;
      else cur += ch;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function parseCsv(text) {
  // Strip UTF-8 BOM + normalize line endings
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = clean.split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().replace(/[\s-]/g, '_'));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = fields[idx] ?? ''; });
    rows.push(obj);
  }
  return rows;
}

const DAY_ALIASES = {
  mon: 'Monday', monday: 'Monday',
  tue: 'Tuesday', tues: 'Tuesday', tuesday: 'Tuesday',
  wed: 'Wednesday', weds: 'Wednesday', wednesday: 'Wednesday',
  thu: 'Thursday', thur: 'Thursday', thurs: 'Thursday', thursday: 'Thursday',
  fri: 'Friday', friday: 'Friday',
  sat: 'Saturday', saturday: 'Saturday',
  sun: 'Sunday', sunday: 'Sunday',
};

function normalizeDay(raw) {
  if (!raw) return null;
  const key = String(raw).trim().toLowerCase();
  return DAY_ALIASES[key] || null;
}

// Accept "8:00", "08:00", "8:00 AM", "1:30 PM", "13:30"
function normalizeTime(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toUpperCase();
  const m = s.match(/^(\d{1,2}):?(\d{2})?\s*(AM|PM)?$/);
  if (!m) return null;
  let hours = parseInt(m[1], 10);
  const mins = m[2] ? parseInt(m[2], 10) : 0;
  const period = m[3];
  if (isNaN(hours) || isNaN(mins) || mins > 59 || hours > 23) return null;
  if (period) {
    if (hours < 1 || hours > 12) return null;
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
  }
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00`;
}

// Download a CSV template
router.get('/template', authenticateToken, requireRole('faculty', 'admin'), (req, res) => {
  const csv =
    'subject_code,subject_name,day_of_week,start_time,end_time,room,section\n' +
    'CS101,Introduction to Computing,Monday,08:00,10:00,Room 201,BSIT-1A\n' +
    'CS101,Introduction to Computing,Wednesday,08:00,10:00,Room 201,BSIT-1A\n' +
    'MATH201,Discrete Mathematics,Tuesday,1:00 PM,2:30 PM,Room 305,BSIT-2B\n';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="teaching-schedule-template.csv"');
  res.send(csv);
});

// Upload CSV — replaces the faculty's existing schedule (or admin can replace for a specific faculty)
router.post('/upload', authenticateToken, requireRole('faculty', 'admin'), uploadCsv.single('file'), async (req, res) => {
  const client = await pool.connect();
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const text = req.file.buffer.toString('utf8');
    const rows = parseCsv(text);
    if (rows.length === 0) {
      return res.status(400).json({ error: 'CSV is empty or missing a header row' });
    }

    // Required headers
    const required = ['subject_code', 'subject_name', 'day_of_week', 'start_time', 'end_time'];
    const missingHeaders = required.filter(h => !(h in rows[0]));
    if (missingHeaders.length) {
      return res.status(400).json({
        error: `Missing required columns: ${missingHeaders.join(', ')}. Expected: ${required.join(', ')} (and optional: room, section${req.user.role === 'admin' ? ', faculty_email' : ''})`
      });
    }

    // Resolve admin-uploaded faculty_email → faculty_id lookup cache
    const isAdmin = req.user.role === 'admin';
    const emailToId = new Map();
    if (isAdmin && 'faculty_email' in rows[0]) {
      const emails = [...new Set(rows.map(r => (r.faculty_email || '').trim().toLowerCase()).filter(Boolean))];
      if (emails.length) {
        const lookup = await client.query(
          `SELECT id, LOWER(email) AS email FROM users WHERE LOWER(email) = ANY($1) AND role IN ('faculty','admin')`,
          [emails]
        );
        lookup.rows.forEach(r => emailToId.set(r.email, r.id));
      }
    }

    // Validate rows
    const valid = [];
    const errors = [];
    rows.forEach((r, idx) => {
      const line = idx + 2; // +1 for header, +1 for 1-based
      const rowErrors = [];

      const subject_code = (r.subject_code || '').trim();
      const subject_name = (r.subject_name || '').trim();
      const day = normalizeDay(r.day_of_week);
      const start = normalizeTime(r.start_time);
      const end = normalizeTime(r.end_time);
      const room = (r.room || '').trim() || null;
      const section = (r.section || '').trim() || null;

      if (!subject_code) rowErrors.push('subject_code required');
      if (!subject_name) rowErrors.push('subject_name required');
      if (!day) rowErrors.push(`invalid day_of_week "${r.day_of_week}"`);
      if (!start) rowErrors.push(`invalid start_time "${r.start_time}"`);
      if (!end) rowErrors.push(`invalid end_time "${r.end_time}"`);
      if (start && end && start >= end) rowErrors.push('start_time must be before end_time');

      // Figure out target faculty
      let targetFaculty = req.user.id;
      if (isAdmin && 'faculty_email' in r && (r.faculty_email || '').trim()) {
        const key = r.faculty_email.trim().toLowerCase();
        if (emailToId.has(key)) {
          targetFaculty = emailToId.get(key);
        } else {
          rowErrors.push(`faculty_email "${r.faculty_email}" not found`);
        }
      }

      if (rowErrors.length) {
        errors.push({ line, errors: rowErrors });
      } else {
        valid.push({ targetFaculty, subject_code, subject_name, day, start, end, room, section });
      }
    });

    if (valid.length === 0) {
      return res.status(400).json({ error: 'No valid rows found', errors, inserted: 0 });
    }

    // Replace existing entries for the affected faculty (transactional)
    const affectedFaculty = [...new Set(valid.map(v => v.targetFaculty))];
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM faculty_schedules WHERE faculty_id = ANY($1)`,
      [affectedFaculty]
    );
    for (const v of valid) {
      await client.query(
        `INSERT INTO faculty_schedules (faculty_id, subject_code, subject_name, day_of_week, start_time, end_time, room, section)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [v.targetFaculty, v.subject_code, v.subject_name, v.day, v.start, v.end, v.room, v.section]
      );
    }
    await client.query('COMMIT');

    res.json({
      message: `Uploaded ${valid.length} class${valid.length === 1 ? '' : 'es'}${errors.length ? ` (${errors.length} row${errors.length === 1 ? '' : 's'} skipped)` : ''}`,
      inserted: valid.length,
      skipped: errors.length,
      affected_faculty: affectedFaculty.length,
      errors,
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Upload faculty schedule CSV error:', err);
    res.status(500).json({ error: 'Failed to upload schedule' });
  } finally {
    client.release();
  }
});

// Get teaching schedule — faculty sees their own, admin can view any via ?faculty_id
router.get('/', authenticateToken, requireRole('faculty', 'admin'), async (req, res) => {
  try {
    const facultyId = (req.user.role === 'admin' && req.query.faculty_id) ? req.query.faculty_id : req.user.id;
    const result = await pool.query(
      `SELECT fs.*, u.first_name || ' ' || u.last_name as faculty_name
       FROM faculty_schedules fs
       LEFT JOIN users u ON fs.faculty_id = u.id
       WHERE fs.faculty_id = $1
       ORDER BY CASE fs.day_of_week
         WHEN 'Monday' THEN 1 WHEN 'Tuesday' THEN 2 WHEN 'Wednesday' THEN 3
         WHEN 'Thursday' THEN 4 WHEN 'Friday' THEN 5 WHEN 'Saturday' THEN 6
         WHEN 'Sunday' THEN 7 END, fs.start_time ASC`,
      [facultyId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get faculty schedules error:', err);
    res.status(500).json({ error: 'Failed to fetch teaching schedule' });
  }
});

// Add a teaching class
router.post('/', authenticateToken, requireRole('faculty', 'admin'), async (req, res) => {
  try {
    const { subject_code, subject_name, day_of_week, start_time, end_time, room, section, faculty_id } = req.body;
    if (!subject_code || !subject_name || !day_of_week || !start_time || !end_time) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    // Admin can assign to any faculty via faculty_id; faculty can only add their own
    const targetFaculty = (req.user.role === 'admin' && faculty_id) ? faculty_id : req.user.id;

    const result = await pool.query(
      `INSERT INTO faculty_schedules (faculty_id, subject_code, subject_name, day_of_week, start_time, end_time, room, section)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [targetFaculty, subject_code, subject_name, day_of_week, start_time, end_time, room || null, section || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Add faculty schedule error:', err);
    res.status(500).json({ error: 'Failed to add teaching class' });
  }
});

// Update a teaching class
router.patch('/:id', authenticateToken, requireRole('faculty', 'admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const check = await pool.query('SELECT faculty_id FROM faculty_schedules WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (req.user.role !== 'admin' && check.rows[0].faculty_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const { subject_code, subject_name, day_of_week, start_time, end_time, room, section } = req.body;
    const result = await pool.query(
      `UPDATE faculty_schedules
         SET subject_code = $1, subject_name = $2, day_of_week = $3,
             start_time = $4, end_time = $5, room = $6, section = $7, updated_at = NOW()
       WHERE id = $8 RETURNING *`,
      [subject_code, subject_name, day_of_week, start_time, end_time, room || null, section || null, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update faculty schedule error:', err);
    res.status(500).json({ error: 'Failed to update teaching class' });
  }
});

// Delete a teaching class
router.delete('/:id', authenticateToken, requireRole('faculty', 'admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const check = await pool.query('SELECT faculty_id FROM faculty_schedules WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (req.user.role !== 'admin' && check.rows[0].faculty_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    await pool.query('DELETE FROM faculty_schedules WHERE id = $1', [id]);
    res.json({ message: 'Teaching class deleted' });
  } catch (err) {
    console.error('Delete faculty schedule error:', err);
    res.status(500).json({ error: 'Failed to delete teaching class' });
  }
});

module.exports = router;
