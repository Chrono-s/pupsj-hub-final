const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { uploadCsv } = require('../middleware/upload');
const { parseCsv, normalizeDay, normalizeTime, parseAmPmTime, normalizeSection, normalizeYearLevel } = require('../utils/csv');

const PUP_DAY_MAP = {
  SUN: 'Sunday', TH: 'Thursday', MON: 'Monday', M: 'Monday',
  TUE: 'Tuesday', T: 'Tuesday', WED: 'Wednesday', W: 'Wednesday',
  FRI: 'Friday', F: 'Friday', SAT: 'Saturday', S: 'Saturday',
};

function parseScheduleString(raw) {
  if (!raw || !raw.trim()) return null;
  const m = String(raw).trim().match(
    /^(SUN|MON|TUE|WED|THU|FRI|SAT|TH|M|T|W|F|S)\s+(\d{1,2}:\d{2}\s*(?:AM|PM))-(\d{1,2}:\d{2}\s*(?:AM|PM))$/i
  );
  if (!m) return null;
  const day = PUP_DAY_MAP[m[1].toUpperCase()];
  const start = parseAmPmTime(m[2]);
  const end = parseAmPmTime(m[3]);
  if (!day || !start || !end) return null;
  return { day, start, end };
}

function isPupFormat(headers) {
  return headers.includes('schedule') && headers.includes('description');
}

