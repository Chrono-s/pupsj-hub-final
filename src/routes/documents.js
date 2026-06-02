const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { uploadDocument } = require('../middleware/upload');
const { notifyAudience, notifyUsers, safeNotify } = require('../services/notifications');
const fs = require('fs');
const path = require('path');
const DOCUMENT_GLOBAL_SCOPES = ['General', 'Campus'];
const DOCUMENT_SPECIFIC_SCOPE = 'Specific Students';

// ── Auto-provision: create category_access table and category department column if they don't exist ──────
pool.query(`
  ALTER TABLE document_categories ADD COLUMN IF NOT EXISTS department VARCHAR(100) DEFAULT 'General'
`).catch(err => console.error('[documents] Auto-provision warning (department):', err.message));

pool.query(`
  CREATE TABLE IF NOT EXISTS category_access (
    category_id UUID REFERENCES document_categories(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (category_id, user_id)
  )
`).catch(err => console.error('[documents] Auto-provision warning (category_access):', err.message));

function parseWhitelist(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch (_) {
    return [];
  }
}

async function replaceDocumentAccess(client, documentId, userIds) {
  await client.query('DELETE FROM document_access WHERE document_id = $1', [documentId]);
  if (!userIds.length) return [];

  const validUsers = await client.query(
    `SELECT id
     FROM users
     WHERE role IN ('student', 'faculty')
       AND id = ANY($1::uuid[])`,
    [userIds]
  );

  for (const row of validUsers.rows) {
    await client.query(
      'INSERT INTO document_access (document_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [documentId, row.id]
    );
  }

  return validUsers.rows.map((row) => row.id);
}

async function fetchDocumentAccess(client, documentId) {
  const result = await client.query(
    `SELECT u.id, u.student_number, u.first_name, u.last_name, u.email, u.role, u.department
     FROM document_access da
     INNER JOIN users u ON u.id = da.student_id
     WHERE da.document_id = $1
       AND u.role IN ('student', 'faculty')
     ORDER BY u.role ASC, u.last_name ASC, u.first_name ASC`,
    [documentId]
  );
  return result.rows;
}

async function replaceCategoryAccess(client, categoryId, userIds) {
  await client.query('DELETE FROM category_access WHERE category_id = $1', [categoryId]);
  if (!userIds.length) return [];

  const validUsers = await client.query(
    `SELECT id
     FROM users
     WHERE role IN ('student', 'faculty')
       AND id = ANY($1::uuid[])`,
    [userIds]
  );

  for (const row of validUsers.rows) {
    await client.query(
      'INSERT INTO category_access (category_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [categoryId, row.id]
    );
  }

  return validUsers.rows.map((row) => row.id);
}

async function fetchCategoryAccess(client, categoryId) {
  const result = await client.query(
    `SELECT u.id, u.student_number, u.first_name, u.last_name, u.email, u.role, u.department
     FROM category_access ca
     INNER JOIN users u ON u.id = ca.user_id
     WHERE ca.category_id = $1
       AND u.role IN ('student', 'faculty')
     ORDER BY u.role ASC, u.last_name ASC, u.first_name ASC`,
    [categoryId]
  );
  return result.rows;
}

