const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { authenticateToken, requireRole, requirePermission } = require('../middleware/auth');
const { uploadAnnouncement } = require('../middleware/upload');
const { notifyAdmins, notifyAudience, notifyUser, safeNotify } = require('../services/notifications');
const { safeJsonParse, getActorName, getPagination } = require('../utils/helpers');

const requireAnnouncements = requirePermission('announcements');

// ── GET /api/announcements ──────────────────────────────────────────────────
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { department: filterDept, status: filterStatus } = req.query;
    const { page, limit, offset } = getPagination(req.query, 20);

    // Auto-maintenance queries
    await pool.query("UPDATE announcements SET status = 'archived' WHERE created_at < NOW() - INTERVAL 3 MONTH AND status = 'active'").catch(() => {});
    await pool.query("DELETE FROM announcements WHERE status = 'deleted' AND updated_at < NOW() - INTERVAL 6 MONTH").catch(() => {});

    const isStaff = ['faculty', 'admin', 'superadmin'].includes(req.user.role);
    const isAdmin = req.user.role === 'admin';
    const params = [];

    let statusClause;
    if (isStaff) {
      if (filterStatus === 'archived') {
        statusClause = `(a.status = 'archived' OR a.status = 'deleted')`;
      } else if (filterStatus && ['pending', 'active', 'rejected'].includes(filterStatus)) {
        params.push(filterStatus);
        statusClause = `a.status = ?`;
      } else {
        statusClause = `a.status != 'deleted' AND a.status != 'archived'`;
      }
    } else {
      params.push(req.user.id);
      statusClause = `((a.status = 'active') OR (a.author_id = ? AND a.status != 'deleted'))`;
    }

    if ((req.user.role === 'student' || req.user.role === 'guest') && filterDept && filterDept !== 'All') {
      const allowedScopes = req.user.role === 'guest'
        ? new Set(['General', 'Campus'])
        : new Set(['General', 'Campus', req.user.department].filter(Boolean));
      if (!allowedScopes.has(filterDept)) {
        return res.json({ announcements: [], total: 0, page, totalPages: 0 });
      }
    }

    let deptClause = '';
    if (!isAdmin) {
      if (req.user.role === 'faculty') {
        if (filterDept && filterDept !== 'All') {
          params.push(filterDept);
          deptClause = ` AND a.department = ?`;
        }
      } else if (req.user.role === 'guest') {
        if (filterDept && filterDept !== 'All') {
          params.push(['General', 'Campus'].includes(filterDept) ? filterDept : 'General');
          deptClause = ` AND a.department = ?`;
        } else {
          deptClause = ` AND a.department IN ('General', 'Campus')`;
        }
      } else {
        const userDept = req.user.department || '';
        if (filterDept && filterDept !== 'All') {
          const allowed = ['General', 'Campus', userDept];
          params.push(allowed.includes(filterDept) ? filterDept : userDept);
          deptClause = ` AND a.department = ?`;
        } else {
          params.push(userDept, req.user.id);
          deptClause = ` AND (a.department IN ('General','Campus') OR a.department = ? OR a.author_id = ?)`;
        }
      }
    } else if (filterDept && filterDept !== 'All') {
      params.push(filterDept);
      deptClause = ` AND a.department = ?`;
    }

    params.push(limit, offset);

    const query = `
      SELECT a.*,
        CONCAT(u.first_name, ' ', u.last_name) as author_name,
        u.profile_image as author_image,
        u.role as author_role,
        pg.name as page_name,
        pg.logo_image as page_logo,
        COALESCE(
          CONCAT('[', GROUP_CONCAT(IF(ai.id IS NOT NULL, JSON_OBJECT('id', ai.id, 'image_url', ai.image_url, 'display_order', ai.display_order), NULL) SEPARATOR ','), ']'),
          '[]'
        ) as images
      FROM announcements a
      LEFT JOIN users u ON a.author_id = u.id
      LEFT JOIN pages pg ON a.page_id = pg.id
      LEFT JOIN announcement_images ai ON ai.announcement_id = a.id
      WHERE ${statusClause}${deptClause}
      GROUP BY a.id, u.first_name, u.last_name, u.profile_image, u.role, pg.name, pg.logo_image
      ORDER BY a.is_pinned DESC, a.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const [rows] = await pool.query(query, params);
    const announcements = (rows || []).map(r => ({
      ...r,
      images: safeJsonParse(r.images, []),
    }));

    res.json({ announcements, total: announcements.length, page, totalPages: 1 });
  } catch (err) {
    console.error('Get announcements error:', err);
    res.status(500).json({ error: 'Failed to fetch announcements' });
  }
});

// ── POST /api/announcements ─────────────────────────────────────────────────
router.post('/', authenticateToken, uploadAnnouncement.array('images', 5), async (req, res) => {
  try {
    const { title, content, department } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'Title and content are required' });

    const isAdmin = req.user.role === 'admin';
    const scope = (department || 'General').trim();

    if (scope === 'Campus' && !['admin', 'faculty'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only faculty and admins can post campus-wide announcements.' });
    }

    const autoApprove = isAdmin;
    const status = autoApprove ? 'active' : 'pending';
    const approvedBy = autoApprove ? req.user.id : null;
    const approvedAt = autoApprove ? new Date() : null;
    const newId = uuidv4();

    await pool.query(
      `INSERT INTO announcements (id, author_id, title, content, department, status, approved_by, approved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId, req.user.id, title, content, scope, status, approvedBy, approvedAt]
    );

    const [createdRows] = await pool.query('SELECT * FROM announcements WHERE id = ?', [newId]);
    const announcement = createdRows[0];

    if (req.files && req.files.length > 0) {
      for (let i = 0; i < req.files.length; i++) {
        const imageUrl = `/uploads/announcements/${req.files[i].filename}`;
        await pool.query(
          'INSERT INTO announcement_images (id, announcement_id, image_url, display_order) VALUES (?, ?, ?, ?)',
          [uuidv4(), announcement.id, imageUrl, i]
        );
      }
    }

    await safeNotify('announcement create', async () => {
      if (status === 'pending') {
        await notifyAdmins(pool, {
          title: 'Announcement awaiting review',
          message: `${getActorName(req.user)} submitted "${title}" for approval.`,
          type: 'announcement',
          link: 'page:admin-dashboard',
        }, [req.user.id]);
      } else {
        await notifyAudience(pool, { department: scope, excludeUserIds: [req.user.id] }, {
          title: 'New announcement',
          message: `"${title}" is now available in Announcements.`,
          type: 'announcement',
          link: 'page:announcements',
        });
      }
    });

    res.status(201).json({
      message: isAdmin ? 'Announcement posted' : 'Announcement submitted for admin approval',
      announcement
    });
  } catch (err) {
    console.error('Create announcement error:', err);
    res.status(500).json({ error: 'Failed to post announcement' });
  }
});