// ── GET /api/schedules/embeds ───────────────────────────────────────────────
router.get('/embeds', authenticateToken, async (req, res) => {
  try {
    const { department: filterDept, section: filterSect } = req.query;
    const filterYear = normalizeYearLevel(req.query.year_level);
    let schedules = [];

    if (req.user.role === 'student') {
      const [userRes] = await pool.query('SELECT department, year_level, section FROM users WHERE id = ?', [req.user.id]);
      const dbUser = (userRes && userRes[0]) || {};
      const searchDept = (dbUser.department || req.user.department || '').trim();
      const searchYear = (dbUser.year_level || req.user.year_level || '').trim();
      const searchSect = (dbUser.section || req.user.section || '').trim();

      const query = `
        SELECT * FROM (
          SELECT cs.id, cs.subject_code, TRIM(cs.subject_name) AS subject_name, TRIM(cs.day_of_week) AS day_of_week,
                 cs.start_time, cs.end_time, TRIM(cs.room) AS room,
                 COALESCE(CONCAT(u.first_name, ' ', u.last_name), cs.instructor) AS instructor,
                 TRIM(cs.department) AS department, TRIM(cs.section) AS section, TRIM(cs.year_level) AS year_level, cs.created_at,
                 TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS faculty_name,
                 cs.faculty_user_id, FALSE AS from_faculty_schedule
          FROM class_schedules cs
          LEFT JOIN users u ON cs.faculty_user_id = u.id
          UNION ALL
          SELECT fs.id, fs.subject_code, TRIM(fs.subject_name) AS subject_name, TRIM(fs.day_of_week) AS day_of_week,
                 fs.start_time, fs.end_time, TRIM(fs.room) AS room,
                 COALESCE(CONCAT(f.first_name, ' ', f.last_name), '') AS instructor,
                 TRIM(fs.department) AS department, TRIM(fs.section) AS section, TRIM(fs.year_level) AS year_level, fs.created_at,
                 TRIM(CONCAT(COALESCE(f.first_name, ''), ' ', COALESCE(f.last_name, ''))) AS faculty_name,
                 fs.faculty_id AS faculty_user_id, TRUE AS from_faculty_schedule
          FROM faculty_schedules fs
          LEFT JOIN users f ON fs.faculty_id = f.id
        ) AS all_schedules
        WHERE (LOWER(TRIM(department)) = LOWER(TRIM(?)) OR LOWER(TRIM(department)) = 'general')
          AND (? = '' OR LOWER(TRIM(year_level)) LIKE CONCAT(LOWER(TRIM(?)), '%') OR year_level IS NULL OR year_level = '')
          AND (? = '' OR REPLACE(LOWER(TRIM(section)), '-', '') = REPLACE(LOWER(TRIM(?)), '-', '') OR section IS NULL OR section = '')
        ORDER BY CASE day_of_week WHEN 'Monday' THEN 1 WHEN 'Tuesday' THEN 2 WHEN 'Wednesday' THEN 3 WHEN 'Thursday' THEN 4 WHEN 'Friday' THEN 5 WHEN 'Saturday' THEN 6 WHEN 'Sunday' THEN 7 END, start_time ASC`;
      const [rows] = await pool.query(query, [searchDept, searchYear, searchYear, searchSect, searchSect]);
      schedules = rows || [];
    } else {
      let query = `
        SELECT cs.*, CONCAT(f.first_name, ' ', f.last_name) AS faculty_name
        FROM class_schedules cs
        LEFT JOIN users f ON cs.faculty_user_id = f.id
        WHERE 1=1`;
      const params = [];
      if (req.user.role === 'faculty') {
        params.push(req.user.id);
        query += ` AND cs.faculty_user_id = ?`;
      } else if (filterDept && filterDept !== 'All') {
        params.push(filterDept);
        query += ` AND cs.department = ?`;
      }
      if (filterSect && req.user.role !== 'faculty') {
        params.push(filterSect);
        query += ` AND cs.section = ?`;
      }
      if (filterYear && req.user.role !== 'faculty') {
        params.push(filterYear);
        query += ` AND cs.year_level = ?`;
      }
      query += ` ORDER BY CASE cs.day_of_week WHEN 'Monday' THEN 1 WHEN 'Tuesday' THEN 2 WHEN 'Wednesday' THEN 3 WHEN 'Thursday' THEN 4 WHEN 'Friday' THEN 5 WHEN 'Saturday' THEN 6 WHEN 'Sunday' THEN 7 END, cs.start_time ASC`;
      const [rows] = await pool.query(query, params);
      schedules = rows || [];
    }

    let embedsQuery = `
      SELECT ss.*, CONCAT(u.first_name, ' ', u.last_name) AS posted_by_name,
             CONCAT(f.first_name, ' ', f.last_name) AS faculty_name
      FROM section_schedule_embeds ss
      LEFT JOIN users u ON ss.posted_by = u.id
      LEFT JOIN users f ON ss.faculty_id = f.id
      WHERE ss.is_active = TRUE`;
    const embedsParams = [];

    if (req.user.role === 'student') {
      const [userRes] = await pool.query('SELECT department, year_level, section FROM users WHERE id = ?', [req.user.id]);
      const u = (userRes && userRes[0]) || {};
      const sDept = (u.department || '').trim();
      const sYear = (u.year_level || '').trim();
      const sSect = (u.section || '').trim();
      embedsParams.push(sDept, sYear, sYear, sSect, sSect);
      embedsQuery += ` AND ss.target_type = 'section' 
                       AND (LOWER(TRIM(ss.department)) = LOWER(TRIM(?)) OR ss.department IS NULL OR ss.department = '')
                       AND (? = '' OR LOWER(TRIM(ss.year_level)) LIKE CONCAT(LOWER(TRIM(?)), '%') OR ss.year_level IS NULL OR ss.year_level = '')
                       AND (? = '' OR REPLACE(LOWER(TRIM(ss.section)), '-', '') = REPLACE(LOWER(TRIM(?)), '-', '') OR ss.section IS NULL OR ss.section = '')`;
    } else if (req.user.role === 'faculty') {
      embedsParams.push(req.user.id);
      embedsQuery += ` AND ss.target_type = 'faculty' AND ss.faculty_id = ?`;
    }

    embedsQuery += ` ORDER BY ss.created_at DESC`;
    const [embedsRows] = await pool.query(embedsQuery, embedsParams);
    res.json({ schedules, embeds: embedsRows || [] });
  } catch (err) {
    console.error('[Schedules] Embeds Error:', err);
    res.status(500).json({ error: 'Failed' });
  }
});

