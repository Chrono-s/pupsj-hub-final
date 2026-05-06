const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// List all active faculty users
router.get('/list', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, first_name, last_name, department
       FROM users
       WHERE role IN ('faculty', 'admin') AND is_active = TRUE AND is_verified = TRUE
       ORDER BY last_name ASC, first_name ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Faculty list error:', err);
    res.status(500).json({ error: 'Failed to fetch faculty list' });
  }
});

// Professor Locator — manual status (Option B).
// Each faculty member sets their own status (in_class, in_office, available, unavailable),
// optional room, optional note, optional "until" timestamp after which status auto-expires
// back to 'unavailable' for display purposes.
router.get('/locations', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        u.id AS faculty_id,
        u.first_name,
        u.last_name,
        u.department,
        u.role,
        u.profile_image,
        CASE
          WHEN u.faculty_status_until IS NOT NULL AND u.faculty_status_until < NOW()
            THEN 'unavailable'
          ELSE COALESCE(u.faculty_status, 'unavailable')
        END AS status,
        u.faculty_status_room AS room,
        u.faculty_status_note AS note,
        u.faculty_status_until AS until_time,
        u.faculty_status_updated_at AS updated_at
      FROM users u
      WHERE u.role IN ('faculty', 'admin')
        AND u.is_active = TRUE
        AND u.is_verified = TRUE
      ORDER BY
        CASE
          WHEN u.faculty_status_until IS NOT NULL AND u.faculty_status_until < NOW() THEN 3
          WHEN u.faculty_status = 'in_class' THEN 0
          WHEN u.faculty_status = 'in_office' THEN 1
          WHEN u.faculty_status = 'available' THEN 2
          ELSE 3
        END,
        u.last_name ASC, u.first_name ASC
    `);

    const timeResult = await pool.query(`SELECT (NOW() AT TIME ZONE 'Asia/Manila')::text AS now_manila`);

    res.json({
      locations: result.rows,
      server_time: timeResult.rows[0].now_manila,
    });
  } catch (err) {
    console.error('Faculty locations error:', err);
    res.status(500).json({ error: 'Failed to fetch faculty locations' });
  }
});

module.exports = router;
