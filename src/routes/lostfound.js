const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { uploadLostFound } = require('../middleware/upload');

// Get all lost/found items
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { type, status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let query = `
      SELECT lf.*, u.first_name || ' ' || u.last_name as reporter_name,
        COALESCE(
          json_agg(
            json_build_object('id', lfi.id, 'image_url', lfi.image_url)
          ) FILTER (WHERE lfi.id IS NOT NULL), '[]'
        ) as images
      FROM lost_found lf
      LEFT JOIN users u ON lf.reporter_id = u.id
      LEFT JOIN lost_found_images lfi ON lfi.lost_found_id = lf.id
      WHERE lf.status != 'closed'
    `;
    const params = [];

    if (type) {
      params.push(type);
      query += ` AND lf.type = $${params.length}`;
    }
    if (status) {
      params.push(status);
      query += ` AND lf.status = $${params.length}`;
    }

    query += ` GROUP BY lf.id, u.first_name, u.last_name
               ORDER BY lf.created_at DESC
               LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get lost/found error:', err);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

// Report lost/found item (with image upload)
router.post('/', authenticateToken, uploadLostFound.array('images', 5), async (req, res) => {
  try {
    const { type, item_name, description, category, location_found, contact_info } = req.body;

    const result = await pool.query(
      `INSERT INTO lost_found (reporter_id, type, item_name, description, category, location_found, contact_info)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.user.id, type, item_name, description, category, location_found, contact_info]
    );

    const item = result.rows[0];

    if (req.files && req.files.length > 0) {
      for (let i = 0; i < Math.min(req.files.length, 5); i++) {
        const imageUrl = `/uploads/lostfound/${req.files[i].filename}`;
        await pool.query(
          `INSERT INTO lost_found_images (lost_found_id, image_url, display_order) VALUES ($1, $2, $3)`,
          [item.id, imageUrl, i]
        );
      }
    }

    res.status(201).json({ message: 'Item reported', item });
  } catch (err) {
    console.error('Report item error:', err);
    res.status(500).json({ error: 'Failed to report item' });
  }
});

// Update status
router.patch('/:id/status', authenticateToken, async (req, res) => {
  try {
    const { status } = req.body;
    await pool.query(
      'UPDATE lost_found SET status = $1, updated_at = NOW() WHERE id = $2',
      [status, req.params.id]
    );
    res.json({ message: 'Status updated' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update status' });
  }
});

module.exports = router;
