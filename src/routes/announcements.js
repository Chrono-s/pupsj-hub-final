const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { uploadAnnouncement } = require('../middleware/upload');

// Valid post scopes that every user can see regardless of department.
const GLOBAL_SCOPES = ['General', 'Campus'];

// Get all announcements
// - Admin sees every announcement (all statuses optionally via ?status=pending|active|all).
// - Faculty/Student sees only 'active' posts in their own department + General + Campus,
//   PLUS their own posts (any status) so they can track pending/rejected submissions.
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { department: filterDept, status: filterStatus, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const isAdmin = req.user.role === 'admin';
    const params = [];

    let statusClause;
    if (isAdmin) {
      if (filterStatus && ['pending', 'active', 'archived', 'rejected'].includes(filterStatus)) {
        params.push(filterStatus);
        statusClause = `a.status = $${params.length}`;
      } else {
        statusClause = `a.status != 'deleted'`;
      }
    } else {
      // Non-admin: active posts visible per dept rules, OR own posts any status (except deleted).
      params.push(req.user.id);
      const ownIdParam = params.length;
      statusClause = `((a.status = 'active') OR (a.author_id = $${ownIdParam} AND a.status != 'deleted'))`;
    }

    let deptClause = '';
    if (!isAdmin) {
      if (req.user.role === 'faculty') {
        // Faculty are institution-wide — they see all active announcements, not filtered by dept
        deptClause = '';
      } else {
        const userDept = req.user.department || '';
        params.push(userDept);
        const deptParam = params.length;
        deptClause = ` AND (a.department IN ('General','Campus') OR a.department = $${deptParam} OR a.author_id = $${ownIdParamOrSelf(params, req.user.id)})`;
      }
    } else if (filterDept && filterDept !== 'All') {
      params.push(filterDept);
      deptClause = ` AND a.department = $${params.length}`;
    }

    let query = `
      SELECT a.*,
        u.first_name || ' ' || u.last_name as author_name,
        u.profile_image as author_image,
        u.role as author_role,
        COALESCE(
          json_agg(
            json_build_object('id', ai.id, 'image_url', ai.image_url, 'display_order', ai.display_order)
          ) FILTER (WHERE ai.id IS NOT NULL), '[]'
        ) as images
      FROM announcements a
      LEFT JOIN users u ON a.author_id = u.id
      LEFT JOIN announcement_images ai ON ai.announcement_id = a.id
      WHERE ${statusClause}${deptClause}
      GROUP BY a.id, u.first_name, u.last_name, u.profile_image, u.role
      ORDER BY a.is_pinned DESC, a.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Count
    const countParams = [];
    let countStatusClause;
    if (isAdmin) {
      if (filterStatus && ['pending', 'active', 'archived', 'rejected'].includes(filterStatus)) {
        countParams.push(filterStatus);
        countStatusClause = `status = $${countParams.length}`;
      } else {
        countStatusClause = `status != 'deleted'`;
      }
    } else {
      countParams.push(req.user.id);
      countStatusClause = `((status = 'active') OR (author_id = $${countParams.length} AND status != 'deleted'))`;
    }
    let countDeptClause = '';
    if (!isAdmin) {
      if (req.user.role === 'faculty') {
        countDeptClause = '';
      } else {
        countParams.push(req.user.department || '');
        countDeptClause = ` AND (department IN ('General','Campus') OR department = $${countParams.length} OR author_id = $1)`;
      }
    } else if (filterDept && filterDept !== 'All') {
      countParams.push(filterDept);
      countDeptClause = ` AND department = $${countParams.length}`;
    }
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM announcements WHERE ${countStatusClause}${countDeptClause}`,
      countParams
    );

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

// Helper: returns the param index for req.user.id, reusing an existing slot if already pushed.
function ownIdParamOrSelf(params, userId) {
  const idx = params.indexOf(userId);
  if (idx !== -1) return idx + 1;
  params.push(userId);
  return params.length;
}

