const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { uploadDocument } = require('../middleware/upload');
const { notifyAudience, notifyUsers, safeNotify } = require('../services/notifications');
const { safeJsonParse } = require('../utils/helpers');

const DOCUMENT_GLOBAL_SCOPES = ['General', 'Campus'];
const DOCUMENT_SPECIFIC_SCOPE = 'Specific Students';

// ── Auto-provisioning tables and columns if not present ─────────────────────
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
  const parsed = safeJsonParse(raw, null);
  if (Array.isArray(parsed)) return parsed.filter(Boolean);
  if (Array.isArray(raw)) return raw.filter(Boolean);
  return [];
}

async function syncAccessList(client, tableName, idColumnName, entityId, userIds) {
  await client.query(`DELETE FROM ${tableName} WHERE ${idColumnName} = ?`, [entityId]);
  if (!userIds.length) return [];

  const [validUsers] = await client.query(
    `SELECT id FROM users WHERE role IN ('student', 'faculty') AND id IN (?)`,
    [userIds]
  );

  const validIds = (validUsers || []).map(u => u.id);
  for (const uid of validIds) {
    const userCol = tableName === 'document_access' ? 'student_id' : 'user_id';
    await client.query(
      `INSERT IGNORE INTO ${tableName} (${idColumnName}, ${userCol}) VALUES (?, ?)`,
      [entityId, uid]
    );
  }
  return validIds;
}

async function fetchAccessUsers(db, tableName, idColumnName, entityId) {
  const userCol = tableName === 'document_access' ? 'student_id' : 'user_id';
  const [rows] = await db.query(
    `SELECT u.id, u.student_number, u.first_name, u.last_name, u.email, u.role, u.department
     FROM ${tableName} a
     INNER JOIN users u ON u.id = a.${userCol}
     WHERE a.${idColumnName} = ?
       AND u.role IN ('student', 'faculty')
     ORDER BY u.role ASC, u.last_name ASC, u.first_name ASC`,
    [entityId]
  );
  return rows || [];
}

// ──────────────────────────────────────────────
//  CATEGORIES
// ──────────────────────────────────────────────

