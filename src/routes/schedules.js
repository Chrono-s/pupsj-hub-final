const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { uploadCsv } = require('../middleware/upload');
const VALID_YEAR_LEVELS = ['1st', '2nd', '3rd', '4th'];
const VALID_SECTIONS = ['1-1','1-2','1-3','2-1','2-2','2-3','3-1','3-2','3-3','4-1','4-2','4-3'];

function normalizeSection(raw) {
  const val = String(raw || '').trim();
  if (!val) return null;
  if (VALID_SECTIONS.includes(val)) return val;
  const compact = val.replace(/\s+/g, '');
  const match = compact.match(/([1-4])[-_]?([1-3])/);
  if (match) {
    const normalized = `${match[1]}-${match[2]}`;
    if (VALID_SECTIONS.includes(normalized)) return normalized;
  }
  return val;
}

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

function normalizeYearLevel(raw) {
  const year = String(raw || '').trim();
  return VALID_YEAR_LEVELS.includes(year) ? year : null;
}

// ── PUP Schedule format helpers ──────────────────────────────
// Parses times like "07:30AM" or "01:30PM"
function parseAmPmTime(raw) {
  if (!raw) return null;
  const m = String(raw).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let hours = parseInt(m[1], 10);
  const mins = parseInt(m[2], 10);
  const period = m[3].toUpperCase();
  if (isNaN(hours) || isNaN(mins) || mins > 59) return null;
  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00`;
}

// Parses PUP schedule strings like "W 07:30AM-12:30PM" or "TH 07:30AM-12:30PM"
// Returns { day, start, end } or null
const PUP_DAY_MAP = {
  'SUN': 'Sunday',
  'TH':  'Thursday',
  'MON': 'Monday', 'M': 'Monday',
  'TUE': 'Tuesday', 'T': 'Tuesday',
  'WED': 'Wednesday', 'W': 'Wednesday',
  'FRI': 'Friday', 'F': 'Friday',
  'SAT': 'Saturday', 'S': 'Saturday',
};
function parseScheduleString(raw) {
  if (!raw || !raw.trim()) return null;
  // Match: DAY TIME-TIME  e.g. "W 07:30AM-12:30PM" or "TH 07:30AM-12:30PM"
  const m = String(raw).trim().match(
    /^(SUN|MON|TUE|WED|THU|FRI|SAT|TH|M|T|W|F|S)\s+(\d{1,2}:\d{2}\s*(?:AM|PM))-(\d{1,2}:\d{2}\s*(?:AM|PM))$/i
  );
  if (!m) return null;
  const day = PUP_DAY_MAP[m[1].toUpperCase()];
  const start = parseAmPmTime(m[2]);
  const end   = parseAmPmTime(m[3]);
  if (!day || !start || !end) return null;
  return { day, start, end };
}

// Detect if a parsed CSV is in PUP official format
// (has 'schedule' column with combined day+time)
function isPupFormat(headers) {
  return headers.includes('schedule') && headers.includes('description');
}

// Get class schedules
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { department: filterDept, section: filterSect } = req.query;
    const filterYear = normalizeYearLevel(req.query.year_level);

    if (req.user.role === 'student') {
      try {
        const userId = req.user.id;
        const userRes = await pool.query('SELECT department, year_level, section FROM users WHERE id = $1', [userId]);
        const dbUser = userRes.rows[0] || {};
        
        const searchDept = (dbUser.department || req.user.department || '').trim();
        const searchYear = (dbUser.year_level || req.user.year_level || '').trim();
        const searchSect = (dbUser.section || req.user.section || '').trim();

        const query = `
          SELECT * FROM (
            SELECT 
              cs.id::TEXT, cs.subject_code::TEXT, TRIM(cs.subject_name)::TEXT AS subject_name, TRIM(cs.day_of_week)::TEXT AS day_of_week,
              cs.start_time::TEXT, cs.end_time::TEXT, TRIM(cs.room)::TEXT AS room,
              COALESCE(u.first_name || ' ' || u.last_name, cs.instructor)::TEXT AS instructor,
              TRIM(cs.department)::TEXT AS department, TRIM(cs.section)::TEXT AS section, TRIM(cs.year_level)::TEXT AS year_level, cs.created_at,
              (COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, ''))::TEXT AS faculty_name,
              cs.faculty_user_id::TEXT,
              FALSE AS from_faculty_schedule
            FROM class_schedules cs
            LEFT JOIN users u ON cs.faculty_user_id = u.id

            UNION ALL

            SELECT 
              fs.id::TEXT, fs.subject_code::TEXT, TRIM(fs.subject_name)::TEXT AS subject_name, TRIM(fs.day_of_week)::TEXT AS day_of_week,
              fs.start_time::TEXT, fs.end_time::TEXT, TRIM(fs.room)::TEXT AS room,
              COALESCE(f.first_name || ' ' || f.last_name, '')::TEXT AS instructor,
              TRIM(fs.department)::TEXT AS department, TRIM(fs.section)::TEXT AS section, TRIM(fs.year_level)::TEXT AS year_level, fs.created_at,
              (COALESCE(f.first_name, '') || ' ' || COALESCE(f.last_name, ''))::TEXT AS faculty_name,
              fs.faculty_id::TEXT AS faculty_user_id,
              TRUE AS from_faculty_schedule
            FROM faculty_schedules fs
            LEFT JOIN users f ON fs.faculty_id = f.id
          ) AS all_schedules
          WHERE 
            (LOWER(TRIM(department)) = LOWER(TRIM($1)) OR LOWER(TRIM(department)) = 'general')
            AND (
              ($2 = '' OR LOWER(TRIM(year_level)) LIKE LOWER(TRIM($2)) || '%' OR year_level IS NULL OR year_level = '')
              AND
              ($3 = '' OR REPLACE(LOWER(TRIM(section)), '-', '') = REPLACE(LOWER(TRIM($3)), '-', '') OR section IS NULL OR section = '')
            )
          ORDER BY 
            CASE day_of_week
              WHEN 'Monday' THEN 1 WHEN 'Tuesday' THEN 2 WHEN 'Wednesday' THEN 3
              WHEN 'Thursday' THEN 4 WHEN 'Friday' THEN 5 WHEN 'Saturday' THEN 6
              WHEN 'Sunday' THEN 7 
            END, 
            start_time ASC`;

        const result = await pool.query(query, [searchDept, searchYear, searchSect]);
        return res.json(result.rows);
      } catch (innerErr) {
        console.error('[Schedules] Student Error:', innerErr);
        return res.status(500).json({ error: 'Internal server error' });
      }
    }

    // Admin/Faculty path
    let query = `
      SELECT cs.*, f.first_name || ' ' || f.last_name AS faculty_name
      FROM class_schedules cs
      LEFT JOIN users f ON cs.faculty_user_id = f.id
      WHERE 1=1`;
    const params = [];

    if (filterDept && filterDept !== 'All') {
      params.push(filterDept);
      query += ` AND cs.department = $${params.length}`;
    }
    if (filterSect) {
      params.push(filterSect);
      query += ` AND cs.section = $${params.length}`;
    }
    if (filterYear) {
      params.push(filterYear);
      query += ` AND cs.year_level = $${params.length}`;
    }

    query += ` ORDER BY CASE cs.day_of_week
         WHEN 'Monday' THEN 1 WHEN 'Tuesday' THEN 2 WHEN 'Wednesday' THEN 3
         WHEN 'Thursday' THEN 4 WHEN 'Friday' THEN 5 WHEN 'Saturday' THEN 6
         WHEN 'Sunday' THEN 7 END, cs.start_time ASC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[Schedules] Error:', err);
    res.status(500).json({ error: 'Failed' });
  }
});



