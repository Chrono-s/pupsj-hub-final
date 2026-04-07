const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { uploadDocument } = require('../middleware/upload');
const fs = require('fs');
const path = require('path');

// ── CATEGORIES ──

// Get all categories
router.get('/categories', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT dc.*, u.first_name || ' ' || u.last_name as created_by_name,
        (SELECT COUNT(*) FROM document_templates dt WHERE dt.category_id = dc.id AND dt.status = 'active') as file_count
       FROM document_categories dc
       LEFT JOIN users u ON dc.created_by = u.id
       WHERE dc.status = 'active'
       ORDER BY dc.name ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get categories error:', err);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Create category (admin/faculty only)
router.post('/categories', authenticateToken, requireRole('admin', 'faculty'), async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Category name is required' });

    const result = await pool.query(
      `INSERT INTO document_categories (name, description, created_by)
       VALUES ($1, $2, $3) RETURNING *`,
      [name.trim(), description?.trim() || null, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create category error:', err);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// Update category (admin/faculty only)
router.patch('/categories/:id', authenticateToken, requireRole('admin', 'faculty'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Category name is required' });

    const result = await pool.query(
      `UPDATE document_categories SET name = $1, description = $2, updated_at = NOW()
       WHERE id = $3 AND status = 'active' RETURNING *`,
      [name.trim(), description?.trim() || null, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Category not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update category error:', err);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// Delete category (admin/faculty only) - soft delete
router.delete('/categories/:id', authenticateToken, requireRole('admin', 'faculty'), async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("UPDATE document_categories SET status = 'deleted', updated_at = NOW() WHERE id = $1", [id]);
    // Also soft-delete all documents in this category
    await pool.query("UPDATE document_templates SET status = 'deleted', updated_at = NOW() WHERE category_id = $1", [id]);
    res.json({ message: 'Category deleted' });
  } catch (err) {
    console.error('Delete category error:', err);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

// ── DOCUMENTS ──

// Get documents (optionally filtered by category)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { category_id, search, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    const params = [];
    let query = `
      SELECT dt.*, dc.name as category_name,
        u.first_name || ' ' || u.last_name as uploaded_by_name
      FROM document_templates dt
      LEFT JOIN document_categories dc ON dt.category_id = dc.id
      LEFT JOIN users u ON dt.uploaded_by = u.id
      WHERE dt.status = 'active'
    `;

    if (category_id) {
      params.push(category_id);
      query += ` AND dt.category_id = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (dt.title ILIKE $${params.length} OR dt.description ILIKE $${params.length} OR dt.file_name ILIKE $${params.length})`;
    }

    query += ` ORDER BY dt.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get documents error:', err);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

// Upload document (admin/faculty only)
router.post('/', authenticateToken, requireRole('admin', 'faculty'), uploadDocument.single('file'), async (req, res) => {
  try {
    const { title, description, category_id } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });
    if (!req.file) return res.status(400).json({ error: 'File is required' });
    if (!category_id) return res.status(400).json({ error: 'Category is required' });

    // Verify category exists
    const catCheck = await pool.query("SELECT id FROM document_categories WHERE id = $1 AND status = 'active'", [category_id]);
    if (catCheck.rows.length === 0) return res.status(400).json({ error: 'Category not found' });

    const fileUrl = `/uploads/documents/${req.file.filename}`;
    const result = await pool.query(
      `INSERT INTO document_templates (category_id, uploaded_by, title, description, file_url, file_name, file_size, file_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [category_id, req.user.id, title.trim(), description?.trim() || null, fileUrl, req.file.originalname, req.file.size, req.file.mimetype]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Upload document error:', err);
    res.status(500).json({ error: 'Failed to upload document' });
  }
});

// Update document metadata (admin/faculty only)
router.patch('/:id', authenticateToken, requireRole('admin', 'faculty'), async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, category_id } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });

    const result = await pool.query(
      `UPDATE document_templates SET title = $1, description = $2, category_id = $3, updated_at = NOW()
       WHERE id = $4 AND status = 'active' RETURNING *`,
      [title.trim(), description?.trim() || null, category_id, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Document not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update document error:', err);
    res.status(500).json({ error: 'Failed to update document' });
  }
});

// Delete document (admin/faculty only) - soft delete
router.delete('/:id', authenticateToken, requireRole('admin', 'faculty'), async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("UPDATE document_templates SET status = 'deleted', updated_at = NOW() WHERE id = $1", [id]);
    res.json({ message: 'Document deleted' });
  } catch (err) {
    console.error('Delete document error:', err);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// Track download
router.post('/:id/download', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('UPDATE document_templates SET download_count = download_count + 1 WHERE id = $1', [id]);
    res.json({ message: 'Download tracked' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to track download' });
  }
});

module.exports = router;
