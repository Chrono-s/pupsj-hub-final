const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// GET section schedules
router.get('/', authenticateToken, async (req, res) => {
  try {
    // ── STUDENT: only their own matching section schedule ────────
    if (req.user.role === 'student') {
      const [profileRows] = await pool.query(
        'SELECT department, year_level, section FROM users WHERE id = ?',
        [req.user.id]
      );
      const p = (profileRows && profileRows[0]) || {};
      const dept    = (p.department  || '').trim();
      const year    = (p.year_level  || '').trim();
      const section = (p.section     || '').trim();

      if (!dept || !year || !section) {
        return res.json({ schedules: [], incomplete_profile: true, student_info: { dept, year, section } });
      }

      const [rows] = await pool.query(
        `SELECT ss.*, CONCAT(u.first_name, ' ', u.last_name) AS posted_by_name
         FROM section_schedule_embeds ss
         LEFT JOIN users u ON ss.posted_by = u.id
         WHERE ss.target_type = 'section'
           AND LOWER(TRIM(ss.department)) = LOWER(?)
           AND LOWER(TRIM(ss.year_level)) = LOWER(?)
           AND LOWER(REPLACE(TRIM(ss.section), '-', '')) = LOWER(REPLACE(?, '-', ''))
           AND ss.is_active = TRUE
         ORDER BY ss.created_at DESC`,
        [dept, year, section]
      );

      return res.json({
        schedules: rows || [],
        incomplete_profile: false,
        student_info: { dept, year, section }
      });
    }

    // ── FACULTY: only schedules assigned to them ────────────────
    if (req.user.role === 'faculty') {
      const [rows] = await pool.query(
        `SELECT ss.*, CONCAT(u.first_name, ' ', u.last_name) AS posted_by_name
         FROM section_schedule_embeds ss
         LEFT JOIN users u ON ss.posted_by = u.id
         WHERE ss.target_type = 'faculty'
           AND ss.faculty_id = ?
           AND ss.is_active = TRUE
         ORDER BY ss.created_at DESC`,
        [req.user.id]
      );
      return res.json(rows || []);
    }

    // ── ADMIN: full list with optional filters ────────
    const { department, year_level, section } = req.query;
    let query = `
      SELECT ss.*, 
             CONCAT(u.first_name, ' ', u.last_name) AS posted_by_name,
             CONCAT(f.first_name, ' ', f.last_name) AS faculty_name
      FROM section_schedule_embeds ss
      LEFT JOIN users u ON ss.posted_by = u.id
      LEFT JOIN users f ON ss.faculty_id = f.id
      WHERE 1=1
    `;
    const params = [];

    if (department) { params.push(department); query += ` AND ss.department = ?`; }
    if (year_level) { params.push(year_level); query += ` AND ss.year_level = ?`; }
    if (section)    { params.push(section);    query += ` AND ss.section = ?`; }

    query += ' ORDER BY ss.target_type, ss.department, ss.year_level, ss.section, ss.created_at DESC';
    const [rows] = await pool.query(query, params);
    res.json(rows || []);
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
    const newId = uuidv4();
    await pool.query(
      `INSERT INTO section_schedule_embeds 
       (id, target_type, faculty_id, department, year_level, section, title, embed_url, posted_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId, target_type || 'section', faculty_id || null, department || null, year_level || null, section || null, title, embed_url, req.user.id]
    );
    const [createdRows] = await pool.query('SELECT * FROM section_schedule_embeds WHERE id = ?', [newId]);
    res.status(201).json(createdRows[0]);
  } catch (err) {
    console.error('Section schedule create error:', err);
    res.status(500).json({ error: 'Failed to post schedule' });
  }
});

// PATCH /:id/toggle — toggle active/inactive (admin only)
router.patch('/:id/toggle', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') return res.status(403).json({ error: 'Access denied' });
  try {
    const [checkRows] = await pool.query('SELECT is_active FROM section_schedule_embeds WHERE id = ?', [req.params.id]);
    if (!checkRows || checkRows.length === 0) return res.status(404).json({ error: 'Schedule not found' });

    const newActive = !checkRows[0].is_active;
    await pool.query(
      `UPDATE section_schedule_embeds
       SET is_active = ?, updated_at = NOW()
       WHERE id = ?`,
      [newActive, req.params.id]
    );
    res.json({ is_active: newActive });
  } catch (err) {
    console.error('Section schedule toggle error:', err);
    res.status(500).json({ error: 'Failed to update schedule' });
  }
});

// DELETE /:id (admin only)
router.delete('/:id', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') return res.status(403).json({ error: 'Access denied' });
  try {
    const [result] = await pool.query(
      'DELETE FROM section_schedule_embeds WHERE id = ?',
      [req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Schedule not found' });
    res.json({ message: 'Schedule deleted' });
  } catch (err) {
    console.error('Section schedule delete error:', err);
    res.status(500).json({ error: 'Failed to delete schedule' });
  }
});

module.exports = router;
