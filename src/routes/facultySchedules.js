const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { uploadCsv } = require('../middleware/upload');
const VALID_YEAR_LEVELS = ['1st', '2nd', '3rd', '4th'];

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

function normalizeYearLevel(raw) {
  const year = String(raw || '').trim();
  return VALID_YEAR_LEVELS.includes(year) ? year : null;
}

// ── PUP official schedule format helpers ─────────────────────
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

// Maps PUP day abbreviations → full names
// SUN/TH must come before T/S to avoid prefix collisions in regex
const PUP_DAY_MAP = {
  'SUN': 'Sunday',
  'TH':  'Thursday',
  'MON': 'Monday',  'M': 'Monday',
  'TUE': 'Tuesday', 'T': 'Tuesday',
  'WED': 'Wednesday', 'W': 'Wednesday',
  'FRI': 'Friday',  'F': 'Friday',
  'SAT': 'Saturday', 'S': 'Saturday',
};

// Parses "W 07:30AM-12:30PM" or "TH 07:30AM-12:30PM" → { day, start, end }
function parseScheduleString(raw) {
  if (!raw || !raw.trim()) return null;
  const m = String(raw).trim().match(
    /^(SUN|MON|TUE|WED|THU|FRI|SAT|TH|M|T|W|F|S)\s+(\d{1,2}:\d{2}\s*(?:AM|PM))-(\d{1,2}:\d{2}\s*(?:AM|PM))$/i
  );
  if (!m) return null;
  const day   = PUP_DAY_MAP[m[1].toUpperCase()];
  const start = parseAmPmTime(m[2]);
  const end   = parseAmPmTime(m[3]);
  if (!day || !start || !end) return null;
  return { day, start, end };
}

// Returns true when the CSV looks like a PUP official schedule export
function isPupFormat(headers) {
  return headers.includes('schedule') && headers.includes('description');
}

// Download a CSV template (generic format — PUP official export also works directly)
router.get('/template', authenticateToken, requireRole('faculty', 'admin'), (req, res) => {
  const isAdmin = req.user.role === 'admin';
  let csv = 'subject_code,subject_name,day_of_week,start_time,end_time,room,section,year_level';
  if (isAdmin) {
    csv += ',faculty_email,faculty_name';
  }
  csv += '\n';
  
  if (isAdmin) {
    csv += 'COMP003,Computer Programming 2,Wednesday,07:30 AM,12:30 PM,SJ-COMLAB2,BSIT-SJ 1-1,1st,prof1@gmail.com,"PAGALILAWAN, ALFRED M."\n' +
           'COMP004,Discrete Structures 1,Tuesday,01:30 PM,04:30 PM,SJ-MB202,BSIT-SJ 1-1,1st,prof2@gmail.com,"SAGUINDAN, IAN JOSEPH"\n';
  } else {
    csv += 'COMP003,Computer Programming 2,Wednesday,07:30 AM,12:30 PM,SJ-COMLAB2,BSIT-SJ 1-1,1st\n' +
           'COMP004,Discrete Structures 1,Tuesday,01:30 PM,04:30 PM,SJ-MB202,BSIT-SJ 1-1,1st\n';
  }
  
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="teaching-schedule-template.csv"');
  res.send(csv);

});