function actorName(user) {
  return [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() || 'A user';
}

// ── CATEGORIES ──

// Get all categories
router.get('/categories', authenticateToken, async (req, res) => {
  try {
    const { department: filterDept } = req.query;
    const isAdmin = req.user.role === 'admin';
    const params = [];
    let visibilityClause = `dt.status = 'active'`;
    let catVisibilityClause = `dc.status = 'active'`;

    if (!isAdmin) {
      if (req.user.role === 'student') {
        params.push(req.user.department || '');
        const deptParam = `$${params.length}`;
        params.push(req.user.id);
        const studentParam = `$${params.length}`;
        visibilityClause += ` AND (
          dt.department IN ('General', 'Campus')
          OR dt.department = ${deptParam}
          OR (dt.department = '${DOCUMENT_SPECIFIC_SCOPE}' AND EXISTS (
            SELECT 1 FROM document_access da WHERE da.document_id = dt.id AND da.student_id = ${studentParam}
          ))
        )`;
        catVisibilityClause += ` AND (
          dc.department IS NULL
          OR dc.department IN ('General', 'Campus')
          OR dc.department = ${deptParam}
          OR (dc.department = '${DOCUMENT_SPECIFIC_SCOPE}' AND EXISTS (
            SELECT 1 FROM category_access ca WHERE ca.category_id = dc.id AND ca.user_id = ${studentParam}
          ))
        )`;
      } else if (req.user.role === 'guest') {
        visibilityClause += ` AND dt.department = 'General'`;
        catVisibilityClause += ` AND (dc.department IS NULL OR dc.department = 'General')`;
      } else {
        params.push(req.user.department || '');
        const deptParam = `$${params.length}`;
        params.push(req.user.id);
        const facultyParam = `$${params.length}`;
        
        visibilityClause += ` AND (
          dt.department IN ('General', 'Campus')
          OR dt.department = ${deptParam}
          OR (dt.department = '${DOCUMENT_SPECIFIC_SCOPE}' AND EXISTS (
            SELECT 1 FROM document_access da WHERE da.document_id = dt.id AND da.student_id = ${facultyParam}
          ))
        )`;
        catVisibilityClause += ` AND (
          dc.department IS NULL
          OR dc.department IN ('General', 'Campus')
          OR dc.department = ${deptParam}
          OR (dc.department = '${DOCUMENT_SPECIFIC_SCOPE}' AND EXISTS (
            SELECT 1 FROM category_access ca WHERE ca.category_id = dc.id AND ca.user_id = ${facultyParam}
          ))
        )`;
      }
      if (filterDept && filterDept !== 'All') {
        params.push(filterDept);
        visibilityClause += ` AND dt.department = $${params.length}`;
        catVisibilityClause += ` AND dc.department = $${params.length}`;
      }
    } else if (filterDept && filterDept !== 'All') {
      params.push(filterDept);
      visibilityClause += ` AND dt.department = $${params.length}`;
      catVisibilityClause += ` AND dc.department = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT dc.*, u.first_name || ' ' || u.last_name as created_by_name,
        (SELECT COUNT(*) FROM document_templates dt WHERE dt.category_id = dc.id AND ${visibilityClause}) as file_count
       FROM document_categories dc
       LEFT JOIN users u ON dc.created_by = u.id
       WHERE ${catVisibilityClause}
       ORDER BY dc.name ASC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get categories error:', err);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Create category (admin/faculty only)
router.post('/categories', authenticateToken, requireRole('admin', 'faculty'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, description, department } = req.body;
    const whitelistUserIds = parseWhitelist(req.body.whitelist_student_ids);
    if (!name || !name.trim()) return res.status(400).json({ error: 'Category name is required' });

    const dept = department || 'General';
    if (dept === DOCUMENT_SPECIFIC_SCOPE && whitelistUserIds.length === 0) {
      return res.status(400).json({ error: 'Please select at least one user for Specific Users visibility.' });
    }

    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO document_categories (name, description, department, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name.trim(), description?.trim() || null, dept, req.user.id]
    );
    const category = result.rows[0];

    if (dept === DOCUMENT_SPECIFIC_SCOPE) {
      await replaceCategoryAccess(client, category.id, whitelistUserIds);
    }
    await client.query('COMMIT');
    res.status(201).json(category);
  } catch (err) {
    console.error('Create category error:', err);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// Update category (admin/faculty only)
router.patch('/categories/:id', authenticateToken, requireRole('admin', 'faculty'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { name, description, department } = req.body;
    const whitelistUserIds = parseWhitelist(req.body.whitelist_student_ids);
    if (!name || !name.trim()) return res.status(400).json({ error: 'Category name is required' });

    const dept = department || 'General';
    if (dept === DOCUMENT_SPECIFIC_SCOPE && whitelistUserIds.length === 0) {
      return res.status(400).json({ error: 'Please select at least one user for Specific Users visibility.' });
    }

    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE document_categories SET name = $1, description = $2, department = $3, updated_at = NOW()
       WHERE id = $4 AND status = 'active' RETURNING *`,
      [name.trim(), description?.trim() || null, dept, id]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Category not found' });
    }
    const category = result.rows[0];

    if (dept === DOCUMENT_SPECIFIC_SCOPE) {
      await replaceCategoryAccess(client, id, whitelistUserIds);
    } else {
      await client.query('DELETE FROM category_access WHERE category_id = $1', [id]);
    }
    await client.query('COMMIT');
    res.json(category);
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

// Get documents
// - Admin sees all.
// - Faculty and students see files whose department matches their own plus General/Campus.
router.get('/', authenticateToken, async (req, res) => {
  try {
    // Run auto-delete for soft-deleted documents: 6 months
    await pool.query(
      `DELETE FROM document_templates 
       WHERE status = 'deleted' 
         AND updated_at < NOW() - INTERVAL '6 months'`
    ).catch(err => console.error('Auto-delete soft-deleted documents error:', err));

    const { category_id, search, department: filterDept, page = 1, limit = 50 } = req.query;
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

    const isAdmin = req.user.role === 'admin';
    if (!isAdmin) {
      if (req.user.role === 'student' || req.user.role === 'faculty') {
        params.push(req.user.department || '');
        const deptParam = `$${params.length}`;
        params.push(req.user.id);
        const userParam = `$${params.length}`;
        query += ` AND (
          dt.department IN ('General', 'Campus')
          OR dt.department = ${deptParam}
          OR (dt.department = '${DOCUMENT_SPECIFIC_SCOPE}' AND EXISTS (
            SELECT 1 FROM document_access da WHERE da.document_id = dt.id AND da.student_id = ${userParam}
          ))
        )`;
      } else if (req.user.role === 'guest') {
        // Guest: ONLY 'General'
        query += ` AND dt.department = 'General'`;
      }
      if (filterDept && filterDept !== 'All') {
        params.push(filterDept);
        query += ` AND dt.department = $${params.length}`;
      }
    } else if (filterDept && filterDept !== 'All') {
      params.push(filterDept);
      query += ` AND dt.department = $${params.length}`;
    }

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

router.get('/students-search', authenticateToken, requireRole('admin', 'faculty'), async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const params = [];
    let query = `
      SELECT id, student_number, first_name, last_name, role, department
      FROM users
      WHERE role = 'student'
        AND is_active = true
    `;

    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      query += ` AND (
        LOWER(first_name || ' ' || last_name) LIKE ${params.length}
        OR LOWER(last_name || ' ' || first_name) LIKE ${params.length}
        OR LOWER(student_number) LIKE ${params.length}
      )`;
    }

    query += ` ORDER BY last_name ASC, first_name ASC LIMIT 20`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Student search error:', err);
    res.status(500).json({ error: 'Failed to search students' });
  }
});

router.get('/users-search', authenticateToken, requireRole('admin', 'faculty'), async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const params = [req.user.id];
    let query = `
      SELECT id, student_number, first_name, last_name, email, role, department
      FROM users
      WHERE id <> $1
        AND is_active = true
        AND role IN ('student', 'faculty')
    `;

    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      query += ` AND (
        LOWER(first_name || ' ' || last_name) LIKE ${params.length}
        OR LOWER(last_name || ' ' || first_name) LIKE ${params.length}
        OR LOWER(student_number) LIKE ${params.length}
        OR LOWER(email) LIKE ${params.length}
      )`;
    }

    query += ` ORDER BY role ASC, last_name ASC, first_name ASC LIMIT 20`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('User search error:', err);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

router.get('/categories/:id/access', authenticateToken, requireRole('admin', 'faculty'), async (req, res) => {
  try {
    const check = await pool.query(
      'SELECT id, department FROM document_categories WHERE id = $1 AND status = $2',
      [req.params.id, 'active']
    );
    if (!check.rows.length) return res.status(404).json({ error: 'Category not found' });

    const users = await fetchCategoryAccess(pool, req.params.id);
    res.json({ users, visibility: check.rows[0].department || 'General' });
  } catch (err) {
    console.error('Category access fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch category access list' });
  }
});

router.get('/:id/access', authenticateToken, requireRole('admin', 'faculty'), async (req, res) => {
  try {
    const check = await pool.query(
      'SELECT id, department, uploaded_by FROM document_templates WHERE id = $1 AND status = $2',
      [req.params.id, 'active']
    );
    if (!check.rows.length) return res.status(404).json({ error: 'Document not found' });

    if (req.user.role === 'faculty' && check.rows[0].uploaded_by !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to view access list for this document' });
    }

    const students = await fetchDocumentAccess(pool, req.params.id);
    res.json({ students, visibility: check.rows[0].department || 'General' });
  } catch (err) {
    console.error('Document access fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch document access list' });
  }
});

// Upload document (admin/faculty only)
router.post('/', authenticateToken, requireRole('admin', 'faculty'), uploadDocument.single('file'), async (req, res) => {
  const client = await pool.connect();
  let documentRow = null;
  let grantedStudentIds = [];
  let scope = 'General';
  try {
    const { title, description, category_id } = req.body;
    let { department } = req.body;
    const whitelistStudentIds = parseWhitelist(req.body.whitelist_student_ids);
    if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });
    if (!req.file) return res.status(400).json({ error: 'File is required' });
    if (!category_id) return res.status(400).json({ error: 'Category is required' });
    if (department === 'Campus') {
      return res.status(400).json({ error: 'Campus visibility is not allowed for document templates' });
    }
    if (department === DOCUMENT_SPECIFIC_SCOPE && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can assign specific student access.' });
    }
    if (department === DOCUMENT_SPECIFIC_SCOPE && whitelistStudentIds.length === 0) {
      return res.status(400).json({ error: 'Please select at least one student for Specific Students visibility.' });
    }

    const catCheck = await client.query("SELECT id FROM document_categories WHERE id = $1 AND status = 'active'", [category_id]);
    if (catCheck.rows.length === 0) return res.status(400).json({ error: 'Category not found' });

    department = department || 'General';
    scope = department;

    const fileUrl = `/uploads/documents/${req.file.filename}`;
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO document_templates (category_id, uploaded_by, title, description, department, file_url, file_name, file_size, file_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [category_id, req.user.id, title.trim(), description?.trim() || null, department, fileUrl, req.file.originalname, req.file.size, req.file.mimetype]
    );
    documentRow = result.rows[0];
    if (department === DOCUMENT_SPECIFIC_SCOPE) {
      grantedStudentIds = await replaceDocumentAccess(client, documentRow.id, whitelistStudentIds);
    }
    await client.query('COMMIT');

    await safeNotify('document upload', async () => {
      const payload = {
        title: 'New document template',
        message: `"${documentRow.title}" is now available in Document Templates.`,
        type: 'document',
        link: 'page:documents',
      };

      if (scope === DOCUMENT_SPECIFIC_SCOPE) {
        await notifyUsers(pool, grantedStudentIds, payload, [req.user.id]);
        return;
      }

      await notifyAudience(
        pool,
        { department: scope, excludeUserIds: [req.user.id] },
        payload
      );
    });

    res.status(201).json(documentRow);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Upload document error:', err);
    res.status(500).json({ error: 'Failed to upload document' });
  } finally {
    client.release();
  }
});