// Create announcement (with image upload)
// Admin-authored posts auto-approve; faculty/student posts enter the pending queue.
router.post('/', authenticateToken, uploadAnnouncement.array('images', 5), async (req, res) => {
  try {
    const { title, content, department } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'Title and content are required' });

    const isAdmin = req.user.role === 'admin';
    const scope = (department || 'General').trim();

    // Only admin and faculty can broadcast to the "Campus" scope.
    if (scope === 'Campus' && !['admin', 'faculty'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only faculty and admins can post campus-wide announcements.' });
    }

    // Faculty announcements now require admin approval before they appear publicly.
    const autoApprove = isAdmin;
    const status = autoApprove ? 'active' : 'pending';
    const approvedBy = autoApprove ? req.user.id : null;
    const approvedAt = autoApprove ? new Date() : null;

    const result = await pool.query(
      `INSERT INTO announcements (author_id, title, content, department, status, approved_by, approved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.user.id, title, content, scope, status, approvedBy, approvedAt]
    );

    const announcement = result.rows[0];

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

    res.status(201).json({
      message: isAdmin ? 'Announcement posted' : 'Announcement submitted for admin approval',
      announcement
    });
  } catch (err) {
    console.error('Create announcement error:', err);
    res.status(500).json({ error: 'Failed to post announcement' });
  }
});

// Update announcement (author or admin). Edits by non-admin authors return the post to pending.
router.patch('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, department, is_pinned } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'Title and content are required' });

    const check = await pool.query(
      "SELECT author_id, status FROM announcements WHERE id = $1 AND status != 'deleted'",
      [id]
    );
    if (check.rows.length === 0) return res.status(404).json({ error: 'Announcement not found' });
    const isAdmin = req.user.role === 'admin';
    if (check.rows[0].author_id !== req.user.id && !isAdmin) {
      return res.status(403).json({ error: 'Not authorized to edit this announcement' });
    }

    // Admin edits auto-approve (e.g. if the post was pending, admin editing it means they approve it).
    // Non-admin edits revert the post to pending for re-review.
    const nextStatus = isAdmin ? 'active' : 'pending';

    const result = await pool.query(
      `UPDATE announcements
         SET title = $1, content = $2,
             department = COALESCE($3, department),
             is_pinned = COALESCE($4, is_pinned),
             status = $5,
             approved_by = CASE WHEN $5 = 'active' THEN $7 ELSE approved_by END,
             approved_at = CASE WHEN $5 = 'active' THEN NOW() ELSE approved_at END,
             updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [title, content, department || null, typeof is_pinned === 'boolean' ? is_pinned : null, nextStatus, id, req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update announcement error:', err);
    res.status(500).json({ error: 'Failed to update announcement' });
  }
});

// Delete announcement (soft delete)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

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

// ── ADMIN APPROVAL ENDPOINTS ──

// List pending announcements (admin only)
router.get('/pending/list', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.*,
        u.first_name || ' ' || u.last_name as author_name,
        u.role as author_role,
        u.department as author_department,
        COALESCE(
          json_agg(
            json_build_object('id', ai.id, 'image_url', ai.image_url, 'display_order', ai.display_order)
          ) FILTER (WHERE ai.id IS NOT NULL), '[]'
        ) as images
      FROM announcements a
      LEFT JOIN users u ON a.author_id = u.id
      LEFT JOIN announcement_images ai ON ai.announcement_id = a.id
      WHERE a.status = 'pending'
      GROUP BY a.id, u.first_name, u.last_name, u.role, u.department
      ORDER BY a.created_at ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Pending announcements error:', err);
    res.status(500).json({ error: 'Failed to fetch pending announcements' });
  }
});

// Approve a pending announcement
router.post('/:id/approve', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE announcements
         SET status = 'active', approved_by = $1, approved_at = NOW(), rejection_reason = NULL, updated_at = NOW()
       WHERE id = $2 AND status = 'pending' RETURNING *`,
      [req.user.id, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Pending announcement not found' });
    res.json({ message: 'Announcement approved', announcement: result.rows[0] });
  } catch (err) {
    console.error('Approve announcement error:', err);
    res.status(500).json({ error: 'Failed to approve announcement' });
  }
});

// Reject a pending announcement (optionally with reason)
router.post('/:id/reject', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const { reason } = req.body || {};
    const result = await pool.query(
      `UPDATE announcements
         SET status = 'rejected', approved_by = $1, approved_at = NOW(), rejection_reason = $2, updated_at = NOW()
       WHERE id = $3 AND status = 'pending' RETURNING *`,
      [req.user.id, reason || null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Pending announcement not found' });
    res.json({ message: 'Announcement rejected', announcement: result.rows[0] });
  } catch (err) {
    console.error('Reject announcement error:', err);
    res.status(500).json({ error: 'Failed to reject announcement' });
  }
});

module.exports = router;