// Upload CSV — replaces the faculty's existing schedule (or admin can replace for a specific faculty)
// Supports both PUP official format and generic format
router.post('/upload', authenticateToken, requireRole('faculty', 'admin'), uploadCsv.single('file'), async (req, res) => {
  const client = await pool.connect();
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const uploadDept = (req.body.department || '').trim() || null;
    const uploadYearLevel = normalizeYearLevel(req.body.year_level);
    if (!uploadYearLevel) {
      return res.status(400).json({ error: 'Valid year_level is required' });
    }

    const text = req.file.buffer.toString('utf8');
    const rows = parseCsv(text);
    if (rows.length === 0) {
      return res.status(400).json({ error: 'CSV is empty or missing a header row' });
    }

    const headers = Object.keys(rows[0]);
    const pup = isPupFormat(headers);
    const isAdmin = req.user.role === 'admin';

    if (!pup) {
      // ── Generic format: require explicit columns ──
      const required = ['subject_code', 'subject_name', 'day_of_week', 'start_time', 'end_time'];
      const missing = required.filter(h => !(h in rows[0]));
      if (missing.length) {
        return res.status(400).json({
          error: `Unrecognized CSV format. Use the PUP official teaching schedule export, or a CSV with columns: ${required.join(', ')}` +
                 (isAdmin ? ' (and optional: room, section, faculty_email)' : ' (and optional: room, section)')
        });
      }
    }

    // Resolve batch faculty lookup (email or name)
    const facultyLookup = new Map();
    if (isAdmin) {
      // Fetch all active faculty/admin users for lookup
      const lookup = await client.query(
        `SELECT id, LOWER(email) AS email, LOWER(first_name) AS first_name, LOWER(last_name) AS last_name FROM users WHERE role IN ('faculty','admin') AND is_active = TRUE`
      );
      lookup.rows.forEach(u => {
        if (u.email) facultyLookup.set('email:' + u.email, u.id);
        facultyLookup.set('name_rev:' + u.last_name + ', ' + u.first_name, u.id);
        facultyLookup.set('name_fwd:' + u.first_name + ' ' + u.last_name, u.id);
      });
    }

    const valid = [];
    const errors = [];

    rows.forEach((r, idx) => {
      const line = idx + 2;
      const errs = [];

      if (pup) {
        // ── PUP official format ──────────────────────────────
        const subject_code = (r.subject_code || '').trim();
        const subject_name = (r.description || '').trim();

        // Skip TOTAL rows and blank rows
        if (subject_code.toUpperCase() === 'TOTAL' || !subject_code) return;

        const room     = (r['room_no.'] || r.room_no || '').trim() || null;
        const section  = (r.section || '').trim() || null;
        const yearLevel = normalizeYearLevel(r.year_level) || uploadYearLevel;
        const schedRaw = (r.schedule || '').trim();

        if (!subject_code) errs.push('Subject Code is empty');
        if (!subject_name) errs.push('Description is empty');

        const parsed = parseScheduleString(schedRaw);
        if (!parsed) {
          errs.push(`Cannot parse Schedule "${schedRaw}" — expected format: W 07:30AM-12:30PM`);
        }

        if (errs.length) {
          errors.push({ line, subject: subject_code, errors: errs });
        } else {
          const { day, start, end } = parsed;
          // Faculty targeting: Admin can specify professor, otherwise defaults to self
          let targetFaculty = req.user.id;
          const professorName = (r.professor || '').trim().toLowerCase();
          if (isAdmin && professorName) {
            // Try matching "LAST, FIRST" or "FIRST LAST"
            targetFaculty = facultyLookup.get('name_rev:' + professorName) || 
                            facultyLookup.get('name_fwd:' + professorName) || 
                            null;
            
            if (!targetFaculty) {
               // Try matching by checking if the professor string starts with the last name (since PUP often adds middle initials)
               const lastName = professorName.split(',')[0].trim();
               for (const [key, id] of facultyLookup) {
                 if (key.startsWith('name_rev:' + lastName + ',')) {
                   targetFaculty = id; break;
                 }
               }
            }

            if (!targetFaculty) {
              errs.push(`Professor "${r.professor}" account not found. Make sure they are registered.`);
            }
          }

          if (errs.length) {
            errors.push({ line, subject: subject_code, errors: errs });
          } else {
            valid.push({ targetFaculty, subject_code, subject_name, day, start, end, room, section, year_level: yearLevel, department: uploadDept });
          }
        }

      } else {
        // ── Generic format ───────────────────────────────────
        const subject_code = (r.subject_code || '').trim();
        const subject_name = (r.subject_name || '').trim();
        const day          = normalizeDay(r.day_of_week);
        const start        = normalizeTime(r.start_time);
        const end          = normalizeTime(r.end_time);
        const room         = (r.room || '').trim() || null;
        const section      = (r.section || '').trim() || null;
        const yearLevel    = normalizeYearLevel(r.year_level) || uploadYearLevel;

        if (!subject_code) errs.push('subject_code required');
        if (!subject_name) errs.push('subject_name required');
        if (!day)          errs.push(`invalid day_of_week "${r.day_of_week}"`);
        if (!start)        errs.push(`invalid start_time "${r.start_time}"`);
        if (!end)          errs.push(`invalid end_time "${r.end_time}"`);
        if (start && end && start >= end) errs.push('start_time must be before end_time');
        if (!yearLevel)    errs.push('year_level required (1st/2nd/3rd/4th)');

        // Admin may target another faculty via faculty_email or faculty_name
        let targetFaculty = req.user.id;
        if (isAdmin) {
          const emailKey = (r.faculty_email || '').trim().toLowerCase();
          const nameKey = (r.faculty_name || '').trim().toLowerCase();
          
          if (emailKey && facultyLookup.has('email:' + emailKey)) {
            targetFaculty = facultyLookup.get('email:' + emailKey);
          } else if (nameKey) {
            targetFaculty = facultyLookup.get('name_rev:' + nameKey) || 
                            facultyLookup.get('name_fwd:' + nameKey) || 
                            null;
            
            if (!targetFaculty) {
              errs.push(`Faculty "${nameKey}" not found`);
            }
          } else if (emailKey) {
            errs.push(`Faculty email "${emailKey}" not found`);
          }
        }

        if (errs.length) {
          errors.push({ line, errors: errs });
        } else {
          valid.push({ targetFaculty, subject_code, subject_name, day, start, end, room, section, year_level: yearLevel, department: uploadDept });
        }
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
        `INSERT INTO faculty_schedules (faculty_id, subject_code, subject_name, day_of_week, start_time, end_time, room, section, department, year_level)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [v.targetFaculty, v.subject_code, v.subject_name, v.day, v.start, v.end, v.room, v.section, v.department, v.year_level]
      );
    }
    await client.query('COMMIT');

    const formatLabel = pup ? 'PUP schedule format' : 'standard format';
    res.json({
      message: `Uploaded ${valid.length} class${valid.length === 1 ? '' : 'es'} (${formatLabel})${errors.length ? ` — ${errors.length} row(s) skipped` : ''}`,
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

// Get teaching schedule — faculty sees their own, admin can view any via ?faculty_id, filter by ?department
router.get('/', authenticateToken, requireRole('faculty', 'admin'), async (req, res) => {
  try {
    const facultyId = (req.user.role === 'admin' && req.query.faculty_id) ? req.query.faculty_id : req.user.id;
    
    // Fetch target faculty name to match against unlinked class_schedules
    const targetUser = await pool.query('SELECT first_name, last_name FROM users WHERE id = $1', [facultyId]);
    if (targetUser.rows.length === 0) return res.status(404).json({ error: 'Faculty not found' });
    const { first_name, last_name } = targetUser.rows[0];
    
    let subquery = `
      SELECT id, faculty_id, subject_code, subject_name, day_of_week, start_time, end_time, room, section, department, year_level, FALSE as from_class_schedule
      FROM faculty_schedules 
      WHERE faculty_id = $1
      
      UNION ALL
      
      SELECT id, $1::uuid as faculty_id, subject_code, subject_name, day_of_week, start_time, end_time, room, section, department, year_level, TRUE as from_class_schedule
      FROM class_schedules
      WHERE faculty_user_id = $1 
         OR (
           instructor IS NOT NULL 
           AND instructor ILIKE '%' || $2 || '%' 
           AND instructor ILIKE '%' || $3 || '%'
         )
    `;

    let query = `SELECT fs.*, u.first_name || ' ' || u.last_name as faculty_name
       FROM (${subquery}) fs
       LEFT JOIN users u ON fs.faculty_id = u.id
       WHERE 1=1`;
    const params = [facultyId, last_name, first_name];

    if (req.query.department && req.query.department !== 'All') {
      params.push(req.query.department);
      query += ` AND fs.department = $${params.length}`;
    }
    const yearLevel = normalizeYearLevel(req.query.year_level);
    if (yearLevel) {
      params.push(yearLevel);
      query += ` AND fs.year_level = $${params.length}`;
    }

    query += ` ORDER BY CASE fs.day_of_week
         WHEN 'Monday' THEN 1 WHEN 'Tuesday' THEN 2 WHEN 'Wednesday' THEN 3
         WHEN 'Thursday' THEN 4 WHEN 'Friday' THEN 5 WHEN 'Saturday' THEN 6
         WHEN 'Sunday' THEN 7 END, fs.start_time ASC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get faculty schedules error:', err);
    res.status(500).json({ error: 'Failed to fetch teaching schedule' });
  }
});

// Add a teaching class
router.post('/', authenticateToken, requireRole('faculty', 'admin'), async (req, res) => {
  try {
    const { subject_code, subject_name, day_of_week, start_time, end_time, room, section, department, faculty_id } = req.body;
    const year_level = normalizeYearLevel(req.body.year_level);
    if (!subject_code || !subject_name || !day_of_week || !start_time || !end_time || !department || !year_level) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    // Admin can assign to any faculty via faculty_id; faculty can only add their own
    const targetFaculty = (req.user.role === 'admin' && faculty_id) ? faculty_id : req.user.id;

    const result = await pool.query(
      `INSERT INTO faculty_schedules (faculty_id, subject_code, subject_name, day_of_week, start_time, end_time, room, section, department, year_level)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [targetFaculty, subject_code, subject_name, day_of_week, start_time, end_time, room || null, section || null, department || null, year_level]
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
    const { subject_code, subject_name, day_of_week, start_time, end_time, room, section, department, faculty_id } = req.body;
    const year_level = normalizeYearLevel(req.body.year_level);
    if (!subject_code || !subject_name || !day_of_week || !start_time || !end_time || !department || !year_level) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const targetFaculty = (req.user.role === 'admin' && faculty_id) ? faculty_id : check.rows[0].faculty_id;
    const result = await pool.query(
      `UPDATE faculty_schedules
         SET subject_code = $1, subject_name = $2, day_of_week = $3,
             start_time = $4, end_time = $5, room = $6, section = $7, department = $8, year_level = $9, faculty_id = $10, updated_at = NOW()
       WHERE id = $11 RETURNING *`,
      [subject_code, subject_name, day_of_week, start_time, end_time, room || null, section || null, department || null, year_level, targetFaculty, id]
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
