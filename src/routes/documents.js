const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { uploadDocument } = require('../middleware/upload');
const { notifyAudience, notifyUsers, safeNotify } = require('../services/notifications');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const DOCUMENT_GLOBAL_SCOPES = ['General', 'Campus'];
const DOCUMENT_SPECIFIC_SCOPE = 'Specific Students';

// ── Auto-provision: create category_access table and category department column if they don't exist ──────
pool.query(`
  ALTER TABLE document_categories ADD COLUMN IF NOT EXISTS department VARCHAR(100) DEFAULT 'General'
`).catch(err => console.error('[documents] Auto-provision warning (department):', err.message));

pool.query(`
  CREATE TABLE IF NOT EXISTS category_access (
    category_id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    PRIMARY KEY (category_id, user_id),
    CONSTRAINT fk_ca_category FOREIGN KEY (category_id) REFERENCES document_categories(id) ON DELETE CASCADE,
    CONSTRAINT fk_ca_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
  await client.query('DELETE FROM document_access WHERE document_id = ?', [documentId]);
  if (!userIds.length) return [];

  const placeholders = userIds.map(() => '?').join(', ');
  const [validUsers] = await client.query(
    `SELECT id
     FROM users
     WHERE role IN ('student', 'faculty')
       AND id IN (${placeholders})`,
    userIds
  );

  for (const row of validUsers) {
    await client.query(
      'INSERT IGNORE INTO document_access (document_id, student_id) VALUES (?, ?)',
      [documentId, row.id]
    );
  }

  return validUsers.map((row) => row.id);
}

async function fetchDocumentAccess(client, documentId) {
  const [rows] = await client.query(
    `SELECT u.id, u.student_number, u.first_name, u.last_name, u.email, u.role, u.department
     FROM document_access da
     INNER JOIN users u ON u.id = da.student_id
     WHERE da.document_id = ?
       AND u.role IN ('student', 'faculty')
     ORDER BY u.role ASC, u.last_name ASC, u.first_name ASC`,
    [documentId]
  );
  return rows;
}

async function replaceCategoryAccess(client, categoryId, userIds) {
  await client.query('DELETE FROM category_access WHERE category_id = ?', [categoryId]);
  if (!userIds.length) return [];

  const placeholders = userIds.map(() => '?').join(', ');
  const [validUsers] = await client.query(
    `SELECT id
     FROM users
     WHERE role IN ('student', 'faculty')
       AND id IN (${placeholders})`,
    userIds
  );

  for (const row of validUsers) {
    await client.query(
      'INSERT IGNORE INTO category_access (category_id, user_id) VALUES (?, ?)',
      [categoryId, row.id]
    );
  }

  return validUsers.map((row) => row.id);
}

async function fetchCategoryAccess(client, categoryId) {
  const [rows] = await client.query(
    `SELECT u.id, u.student_number, u.first_name, u.last_name, u.email, u.role, u.department
     FROM category_access ca
     INNER JOIN users u ON u.id = ca.user_id
     WHERE ca.category_id = ?
       AND u.role IN ('student', 'faculty')
     ORDER BY u.role ASC, u.last_name ASC, u.first_name ASC`,
    [categoryId]
  );
  return rows;
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
        const deptParamIdx = params.length; // position of dept param
        params.push(req.user.id);
        const studentParamIdx = params.length; // position of student param
        visibilityClause += ` AND (
          dt.department IN ('General', 'Campus')
          OR dt.department = ?
          OR (dt.department = '${DOCUMENT_SPECIFIC_SCOPE}' AND EXISTS (
            SELECT 1 FROM document_access da WHERE da.document_id = dt.id AND da.student_id = ?
          ))
        )`;
        catVisibilityClause += ` AND (
          dc.department IS NULL
          OR dc.department IN ('General', 'Campus')
          OR dc.department = ?
          OR (dc.department = '${DOCUMENT_SPECIFIC_SCOPE}' AND EXISTS (
            SELECT 1 FROM category_access ca WHERE ca.category_id = dc.id AND ca.user_id = ?
          ))
        )`;
      } else if (req.user.role === 'guest') {
        visibilityClause += ` AND dt.department = 'General'`;
        catVisibilityClause += ` AND (dc.department IS NULL OR dc.department = 'General')`;
      } else {
        params.push(req.user.department || '');
        params.push(req.user.id);
        visibilityClause += ` AND (
          dt.department IN ('General', 'Campus')
          OR dt.department = ?
          OR (dt.department = '${DOCUMENT_SPECIFIC_SCOPE}' AND EXISTS (
            SELECT 1 FROM document_access da WHERE da.document_id = dt.id AND da.student_id = ?
          ))
        )`;
        catVisibilityClause += ` AND (
          dc.department IS NULL
          OR dc.department IN ('General', 'Campus')
          OR dc.department = ?
          OR (dc.department = '${DOCUMENT_SPECIFIC_SCOPE}' AND EXISTS (
            SELECT 1 FROM category_access ca WHERE ca.category_id = dc.id AND ca.user_id = ?
          ))
        )`;
      }
      if (filterDept && filterDept !== 'All') {
        params.push(filterDept);
        visibilityClause += ` AND dt.department = ?`;
        catVisibilityClause += ` AND dc.department = ?`;
      }
    } else if (filterDept && filterDept !== 'All') {
      params.push(filterDept);
      visibilityClause += ` AND dt.department = ?`;
      catVisibilityClause += ` AND dc.department = ?`;
    }

    // For the subquery in SELECT, we need to repeat the visibilityClause params
    // Build the final params array: cat params come first (for catVisibilityClause in WHERE),
    // visibility params (for subquery) must appear in the order the ?s are consumed.
    // Strategy: build separate param arrays and merge.

    // visibilityClause params (for subquery): matches the ?s in visibilityClause
    const visParams = [];
    const catParams = [];

    if (!isAdmin) {
      if (req.user.role === 'student' || (!['guest'].includes(req.user.role))) {
        if (req.user.role !== 'guest') {
          visParams.push(req.user.department || '', req.user.id);
          catParams.push(req.user.department || '', req.user.id);
        }
      }
      if (filterDept && filterDept !== 'All') {
        visParams.push(filterDept);
        catParams.push(filterDept);
      }
    } else if (filterDept && filterDept !== 'All') {
      visParams.push(filterDept);
      catParams.push(filterDept);
    }

    // For the correlated subquery the visibilityClause is inlined, so params order is:
    // [visParams (subquery ?s), catParams (WHERE ?s)]
    // But since mysql2 binds ?s left-to-right, we need to pass them in the correct order.
    // The SELECT subquery comes before the WHERE clause in SQL evaluation order for param binding.
    // Rebuild correctly:
    const finalParams = [...visParams, ...catParams];

    const [rows] = await pool.query(
      `SELECT dc.*, CONCAT(u.first_name, ' ', u.last_name) as created_by_name,
        (SELECT COUNT(*) FROM document_templates dt WHERE dt.category_id = dc.id AND ${visibilityClause}) as file_count
       FROM document_categories dc
       LEFT JOIN users u ON dc.created_by = u.id
       WHERE ${catVisibilityClause}
       ORDER BY dc.name ASC`,
      finalParams
    );
    res.json(rows);
  } catch (err) {
    console.error('Get categories error:', err);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Create category (admin/faculty only)
router.post('/categories', authenticateToken, requireRole('admin', 'faculty'), async (req, res) => {
  const client = await pool.getConnection();
  try {
    const { name, description, department } = req.body;
    const whitelistUserIds = parseWhitelist(req.body.whitelist_student_ids);
    if (!name || !name.trim()) return res.status(400).json({ error: 'Category name is required' });

    const dept = department || 'General';
    if (dept === DOCUMENT_SPECIFIC_SCOPE && whitelistUserIds.length === 0) {
      return res.status(400).json({ error: 'Please select at least one user for Specific Users visibility.' });
    }

    await client.query('BEGIN');
    const newCategoryId = uuidv4();
    await client.query(
      `INSERT INTO document_categories (id, name, description, department, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [newCategoryId, name.trim(), description?.trim() || null, dept, req.user.id]
    );
    const [categoryRows] = await client.query(
      'SELECT * FROM document_categories WHERE id = ?',
      [newCategoryId]
    );
    const category = categoryRows[0];

    if (dept === DOCUMENT_SPECIFIC_SCOPE) {
      await replaceCategoryAccess(client, category.id, whitelistUserIds);
    }
    await client.query('COMMIT');
    res.status(201).json(category);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Create category error:', err);
    res.status(500).json({ error: 'Failed to create category' });
  } finally {
    client.release();
  }
});

