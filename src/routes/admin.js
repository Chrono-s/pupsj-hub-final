const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

// Get all users (admin)
router.get('/users', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { status } = req.query;
    let query = `SELECT id, student_number, email, first_name, last_name, role, department, 
                        is_verified, is_active, created_at FROM users WHERE role != 'admin'`;
    const params = [];

    if (status === 'pending') {
      query += ' AND is_verified = false';
    } else if (status === 'verified') {
      query += ' AND is_verified = true';
    }

    query += ' ORDER BY created_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Verify user
router.patch('/users/:id/verify', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    await pool.query('UPDATE users SET is_verified = true, updated_at = NOW() WHERE id = $1', [req.params.id]);
    res.json({ message: 'User verified' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to verify user' });
  }
});

// Deactivate user
router.patch('/users/:id/deactivate', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    await pool.query('UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1', [req.params.id]);
    res.json({ message: 'User deactivated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to deactivate user' });
  }
});

// Activate user
router.patch('/users/:id/activate', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    await pool.query('UPDATE users SET is_active = true, updated_at = NOW() WHERE id = $1', [req.params.id]);
    res.json({ message: 'User activated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to activate user' });
  }
});

// Delete user
router.delete('/users/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id = $1 AND role != $2', [req.params.id, 'admin']);
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Dashboard stats
router.get('/stats', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const [users, announcements, events, lostFound] = await Promise.all([
      pool.query("SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE is_verified = false) as pending FROM users WHERE role != 'admin'"),
      pool.query("SELECT COUNT(*) as total FROM announcements WHERE status = 'active'"),
      pool.query("SELECT COUNT(*) as total FROM events WHERE status = 'active'"),
      pool.query("SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'open') as open FROM lost_found")
    ]);

    res.json({
      users: { total: parseInt(users.rows[0].total), pending: parseInt(users.rows[0].pending) },
      announcements: parseInt(announcements.rows[0].total),
      events: parseInt(events.rows[0].total),
      lostFound: { total: parseInt(lostFound.rows[0].total), open: parseInt(lostFound.rows[0].open) }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
