const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { uploadEvent } = require('../middleware/upload');

// Get events (optional month/year filter)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { month, year } = req.query;
    let query = `
      SELECT e.*, u.first_name || ' ' || u.last_name as author_name,
        COALESCE(
          json_agg(
            json_build_object('id', ei.id, 'image_url', ei.image_url, 'display_order', ei.display_order)
          ) FILTER (WHERE ei.id IS NOT NULL), '[]'
        ) as images
      FROM events e
      LEFT JOIN users u ON e.author_id = u.id
      LEFT JOIN event_images ei ON ei.event_id = e.id
      WHERE e.status != 'deleted'
    `;
    const params = [];

    if (month && year) {
      params.push(parseInt(month), parseInt(year));
      query += ` AND EXTRACT(MONTH FROM e.event_date) = $1 AND EXTRACT(YEAR FROM e.event_date) = $2`;
    }

    query += ` GROUP BY e.id, u.first_name, u.last_name
               ORDER BY e.event_date ASC, e.start_time ASC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get events error:', err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// Create event (with image upload)
router.post('/', authenticateToken, requireRole('faculty', 'admin'), uploadEvent.array('images', 5), async (req, res) => {
  try {
    const { title, description, location, event_date, start_time, end_time, department } = req.body;

    const result = await pool.query(
      `INSERT INTO events (author_id, title, description, location, event_date, start_time, end_time, department)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.user.id, title, description, location, event_date, start_time, end_time, department || 'General']
    );

    const event = result.rows[0];

    if (req.files && req.files.length > 0) {
      for (let i = 0; i < req.files.length; i++) {
        const imageUrl = `/uploads/events/${req.files[i].filename}`;
        await pool.query(
          `INSERT INTO event_images (event_id, image_url, display_order) VALUES ($1, $2, $3)`,
          [event.id, imageUrl, i]
        );
      }
    }

    res.status(201).json({ message: 'Event created', event });
  } catch (err) {
    console.error('Create event error:', err);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// Delete event
router.delete('/:id', authenticateToken, requireRole('faculty', 'admin'), async (req, res) => {
  try {
    await pool.query("UPDATE events SET status = 'deleted' WHERE id = $1", [req.params.id]);
    res.json({ message: 'Event deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

module.exports = router;