// Update category (admin/faculty only)
router.patch('/categories/:id', authenticateToken, requireRole('admin', 'faculty'), async (req, res) => {
  const client = await pool.getConnection();
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
    await client.query(
      `UPDATE document_categories SET name = ?, description = ?, department = ?, updated_at = NOW()
       WHERE id = ? AND status = 'active'`,
      [name.trim(), description?.trim() || null, dept, id]
    );
    const [updatedRows] = await client.query(
      `SELECT * FROM document_categories WHERE id = ? AND status = 'active'`,
      [id]
    );
    if (updatedRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Category not found' });
    }
    const category = updatedRows[0];

    if (dept === DOCUMENT_SPECIFIC_SCOPE) {
      await replaceCategoryAccess(client, id, whitelistUserIds);
    } else {
      await client.query('DELETE FROM category_access WHERE category_id = ?', [id]);
    }
    await client.query('COMMIT');
    res.json(category);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Update category error:', err);
    res.status(500).json({ error: 'Failed to update category' });
  } finally {
    client.release();
  }
});

// Delete category (admin/faculty only) - soft delete
router.delete('/categories/:id', authenticateToken, requireRole('admin', 'faculty'), async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("UPDATE document_categories SET status = 'deleted', updated_at = NOW() WHERE id = ?", [id]);
    // Also soft-delete all documents in this category
    await pool.query("UPDATE document_templates SET status = 'deleted', updated_at = NOW() WHERE category_id = ?", [id]);
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
         AND updated_at < NOW() - INTERVAL 6 MONTH`
    ).catch(err => console.error('Auto-delete soft-deleted documents error:', err));

    const { category_id, search, department: filterDept, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;
    const params = [];
    let query = `
      SELECT dt.*, dc.name as category_name,
        CONCAT(u.first_name, ' ', u.last_name) as uploaded_by_name
      FROM document_templates dt
      LEFT JOIN document_categories dc ON dt.category_id = dc.id
      LEFT JOIN users u ON dt.uploaded_by = u.id
      WHERE dt.status = 'active'
    `;

    const isAdmin = req.user.role === 'admin';
    if (!isAdmin) {
      if (req.user.role === 'student' || req.user.role === 'faculty') {
        params.push(req.user.department || '');
        params.push(req.user.id);
        query += ` AND (
          dt.department IN ('General', 'Campus')
          OR dt.department = ?
          OR (dt.department = '${DOCUMENT_SPECIFIC_SCOPE}' AND EXISTS (
            SELECT 1 FROM document_access da WHERE da.document_id = dt.id AND da.student_id = ?
          ))
        )`;
      } else if (req.user.role === 'guest') {
        // Guest: ONLY 'General'
        query += ` AND dt.department = 'General'`;
      }
      if (filterDept && filterDept !== 'All') {
        params.push(filterDept);
        query += ` AND dt.department = ?`;
      }
    } else if (filterDept && filterDept !== 'All') {
      params.push(filterDept);
      query += ` AND dt.department = ?`;
    }

    if (category_id) {
      params.push(category_id);
      query += ` AND dt.category_id = ?`;
    }

    if (search) {
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
      query += ` AND (dt.title LIKE ? OR dt.description LIKE ? OR dt.file_name LIKE ?)`;
    }

    query += ` ORDER BY dt.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    const [rows] = await pool.query(query, params);
    res.json(rows);
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
        AND is_active = 1
    `;

    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      query += ` AND (
        LOWER(CONCAT(first_name, ' ', last_name)) LIKE ?
        OR LOWER(CONCAT(last_name, ' ', first_name)) LIKE ?
        OR LOWER(student_number) LIKE ?
      )`;
      // Duplicate the param for each ? placeholder
      params.push(`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`);
    }

    query += ` ORDER BY last_name ASC, first_name ASC LIMIT 20`;
    const [rows] = await pool.query(query, params);
    res.json(rows);
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
      WHERE id <> ?
        AND is_active = 1
        AND role IN ('student', 'faculty')
    `;

    if (q) {
      params.push(
        `%${q.toLowerCase()}%`,
        `%${q.toLowerCase()}%`,
        `%${q.toLowerCase()}%`,
        `%${q.toLowerCase()}%`
      );
      query += ` AND (
        LOWER(CONCAT(first_name, ' ', last_name)) LIKE ?
        OR LOWER(CONCAT(last_name, ' ', first_name)) LIKE ?
        OR LOWER(student_number) LIKE ?
        OR LOWER(email) LIKE ?
      )`;
    }

    query += ` ORDER BY role ASC, last_name ASC, first_name ASC LIMIT 20`;
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('User search error:', err);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

router.get('/categories/:id/access', authenticateToken, requireRole('admin', 'faculty'), async (req, res) => {
  try {
    const [checkRows] = await pool.query(
      'SELECT id, department FROM document_categories WHERE id = ? AND status = ?',
      [req.params.id, 'active']
    );
    if (!checkRows.length) return res.status(404).json({ error: 'Category not found' });

    const users = await fetchCategoryAccess(pool, req.params.id);
    res.json({ users, visibility: checkRows[0].department || 'General' });
  } catch (err) {
    console.error('Category access fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch category access list' });
  }
});

