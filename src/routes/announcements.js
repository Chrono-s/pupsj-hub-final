const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { uploadAnnouncement } = require('../middleware/upload');

// Get all announcements
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { department, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT a.*,
        CASE WHEN a.is_anonymous THEN 'Anonymous' ELSE u.first_name || ' ' || u.last_name END as author_name,
        CASE WHEN a.is_anonymous THEN NULL ELSE u.profile_image END as author_image,
        u.role as author_role,
        COALESCE(
          json_agg(
            json_build_object('id', ai.id, 'image_url', ai.image_url, 'display_order', ai.display_order)
          ) FILTER (WHERE ai.id IS NOT NULL), '[]'
        ) as images
      FROM announcements a
      LEFT JOIN users u ON a.author_id = u.id
      LEFT JOIN announcement_images ai ON ai.announcement_id = a.id
      WHERE a.status = 'active'
    `;
    const params = [];

    if (department && department !== 'All') {
      params.push(department);
      query += ` AND (a.department = $${params.length} OR a.department = 'General')`;
    }

    query += ` GROUP BY a.id, u.first_name, u.last_name, u.profile_image, u.role
               ORDER BY a.is_pinned DESC, a.created_at DESC
               LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) FROM announcements WHERE status = 'active'`;
    const countParams = [];
    if (department && department !== 'All') {
      countParams.push(department);
      countQuery += ` AND (department = $1 OR department = 'General')`;
    }
    const countResult = await pool.query(countQuery, countParams);

    res.json({
      announcements: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      totalPages: Math.ceil(countResult.rows[0].count / limit)
    });
  } catch (err) {
    console.error('Get announcements error:', err);
    res.status(500).json({ error: 'Failed to fetch announcements' });
  }
});

// Create announcement (with image upload)
router.post('/', authenticateToken, uploadAnnouncement.array('images', 5), async (req, res) => {
  try {
    const { title, content, department, is_anonymous } = req.body;

    const result = await pool.query(
      `INSERT INTO announcements (author_id, title, content, department, is_anonymous)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.id, title, content, department || 'General', is_anonymous === 'true' || is_anonymous === true]
    );

    const announcement = result.rows[0];

    // Insert uploaded images
    if (req.files && req.files.length > 0) {
      for (let i = 0; i < req.files.length; i++) {
        const imageUrl = `/uploads/announcements/${req.files[i].filename}`;
        await pool.query(
          `INSERT INTO announcement_images (announcement_id, image_url, display_order)
           VALUES ($1, $2, $3)`,
          [announcement.id, imageUrl, i]
        );
      }
    }

    res.status(201).json({ message: 'Announcement posted', announcement });
  } catch (err) {
    console.error('Create announcement error:', err);
    res.status(500).json({ error: 'Failed to post announcement' });
  }
});

// Delete announcement
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Check ownership or admin
    const check = await pool.query('SELECT author_id FROM announcements WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Not found' });

    if (check.rows[0].author_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await pool.query("UPDATE announcements SET status = 'deleted' WHERE id = $1", [id]);
    res.json({ message: 'Announcement deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

module.exports = router;
