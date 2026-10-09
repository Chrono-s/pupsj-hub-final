const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { uploadFeedback } = require('../middleware/upload');
const { notifyUser, safeNotify } = require('../services/notifications');
const { isValidUuid, safeJsonParse } = require('../utils/helpers');

const AI_SIDECAR_URL = process.env.AI_SIDECAR_URL || 'http://localhost:8000';

// ── GET /api/feedback/event/:eventId ────────────────────────────────────────
router.get('/event/:eventId', authenticateToken, async (req, res) => {
  try {
    if (!isValidUuid(req.params.eventId)) return res.json([]);

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

    const result = (rows || []).map((r) => {
      let imgs = safeJsonParse(r.images, []);
      if (!Array.isArray(imgs)) imgs = [];
      return {
        ...r,
        images: imgs.filter(img => img && (img.image_url || typeof img === 'string')).map(img => {
          if (typeof img === 'string') return { id: img, image_url: img };
          return { id: img.id || img.image_url, image_url: img.image_url };
        })
      };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch feedback' });
  }
});

// ── GET /api/feedback/event/:eventId/insights ───────────────────────────────
router.get('/event/:eventId/insights', authenticateToken, async (req, res) => {
  try {
    if (!isValidUuid(req.params.eventId)) return res.json({});

    const [eventRows] = await pool.query('SELECT title, author_id FROM events WHERE id = ?', [req.params.eventId]);
    if (!eventRows.length) return res.status(404).json({ error: 'Event not found' });

    const isAuthor = eventRows[0].author_id === req.user.id;
    if (req.user.role !== 'admin' && !isAuthor) {
      return res.status(403).json({ error: 'Access restricted to the event organizer or admin' });
    }

    const [fbRows] = await pool.query(
      `SELECT rating, comment FROM feedback WHERE event_id = ? AND comment IS NOT NULL AND TRIM(comment) != '' ORDER BY created_at DESC LIMIT 100`,
      [req.params.eventId]
    );

    const sidecarRes = await fetch(`${AI_SIDECAR_URL}/feedback-insights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_id: req.params.eventId,
        event_title: eventRows[0].title,
        feedback: (fbRows || []).map(r => ({ rating: parseInt(r.rating, 10) || 5, comment: r.comment }))
      }),
      signal: AbortSignal.timeout(60000),
    });

    const data = await sidecarRes.json();
    if (!sidecarRes.ok) return res.status(sidecarRes.status).json({ error: data.detail || 'AI analysis failed' });
    res.json(data);
  } catch (err) {
    console.error('Feedback insights error:', err);
    if (err.name === 'TimeoutError') return res.status(504).json({ error: 'AI analysis timed out. Try again.' });
    if (err.code === 'ECONNREFUSED' || err.message?.includes('fetch failed')) {
      return res.status(503).json({ error: 'AI Insights sidecar is currently offline. Please try again later.' });
    }
    res.status(500).json({ error: 'Failed to generate insights' });
  }
});

// ── GET /api/feedback/event/:eventId/summary ────────────────────────────────
router.get('/event/:eventId/summary', authenticateToken, async (req, res) => {
  try {
    if (!isValidUuid(req.params.eventId)) {
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

// ── POST /api/feedback ──────────────────────────────────────────────────────
router.post('/', authenticateToken, uploadFeedback.array('images', 5), async (req, res) => {
  try {
    const { event_id, rating, comment } = req.body;
    const normalizedComment = String(comment || '').trim();

    const r = parseInt(rating, 10);
    if (!r || r < 1 || r > 5) return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    if (!isValidUuid(event_id)) return res.status(400).json({ error: 'Invalid event ID' });

    const [eventCheckRows] = await pool.query(
      "SELECT id, title, author_id, event_date, start_time, end_time FROM events WHERE id = ? AND status != 'deleted'",
      [event_id]
    );
    if (!eventCheckRows.length) return res.status(404).json({ error: 'Event not found' });
    const event = eventCheckRows[0];

    const d = new Date(event.event_date);
    const datePart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let targetTime = event.end_time || event.start_time || '23:59:59';
    if (targetTime.split(':').length === 2) targetTime += ':00';
    const eventDateTime = new Date(`${datePart}T${targetTime}`);

    if (new Date() < eventDateTime) {
      return res.status(400).json({ error: 'Feedback can only be submitted after the event has concluded' });
    }
    if (new Date() - eventDateTime > 3 * 24 * 60 * 60 * 1000) {
      return res.status(400).json({ error: 'Feedback submission period is closed. Reviews are only accepted within 3 days after the event has concluded.' });
    }
    if (!['student', 'faculty'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only students and faculty can submit feedback' });
    }

    const [dupCheckRows] = await pool.query('SELECT id FROM feedback WHERE user_id = ? AND event_id = ?', [req.user.id, event_id]);
    if (dupCheckRows.length > 0) {
      return res.status(400).json({ error: 'You have already submitted feedback for this event' });
    }

    let sentiment = 'neutral';
    if (r >= 4) sentiment = 'positive';
    else if (r <= 2) sentiment = 'negative';

    const newFeedbackId = uuidv4();
    await pool.query(
      'INSERT INTO feedback (id, user_id, event_id, rating, comment, sentiment) VALUES (?, ?, ?, ?, ?, ?)',
      [newFeedbackId, req.user.id, event_id, r, normalizedComment || null, sentiment]
    );

    const [feedbackRows] = await pool.query('SELECT * FROM feedback WHERE id = ?', [newFeedbackId]);
    const feedback = feedbackRows[0];

    if (req.files?.length > 0) {
      for (let i = 0; i < req.files.length; i++) {
        await pool.query(
          'INSERT INTO feedback_images (id, feedback_id, image_url, display_order) VALUES (?, ?, ?, ?)',
          [uuidv4(), feedback.id, `/uploads/feedback/${req.files[i].filename}`, i]
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

// ── PATCH /api/feedback/:id ─────────────────────────────────────────────────
router.patch('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidUuid(id)) return res.status(404).json({ error: 'Feedback not found' });

    const { rating, comment } = req.body;
    const r = parseInt(rating, 10);
    if (!r || r < 1 || r > 5) return res.status(400).json({ error: 'Rating must be between 1 and 5' });

    const isPrivileged = ['admin', 'superadmin'].includes(req.user.role);
    if (checkRows[0].user_id !== req.user.id && !isPrivileged) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    let sentiment = 'neutral';
    if (r >= 4) sentiment = 'positive';
    else if (r <= 2) sentiment = 'negative';

    await pool.query('UPDATE feedback SET rating=?, comment=?, sentiment=? WHERE id=?', [r, comment || null, sentiment, id]);
    const [fetchRows] = await pool.query('SELECT * FROM feedback WHERE id = ?', [id]);
    res.json(fetchRows[0]);
  } catch (err) {
    console.error('Update feedback error:', err);
    res.status(500).json({ error: 'Failed to update feedback' });
  }
});

// ── DELETE /api/feedback/:id ────────────────────────────────────────────────
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidUuid(id)) return res.status(404).json({ error: 'Feedback not found' });

    const [checkRows] = await pool.query('SELECT user_id FROM feedback WHERE id = ?', [id]);
    if (!checkRows.length) return res.status(404).json({ error: 'Feedback not found' });
    const isPrivileged = ['admin', 'superadmin'].includes(req.user.role);
    if (checkRows[0].user_id !== req.user.id && !isPrivileged) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await pool.query('DELETE FROM feedback WHERE id = ?', [id]);
    res.json({ message: 'Feedback deleted' });
  } catch (err) {
    console.error('Delete feedback error:', err);
    res.status(500).json({ error: 'Failed to delete feedback' });
  }
});

module.exports = router;
