const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { uploadPages, uploadAnnouncement } = require('../middleware/upload');
const { notifyUser, notifyAdmins, notifyAudience, safeNotify } = require('../services/notifications');

function actorName(user) {
  return [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() || 'A user';
}

// ════════════════════════════════════════════
//  PAGE CRUD
// ════════════════════════════════════════════

// Create page request (student = pending, superadmin = auto-approved)
router.post('/', authenticateToken, uploadPages.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'cover', maxCount: 1 }
]), async (req, res) => {
  try {
    const { name, description, category } = req.body;
    if (!name || !category) return res.status(400).json({ error: 'Page name and category are required' });

    const isSuperAdmin = req.user.role === 'superadmin';
    const status = isSuperAdmin ? 'approved' : 'pending';

    let logoImage = null;
    let coverImage = null;
    if (req.files?.logo?.[0]) logoImage = `/uploads/pages/${req.files.logo[0].filename}`;
    if (req.files?.cover?.[0]) coverImage = `/uploads/pages/${req.files.cover[0].filename}`;

    const newId = uuidv4();
    await pool.query(
      `INSERT INTO pages (id, owner_id, name, description, category, logo_image, cover_image, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId, req.user.id, name, description || null, category, logoImage, coverImage, status]
    );

    const [pageRows] = await pool.query('SELECT * FROM pages WHERE id = ?', [newId]);
    const createdPage = pageRows[0];

    if (status === 'pending') {
      await safeNotify('page create request', async () => {
        await notifyAdmins(pool, {
          title: 'New page request',
          message: `${actorName(req.user)} requested to create a page: "${name}"`,
          type: 'page',
          link: 'page:request:' + createdPage.id,
        }, [req.user.id]);
      });
    }

    res.status(201).json({
      message: isSuperAdmin ? 'Page created and approved' : 'Page request submitted for approval',
      page: createdPage
    });
  } catch (err) {
    console.error('Create page error:', err);
    res.status(500).json({ error: 'Failed to create page' });
  }
});

// Get all active (approved) pages
router.get('/active', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT p.*, CONCAT(u.first_name, ' ', u.last_name) as owner_name, u.department as owner_department
      FROM pages p
      LEFT JOIN users u ON p.owner_id = u.id
      WHERE p.status = 'approved'
      ORDER BY p.name ASC
    `);
    res.json(rows || []);
  } catch (err) {
    console.error('Get active pages error:', err);
    res.status(500).json({ error: 'Failed to fetch pages' });
  }
});

