const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// ── Auto-provision: create table + index if they don't exist ──────
pool.query(`
  CREATE TABLE IF NOT EXISTS notifications (
    id          CHAR(36)     PRIMARY KEY,
    user_id     CHAR(36),
    title       VARCHAR(255) NOT NULL,
    message     TEXT,
    type        VARCHAR(50)  DEFAULT 'general',
    is_read     TINYINT(1)   DEFAULT 0,
    link        VARCHAR(500),
    created_at  DATETIME     DEFAULT NOW(),
    CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
    const [[totalResult], [typeRows]] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) AS unread_count
         FROM notifications
         WHERE user_id = ?
           AND is_read = FALSE`,
        [req.user.id]
      ),
      pool.query(
        `SELECT type, COUNT(*) AS count
         FROM notifications
         WHERE user_id = ?
           AND is_read = FALSE
         GROUP BY type`,
        [req.user.id]
      )
    ]);

    const types = {};
    typeRows.forEach(r => {
      types[r.type] = parseInt(r.count, 10);
    });

    res.json({
      unread_count: parseInt(totalResult[0]?.unread_count, 10) || 0,
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

    const [[notificationsRows], [unreadRows]] = await Promise.all([
      pool.query(
        `SELECT id, title, message, type, is_read, link, created_at
         FROM notifications
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
        [req.user.id, limit]
      ),
      pool.query(
        `SELECT COUNT(*) AS unread_count
         FROM notifications
         WHERE user_id = ?
           AND is_read = FALSE`,
        [req.user.id]
      ),
    ]);

    res.json({
      notifications: notificationsRows,
      unread_count: parseInt(unreadRows[0]?.unread_count, 10) || 0,
    });
  } catch (err) {
    console.error('Notifications list error:', err);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

router.patch('/read-all', authenticateToken, async (req, res) => {
  try {
    const [result] = await pool.query(
      `UPDATE notifications
       SET is_read = TRUE
       WHERE user_id = ?
         AND is_read = FALSE`,
      [req.user.id]
    );

    res.json({
      message: 'Notifications marked as read',
      updated: result.affectedRows,
    });
  } catch (err) {
    console.error('Read-all notifications error:', err);
    res.status(500).json({ error: 'Failed to update notifications' });
  }
});

router.patch('/read-type/:type', authenticateToken, async (req, res) => {
  try {
    const { type } = req.params;
    const [result] = await pool.query(
      `UPDATE notifications
       SET is_read = TRUE
       WHERE user_id = ?
         AND type = ?
         AND is_read = FALSE`,
      [req.user.id, type]
    );

    res.json({
      message: `Notifications of type ${type} marked as read`,
      updated: result.affectedRows,
    });
  } catch (err) {
    console.error('Read-type notifications error:', err);
    res.status(500).json({ error: 'Failed to update notifications' });
  }
});

router.patch('/:id/read', authenticateToken, async (req, res) => {
  try {
    const [result] = await pool.query(
      `UPDATE notifications
       SET is_read = TRUE
       WHERE id = ?
         AND user_id = ?`,
      [req.params.id, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    const [fetchRows] = await pool.query(
      `SELECT id, title, message, type, is_read, link, created_at
       FROM notifications WHERE id = ?`,
      [req.params.id]
    );

    res.json({
      message: 'Notification updated',
      notification: fetchRows[0],
    });
  } catch (err) {
    console.error('Read notification error:', err);
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

module.exports = router;