router.get('/:id/access', authenticateToken, requireRole('admin', 'faculty'), async (req, res) => {
  try {
    const [checkRows] = await pool.query(
      'SELECT id, department, uploaded_by FROM document_templates WHERE id = ? AND status = ?',
      [req.params.id, 'active']
    );
    if (!checkRows.length) return res.status(404).json({ error: 'Document not found' });

    if (req.user.role === 'faculty' && checkRows[0].uploaded_by !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to view access list for this document' });
    }

    const students = await fetchDocumentAccess(pool, req.params.id);
    res.json({ students, visibility: checkRows[0].department || 'General' });
  } catch (err) {
    console.error('Document access fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch document access list' });
  }
});

// Upload document (admin/faculty only)
router.post('/', authenticateToken, requireRole('admin', 'faculty'), uploadDocument.single('file'), async (req, res) => {
  const client = await pool.getConnection();
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

    const [catCheck] = await client.query("SELECT id FROM document_categories WHERE id = ? AND status = 'active'", [category_id]);
    if (catCheck.length === 0) return res.status(400).json({ error: 'Category not found' });

    department = department || 'General';
    scope = department;

    const fileUrl = `/uploads/documents/${req.file.filename}`;
    await client.query('BEGIN');
    const newDocumentId = uuidv4();
    await client.query(
      `INSERT INTO document_templates (id, category_id, uploaded_by, title, description, department, file_url, file_name, file_size, file_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newDocumentId, category_id, req.user.id, title.trim(), description?.trim() || null, department, fileUrl, req.file.originalname, req.file.size, req.file.mimetype]
    );
    const [documentRows] = await client.query(
      'SELECT * FROM document_templates WHERE id = ?',
      [newDocumentId]
    );
    documentRow = documentRows[0];

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
  const client = await pool.getConnection();
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

    const [checkRows] = await client.query(
      "SELECT uploaded_by, department FROM document_templates WHERE id = ? AND status = 'active'", [id]
    );
    if (checkRows.length === 0) return res.status(404).json({ error: 'Document not found' });
    previousDepartment = checkRows[0].department || 'General';
    if (req.user.role === 'faculty' && checkRows[0].uploaded_by !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to edit this document' });
    }

    let deptToSet = department || null;

    await client.query('BEGIN');
    if (previousDepartment === DOCUMENT_SPECIFIC_SCOPE) {
      previousAccessIds = (await fetchDocumentAccess(client, id)).map((student) => student.id);
    }
    await client.query(
      `UPDATE document_templates
         SET title = ?,
         description = ?,
             category_id = ?,
             department = COALESCE(?, department),
             updated_at = NOW()
       WHERE id = ? AND status = 'active'`,
      [title.trim(), description?.trim() || null, category_id, deptToSet, id]
    );
    const [updatedRows] = await client.query(
      `SELECT * FROM document_templates WHERE id = ? AND status = 'active'`,
      [id]
    );
    updatedDocument = updatedRows[0];

    if (deptToSet === DOCUMENT_SPECIFIC_SCOPE) {
      grantedStudentIds = await replaceDocumentAccess(client, id, whitelistStudentIds);
    } else {
      await client.query('DELETE FROM document_access WHERE document_id = ?', [id]);
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
    const [checkRows] = await pool.query(
      "SELECT uploaded_by FROM document_templates WHERE id = ? AND status = 'active'", [id]
    );
    if (checkRows.length === 0) return res.status(404).json({ error: 'Document not found' });
    if (req.user.role === 'faculty' && checkRows[0].uploaded_by !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to delete this document' });
    }
    await pool.query("UPDATE document_templates SET status = 'deleted', updated_at = NOW() WHERE id = ?", [id]);
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
    await pool.query('UPDATE document_templates SET download_count = download_count + 1 WHERE id = ?', [id]);
    res.json({ message: 'Download tracked' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to track download' });
  }
});

module.exports = router;