// Get pages owned by or member of (for current user)
router.get('/my-pages', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT p.*, CONCAT(u.first_name, ' ', u.last_name) as owner_name, u.department as owner_department,
        CASE WHEN p.owner_id = ? THEN 'owner' ELSE 'member' END as my_role
      FROM pages p
      LEFT JOIN users u ON p.owner_id = u.id
      WHERE p.owner_id = ? OR p.id IN (SELECT page_id FROM page_members WHERE user_id = ?)
      ORDER BY p.created_at DESC
    `, [req.user.id, req.user.id, req.user.id]);
    res.json(rows || []);
  } catch (err) {
    console.error('Get my pages error:', err);
    res.status(500).json({ error: 'Failed to fetch your pages' });
  }
});

// Get pending page requests (admin/superadmin)
router.get('/requests', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const [rows] = await pool.query(`
      SELECT p.*, CONCAT(u.first_name, ' ', u.last_name) as owner_name, u.department as owner_department, u.email as owner_email
      FROM pages p
      LEFT JOIN users u ON p.owner_id = u.id
      WHERE p.status = 'pending'
      ORDER BY p.created_at ASC
    `);
    res.json(rows || []);
  } catch (err) {
    console.error('Get page requests error:', err);
    res.status(500).json({ error: 'Failed to fetch page requests' });
  }
});

// Get a single page profile with its announcements
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const [pageRows] = await pool.query(`
      SELECT p.*, CONCAT(u.first_name, ' ', u.last_name) as owner_name, u.department as owner_department
      FROM pages p
      LEFT JOIN users u ON p.owner_id = u.id
      WHERE p.id = ?
    `, [req.params.id]);

    if (!pageRows || pageRows.length === 0) return res.status(404).json({ error: 'Page not found' });
    const page = pageRows[0];

    const [annRows] = await pool.query(`
      SELECT a.*,
        p2.name as author_name,
        p2.logo_image as author_image,
        'Page' as author_role,
        COALESCE(
          CONCAT('[', GROUP_CONCAT(IF(ai.id IS NOT NULL, JSON_OBJECT('id', ai.id, 'image_url', ai.image_url, 'display_order', ai.display_order), NULL) SEPARATOR ','), ']'),
          '[]'
        ) as images
      FROM announcements a
      LEFT JOIN pages p2 ON a.page_id = p2.id
      LEFT JOIN announcement_images ai ON ai.announcement_id = a.id
      WHERE a.page_id = ? AND a.status = 'active'
      GROUP BY a.id, p2.name, p2.logo_image
      ORDER BY a.created_at DESC
    `, [req.params.id]);
    (annRows || []).forEach(r => {
      if (typeof r.images === 'string') {
        try { r.images = JSON.parse(r.images); } catch (_) { r.images = []; }
      }
      if (!Array.isArray(r.images)) r.images = [];
    });

    const [memberRows] = await pool.query(`
      SELECT pm.id as membership_id, pm.user_id, pm.role, pm.created_at,
        CONCAT(u.first_name, ' ', u.last_name) as name, u.email, u.profile_image
      FROM page_members pm
      LEFT JOIN users u ON pm.user_id = u.id
      WHERE pm.page_id = ?
      ORDER BY pm.created_at ASC
    `, [req.params.id]);

    const isOwner = page.owner_id === req.user.id;
    const isMember = (memberRows || []).some(m => m.user_id === req.user.id);
    const isSuperAdmin = req.user.role === 'superadmin';

    res.json({
      page,
      announcements: annRows || [],
      members: memberRows || [],
      isOwner,
      isMember,
      canPost: isOwner || isMember,
      canManage: isOwner || isSuperAdmin,
    });
  } catch (err) {
    console.error('Get page error:', err);
    res.status(500).json({ error: 'Failed to fetch page' });
  }
});

// Approve page request (admin/superadmin)
router.post('/:id/approve', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const [checkRows] = await pool.query('SELECT * FROM pages WHERE id = ? AND status = \'pending\'', [req.params.id]);
    if (!checkRows || checkRows.length === 0) return res.status(404).json({ error: 'Pending page not found' });

    await pool.query(
      `UPDATE pages SET status = 'approved', rejection_reason = NULL, updated_at = NOW()
       WHERE id = ? AND status = 'pending'`,
      [req.params.id]
    );
    const [pageRows] = await pool.query('SELECT * FROM pages WHERE id = ?', [req.params.id]);
    const page = pageRows[0];

    await safeNotify('page approve', async () => {
      await notifyUser(pool, page.owner_id, {
        title: 'Page approved! 🎉',
        message: `Your page "${page.name}" has been approved and is now live.`,
        type: 'page',
        link: 'page:profile:' + page.id,
      });
    });

    res.json({ message: 'Page approved', page });
  } catch (err) {
    console.error('Approve page error:', err);
    res.status(500).json({ error: 'Failed to approve page' });
  }
});

// Reject page request (admin/superadmin)
router.post('/:id/reject', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { reason } = req.body || {};
    const [checkRows] = await pool.query('SELECT * FROM pages WHERE id = ? AND status = \'pending\'', [req.params.id]);
    if (!checkRows || checkRows.length === 0) return res.status(404).json({ error: 'Pending page not found' });

    await pool.query(
      `UPDATE pages SET status = 'rejected', rejection_reason = ?, updated_at = NOW()
       WHERE id = ? AND status = 'pending'`,
      [reason || null, req.params.id]
    );
    const [pageRows] = await pool.query('SELECT * FROM pages WHERE id = ?', [req.params.id]);
    const page = pageRows[0];

    await safeNotify('page reject', async () => {
      await notifyUser(pool, page.owner_id, {
        title: 'Page request rejected',
        message: reason
          ? `Your page "${page.name}" was rejected: ${reason}`
          : `Your page "${page.name}" was rejected.`,
        type: 'page',
        link: 'page:request:' + page.id,
      });
    });

    res.json({ message: 'Page rejected', page });
  } catch (err) {
    console.error('Reject page error:', err);
    res.status(500).json({ error: 'Failed to reject page' });
  }
});

// Edit page (owner or superadmin only)
router.patch('/:id', authenticateToken, uploadPages.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'cover', maxCount: 1 }
]), async (req, res) => {
  try {
    const [pageRows] = await pool.query('SELECT * FROM pages WHERE id = ?', [req.params.id]);
    if (!pageRows || pageRows.length === 0) return res.status(404).json({ error: 'Page not found' });

    const isOwner = pageRows[0].owner_id === req.user.id;
    const isSuperAdmin = req.user.role === 'superadmin';
    if (!isOwner && !isSuperAdmin) {
      return res.status(403).json({ error: 'Only the page owner or superadmin can edit this page' });
    }

    const { name, description, category } = req.body;
    let logoImage = pageRows[0].logo_image;
    let coverImage = pageRows[0].cover_image;
    if (req.files?.logo?.[0]) logoImage = `/uploads/pages/${req.files.logo[0].filename}`;
    if (req.files?.cover?.[0]) coverImage = `/uploads/pages/${req.files.cover[0].filename}`;

    await pool.query(
      `UPDATE pages SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        category = COALESCE(?, category),
        logo_image = ?,
        cover_image = ?,
        updated_at = NOW()
       WHERE id = ?`,
      [name || null, description || null, category || null, logoImage, coverImage, req.params.id]
    );
    const [updatedRows] = await pool.query('SELECT * FROM pages WHERE id = ?', [req.params.id]);
    res.json({ message: 'Page updated', page: updatedRows[0] });
  } catch (err) {
    console.error('Edit page error:', err);
    res.status(500).json({ error: 'Failed to update page' });
  }
});

// Delete page (owner or superadmin only)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const [pageRows] = await pool.query('SELECT * FROM pages WHERE id = ?', [req.params.id]);
    if (!pageRows || pageRows.length === 0) return res.status(404).json({ error: 'Page not found' });

    const isOwner = pageRows[0].owner_id === req.user.id;
    const isSuperAdmin = req.user.role === 'superadmin';
    if (!isOwner && !isSuperAdmin) {
      return res.status(403).json({ error: 'Only the page owner or superadmin can delete this page' });
    }

    await pool.query(`UPDATE announcements SET page_id = NULL WHERE page_id = ?`, [req.params.id]);
    await pool.query(`DELETE FROM page_members WHERE page_id = ?`, [req.params.id]);
    await pool.query(`DELETE FROM pages WHERE id = ?`, [req.params.id]);

    res.json({ message: 'Page deleted' });
  } catch (err) {
    console.error('Delete page error:', err);
    res.status(500).json({ error: 'Failed to delete page' });
  }
});

// ════════════════════════════════════════════
//  MEMBERS MANAGEMENT
// ════════════════════════════════════════════

// Add member (owner or superadmin only)
router.post('/:id/members', authenticateToken, async (req, res) => {
  try {
    const [pageRows] = await pool.query('SELECT * FROM pages WHERE id = ?', [req.params.id]);
    if (!pageRows || pageRows.length === 0) return res.status(404).json({ error: 'Page not found' });

    const isOwner = pageRows[0].owner_id === req.user.id;
    const isSuperAdmin = req.user.role === 'superadmin';
    if (!isOwner && !isSuperAdmin) {
      return res.status(403).json({ error: 'Only the page owner or superadmin can add members' });
    }

    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required to add a member' });

    const [userRows] = await pool.query(
      `SELECT id, first_name, last_name, email, role FROM users WHERE email = ? AND is_active = TRUE`,
      [email.trim().toLowerCase()]
    );
    if (!userRows || userRows.length === 0) return res.status(404).json({ error: 'User not found with that email' });

    const targetUser = userRows[0];
    if (targetUser.id === pageRows[0].owner_id) {
      return res.status(400).json({ error: 'The page owner cannot be added as a member' });
    }

    const [existingRows] = await pool.query(
      'SELECT id FROM page_members WHERE page_id = ? AND user_id = ?',
      [req.params.id, targetUser.id]
    );
    if (existingRows && existingRows.length > 0) return res.status(400).json({ error: 'User is already a member of this page' });

    const newMemberId = uuidv4();
    await pool.query(
      'INSERT INTO page_members (id, page_id, user_id) VALUES (?, ?, ?)',
      [newMemberId, req.params.id, targetUser.id]
    );

    await safeNotify('page member add', async () => {
      await notifyUser(pool, targetUser.id, {
        title: 'Added to a page',
        message: `You have been added as a member of "${pageRows[0].name}". You can now post on this page.`,
        type: 'page',
        link: 'page:announcements',
      });
    });

    res.json({ message: `${targetUser.first_name} ${targetUser.last_name} added as member`, user: targetUser });
  } catch (err) {
    console.error('Add member error:', err);
    res.status(500).json({ error: 'Failed to add member' });
  }
});

// Remove member
router.delete('/:id/members/:userId', authenticateToken, async (req, res) => {
  try {
    const [pageRows] = await pool.query('SELECT * FROM pages WHERE id = ?', [req.params.id]);
    if (!pageRows || pageRows.length === 0) return res.status(404).json({ error: 'Page not found' });

    const isOwner = pageRows[0].owner_id === req.user.id;
    const isSuperAdmin = req.user.role === 'superadmin';
    const isSelf = req.params.userId === req.user.id;
    if (!isOwner && !isSuperAdmin && !isSelf) {
      return res.status(403).json({ error: 'Not authorized to remove this member' });
    }

    await pool.query('DELETE FROM page_members WHERE page_id = ? AND user_id = ?', [req.params.id, req.params.userId]);
    res.json({ message: 'Member removed' });
  } catch (err) {
    console.error('Remove member error:', err);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// Get members list
router.get('/:id/members', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT pm.id as membership_id, pm.user_id, pm.role, pm.created_at,
        CONCAT(u.first_name, ' ', u.last_name) as name, u.email, u.profile_image, u.department
      FROM page_members pm
      LEFT JOIN users u ON pm.user_id = u.id
      WHERE pm.page_id = ?
      ORDER BY pm.created_at ASC
    `, [req.params.id]);
    res.json(rows || []);
  } catch (err) {
    console.error('Get members error:', err);
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

// ════════════════════════════════════════════
//  POST ANNOUNCEMENT AS PAGE
// ════════════════════════════════════════════

router.post('/:id/announcements', authenticateToken, uploadAnnouncement.array('images', 5), async (req, res) => {
  try {
    const pageId = req.params.id;

    const [pageRows] = await pool.query(`
      SELECT p.*, u.department as owner_department
      FROM pages p
      LEFT JOIN users u ON p.owner_id = u.id
      WHERE p.id = ? AND p.status = 'approved'
    `, [pageId]);

    if (!pageRows || pageRows.length === 0) {
      return res.status(404).json({ error: 'Approved page not found' });
    }
    const page = pageRows[0];

    const isOwner = page.owner_id === req.user.id;
    let isMember = false;
    if (!isOwner) {
      const [memberCheck] = await pool.query(
        'SELECT id FROM page_members WHERE page_id = ? AND user_id = ?',
        [pageId, req.user.id]
      );
      isMember = memberCheck && memberCheck.length > 0;
    }

    if (!isOwner && !isMember && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'You are not authorized to post on this page' });
    }

    const { title, content, department } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'Title and content are required' });

    const ownerDept = page.owner_department || '';
    const allowedDepts = ['General', ownerDept].filter(Boolean);
    const scope = (department || 'General').trim();

    if (!allowedDepts.includes(scope)) {
      return res.status(403).json({
        error: `This page can only post to: ${allowedDepts.join(' or ')}`
      });
    }

    const isSuperAdmin = req.user.role === 'superadmin';
    const status = isSuperAdmin ? 'active' : 'pending';
    const newAnnId = uuidv4();

    await pool.query(
      `INSERT INTO announcements (id, author_id, title, content, department, status, page_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [newAnnId, req.user.id, title, content, scope, status, pageId]
    );
    const [createdAnnRows] = await pool.query('SELECT * FROM announcements WHERE id = ?', [newAnnId]);
    const announcement = createdAnnRows[0];

    if (req.files && req.files.length > 0) {
      for (let i = 0; i < req.files.length; i++) {
        const imageUrl = `/uploads/announcements/${req.files[i].filename}`;
        const newImgId = uuidv4();
        await pool.query(
          `INSERT INTO announcement_images (id, announcement_id, image_url, display_order) VALUES (?, ?, ?, ?)`,
          [newImgId, announcement.id, imageUrl, i]
        );
      }
    }

    await safeNotify('page announcement', async () => {
      if (status === 'pending') {
        await notifyAdmins(pool, {
          title: 'Page announcement awaiting review',
          message: `"${page.name}" submitted "${title}" for approval.`,
          type: 'announcement',
          link: 'page:admin-dashboard',
        }, [req.user.id]);
      } else {
        await notifyAudience(pool, { department: scope, excludeUserIds: [req.user.id] }, {
          title: 'New announcement from a page',
          message: `"${page.name}" posted "${title}" in Announcements.`,
          type: 'announcement',
          link: 'page:announcements',
        });
      }
    });

    res.status(201).json({
      message: isSuperAdmin ? 'Announcement posted' : 'Announcement submitted for admin approval',
      announcement
    });
  } catch (err) {
    console.error('Page announcement error:', err);
    res.status(500).json({ error: 'Failed to post announcement' });
  }
});

module.exports = router;
