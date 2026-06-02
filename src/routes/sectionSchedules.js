const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// ── Auto-provision: create table + columns if they don't exist ──────
pool.query(`
  CREATE TABLE IF NOT EXISTS section_schedule_embeds (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    target_type VARCHAR(20) DEFAULT 'section', -- 'section' or 'faculty'
    faculty_id  UUID REFERENCES users(id) ON DELETE CASCADE,
    department  VARCHAR(100),
    year_level  VARCHAR(20),
    section     VARCHAR(20),
    title       VARCHAR(200),
    embed_url   TEXT         NOT NULL,
    is_active   BOOLEAN      DEFAULT TRUE,
    posted_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ  DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  DEFAULT NOW()
  )
`).then(() =>
  pool.query(`
    ALTER TABLE section_schedule_embeds
      ADD COLUMN IF NOT EXISTS target_type VARCHAR(20) DEFAULT 'section',
      ADD COLUMN IF NOT EXISTS faculty_id  UUID REFERENCES users(id) ON DELETE CASCADE,
      ALTER COLUMN department DROP NOT NULL,
      ALTER COLUMN year_level DROP NOT NULL,
      ALTER COLUMN section DROP NOT NULL
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
router.get('/', authenticateToken, async (req, res) => {
  try {
    // ── STUDENT: only their own matching section schedule ────────
    if (req.user.role === 'student') {
      const profileRes = await pool.query(
        'SELECT department, year_level, section FROM users WHERE id = $1',
        [req.user.id]
      );
      const p = profileRes.rows[0] || {};
      const dept    = (p.department  || '').trim();
      const year    = (p.year_level  || '').trim();
      const section = (p.section     || '').trim();

      if (!dept || !year || !section) {
        return res.json({ schedules: [], incomplete_profile: true, student_info: { dept, year, section } });
      }

      const result = await pool.query(
        `SELECT ss.*, u.first_name || ' ' || u.last_name AS posted_by_name
         FROM section_schedule_embeds ss
         LEFT JOIN users u ON ss.posted_by = u.id
         WHERE ss.target_type = 'section'
           AND LOWER(TRIM(ss.department)) = LOWER($1)
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

    // ── FACULTY: only schedules assigned to them ────────────────
    if (req.user.role === 'faculty') {
      const result = await pool.query(
        `SELECT ss.*, u.first_name || ' ' || u.last_name AS posted_by_name
         FROM section_schedule_embeds ss
         LEFT JOIN users u ON ss.posted_by = u.id
         WHERE ss.target_type = 'faculty'
           AND ss.faculty_id = $1
           AND ss.is_active = TRUE
         ORDER BY ss.created_at DESC`,
        [req.user.id]
      );
      return res.json(result.rows);
    }

    // ── ADMIN: full list with optional filters ────────
    const { department, year_level, section } = req.query;
    let query = `
      SELECT ss.*, 
             u.first_name || ' ' || u.last_name AS posted_by_name,
             f.first_name || ' ' || f.last_name AS faculty_name
      FROM section_schedule_embeds ss
      LEFT JOIN users u ON ss.posted_by = u.id
      LEFT JOIN users f ON ss.faculty_id = f.id
      WHERE 1=1
    `;
    const params = [];

    if (department) { params.push(department); query += ` AND ss.department = $${params.length}`; }
    if (year_level) { params.push(year_level); query += ` AND ss.year_level = $${params.length}`; }
    if (section)    { params.push(section);    query += ` AND ss.section    = $${params.length}`; }

    query += ' ORDER BY ss.target_type, ss.department, ss.year_level, ss.section, ss.created_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Section schedules fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch schedules' });
  }
});

// POST a new section schedule (admin only)
router.post('/', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Only administrators can post schedules' });
  }
  const { target_type, faculty_id, department, year_level, section, title, embed_url } = req.body;
  if (!embed_url || !title) return res.status(400).json({ error: 'Title and Embed URL are required' });

  try {
    const result = await pool.query(
      `INSERT INTO section_schedule_embeds 
       (target_type, faculty_id, department, year_level, section, title, embed_url, posted_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [target_type || 'section', faculty_id || null, department || null, year_level || null, section || null, title, embed_url, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Section schedule create error:', err);
    res.status(500).json({ error: 'Failed to post schedule' });
  }
});

// PATCH /:id/toggle — toggle active/inactive (admin only)
router.patch('/:id/toggle', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') return res.status(403).json({ error: 'Access denied' });
  try {
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

// DELETE /:id (admin only)
router.delete('/:id', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') return res.status(403).json({ error: 'Access denied' });
  try {
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
