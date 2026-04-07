const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { uploadCsv } = require('../middleware/upload');

// ── CSV helpers (same logic as facultySchedules) ──
function parseCsvLine(line) {
  const out = []; let cur = ''; let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false; }
      else cur += ch;
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
  return DAY_ALIASES[String(raw).trim().toLowerCase()] || null;
}
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

// Get user's class schedules
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT cs.*,
              f.first_name || ' ' || f.last_name AS faculty_name
       FROM class_schedules cs
       LEFT JOIN users f ON cs.faculty_user_id = f.id
       WHERE cs.user_id = $1
       ORDER BY CASE cs.day_of_week
         WHEN 'Monday' THEN 1 WHEN 'Tuesday' THEN 2 WHEN 'Wednesday' THEN 3
         WHEN 'Thursday' THEN 4 WHEN 'Friday' THEN 5 WHEN 'Saturday' THEN 6
         WHEN 'Sunday' THEN 7 END, cs.start_time ASC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch schedules' });
  }
});

// Add a class
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { subject_code, subject_name, day_of_week, start_time, end_time, room, instructor, faculty_user_id } = req.body;
    const result = await pool.query(
      `INSERT INTO class_schedules (user_id, subject_code, subject_name, day_of_week, start_time, end_time, room, instructor, faculty_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [req.user.id, subject_code, subject_name, day_of_week, start_time, end_time, room, instructor, faculty_user_id || null]
    );
    res.status(201).json({ message: 'Schedule added', schedule: result.rows[0] });
  } catch (err) {
    console.error('Add schedule error:', err);
    res.status(500).json({ error: 'Failed to add schedule' });
  }
});

// Download CSV template
router.get('/template', authenticateToken, (req, res) => {
  const csv =
    'subject_code,subject_name,day_of_week,start_time,end_time,room,instructor\n' +
    'CS101,Introduction to Computing,Monday,08:00,10:00,Room 201,Prof. Cruz\n' +
    'MATH201,Discrete Math,Tuesday,1:00 PM,2:30 PM,Room 305,Prof. Reyes\n';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="class-schedule-template.csv"');
  res.send(csv);
});

// Upload CSV — replaces user's existing class schedule
router.post('/upload', authenticateToken, uploadCsv.single('file'), async (req, res) => {
  const client = await pool.connect();
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const rows = parseCsv(req.file.buffer.toString('utf8'));
    if (rows.length === 0) return res.status(400).json({ error: 'CSV is empty or missing a header row' });

    const required = ['subject_code', 'subject_name', 'day_of_week', 'start_time', 'end_time'];
    const missing = required.filter(h => !(h in rows[0]));
    if (missing.length) {
      return res.status(400).json({ error: `Missing required columns: ${missing.join(', ')}` });
    }

    // Try to resolve instructor names to faculty_user_id (best-effort)
    const instructorNames = [...new Set(rows.map(r => (r.instructor || '').trim()).filter(Boolean))];
    const nameToId = new Map();
    if (instructorNames.length) {
      const lookup = await client.query(
        `SELECT id, first_name, last_name FROM users WHERE role IN ('faculty','admin') AND is_active = TRUE`
      );
      lookup.rows.forEach(u => {
        const a = `${u.first_name} ${u.last_name}`.toLowerCase();
        const b = `${u.last_name}, ${u.first_name}`.toLowerCase();
        nameToId.set(a, u.id); nameToId.set(b, u.id);
      });
    }

    const valid = []; const errors = [];
    rows.forEach((r, idx) => {
      const line = idx + 2;
      const errs = [];
      const subject_code = (r.subject_code || '').trim();
      const subject_name = (r.subject_name || '').trim();
      const day = normalizeDay(r.day_of_week);
      const start = normalizeTime(r.start_time);
      const end = normalizeTime(r.end_time);
      const room = (r.room || '').trim() || null;
      const instructor = (r.instructor || '').trim() || null;
      if (!subject_code) errs.push('subject_code required');
      if (!subject_name) errs.push('subject_name required');
      if (!day) errs.push(`invalid day_of_week "${r.day_of_week}"`);
      if (!start) errs.push(`invalid start_time "${r.start_time}"`);
      if (!end) errs.push(`invalid end_time "${r.end_time}"`);
      if (start && end && start >= end) errs.push('start_time must be before end_time');
      if (errs.length) errors.push({ line, errors: errs });
      else {
        const facultyUserId = instructor ? (nameToId.get(instructor.toLowerCase()) || null) : null;
        valid.push({ subject_code, subject_name, day, start, end, room, instructor, facultyUserId });
      }
    });

    if (valid.length === 0) {
      return res.status(400).json({ error: 'No valid rows found', errors, inserted: 0 });
    }

    await client.query('BEGIN');
    await client.query('DELETE FROM class_schedules WHERE user_id = $1', [req.user.id]);
    for (const v of valid) {
      await client.query(
        `INSERT INTO class_schedules (user_id, subject_code, subject_name, day_of_week, start_time, end_time, room, instructor, faculty_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [req.user.id, v.subject_code, v.subject_name, v.day, v.start, v.end, v.room, v.instructor, v.facultyUserId]
      );
    }
    await client.query('COMMIT');

    res.json({
      message: `Uploaded ${valid.length} class${valid.length === 1 ? '' : 'es'}${errors.length ? ` (${errors.length} skipped)` : ''}`,
      inserted: valid.length, skipped: errors.length, errors,
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Upload class schedule CSV error:', err);
    res.status(500).json({ error: 'Failed to upload schedule' });
  } finally {
    client.release();
  }
});

// Delete a class
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM class_schedules WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ message: 'Schedule deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete schedule' });
  }
});

module.exports = router;
