const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// List all active faculty users (for the "Add Class" dropdown)
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

// Real-time faculty locations — returns every active faculty with current status (In Class / Available)
// Uses Asia/Manila timezone (PHT) for all comparisons.
router.get('/locations', authenticateToken, async (req, res) => {
  try {
    // Compute current day + time in Manila timezone directly in SQL so the server
    // timezone doesn't matter. to_char with 'FMDay' returns "Monday", "Tuesday", etc.
    // Pull active classes from BOTH faculty_schedules (faculty's own teaching schedule)
    // AND class_schedules linked to a faculty via faculty_user_id, so updates from
    // either page reflect in the locator. Day-name compare is case-insensitive to
    // tolerate mixed casing in the database.
    const result = await pool.query(`
      WITH now_manila AS (
        SELECT
          LOWER(TRIM(to_char((NOW() AT TIME ZONE 'Asia/Manila'), 'FMDay'))) AS day_name,
          (NOW() AT TIME ZONE 'Asia/Manila')::time AS time_now
      ),
      active AS (
        SELECT fs.faculty_id, fs.subject_code, fs.subject_name, fs.room, fs.start_time, fs.end_time
        FROM faculty_schedules fs CROSS JOIN now_manila nm
        WHERE LOWER(TRIM(fs.day_of_week)) = nm.day_name
          AND nm.time_now >= fs.start_time
          AND nm.time_now <  fs.end_time
        UNION ALL
        SELECT cs.faculty_user_id AS faculty_id, cs.subject_code, cs.subject_name, cs.room, cs.start_time, cs.end_time
        FROM class_schedules cs CROSS JOIN now_manila nm
        WHERE cs.faculty_user_id IS NOT NULL
          AND LOWER(TRIM(cs.day_of_week)) = nm.day_name
          AND nm.time_now >= cs.start_time
          AND nm.time_now <  cs.end_time
      )
      SELECT
        u.id AS faculty_id,
        u.first_name,
        u.last_name,
        u.department,
        u.role,
        a.subject_code,
        a.subject_name,
        a.room,
        a.start_time,
        a.end_time,
        CASE WHEN a.faculty_id IS NOT NULL THEN 'in_class' ELSE 'available' END AS status
      FROM users u
      LEFT JOIN LATERAL (
        SELECT * FROM active WHERE active.faculty_id = u.id LIMIT 1
      ) a ON TRUE
      WHERE u.role IN ('faculty', 'admin')
        AND u.is_active = TRUE
        AND u.is_verified = TRUE
      ORDER BY (a.faculty_id IS NOT NULL) DESC, u.last_name ASC, u.first_name ASC
    `);

    // Also return server-computed Manila time for client "Updated at" display
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
