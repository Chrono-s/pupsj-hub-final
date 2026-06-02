const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// ── Auto-provision: create table + index if they don't exist ──────
pool.query(`
  CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    message TEXT,
    type VARCHAR(50) DEFAULT 'general',
    is_read BOOLEAN DEFAULT FALSE,
    link VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )
`).then(() =>
  pool.query(`
    CREATE INDEX IF NOT EXISTS idx_notifications_user
      ON notifications(user_id, is_read)
  `)
).catch((err) => {
  console.error('[notifications] Auto-provision warning:', err.message);
});

router.get('/summary', authenticateToken, async (req, res) => {
  try {
    const [totalResult, typeResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS unread_count
         FROM notifications
         WHERE user_id = $1
           AND is_read = FALSE`,
        [req.user.id]
      ),
      pool.query(
        `SELECT type, COUNT(*)::int AS count
         FROM notifications
         WHERE user_id = $1
           AND is_read = FALSE
         GROUP BY type`,
        [req.user.id]
      )
    ]);

    const types = {};
    typeResult.rows.forEach(r => {
      types[r.type] = r.count;
    });

    res.json({
      unread_count: totalResult.rows[0]?.unread_count || 0,
      types: types
    });
  } catch (err) {
    console.error('Notification summary error:', err);
    res.status(500).json({ error: 'Failed to fetch notification summary' });
  }
});

router.get('/', authenticateToken, async (req, res) => {
  try {
    const parsedLimit = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 100)
      : 50;

    const [notificationsResult, unreadResult] = await Promise.all([
      pool.query(
        `SELECT id, title, message, type, is_read, link, created_at
         FROM notifications
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [req.user.id, limit]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS unread_count
         FROM notifications
         WHERE user_id = $1
           AND is_read = FALSE`,
        [req.user.id]
      ),
    ]);

    res.json({
      notifications: notificationsResult.rows,
      unread_count: unreadResult.rows[0]?.unread_count || 0,
    });
  } catch (err) {
    console.error('Notifications list error:', err);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

router.patch('/read-all', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE notifications
       SET is_read = TRUE
       WHERE user_id = $1
         AND is_read = FALSE
       RETURNING id`,
      [req.user.id]
    );

    res.json({
      message: 'Notifications marked as read',
      updated: result.rowCount,
    });
  } catch (err) {
    console.error('Read-all notifications error:', err);
    res.status(500).json({ error: 'Failed to update notifications' });
  }
});

router.patch('/read-type/:type', authenticateToken, async (req, res) => {
  try {
    const { type } = req.params;
    const result = await pool.query(
      `UPDATE notifications
       SET is_read = TRUE
       WHERE user_id = $1
         AND type = $2
         AND is_read = FALSE
       RETURNING id`,
      [req.user.id, type]
    );

    res.json({
      message: `Notifications of type ${type} marked as read`,
      updated: result.rowCount,
    });
  } catch (err) {
    console.error('Read-type notifications error:', err);
    res.status(500).json({ error: 'Failed to update notifications' });
  }
});

router.patch('/:id/read', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE notifications
       SET is_read = TRUE
       WHERE id = $1
         AND user_id = $2
         RETURNING id, title, message, type, is_read, link, created_at`,
      [req.params.id, req.user.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({
      message: 'Notification updated',
      notification: result.rows[0],
    });
  } catch (err) {
    console.error('Read notification error:', err);
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

module.exports = router;