// Get all categories with access-filtered file counts
router.get('/categories', authenticateToken, async (req, res) => {
  try {
    const { department: filterDept } = req.query;
    const isAdmin = req.user.role === 'admin';
    let visibilityClause = `dt.status = 'active'`;
    let catVisibilityClause = `dc.status = 'active'`;

    const visParams = [];
    const catParams = [];

    if (!isAdmin) {
      if (req.user.role === 'student' || req.user.role === 'faculty') {
        const userDept = req.user.department || '';
        const userId = req.user.id;

        visibilityClause += ` AND (
          dt.department IN ('General', 'Campus')
          OR dt.department = ?
          OR (dt.department = '${DOCUMENT_SPECIFIC_SCOPE}' AND EXISTS (
            SELECT 1 FROM document_access da WHERE da.document_id = dt.id AND da.student_id = ?
          ))
        )`;
        visParams.push(userDept, userId);

        catVisibilityClause += ` AND (
          dc.department IS NULL
          OR dc.department IN ('General', 'Campus')
          OR dc.department = ?
          OR (dc.department = '${DOCUMENT_SPECIFIC_SCOPE}' AND EXISTS (
            SELECT 1 FROM category_access ca WHERE ca.category_id = dc.id AND ca.user_id = ?
          ))
        )`;
        catParams.push(userDept, userId);
      } else if (req.user.role === 'guest') {
        visibilityClause += ` AND dt.department = 'General'`;
        catVisibilityClause += ` AND (dc.department IS NULL OR dc.department = 'General')`;
      }
    }

    if (filterDept && filterDept !== 'All') {
      visibilityClause += ` AND dt.department = ?`;
      catVisibilityClause += ` AND dc.department = ?`;
      visParams.push(filterDept);
      catParams.push(filterDept);
    }

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
    res.json(rows || []);
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

    await client.beginTransaction();
    const newCategoryId = uuidv4();
    await client.query(
      `INSERT INTO document_categories (id, name, description, department, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [newCategoryId, name.trim(), description?.trim() || null, dept, req.user.id]
    );
    const [categoryRows] = await client.query('SELECT * FROM document_categories WHERE id = ?', [newCategoryId]);

    if (dept === DOCUMENT_SPECIFIC_SCOPE) {
      await syncAccessList(client, 'category_access', 'category_id', newCategoryId, whitelistUserIds);
    }
    await client.commit();
    res.status(201).json(categoryRows[0]);
  } catch (err) {
    try { await client.rollback(); } catch (_) {}
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

    await client.beginTransaction();
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
      await client.rollback();
      return res.status(404).json({ error: 'Category not found' });
    }

    if (dept === DOCUMENT_SPECIFIC_SCOPE) {
      await syncAccessList(client, 'category_access', 'category_id', id, whitelistUserIds);
    } else {
      await client.query('DELETE FROM category_access WHERE category_id = ?', [id]);
    }
    await client.commit();
    res.json(updatedRows[0]);
  } catch (err) {
    try { await client.rollback(); } catch (_) {}
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
    await pool.query("UPDATE document_templates SET status = 'deleted', updated_at = NOW() WHERE category_id = ?", [id]);
    res.json({ message: 'Category deleted' });
  } catch (err) {
    console.error('Delete category error:', err);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

// ──────────────────────────────────────────────
//  DOCUMENTS
// ──────────────────────────────────────────────

// Get documents list
router.get('/', authenticateToken, async (req, res) => {
  try {
    // Purge documents soft-deleted over 6 months ago
    await pool.query(
      `DELETE FROM document_templates
       WHERE status = 'deleted' AND updated_at < NOW() - INTERVAL 6 MONTH`
    ).catch(err => console.error('Auto-delete soft-deleted documents error:', err));

    const { category_id, search, department: filterDept, page = 1, limit = 50 } = req.query;
    const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
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
        params.push(req.user.department || '', req.user.id);
        query += ` AND (
          dt.department IN ('General', 'Campus')
          OR dt.department = ?
          OR (dt.department = '${DOCUMENT_SPECIFIC_SCOPE}' AND EXISTS (
            SELECT 1 FROM document_access da WHERE da.document_id = dt.id AND da.student_id = ?
          ))
        )`;
      } else if (req.user.role === 'guest') {
        query += ` AND dt.department = 'General'`;
      }
    }

    if (filterDept && filterDept !== 'All') {
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
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const [rows] = await pool.query(query, params);
    res.json(rows || []);
  } catch (err) {
    console.error('Get documents error:', err);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

// Search students for permissions assignment
router.get('/students-search', authenticateToken, requireRole('admin', 'faculty'), async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const params = [];
    let query = `
      SELECT id, student_number, first_name, last_name, role, department
      FROM users
      WHERE role = 'student' AND is_active = 1
    `;

    if (q) {
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
      query += ` AND (
        LOWER(CONCAT(first_name, ' ', last_name)) LIKE ?
        OR LOWER(CONCAT(last_name, ' ', first_name)) LIKE ?
        OR LOWER(student_number) LIKE ?
      )`;
    }

    query += ` ORDER BY last_name ASC, first_name ASC LIMIT 20`;
    const [rows] = await pool.query(query, params);
    res.json(rows || []);
  } catch (err) {
    console.error('Student search error:', err);
    res.status(500).json({ error: 'Failed to search students' });
  }
});

// Search users (students + faculty) for category/document permissions
router.get('/users-search', authenticateToken, requireRole('admin', 'faculty'), async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const params = [req.user.id];
    let query = `
      SELECT id, student_number, first_name, last_name, email, role, department
      FROM users
      WHERE id <> ?
        AND is_active = 1
        AND role IN ('student', 'faculty')
    `;

    if (q) {
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
      query += ` AND (
        LOWER(CONCAT(first_name, ' ', last_name)) LIKE ?
        OR LOWER(CONCAT(last_name, ' ', first_name)) LIKE ?
        OR LOWER(student_number) LIKE ?
        OR LOWER(email) LIKE ?
      )`;
    }

    query += ` ORDER BY role ASC, last_name ASC, first_name ASC LIMIT 20`;
    const [rows] = await pool.query(query, params);
    res.json(rows || []);
  } catch (err) {
    console.error('User search error:', err);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

// Get category access whitelist
router.get('/categories/:id/access', authenticateToken, requireRole('admin', 'faculty'), async (req, res) => {
  try {
    const [checkRows] = await pool.query(
      'SELECT id, department FROM document_categories WHERE id = ? AND status = ?',
      [req.params.id, 'active']
    );
    if (!checkRows.length) return res.status(404).json({ error: 'Category not found' });

    const users = await fetchAccessUsers(pool, 'category_access', 'category_id', req.params.id);
    res.json({ users, visibility: checkRows[0].department || 'General' });
  } catch (err) {
    console.error('Category access fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch category access list' });
  }
});

// Get document access whitelist
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

    const students = await fetchAccessUsers(pool, 'document_access', 'document_id', req.params.id);
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
    if (department === DOCUMENT_SPECIFIC_SCOPE && !['admin', 'superadmin', 'faculty'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only admins and faculty can assign specific student access.' });
    }
    if (department === DOCUMENT_SPECIFIC_SCOPE && whitelistStudentIds.length === 0) {
      return res.status(400).json({ error: 'Please select at least one student for Specific Students visibility.' });
    }

    const [catCheck] = await client.query("SELECT id FROM document_categories WHERE id = ? AND status = 'active'", [category_id]);
    if (catCheck.length === 0) return res.status(400).json({ error: 'Category not found' });

    department = department || 'General';
    scope = department;

    const fileUrl = `/uploads/documents/${req.file.filename}`;
    await client.beginTransaction();
    const newDocumentId = uuidv4();
    await client.query(
      `INSERT INTO document_templates (id, category_id, uploaded_by, title, description, department, file_url, file_name, file_size, file_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newDocumentId, category_id, req.user.id, title.trim(), description?.trim() || null, department, fileUrl, req.file.originalname, req.file.size, req.file.mimetype]
    );
    const [documentRows] = await client.query('SELECT * FROM document_templates WHERE id = ?', [newDocumentId]);
    documentRow = documentRows[0];

    if (department === DOCUMENT_SPECIFIC_SCOPE) {
      grantedStudentIds = await syncAccessList(client, 'document_access', 'document_id', documentRow.id, whitelistStudentIds);
    }
    await client.commit();

    await safeNotify('document upload', async () => {
      const payload = {
        title: 'New document template',
        message: `"${documentRow.title}" is now available in Document Templates.`,
        type: 'document',
        link: 'page:documents',
      };

      if (scope === DOCUMENT_SPECIFIC_SCOPE) {
        await notifyUsers(pool, grantedStudentIds, payload, [req.user.id]);
      } else {
        await notifyAudience(pool, { department: scope, excludeUserIds: [req.user.id] }, payload);
      }
    });

    res.status(201).json(documentRow);
  } catch (err) {
    try { await client.rollback(); } catch (_) {}
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
    if (department === DOCUMENT_SPECIFIC_SCOPE && !['admin', 'superadmin', 'faculty'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only admins and faculty can assign specific student access.' });
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

    const deptToSet = department || null;

    await client.beginTransaction();
    if (previousDepartment === DOCUMENT_SPECIFIC_SCOPE) {
      previousAccessIds = (await fetchAccessUsers(client, 'document_access', 'document_id', id)).map(s => s.id);
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
      grantedStudentIds = await syncAccessList(client, 'document_access', 'document_id', id, whitelistStudentIds);
    } else {
      await client.query('DELETE FROM document_access WHERE document_id = ?', [id]);
    }
    await client.commit();

    await safeNotify('document access update', async () => {
      if ((deptToSet || previousDepartment) !== DOCUMENT_SPECIFIC_SCOPE) return;
      const newlyAddedIds = grantedStudentIds.filter(uid => !previousAccessIds.includes(uid));
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
    try { await client.rollback(); } catch (_) {}
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
