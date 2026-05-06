const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// ── Auto-provision: create table + is_active column if they don't exist ──────
pool.query(`
  CREATE TABLE IF NOT EXISTS section_schedule_embeds (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    department VARCHAR(100) NOT NULL,
    year_level VARCHAR(20)  NOT NULL,
    section    VARCHAR(20)  NOT NULL,
    title      VARCHAR(200),
    embed_url  TEXT         NOT NULL,
    is_active  BOOLEAN      DEFAULT TRUE,
    posted_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ  DEFAULT NOW(),
    updated_at TIMESTAMPTZ  DEFAULT NOW()
  )
`).then(() =>
  pool.query(`
    ALTER TABLE section_schedule_embeds
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE
  `)
).then(() =>
  pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sse_dept_year_sec
      ON section_schedule_embeds (department, year_level, section)
  `)
).catch((err) => {
  console.error('[sectionSchedules] Auto-provision warning:', err.message);
});

// GET section schedules
// Students → only their own dept/year/section (active only)
// Faculty/Admin → all schedules with optional query filters
router.get('/', authenticateToken, async (req, res) => {
  try {
    // ── STUDENT: personalised view ──────────────────────────────
    if (req.user.role === 'student') {
      // Fetch the student's current profile to get dept/year/section
      const profileRes = await pool.query(
        'SELECT department, year_level, section FROM users WHERE id = $1',
        [req.user.id]
      );
      const p = profileRes.rows[0] || {};
      const dept    = (p.department  || '').trim();
      const year    = (p.year_level  || '').trim();
      const section = (p.section     || '').trim();

      // If profile is incomplete, return empty list with metadata
      if (!dept || !year || !section) {
        return res.json({ schedules: [], incomplete_profile: true, student_info: { dept, year, section } });
      }

      const result = await pool.query(
        `SELECT ss.*, u.first_name || ' ' || u.last_name AS posted_by_name
         FROM section_schedule_embeds ss
         LEFT JOIN users u ON ss.posted_by = u.id
         WHERE LOWER(TRIM(ss.department)) = LOWER($1)
           AND LOWER(TRIM(ss.year_level)) = LOWER($2)
           AND LOWER(REPLACE(TRIM(ss.section), '-', '')) = LOWER(REPLACE($3, '-', ''))
           AND ss.is_active = TRUE
         ORDER BY ss.created_at DESC`,
        [dept, year, section]
      );

      return res.json({
        schedules: result.rows,
        incomplete_profile: false,
        student_info: { dept, year, section }
      });
    }

    // ── FACULTY / ADMIN: full list with optional filters ────────
    const { department, year_level, section } = req.query;
    let query = `
      SELECT ss.*, u.first_name || ' ' || u.last_name AS posted_by_name
      FROM section_schedule_embeds ss
      LEFT JOIN users u ON ss.posted_by = u.id
      WHERE 1=1
    `;
    const params = [];

    if (department) { params.push(department); query += ` AND ss.department = $${params.length}`; }
    if (year_level) { params.push(year_level); query += ` AND ss.year_level = $${params.length}`; }
    if (section)    { params.push(section);    query += ` AND ss.section    = $${params.length}`; }

    query += ' ORDER BY ss.department, ss.year_level, ss.section, ss.created_at DESC';
    const result = await pool.query(query, params);
    // Return array directly for faculty/admin (backwards compat with filters)
    res.json(result.rows);
  } catch (err) {
    console.error('Section schedules fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch schedules' });
  }
});

// POST a new section schedule (faculty/admin only)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const u = req.user;
    if (u.role === 'student') return res.status(403).json({ error: 'Not authorized' });

    const { title, department, year_level, section, embed_url } = req.body;
    if (!title || !department || !year_level || !section) {
      return res.status(400).json({ error: 'title, department, year_level, and section are required' });
    }

    const result = await pool.query(
      `INSERT INTO section_schedule_embeds
         (posted_by, title, department, year_level, section, embed_url, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE)
       RETURNING *`,
      [u.id, title, department, year_level, section, embed_url || null]
    );

    res.status(201).json({ message: 'Schedule posted', schedule: result.rows[0] });
  } catch (err) {
    console.error('Section schedule post error:', err);
    res.status(500).json({ error: 'Failed to post schedule' });
  }
});

// PATCH /:id/toggle — toggle active/inactive (faculty/admin only)
router.patch('/:id/toggle', authenticateToken, async (req, res) => {
  try {
    const u = req.user;
    if (u.role === 'student') return res.status(403).json({ error: 'Not authorized' });

    const result = await pool.query(
      `UPDATE section_schedule_embeds
       SET is_active = NOT is_active, updated_at = NOW()
       WHERE id = $1
       RETURNING is_active`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Schedule not found' });
    res.json({ is_active: result.rows[0].is_active });
  } catch (err) {
    console.error('Section schedule toggle error:', err);
    res.status(500).json({ error: 'Failed to update schedule' });
  }
});

// DELETE /:id (faculty/admin only)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const u = req.user;
    if (u.role === 'student') return res.status(403).json({ error: 'Not authorized' });

    const result = await pool.query(
      'DELETE FROM section_schedule_embeds WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Schedule not found' });
    res.json({ message: 'Schedule deleted' });
  } catch (err) {
    console.error('Section schedule delete error:', err);
    res.status(500).json({ error: 'Failed to delete schedule' });
  }
});

module.exports = router;