// ══════════════════════════════════════════════════════════════
//  GOOGLE SHEETS → JSON PROXY
//  Fetches the public CSV export of a Google Sheet server-side
//  so students never need a Google account to view schedules.
// ══════════════════════════════════════════════════════════════

router.get('/fetch-sheet', authenticateToken, async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url query param required' });

  // Extract sheet ID from any Google Sheets URL variant
  const idMatch = url.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!idMatch) {
    return res.status(400).json({ error: 'Not a valid Google Sheets URL' });
  }
  const sheetId = idMatch[1];
  const gidMatch = url.match(/[#&?]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : '0';

  // Use the export endpoint — works for any sheet shared as "Anyone with link can view"
  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;

  try {
    const response = await fetch(csvUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      redirect: 'follow',
    });

    if (!response.ok) {
      return res.status(400).json({
        error: 'Could not fetch the sheet. Make sure it is shared with "Anyone with the link can view".',
      });
    }

    const csvText = await response.text();

    // Basic check: if Google returned an HTML login page instead of CSV
    if (csvText.trimStart().startsWith('<!')) {
      return res.status(400).json({
        error: 'Sheet requires sign-in. Share it with "Anyone with the link can view" first.',
      });
    }

    const rows = parseCsv(csvText);
    if (rows.length === 0) {
      return res.status(400).json({ error: 'Sheet appears to be empty.' });
    }

    res.json({ rows, sheetId, gid });
  } catch (err) {
    console.error('[fetch-sheet] error:', err);
    res.status(500).json({ error: 'Failed to fetch sheet data: ' + err.message });
  }
});

