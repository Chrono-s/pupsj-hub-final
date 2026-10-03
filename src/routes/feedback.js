const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { uploadFeedback } = require('../middleware/upload');
const { notifyUser, safeNotify } = require('../services/notifications');
const { v4: uuidv4 } = require('uuid');

const AI_SIDECAR_URL = process.env.AI_SIDECAR_URL || 'http://localhost:8000';

// Get feedback for an event (with images)
router.get('/event/:eventId', authenticateToken, async (req, res) => {
  try {
    const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!UUID_REGEX.test(req.params.eventId)) {
      return res.json([]);
    }

    const [rows] = await pool.query(
      `SELECT f.*, CONCAT(u.first_name, ' ', u.last_name) as user_name,
        u.first_name, u.last_name, u.profile_image as user_profile_image,
        COALESCE(
          CONCAT('[', GROUP_CONCAT(IF(fi.id IS NOT NULL, JSON_OBJECT('id', fi.id, 'image_url', fi.image_url), NULL) SEPARATOR ','), ']'),
          '[]'
        ) as images
       FROM feedback f
       LEFT JOIN users u ON f.user_id = u.id
       LEFT JOIN feedback_images fi ON fi.feedback_id = f.id
       WHERE f.event_id = ?
       GROUP BY f.id, u.first_name, u.last_name, u.profile_image
       ORDER BY f.created_at DESC`,
      [req.params.eventId]
    );
    (rows || []).forEach(r => {
      if (typeof r.images === 'string') {
        try { r.images = JSON.parse(r.images); } catch (_) { r.images = []; }
      }
      if (!Array.isArray(r.images)) r.images = [];
    });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch feedback' });
  }
});