// ── POST /api/schedules/embeds ──────────────────────────────────────────────
router.post('/embeds', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') return res.status(403).json({ error: 'Access denied' });
  try {
    const { title, department, year_level, section, embed_url, target_type, faculty_id } = req.body;
    if (!title || !embed_url) return res.status(400).json({ error: 'Title and URL are required' });

    const newId = uuidv4();
    await pool.query(
      `INSERT INTO section_schedule_embeds (id, title, department, year_level, section, embed_url, target_type, faculty_id, posted_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId, title, target_type === 'faculty' ? null : department, target_type === 'faculty' ? null : year_level, target_type === 'faculty' ? null : section, embed_url, target_type || 'section', target_type === 'faculty' ? faculty_id : null, req.user.id]
    );
    const [createdRows] = await pool.query('SELECT * FROM section_schedule_embeds WHERE id = ?', [newId]);
    res.status(201).json(createdRows[0]);
  } catch (err) {
    console.error('[Schedules] Create Embed Error:', err);
    res.status(500).json({ error: 'Failed to create embed' });
  }
});

// ── PATCH /api/schedules/embeds/:id ─────────────────────────────────────────
router.patch('/embeds/:id', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') return res.status(403).json({ error: 'Access denied' });
  try {
    const { title, department, year_level, section, embed_url, target_type, faculty_id } = req.body;
    await pool.query(
      `UPDATE section_schedule_embeds
       SET title = ?, department = ?, year_level = ?, section = ?, embed_url = ?, target_type = ?, faculty_id = ?, updated_at = NOW()
       WHERE id = ?`,
      [title, target_type === 'faculty' ? null : department, target_type === 'faculty' ? null : year_level, target_type === 'faculty' ? null : section, embed_url, target_type || 'section', target_type === 'faculty' ? faculty_id : null, req.params.id]
    );
    const [updatedRows] = await pool.query('SELECT * FROM section_schedule_embeds WHERE id = ?', [req.params.id]);
    if (!updatedRows?.length) return res.status(404).json({ error: 'Embed not found' });
    res.json(updatedRows[0]);
  } catch (err) {
    console.error('[Schedules] Update Embed Error:', err);
    res.status(500).json({ error: 'Failed to update embed' });
  }
});

// ── DELETE /api/schedules/embeds/:id ────────────────────────────────────────
router.delete('/embeds/:id', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') return res.status(403).json({ error: 'Access denied' });
  try {
    const [result] = await pool.query('DELETE FROM section_schedule_embeds WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Embed not found' });
    res.json({ message: 'Embed deleted' });
  } catch (err) {
    console.error('[Schedules] Delete Embed Error:', err);
    res.status(500).json({ error: 'Failed to delete embed' });
  }
});

// ── PATCH /api/schedules/embeds/:id/toggle ──────────────────────────────────
router.patch('/embeds/:id/toggle', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') return res.status(403).json({ error: 'Access denied' });
  try {
    const [checkRows] = await pool.query('SELECT is_active FROM section_schedule_embeds WHERE id = ?', [req.params.id]);
    if (!checkRows?.length) return res.status(404).json({ error: 'Embed not found' });
    const newActive = !checkRows[0].is_active;
    await pool.query('UPDATE section_schedule_embeds SET is_active = ?, updated_at = NOW() WHERE id = ?', [newActive, req.params.id]);
    const [updatedRows] = await pool.query('SELECT * FROM section_schedule_embeds WHERE id = ?', [req.params.id]);
    res.json(updatedRows[0]);
  } catch (err) {
    console.error('[Schedules] Toggle Embed Error:', err);
    res.status(500).json({ error: 'Failed to toggle embed' });
  }
});

// ── GET /api/schedules/fetch-sheet ──────────────────────────────────────────
router.get('/fetch-sheet', authenticateToken, async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    let fetchUrl = url;
    if (url.includes('docs.google.com/spreadsheets')) {
      const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
      if (match) fetchUrl = `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=csv`;
    }

    const response = await fetch(fetchUrl);
    if (!response.ok) throw new Error('Failed to fetch external sheet');
    const csvData = await response.text();
    const rows = parseCsv(csvData);
    res.json({ rows });
  } catch (err) {
    console.error('[Schedules] Fetch Sheet Error:', err);
    res.status(500).json({ error: 'Failed to parse sheet' });
  }
});

// ── GET /api/schedules ──────────────────────────────────────────────────────
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { department: filterDept, section: filterSect } = req.query;
    const filterYear = normalizeYearLevel(req.query.year_level);

    if (req.user.role === 'student') {
      const [userRes] = await pool.query('SELECT department, year_level, section FROM users WHERE id = ?', [req.user.id]);
      const dbUser = (userRes && userRes[0]) || {};
      const searchDept = (dbUser.department || req.user.department || '').trim();
      const searchYear = (dbUser.year_level || req.user.year_level || '').trim();
      const searchSect = (dbUser.section || req.user.section || '').trim();

      const query = `
        SELECT * FROM (
          SELECT cs.id, cs.subject_code, TRIM(cs.subject_name) AS subject_name, TRIM(cs.day_of_week) AS day_of_week,
            cs.start_time, cs.end_time, TRIM(cs.room) AS room,
            COALESCE(CONCAT(u.first_name, ' ', u.last_name), cs.instructor) AS instructor,
            TRIM(cs.department) AS department, TRIM(cs.section) AS section, TRIM(cs.year_level) AS year_level, cs.created_at,
            TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS faculty_name,
            cs.faculty_user_id, FALSE AS from_faculty_schedule
          FROM class_schedules cs
          LEFT JOIN users u ON cs.faculty_user_id = u.id
          UNION ALL
          SELECT fs.id, fs.subject_code, TRIM(fs.subject_name) AS subject_name, TRIM(fs.day_of_week) AS day_of_week,
            fs.start_time, fs.end_time, TRIM(fs.room) AS room,
            COALESCE(CONCAT(f.first_name, ' ', f.last_name), '') AS instructor,
            TRIM(fs.department) AS department, TRIM(fs.section) AS section, TRIM(fs.year_level) AS year_level, fs.created_at,
            TRIM(CONCAT(COALESCE(f.first_name, ''), ' ', COALESCE(f.last_name, ''))) AS faculty_name,
            fs.faculty_id AS faculty_user_id, TRUE AS from_faculty_schedule
          FROM faculty_schedules fs
          LEFT JOIN users f ON fs.faculty_id = f.id
        ) AS all_schedules
        WHERE (LOWER(TRIM(department)) = LOWER(TRIM(?)) OR LOWER(TRIM(department)) = 'general')
          AND (? = '' OR LOWER(TRIM(year_level)) LIKE CONCAT(LOWER(TRIM(?)), '%') OR year_level IS NULL OR year_level = '')
          AND (? = '' OR REPLACE(LOWER(TRIM(section)), '-', '') = REPLACE(LOWER(TRIM(?)), '-', '') OR section IS NULL OR section = '')
        ORDER BY CASE day_of_week WHEN 'Monday' THEN 1 WHEN 'Tuesday' THEN 2 WHEN 'Wednesday' THEN 3 WHEN 'Thursday' THEN 4 WHEN 'Friday' THEN 5 WHEN 'Saturday' THEN 6 WHEN 'Sunday' THEN 7 END, start_time ASC`;

      const [rows] = await pool.query(query, [searchDept, searchYear, searchYear, searchSect, searchSect]);
      return res.json(rows || []);
    }

    let query = `
      SELECT cs.*, CONCAT(f.first_name, ' ', f.last_name) AS faculty_name
      FROM class_schedules cs
      LEFT JOIN users f ON cs.faculty_user_id = f.id
      WHERE 1=1`;
    const params = [];

    if (filterDept && filterDept !== 'All') {
      params.push(filterDept);
      query += ` AND cs.department = ?`;
    }
    if (filterSect) {
      params.push(filterSect);
      query += ` AND cs.section = ?`;
    }
    if (filterYear) {
      params.push(filterYear);
      query += ` AND cs.year_level = ?`;
    }

    query += ` ORDER BY CASE cs.day_of_week WHEN 'Monday' THEN 1 WHEN 'Tuesday' THEN 2 WHEN 'Wednesday' THEN 3 WHEN 'Thursday' THEN 4 WHEN 'Friday' THEN 5 WHEN 'Saturday' THEN 6 WHEN 'Sunday' THEN 7 END, cs.start_time ASC`;
    const [rows] = await pool.query(query, params);
    res.json(rows || []);
  } catch (err) {
    console.error('[Schedules] Error:', err);
    res.status(500).json({ error: 'Failed' });
  }
});

// ── POST /api/schedules ─────────────────────────────────────────────────────
router.post('/', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { subject_code, subject_name, day_of_week, start_time, end_time, room, instructor, faculty_user_id, department } = req.body;
    const section = normalizeSection(req.body.section);
    const year_level = normalizeYearLevel(req.body.year_level);
    if (!subject_code || !subject_name || !day_of_week || !start_time || !end_time || !department || !year_level || !instructor) {
      return res.status(400).json({ error: 'Missing required fields including instructor' });
    }
    const newId = uuidv4();
    await pool.query(
      `INSERT INTO class_schedules (id, user_id, subject_code, subject_name, day_of_week, start_time, end_time, room, instructor, faculty_user_id, department, section, year_level)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId, req.user.id, subject_code, subject_name, day_of_week, start_time, end_time, room || null, instructor || null, faculty_user_id || null, department || null, section || null, year_level]
    );
    const [createdRows] = await pool.query('SELECT * FROM class_schedules WHERE id = ?', [newId]);
    res.status(201).json({ message: 'Schedule added', schedule: createdRows[0] });
  } catch (err) {
    console.error('Add schedule error:', err);
    res.status(500).json({ error: 'Failed to add schedule' });
  }
});