// ── PATCH / PUT /api/announcements/:id ──────────────────────────────────────
const handleUpdateAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, department, is_pinned } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'Title and content are required' });

    const [checkRows] = await pool.query("SELECT author_id, status, page_id FROM announcements WHERE id = ? AND status != 'deleted'", [id]);
    if (!checkRows.length) return res.status(404).json({ error: 'Announcement not found' });

    const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
    const isAuthor = checkRows[0].author_id === req.user.id;
    let isPageManager = false;
    if (checkRows[0].page_id) {
      const [pageRows] = await pool.query('SELECT owner_id FROM pages WHERE id = ?', [checkRows[0].page_id]);
      if (pageRows.length && pageRows[0].owner_id === req.user.id) {
        isPageManager = true;
      } else {
        const [memRows] = await pool.query('SELECT id FROM page_members WHERE page_id = ? AND user_id = ?', [checkRows[0].page_id, req.user.id]);
        if (memRows.length) isPageManager = true;
      }
    }

    if (!isAuthor && !isAdmin && !isPageManager) {
      return res.status(403).json({ error: 'Not authorized to edit this announcement' });
    }

    const currentStatus = checkRows[0].status;
    const nextStatus = isAdmin ? 'active' : (currentStatus === 'rejected' ? 'pending' : (currentStatus || 'pending'));
    await pool.query(
      `UPDATE announcements
         SET title = ?, content = ?,
             department = COALESCE(?, department),
             is_pinned = COALESCE(?, is_pinned),
             status = ?,
             approved_by = CASE WHEN ? = 'active' THEN ? ELSE approved_by END,
             approved_at = CASE WHEN ? = 'active' THEN NOW() ELSE approved_at END,
             updated_at = NOW()
       WHERE id = ?`,
      [title.trim(), content.trim(), department || null, typeof is_pinned === 'boolean' ? is_pinned : null, nextStatus, nextStatus, req.user.id, nextStatus, id]
    );

    if (req.files && req.files.length > 0) {
      const keepImages = req.body.keep_images ? (Array.isArray(req.body.keep_images) ? req.body.keep_images : [req.body.keep_images]) : [];
      if (keepImages.length > 0) {
        await pool.query('DELETE FROM announcement_images WHERE announcement_id = ? AND id NOT IN (?) AND image_url NOT IN (?)', [id, keepImages, keepImages]).catch(() => {});
      } else if (req.body.replace_images === 'true' || req.body.replace_images === true) {
        await pool.query('DELETE FROM announcement_images WHERE announcement_id = ?', [id]);
      }
      for (let i = 0; i < req.files.length; i++) {
        const imageUrl = `/uploads/announcements/${req.files[i].filename}`;
        await pool.query(
          'INSERT INTO announcement_images (id, announcement_id, image_url, display_order) VALUES (?, ?, ?, ?)',
          [uuidv4(), id, imageUrl, i]
        );
      }
    }

    const [fetchRows] = await pool.query(`
      SELECT a.*,
        CONCAT(u.first_name, ' ', u.last_name) as author_name,
        u.profile_image as author_image,
        u.role as author_role,
        pg.name as page_name,
        pg.logo_image as page_logo,
        COALESCE(
          CONCAT('[', GROUP_CONCAT(IF(ai.id IS NOT NULL, JSON_OBJECT('id', ai.id, 'image_url', ai.image_url, 'display_order', ai.display_order), NULL) SEPARATOR ','), ']'),
          '[]'
        ) as images
      FROM announcements a
      LEFT JOIN users u ON a.author_id = u.id
      LEFT JOIN pages pg ON a.page_id = pg.id
      LEFT JOIN announcement_images ai ON ai.announcement_id = a.id
      WHERE a.id = ?
      GROUP BY a.id, u.first_name, u.last_name, u.profile_image, u.role, pg.name, pg.logo_image
    `, [id]);

    const announcement = fetchRows[0] || {};
    announcement.images = safeJsonParse(announcement.images, []);
    res.json(announcement);
  } catch (err) {
    console.error('Update announcement error:', err);
    res.status(500).json({ error: 'Failed to update announcement' });
  }
};