// ══════════════════════════════════════════════════════════════
//  SECTION SCHEDULE EMBEDS
//  Faculty/Admin post an embed URL for a Dept + Year + Section.
//  Students whose profile matches see the embedded schedule.
// ══════════════════════════════════════════════════════════════

// GET /api/schedules/embeds
router.get('/embeds', authenticateToken, async (req, res) => {
  try {
    if (req.user.role === 'student') {
      const userRes = await pool.query(
        'SELECT department, year_level, section FROM users WHERE id = $1',
        [req.user.id]
      );
      const u = userRes.rows[0] || {};
      const dept    = (u.department  || '').trim();
      const year    = (u.year_level  || '').trim();
      const section = (u.section     || '').trim();

      if (!dept || !year || !section) {
        return res.json([]);
      }

      const result = await pool.query(
        `SELECT se.*, u.first_name || ' ' || u.last_name AS posted_by_name
         FROM section_schedule_embeds se
         LEFT JOIN users u ON se.posted_by = u.id
         WHERE LOWER(TRIM(se.department)) = LOWER($1)
           AND LOWER(TRIM(se.year_level)) = LOWER($2)
           AND REPLACE(LOWER(TRIM(se.section)), '-', '') = REPLACE(LOWER($3), '-', '')
         ORDER BY se.created_at DESC`,
        [dept, year, section]
      );
      return res.json(result.rows);
    }

    // Faculty / Admin — return filtered list
    const { department, year_level, section } = req.query;
    const params = [];
    let query = `
      SELECT se.*, u.first_name || ' ' || u.last_name AS posted_by_name
      FROM section_schedule_embeds se
      LEFT JOIN users u ON se.posted_by = u.id
      WHERE 1=1`;

    // Faculty can only see their own postings
    if (req.user.role === 'faculty') {
      params.push(req.user.id);
      query += ` AND se.posted_by = $${params.length}`;
    }
    if (department && department !== 'All') {
      params.push(department);
      query += ` AND se.department = $${params.length}`;
    }
    if (year_level) {
      params.push(year_level);
      query += ` AND se.year_level = $${params.length}`;
    }
    if (section) {
      params.push(section);
      query += ` AND se.section = $${params.length}`;
    }
    query += ' ORDER BY se.department, se.year_level, se.section, se.created_at DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[Embeds] GET error:', err);
    res.status(500).json({ error: 'Failed to load schedule embeds' });
  }
});