// ── GET /api/schedules/template ─────────────────────────────────────────────
router.get('/template', authenticateToken, (_req, res) => {
  const csv =
    'subject_code,subject_name,day_of_week,start_time,end_time,room,instructor,year_level,section\n' +
    'COMP003,Computer Programming 2,Wednesday,07:30 AM,12:30 PM,SJ-COMLAB2,"PAGALILAWAN, ALFRED M.",1st,BSIT 1-1\n' +
    'COMP004,Discrete Structures 1,Tuesday,01:30 PM,04:30 PM,SJ-MB202,"SAGUINDAN, IAN JOSEPH",1st,BSIT 1-1\n';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="class-schedule-template.csv"');
  res.send(csv);
});

// ── POST /api/schedules/upload ──────────────────────────────────────────────
router.post('/upload', authenticateToken, requireRole('admin'), uploadCsv.single('file'), async (req, res) => {
  const client = await pool.getConnection();
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const uploadDept = (req.body.department || '').trim() || null;
    const uploadSection = (req.body.section || '').trim() || null;
    const uploadYearLevel = normalizeYearLevel(req.body.year_level);
    if (!uploadYearLevel) return res.status(400).json({ error: 'Valid year_level is required' });

    const rows = parseCsv(req.file.buffer.toString('utf8'));
    if (!rows.length) return res.status(400).json({ error: 'CSV is empty or missing a header row' });

    const headers = Object.keys(rows[0]);
    const pup = isPupFormat(headers);

    if (!pup) {
      const required = ['subject_code', 'subject_name', 'day_of_week', 'start_time', 'end_time'];
      const missing = required.filter(h => !(h in rows[0]));
      if (missing.length) {
        return res.status(400).json({
          error: `Unrecognized CSV format. Use the PUP official class schedule export, or a CSV with columns: ${required.join(', ')}`
        });
      }
    }

    const instructorKey = pup ? 'professor' : 'instructor';
    const instructorNames = [...new Set(rows.map(r => (r[instructorKey] || '').trim()).filter(Boolean))];
    const nameToId = new Map();
    if (instructorNames.length) {
      const [lookupRows] = await client.query("SELECT id, first_name, last_name FROM users WHERE role IN ('faculty','admin') AND is_active = TRUE");
      (lookupRows || []).forEach(u => {
        nameToId.set(`${u.first_name} ${u.last_name}`.toLowerCase(), u.id);
        nameToId.set(`${u.last_name}, ${u.first_name}`.toLowerCase(), u.id);
      });
    }

    const valid = [];
    const errors = [];

    rows.forEach((r, idx) => {
      const line = idx + 2;
      const errs = [];

      if (pup) {
        const subject_code = (r.subject_code || '').trim();
        const subject_name = (r.description || '').trim();
        if (subject_code.toUpperCase() === 'TOTAL' || !subject_code) return;

        const room = (r['room_no.'] || r.room_no || '').trim() || null;
        const instructor = (r.professor || '').trim() || null;
        const schedRaw = (r.schedule || '').trim();

        if (!subject_code) errs.push('Subject Code is empty');
        if (!subject_name) errs.push('Description is empty');
        if (!instructor) errs.push('Professor/Instructor is empty');

        const parsed = parseScheduleString(schedRaw);
        if (!parsed) errs.push(`Cannot parse Schedule "${schedRaw}" — expected format: W 07:30AM-12:30PM`);

        if (errs.length) {
          errors.push({ line, subject: subject_code, errors: errs });
        } else {
          const { day, start, end } = parsed;
          let facultyUserId = nameToId.get(instructor.toLowerCase()) || null;
          if (!facultyUserId && instructor) {
            const lastName = instructor.split(',')[0].trim().toLowerCase();
            for (const [key, id] of nameToId) {
              if (key.startsWith(lastName + ',') || key.endsWith(' ' + lastName)) {
                facultyUserId = id;
                break;
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
        const subject_code = (r.subject_code || '').trim();
        const subject_name = (r.subject_name || '').trim();
        const day = normalizeDay(r.day_of_week);
        const start = normalizeTime(r.start_time);
        const end = normalizeTime(r.end_time);
        const room = (r.room || '').trim() || null;
        const instructor = (r.instructor || '').trim() || null;
        const csvSection = normalizeSection((r.section || '').trim() || uploadSection);
        const yearLevel = normalizeYearLevel(r.year_level) || uploadYearLevel;

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

    if (!valid.length) return res.status(400).json({ error: 'No valid rows found', errors, inserted: 0 });

    await client.beginTransaction();
    await client.query('DELETE FROM class_schedules WHERE user_id = ? AND department = ?', [req.user.id, uploadDept]);
    for (const v of valid) {
      await client.query(
        `INSERT INTO class_schedules (id, user_id, subject_code, subject_name, day_of_week, start_time, end_time, room, instructor, faculty_user_id, department, section, year_level)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), req.user.id, v.subject_code, v.subject_name, v.day, v.start, v.end, v.room, v.instructor, v.facultyUserId, v.department, v.section, v.year_level]
      );
    }
    await client.commit();

    const formatLabel = pup ? 'PUP schedule format' : 'standard format';
    res.json({
      message: `Uploaded ${valid.length} class${valid.length === 1 ? '' : 'es'} (${formatLabel})${errors.length ? ` — ${errors.length} row(s) skipped` : ''}`,
      inserted: valid.length,
      skipped: errors.length,
      errors,
    });
  } catch (err) {
    try { await client.rollback(); } catch (_) {}
    console.error('Upload class schedule CSV error:', err);
    res.status(500).json({ error: 'Failed to upload schedule' });
  } finally {
    client.release();
  }
});

// ── PATCH /api/schedules/:id ────────────────────────────────────────────────
router.patch('/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { subject_code, subject_name, day_of_week, start_time, end_time, room, instructor, faculty_user_id, department } = req.body;
    const section = normalizeSection(req.body.section);
    const year_level = normalizeYearLevel(req.body.year_level);
    if (!subject_code || !subject_name || !day_of_week || !start_time || !end_time || !department || !year_level || !instructor) {
      return res.status(400).json({ error: 'Missing required fields including instructor' });
    }
    const [checkRows] = await pool.query('SELECT user_id FROM class_schedules WHERE id = ?', [id]);
    if (!checkRows?.length) return res.status(404).json({ error: 'Class not found' });
    if (checkRows[0].user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Not authorized' });

    await pool.query(
      `UPDATE class_schedules SET subject_code=?, subject_name=?, day_of_week=?,
              start_time=?, end_time=?, room=?, instructor=?, faculty_user_id=?,
              department=?, section=?, year_level=?
       WHERE id=?`,
      [subject_code, subject_name, day_of_week, start_time, end_time, room || null, instructor || null, faculty_user_id || null, department || null, section || null, year_level, id]
    );
    const [updatedRows] = await pool.query('SELECT * FROM class_schedules WHERE id = ?', [id]);
    res.json(updatedRows[0]);
  } catch (err) {
    console.error('Update schedule error:', err);
    res.status(500).json({ error: 'Failed to update class' });
  }
});

// ── DELETE /api/schedules/:id ───────────────────────────────────────────────
router.delete('/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM class_schedules WHERE id = ?', [req.params.id]);
    res.json({ message: 'Schedule deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete schedule' });
  }
});

module.exports = router;