// Update document metadata (admin/faculty only)
router.patch('/:id', authenticateToken, requireRole('admin', 'faculty'), async (req, res) => {
  const client = await pool.connect();
  let grantedStudentIds = [];
  let previousDepartment = null;
  let previousAccessIds = [];
  let updatedDocument = null;
  try {
    const { id } = req.params;
    const { title, description, category_id, department } = req.body;
    const whitelistStudentIds = parseWhitelist(req.body.whitelist_student_ids);
    if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });
    if (department === 'Campus') {
      return res.status(400).json({ error: 'Campus visibility is not allowed for document templates' });
    }
    if (department === DOCUMENT_SPECIFIC_SCOPE && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can assign specific student access.' });
    }
    if (department === DOCUMENT_SPECIFIC_SCOPE && whitelistStudentIds.length === 0) {
      return res.status(400).json({ error: 'Please select at least one student for Specific Students visibility.' });
    }

    const check = await client.query(
      "SELECT uploaded_by, department FROM document_templates WHERE id = $1 AND status = 'active'", [id]
    );
    if (check.rows.length === 0) return res.status(404).json({ error: 'Document not found' });
    previousDepartment = check.rows[0].department || 'General';
    if (req.user.role === 'faculty' && check.rows[0].uploaded_by !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to edit this document' });
    }

    let deptToSet = department || null;

    await client.query('BEGIN');
    if (previousDepartment === DOCUMENT_SPECIFIC_SCOPE) {
      previousAccessIds = (await fetchDocumentAccess(client, id)).map((student) => student.id);
    }
    const result = await client.query(
      `UPDATE document_templates
         SET title = $1,
         description = $2,
             category_id = $3,
             department = COALESCE($4, department),
             updated_at = NOW()
       WHERE id = $5 AND status = 'active' RETURNING *`,
      [title.trim(), description?.trim() || null, category_id, deptToSet, id]
    );
    updatedDocument = result.rows[0];
    if (deptToSet === DOCUMENT_SPECIFIC_SCOPE) {
      grantedStudentIds = await replaceDocumentAccess(client, id, whitelistStudentIds);
    } else {
      await client.query('DELETE FROM document_access WHERE document_id = $1', [id]);
    }
    await client.query('COMMIT');

    await safeNotify('document access update', async () => {
      if ((deptToSet || previousDepartment) !== DOCUMENT_SPECIFIC_SCOPE) return;

      const newlyAddedIds = grantedStudentIds.filter((studentId) => !previousAccessIds.includes(studentId));
      if (!newlyAddedIds.length) return;

      await notifyUsers(
        pool,
        newlyAddedIds,
        {
          title: 'Document template shared with you',
          message: `"${updatedDocument.title}" was added to your Document Templates access.`,
          type: 'document',
          link: 'page:documents',
        },
        [req.user.id]
      );
    });

    res.json(updatedDocument);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Update document error:', err);
    res.status(500).json({ error: 'Failed to update document' });
  } finally {
    client.release();
  }
});

// Delete document (admin/faculty only) - soft delete
router.delete('/:id', authenticateToken, requireRole('admin', 'faculty'), async (req, res) => {
  try {
    const { id } = req.params;
    const check = await pool.query(
      "SELECT uploaded_by FROM document_templates WHERE id = $1 AND status = 'active'", [id]
    );
    if (check.rows.length === 0) return res.status(404).json({ error: 'Document not found' });
    if (req.user.role === 'faculty' && check.rows[0].uploaded_by !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to delete this document' });
    }
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