// POST /api/schedules/embeds
router.post('/embeds', authenticateToken, requireRole('faculty', 'admin'), async (req, res) => {
  try {
    const { department, title, embed_url } = req.body;
    const year_level = normalizeYearLevel(req.body.year_level);
    const section    = normalizeSection(req.body.section);

    if (!department || !year_level || !section || !embed_url) {
      return res.status(400).json({ error: 'Department, year level, section and embed URL are required.' });
    }

    const result = await pool.query(
      `INSERT INTO section_schedule_embeds (department, year_level, section, title, embed_url, posted_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [department, year_level, section, title || null, embed_url.trim(), req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[Embeds] POST error:', err);
    res.status(500).json({ error: 'Failed to post schedule embed' });
  }
});

// PATCH /api/schedules/embeds/:id
router.patch('/embeds/:id', authenticateToken, requireRole('faculty', 'admin'), async (req, res) => {
  try {
    const check = await pool.query(
      'SELECT posted_by FROM section_schedule_embeds WHERE id = $1', [req.params.id]
    );
    if (check.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (req.user.role !== 'admin' && check.rows[0].posted_by !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const { department, title, embed_url } = req.body;
    const year_level = normalizeYearLevel(req.body.year_level);
    const section    = normalizeSection(req.body.section);

    if (!department || !year_level || !section || !embed_url) {
      return res.status(400).json({ error: 'Department, year level, section and embed URL are required.' });
    }

    const result = await pool.query(
      `UPDATE section_schedule_embeds
          SET department = $1, year_level = $2, section = $3, title = $4, embed_url = $5, updated_at = NOW()
        WHERE id = $6 RETURNING *`,
      [department, year_level, section, title || null, embed_url.trim(), req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Embeds] PATCH error:', err);
    res.status(500).json({ error: 'Failed to update schedule embed' });
  }
});

// DELETE /api/schedules/embeds/:id
router.delete('/embeds/:id', authenticateToken, requireRole('faculty', 'admin'), async (req, res) => {
  try {
    const check = await pool.query(
      'SELECT posted_by FROM section_schedule_embeds WHERE id = $1', [req.params.id]
    );
    if (check.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (req.user.role !== 'admin' && check.rows[0].posted_by !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    await pool.query('DELETE FROM section_schedule_embeds WHERE id = $1', [req.params.id]);
    res.json({ message: 'Schedule embed deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete schedule embed' });
  }
});

// ══════════════════════════════════════════════════════════════

// Add a class (faculty/admin only — students view schedules posted by faculty/admin)
router.post('/', authenticateToken, requireRole('faculty', 'admin'), async (req, res) => {
  try {
    const { subject_code, subject_name, day_of_week, start_time, end_time, room, instructor, faculty_user_id, department } = req.body;
    const section = normalizeSection(req.body.section);
    const year_level = normalizeYearLevel(req.body.year_level);
    if (!subject_code || !subject_name || !day_of_week || !start_time || !end_time || !department || !year_level || !instructor) {
      return res.status(400).json({ error: 'Missing required fields including instructor' });
    }
    const result = await pool.query(
      `INSERT INTO class_schedules (user_id, subject_code, subject_name, day_of_week, start_time, end_time, room, instructor, faculty_user_id, department, section, year_level)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [req.user.id, subject_code, subject_name, day_of_week, start_time, end_time, room || null, instructor || null, faculty_user_id || null, department || null, section || null, year_level]
    );
    res.status(201).json({ message: 'Schedule added', schedule: result.rows[0] });
  } catch (err) {
    console.error('Add schedule error:', err);
    res.status(500).json({ error: 'Failed to add schedule' });
  }
});

// Download CSV template
router.get('/template', authenticateToken, (req, res) => {
  // Generic format template (the PUP official export also works directly)
  const csv =
    'subject_code,subject_name,day_of_week,start_time,end_time,room,instructor,year_level,section\n' +
    'COMP003,Computer Programming 2,Wednesday,07:30 AM,12:30 PM,SJ-COMLAB2,"PAGALILAWAN, ALFRED M.",1st,BSIT 1-1\n' +
    'COMP004,Discrete Structures 1,Tuesday,01:30 PM,04:30 PM,SJ-MB202,"SAGUINDAN, IAN JOSEPH",1st,BSIT 1-1\n';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="class-schedule-template.csv"');
  res.send(csv);
});