// AI insights for an event's feedback (admin or event author only)
router.get('/event/:eventId/insights', authenticateToken, async (req, res) => {
  try {
    const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!UUID_REGEX.test(req.params.eventId)) {
      return res.json({});
    }

    const [eventRows] = await pool.query(
      'SELECT title, author_id FROM events WHERE id = ?',
      [req.params.eventId]
    );
    if (!eventRows.length) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const isAuthor = eventRows[0].author_id === req.user.id;
    if (req.user.role !== 'admin' && !isAuthor) {
      return res.status(403).json({ error: 'Access restricted to the event organizer or admin' });
    }

    const sidecarRes = await fetch(`${AI_SIDECAR_URL}/feedback-insights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_id: req.params.eventId,
        event_title: eventRows[0].title,
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
    if (err.code === 'ECONNREFUSED' || err.message?.includes('fetch failed')) {
      return res.status(503).json({ error: 'AI Insights sidecar is currently offline. Please try again later.' });
    }
    res.status(500).json({ error: 'Failed to generate insights' });
  }
});

// Get feedback summary for an event
router.get('/event/:eventId/summary', authenticateToken, async (req, res) => {
  try {
    const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!UUID_REGEX.test(req.params.eventId)) {
      return res.json({ total: 0, average_rating: 0, positive: 0, neutral: 0, negative: 0 });
    }

    const [rows] = await pool.query(
      `SELECT
        COUNT(*) as total,
        ROUND(AVG(rating), 1) as average_rating,
        SUM(IF(rating >= 4, 1, 0)) as positive,
        SUM(IF(rating = 3, 1, 0)) as neutral,
        SUM(IF(rating <= 2, 1, 0)) as negative
       FROM feedback WHERE event_id = ?`,
      [req.params.eventId]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// Submit feedback (with image upload)
router.post('/', authenticateToken, uploadFeedback.array('images', 5), async (req, res) => {
  try {
    const { event_id, rating, comment } = req.body;
    const normalizedComment = String(comment || '').trim();

    const r = parseInt(rating);
    if (!r || r < 1 || r > 5) return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    if (!event_id) return res.status(400).json({ error: 'event_id is required' });

    const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!UUID_REGEX.test(event_id)) {
      return res.status(400).json({ error: 'Invalid event ID' });
    }

    const [eventCheckRows] = await pool.query(
      `SELECT id, title, author_id, event_date, start_time, end_time
       FROM events
       WHERE id = ?
         AND status != ?`,
      [event_id, 'deleted']
    );
    if (!eventCheckRows.length) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const event = eventCheckRows[0];

    // Enforce feedback concluded time check
    const d = new Date(event.event_date);
    const datePart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let targetTime = event.end_time || event.start_time || '23:59:59';
    if (targetTime.split(':').length === 2) {
      targetTime += ':00';
    }
    const eventDateTime = new Date(`${datePart}T${targetTime}`);
    if (new Date() < eventDateTime) {
      return res.status(400).json({ error: 'Feedback can only be submitted after the event has concluded' });
    }
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    if (new Date() - eventDateTime > threeDaysMs) {
      return res.status(400).json({ error: 'Feedback submission period is closed. Reviews are only accepted within 3 days after the event has concluded.' });
    }

    // Enforce exactly one feedback per event per student/faculty
    if (req.user.role !== 'student' && req.user.role !== 'faculty') {
      return res.status(403).json({ error: 'Only students and faculty can submit feedback' });
    }

    const [dupCheckRows] = await pool.query(
      `SELECT id FROM feedback WHERE user_id = ? AND event_id = ?`,
      [req.user.id, event_id]
    );
    if (dupCheckRows.length > 0) {
      return res.status(400).json({ error: 'You have already submitted feedback for this event' });
    }

    let sentiment = 'neutral';
    if (r >= 4) sentiment = 'positive';
    else if (r <= 2) sentiment = 'negative';

    const newFeedbackId = uuidv4();
    await pool.query(
      `INSERT INTO feedback (id, user_id, event_id, rating, comment, sentiment)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [newFeedbackId, req.user.id, event_id, r, normalizedComment || null, sentiment]
    );
    const [feedbackRows] = await pool.query(
      `SELECT * FROM feedback WHERE id = ?`,
      [newFeedbackId]
    );
    const feedback = feedbackRows[0];

    if (req.files && req.files.length > 0) {
      for (let i = 0; i < req.files.length; i++) {
        const imageUrl = `/uploads/feedback/${req.files[i].filename}`;
        await pool.query(
          `INSERT INTO feedback_images (feedback_id, image_url, display_order) VALUES (?, ?, ?)`,
          [feedback.id, imageUrl, i]
        );
      }
    }

    await safeNotify('feedback create', async () => {
      if (event.author_id && event.author_id !== req.user.id) {
        await notifyUser(pool, event.author_id, {
          title: 'New event feedback',
          message: `Your event "${event.title}" received a new ${r}-star review.`,
          type: 'feedback',
          link: 'page:events',
        });
      }
    });

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
    const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!UUID_REGEX.test(id)) {
      return res.status(404).json({ error: 'Feedback not found' });
    }
    const { rating, comment } = req.body;
    const r = parseInt(rating);
    if (!r || r < 1 || r > 5) return res.status(400).json({ error: 'Rating must be between 1 and 5' });

    const [checkRows] = await pool.query('SELECT user_id FROM feedback WHERE id = ?', [id]);
    if (checkRows.length === 0) return res.status(404).json({ error: 'Feedback not found' });
    if (checkRows[0].user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Removed check: students/faculty can always edit/delete their own feedback at any time after submission

    let sentiment = 'neutral';
    if (r >= 4) sentiment = 'positive';
    else if (r <= 2) sentiment = 'negative';

    await pool.query(
      `UPDATE feedback SET rating=?, comment=?, sentiment=? WHERE id=?`,
      [r, comment || null, sentiment, id]
    );
    const [fetchRows] = await pool.query(`SELECT * FROM feedback WHERE id = ?`, [id]);
    res.json(fetchRows[0]);
  } catch (err) {
    console.error('Update feedback error:', err);
    res.status(500).json({ error: 'Failed to update feedback' });
  }
});

// Delete feedback (author or admin)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!UUID_REGEX.test(id)) {
      return res.status(404).json({ error: 'Feedback not found' });
    }
    const [checkRows] = await pool.query('SELECT user_id FROM feedback WHERE id = ?', [id]);
    if (checkRows.length === 0) return res.status(404).json({ error: 'Feedback not found' });
    if (checkRows[0].user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Removed check: students/faculty can always edit/delete their own feedback at any time after submission
    await pool.query('DELETE FROM feedback WHERE id = ?', [id]);
    res.json({ message: 'Feedback deleted' });
  } catch (err) {
    console.error('Delete feedback error:', err);
    res.status(500).json({ error: 'Failed to delete feedback' });
  }
});

module.exports = router;
