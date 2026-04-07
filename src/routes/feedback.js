const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { uploadFeedback } = require('../middleware/upload');

// Get feedback for an event (with images)
router.get('/event/:eventId', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT f.*, u.first_name || ' ' || u.last_name as user_name,
        u.first_name, u.last_name, u.profile_image as user_profile_image,
        COALESCE(
          json_agg(
            json_build_object('id', fi.id, 'image_url', fi.image_url)
          ) FILTER (WHERE fi.id IS NOT NULL), '[]'
        ) as images
       FROM feedback f
       LEFT JOIN users u ON f.user_id = u.id
       LEFT JOIN feedback_images fi ON fi.feedback_id = f.id
       WHERE f.event_id = $1
       GROUP BY f.id, u.first_name, u.last_name, u.profile_image
       ORDER BY f.created_at DESC`,
      [req.params.eventId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch feedback' });
  }
});

// Get feedback summary for an event
router.get('/event/:eventId/summary', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        COUNT(*) as total,
        ROUND(AVG(rating)::numeric, 1) as average_rating,
        COUNT(*) FILTER (WHERE rating >= 4) as positive,
        COUNT(*) FILTER (WHERE rating = 3) as neutral,
        COUNT(*) FILTER (WHERE rating <= 2) as negative
       FROM feedback WHERE event_id = $1`,
      [req.params.eventId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// Submit feedback (with image upload)
router.post('/', authenticateToken, uploadFeedback.array('images', 5), async (req, res) => {
  try {
    const { event_id, rating, comment } = req.body;

    // Simple sentiment
    let sentiment = 'neutral';
    const r = parseInt(rating);
    if (r >= 4) sentiment = 'positive';
    else if (r <= 2) sentiment = 'negative';

    const result = await pool.query(
      `INSERT INTO feedback (user_id, event_id, rating, comment, sentiment)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.id, event_id, r, comment, sentiment]
    );

    const feedback = result.rows[0];

    if (req.files && req.files.length > 0) {
      for (let i = 0; i < req.files.length; i++) {
        const imageUrl = `/uploads/feedback/${req.files[i].filename}`;
        await pool.query(
          `INSERT INTO feedback_images (feedback_id, image_url, display_order) VALUES ($1, $2, $3)`,
          [feedback.id, imageUrl, i]
        );
      }
    }

    res.status(201).json({ message: 'Feedback submitted', feedback });
  } catch (err) {
    console.error('Feedback error:', err);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

module.exports = router;
