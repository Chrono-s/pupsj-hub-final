const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { uploadFeedback } = require('../middleware/upload');

const AI_SIDECAR_URL = process.env.AI_SIDECAR_URL || 'http://localhost:8000';

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

// AI insights for an event's feedback (admin or event author only)
router.get('/event/:eventId/insights', authenticateToken, async (req, res) => {
  try {
    const eventResult = await pool.query(
      'SELECT title, author_id FROM events WHERE id = $1',
      [req.params.eventId]
    );
    if (!eventResult.rows.length) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const isAuthor = eventResult.rows[0].author_id === req.user.id;
    if (req.user.role !== 'admin' && !isAuthor) {
      return res.status(403).json({ error: 'Access restricted to the event organizer or admin' });
    }

    const sidecarRes = await fetch(`${AI_SIDECAR_URL}/feedback-insights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_id: req.params.eventId,
        event_title: eventResult.rows[0].title,
      }),
      signal: AbortSignal.timeout(60000),
    });

    const data = await sidecarRes.json();
    if (!sidecarRes.ok) {
      return res.status(sidecarRes.status).json({ error: data.detail || 'AI analysis failed' });
    }
    res.json(data);
  } catch (err) {
    console.error('Feedback insights error:', err);
    if (err.name === 'TimeoutError') {
      return res.status(504).json({ error: 'AI analysis timed out. Try again.' });
    }
    res.status(500).json({ error: 'Failed to generate insights' });
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

    const r = parseInt(rating);
    if (!r || r < 1 || r > 5) return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    if (!event_id) return res.status(400).json({ error: 'event_id is required' });

    let sentiment = 'neutral';
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

// Update feedback (author only)
router.patch('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, comment } = req.body;
    const r = parseInt(rating);
    if (!r || r < 1 || r > 5) return res.status(400).json({ error: 'Rating must be between 1 and 5' });

    const check = await pool.query('SELECT user_id FROM feedback WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Feedback not found' });
    if (check.rows[0].user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    let sentiment = 'neutral';
    if (r >= 4) sentiment = 'positive';
    else if (r <= 2) sentiment = 'negative';

    const result = await pool.query(
      `UPDATE feedback SET rating=$1, comment=$2, sentiment=$3 WHERE id=$4 RETURNING *`,
      [r, comment || null, sentiment, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update feedback error:', err);
    res.status(500).json({ error: 'Failed to update feedback' });
  }
});

// Delete feedback (author or admin)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const check = await pool.query('SELECT user_id FROM feedback WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Feedback not found' });
    if (check.rows[0].user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }
    await pool.query('DELETE FROM feedback WHERE id = $1', [id]);
    res.json({ message: 'Feedback deleted' });
  } catch (err) {
    console.error('Delete feedback error:', err);
    res.status(500).json({ error: 'Failed to delete feedback' });
  }
});

module.exports = router;