// Upload CSV (faculty/admin only)
router.post('/upload', authenticateToken, requireRole('faculty', 'admin'), uploadCsv.single('file'), async (req, res) => {
  const client = await pool.connect();
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const uploadDept = (req.body.department || '').trim() || null;
    const uploadSection = (req.body.section || '').trim() || null;
    const uploadYearLevel = normalizeYearLevel(req.body.year_level);
    if (!uploadYearLevel) {
      return res.status(400).json({ error: 'Valid year_level is required' });
    }
    const rows = parseCsv(req.file.buffer.toString('utf8'));
    if (rows.length === 0) return res.status(400).json({ error: 'CSV is empty or missing a header row' });

    const headers = Object.keys(rows[0]);
    const pup = isPupFormat(headers);

    if (!pup) {
      // ── Generic format: requires explicit columns ──
      const required = ['subject_code', 'subject_name', 'day_of_week', 'start_time', 'end_time'];
      const missing = required.filter(h => !(h in rows[0]));
      if (missing.length) {
        return res.status(400).json({
          error: `Unrecognized CSV format. Use the PUP official class schedule export, or a CSV with columns: ${required.join(', ')}`
        });
      }
    }

    // Try to resolve instructor names to faculty_user_id (best-effort)
    const instructorKey = pup ? 'professor' : 'instructor';
    const instructorNames = [...new Set(rows.map(r => (r[instructorKey] || '').trim()).filter(Boolean))];
    const nameToId = new Map();
    if (instructorNames.length) {
      const lookup = await client.query(
        `SELECT id, first_name, last_name FROM users WHERE role IN ('faculty','admin') AND is_active = TRUE`
      );
      lookup.rows.forEach(u => {
        // Match "First Last" and "LAST, FIRST" formats (PUP uses "LASTNAME, FIRSTNAME M.")
        const fullFwd = `${u.first_name} ${u.last_name}`.toLowerCase();
        const fullRev = `${u.last_name}, ${u.first_name}`.toLowerCase();
        nameToId.set(fullFwd, u.id);
        nameToId.set(fullRev, u.id);
      });
    }

    const valid = []; const errors = [];

    rows.forEach((r, idx) => {
      const line = idx + 2;
      const errs = [];

      if (pup) {
        // ── PUP official format ──────────────────────────────
        const subject_code = (r.subject_code || '').trim();
        const subject_name = (r.description || '').trim();

        // Skip TOTAL rows and blank rows
        if (subject_code.toUpperCase() === 'TOTAL' || !subject_code) return;

        const room       = (r['room_no.'] || r.room_no || '').trim() || null;
        const instructor = (r.professor || '').trim() || null;
        const schedRaw   = (r.schedule || '').trim();

        if (!subject_code) errs.push('Subject Code is empty');
        if (!subject_name) errs.push('Description is empty');
        if (!instructor) errs.push('Professor/Instructor is empty');

        const parsed = parseScheduleString(schedRaw);
        if (!parsed) {
          errs.push(`Cannot parse Schedule "${schedRaw}" — expected format: W 07:30AM-12:30PM`);
        }

        if (errs.length) {
          errors.push({ line, subject: subject_code, errors: errs });
        } else {
          const { day, start, end } = parsed;
          // Match instructor by "LASTNAME, FIRSTNAME" style
          const instructorLower = instructor ? instructor.toLowerCase() : '';
          // Try exact match first, then partial last-name match
          let facultyUserId = nameToId.get(instructorLower) || null;
          if (!facultyUserId && instructor) {
            // Try matching just the last name portion (before the comma)
            const lastName = instructor.split(',')[0].trim().toLowerCase();
            for (const [key, id] of nameToId) {
              if (key.startsWith(lastName + ',') || key.endsWith(' ' + lastName)) {
                facultyUserId = id; break;
              }
            }
          }
          const section = normalizeSection((r.section || '').trim() || uploadSection);
          const yearLevel = normalizeYearLevel(r.year_level) || uploadYearLevel;
          if (!yearLevel) {
            errors.push({ line, subject: subject_code, errors: ['year_level required (1st/2nd/3rd/4th)'] });
            return;
          }
          valid.push({ subject_code, subject_name, day, start, end, room, instructor, facultyUserId, department: uploadDept, section, year_level: yearLevel });
        }

      } else {
        // ── Generic format ───────────────────────────────────
        const subject_code = (r.subject_code || '').trim();
        const subject_name = (r.subject_name || '').trim();
        const day          = normalizeDay(r.day_of_week);
        const start        = normalizeTime(r.start_time);
        const end          = normalizeTime(r.end_time);
        const room         = (r.room || '').trim() || null;
        const instructor   = (r.instructor || '').trim() || null;
        const csvSection   = normalizeSection((r.section || '').trim() || uploadSection);
        const yearLevel    = normalizeYearLevel(r.year_level) || uploadYearLevel;

        if (!subject_code) errs.push('subject_code is empty');
        if (!subject_name) errs.push('subject_name is empty');
        if (!day) errs.push('day_of_week is required (e.g. Monday-Sunday)');
        if (!start) errs.push('start_time is required');
        if (!end) errs.push('end_time is required');
        if (!instructor) errs.push('instructor is required');
        if (start && end && start >= end) errs.push('start_time must be before end_time');
        if (!yearLevel) errs.push('year_level required (1st/2nd/3rd/4th)');

        if (errs.length) {
          errors.push({ line, errors: errs });
        } else {
          const facultyUserId = instructor ? (nameToId.get(instructor.toLowerCase()) || null) : null;
          valid.push({ subject_code, subject_name, day, start, end, room, instructor, facultyUserId, department: uploadDept, section: csvSection, year_level: yearLevel });
        }
      }
    });

    if (valid.length === 0) {
      return res.status(400).json({ error: 'No valid rows found', errors, inserted: 0 });
    }

    await client.query('BEGIN');
    await client.query('DELETE FROM class_schedules WHERE user_id = $1 AND department = $2', [req.user.id, uploadDept]);
    for (const v of valid) {
      await client.query(
        `INSERT INTO class_schedules (user_id, subject_code, subject_name, day_of_week, start_time, end_time, room, instructor, faculty_user_id, department, section, year_level)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [req.user.id, v.subject_code, v.subject_name, v.day, v.start, v.end, v.room, v.instructor, v.facultyUserId, v.department, v.section, v.year_level]
      );
    }
    await client.query('COMMIT');

    const formatLabel = pup ? 'PUP schedule format' : 'standard format';
    res.json({
      message: `Uploaded ${valid.length} class${valid.length === 1 ? '' : 'es'} (${formatLabel})${errors.length ? ` — ${errors.length} row(s) skipped` : ''}`,
      inserted: valid.length,
      skipped: errors.length,
      errors,
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Upload class schedule CSV error:', err);
    res.status(500).json({ error: 'Failed to upload schedule' });
  } finally {
    client.release();
  }
});

// Update a class (faculty/admin only)
router.patch('/:id', authenticateToken, requireRole('faculty', 'admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { subject_code, subject_name, day_of_week, start_time, end_time, room, instructor, faculty_user_id, department } = req.body;
    const section = normalizeSection(req.body.section);
    const year_level = normalizeYearLevel(req.body.year_level);
    if (!subject_code || !subject_name || !day_of_week || !start_time || !end_time || !department || !year_level || !instructor) {
      return res.status(400).json({ error: 'Missing required fields including instructor' });
    }
    const check = await pool.query('SELECT user_id FROM class_schedules WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Class not found' });
    if (check.rows[0].user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Not authorized' });

    const result = await pool.query(
      `UPDATE class_schedules SET subject_code=$1, subject_name=$2, day_of_week=$3,
              start_time=$4, end_time=$5, room=$6, instructor=$7, faculty_user_id=$8,
              department=$9, section=$10, year_level=$11
       WHERE id=$12 RETURNING *`,
      [subject_code, subject_name, day_of_week, start_time, end_time, room || null, instructor || null, faculty_user_id || null, department || null, section || null, year_level, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update schedule error:', err);
    res.status(500).json({ error: 'Failed to update class' });
  }
});

// Delete a class (faculty/admin only)
router.delete('/:id', authenticateToken, requireRole('faculty', 'admin'), async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      await pool.query('DELETE FROM class_schedules WHERE id = $1', [req.params.id]);
    } else {
      await pool.query('DELETE FROM class_schedules WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    }
    res.json({ message: 'Schedule deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete schedule' });
  }
});

module.exports = router;