router.patch('/:id', authenticateToken, uploadAnnouncement.array('images', 5), handleUpdateAnnouncement);
router.put('/:id', authenticateToken, uploadAnnouncement.array('images', 5), handleUpdateAnnouncement);

// ── DELETE /api/announcements/:id ──────────────────────────────────────────
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const [checkRows] = await pool.query('SELECT author_id FROM announcements WHERE id = ?', [id]);
    if (!checkRows.length) return res.status(404).json({ error: 'Not found' });

    if (checkRows[0].author_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await pool.query("UPDATE announcements SET status = 'deleted' WHERE id = ?", [id]);
    res.json({ message: 'Announcement deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

// ── ADMIN APPROVAL ENDPOINTS ────────────────────────────────────────────────
router.get('/pending/list', authenticateToken, requireRole('admin'), requireAnnouncements, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT a.*,
        CONCAT(u.first_name, ' ', u.last_name) as author_name,
        u.role as author_role,
        u.department as author_department,
        pg.name as page_name,
        pg.logo_image as page_logo,
        COALESCE(
          CONCAT('[', GROUP_CONCAT(IF(ai.id IS NOT NULL, JSON_OBJECT('id', ai.id, 'image_url', ai.image_url, 'display_order', ai.display_order), NULL) SEPARATOR ','), ']'),
          '[]'
        ) as images
      FROM announcements a
      LEFT JOIN users u ON a.author_id = u.id
      LEFT JOIN pages pg ON a.page_id = pg.id
      LEFT JOIN announcement_images ai ON ai.announcement_id = a.id
      WHERE a.status = 'pending'
      GROUP BY a.id, u.first_name, u.last_name, u.role, u.department, pg.name, pg.logo_image
      ORDER BY a.created_at ASC
    `);

    const result = (rows || []).map(r => ({
      ...r,
      images: safeJsonParse(r.images, []),
    }));
    res.json(result);
  } catch (err) {
    console.error('Pending announcements error:', err);
    res.status(500).json({ error: 'Failed to fetch pending announcements' });
  }
});

router.post('/:id/approve', authenticateToken, requireRole('admin'), requireAnnouncements, async (req, res) => {
  try {
    const [updateResult] = await pool.query(
      `UPDATE announcements
         SET status = 'active', approved_by = ?, approved_at = NOW(), rejection_reason = NULL, updated_at = NOW()
       WHERE id = ? AND status = 'pending'`,
      [req.user.id, req.params.id]
    );
    if (updateResult.affectedRows === 0) return res.status(404).json({ error: 'Pending announcement not found' });

    const [fetchRows] = await pool.query('SELECT * FROM announcements WHERE id = ?', [req.params.id]);
    const announcement = fetchRows[0];

    await safeNotify('announcement approve', async () => {
      await notifyUser(pool, announcement.author_id, {
        title: 'Announcement approved',
        message: `"${announcement.title}" is now live in Announcements.`,
        type: 'announcement',
        link: 'page:announcements',
      });
      await notifyAudience(pool, { department: announcement.department, excludeUserIds: [announcement.author_id] }, {
        title: 'New announcement',
        message: `"${announcement.title}" is now available in Announcements.`,
        type: 'announcement',
        link: 'page:announcements',
      });
    });

    res.json({ message: 'Announcement approved', announcement });
  } catch (err) {
    console.error('Approve announcement error:', err);
    res.status(500).json({ error: 'Failed to approve announcement' });
  }
});

router.post('/:id/reject', authenticateToken, requireRole('admin'), requireAnnouncements, async (req, res) => {
  try {
    const { reason } = req.body || {};
    const [updateResult] = await pool.query(
      `UPDATE announcements
         SET status = 'rejected', approved_by = ?, approved_at = NOW(), rejection_reason = ?, updated_at = NOW()
       WHERE id = ? AND status = 'pending'`,
      [req.user.id, reason || null, req.params.id]
    );
    if (updateResult.affectedRows === 0) return res.status(404).json({ error: 'Pending announcement not found' });

    const [fetchRows] = await pool.query('SELECT * FROM announcements WHERE id = ?', [req.params.id]);
    const announcement = fetchRows[0];

    await safeNotify('announcement reject', async () => {
      await notifyUser(pool, announcement.author_id, {
        title: 'Announcement rejected',
        message: reason ? `"${announcement.title}" was rejected: ${reason}` : `"${announcement.title}" was rejected by an administrator.`,
        type: 'announcement',
        link: 'page:announcements',
      });
    });

    res.json({ message: 'Announcement rejected', announcement });
  } catch (err) {
    console.error('Reject announcement error:', err);
    res.status(500).json({ error: 'Failed to reject announcement' });
  }
});

module.exports = router;
