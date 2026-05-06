import express, { Response } from 'express';
const router = express.Router();
import pool from '../config/database';
import { authenticateToken, requireRole } from '../middleware/auth';
import { uploadEvent } from '../middleware/upload';
import { AuthRequest } from '../types';

// Get events
// - Admin sees all (optionally filter by ?status=pending|active|...)
// - Everyone else sees active events for their department + General + Campus,
//   plus their own (any non-deleted status) so they can track pending submissions.
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { month, year, status: filterStatus } = req.query;
    const isAdmin = req.user!.role === 'admin';
    const params: unknown[] = [];

    let statusClause;
    let ownIdParam: number | null = null;
    if (isAdmin) {
      if (filterStatus && ['pending', 'active', 'cancelled', 'completed', 'rejected'].includes(filterStatus as string)) {
        params.push(filterStatus);
        statusClause = `e.status = $${params.length}`;
      } else {
        statusClause = `e.status != 'deleted'`;
      }
    } else {
      params.push(req.user!.id);
      ownIdParam = params.length;
      statusClause = `((e.status = 'active') OR (e.author_id = $${ownIdParam} AND e.status != 'deleted'))`;
    }

    let deptClause = '';
    if (!isAdmin) {
      if (req.user!.role === 'faculty') {
        deptClause = '';
      } else {
        params.push(req.user!.department || '');
        const deptParam = params.length;
        deptClause = ` AND (e.department IN ('General','Campus') OR e.department = $${deptParam} OR e.author_id = $${ownIdParam})`;
      }
    }

    if (month && year) {
      params.push(parseInt(month as string, 10), parseInt(year as string, 10));
      const mi = params.length - 1;
      const yi = params.length;
      deptClause += ` AND EXTRACT(MONTH FROM e.event_date) = $${mi} AND EXTRACT(YEAR FROM e.event_date) = $${yi}`;
    }

    const query = `
      SELECT e.*, u.first_name || ' ' || u.last_name as author_name,
        COALESCE(
          json_agg(
            json_build_object('id', ei.id, 'image_url', ei.image_url, 'display_order', ei.display_order)
          ) FILTER (WHERE ei.id IS NOT NULL), '[]'
        ) as images
      FROM events e
      LEFT JOIN users u ON e.author_id = u.id
      LEFT JOIN event_images ei ON ei.event_id = e.id
      WHERE ${statusClause}${deptClause}
      GROUP BY e.id, u.first_name, u.last_name
      ORDER BY e.event_date ASC, e.start_time ASC
    `;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get events error:', err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// Create event (faculty/admin). Admin posts auto-approve; faculty posts enter approval queue.
router.post('/', authenticateToken, requireRole('faculty', 'admin'), uploadEvent.array('images', 5), async (req: AuthRequest, res: Response) => {
  try {
    const { title, description, location, event_date, start_time, end_time, department } = req.body;
    if (!title || !event_date) return res.status(400).json({ error: 'Title and event date are required' });

    const isAdmin = req.user!.role === 'admin';
    const isFaculty = req.user!.role === 'faculty';
    const scope = (department || 'General').trim();

    // Admin and faculty can post campus-wide events
    if (scope === 'Campus' && !isAdmin && !isFaculty) {
      return res.status(403).json({ error: 'Only faculty and admins can post campus-wide events.' });
    }

    const autoApprove = isAdmin;
    const status = autoApprove ? 'active' : 'pending';
    const approvedBy = autoApprove ? req.user!.id : null;
    const approvedAt = autoApprove ? new Date() : null;

    const result = await pool.query(
      `INSERT INTO events (author_id, title, description, location, event_date, start_time, end_time, department, status, approved_by, approved_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [req.user!.id, title, description, location, event_date, start_time, end_time, scope, status, approvedBy, approvedAt]
    );

    const event = result.rows[0];

    const files = req.files as Express.Multer.File[];
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const imageUrl = `/uploads/events/${files[i].filename}`;
        await pool.query(
          `INSERT INTO event_images (event_id, image_url, display_order) VALUES ($1, $2, $3)`,
          [event.id, imageUrl, i]
        );
      }
    }

    res.status(201).json({
      message: isAdmin ? 'Event created' : 'Event submitted for admin approval',
      event
    });
  } catch (err) {
    console.error('Create event error:', err);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// Update event (author or admin). Non-admin edits return the post to pending.
router.patch('/:id', authenticateToken, requireRole('faculty', 'admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { title, description, location, event_date, start_time, end_time, department } = req.body;
    if (!title || !event_date) return res.status(400).json({ error: 'Title and event date are required' });

    const isAdmin = req.user!.role === 'admin';
    const scope = (department || 'General').trim();

    // Admin and faculty can post campus-wide events
    if (scope === 'Campus' && !isAdmin && req.user!.role !== 'faculty') {
      return res.status(403).json({ error: 'Only faculty and admins can post campus-wide events.' });
    }

    const check = await pool.query("SELECT author_id, status FROM events WHERE id = $1 AND status != 'deleted'", [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Event not found' });
    if (check.rows[0].author_id !== req.user!.id && !isAdmin) {
      return res.status(403).json({ error: 'Not authorized to edit this event' });
    }

    const nextStatus = isAdmin ? 'active' : 'pending';

    const result = await pool.query(
      `UPDATE events SET title=$1, description=$2, location=$3, event_date=$4,
              start_time=$5, end_time=$6, department=COALESCE($7, department), status=$8,
              approved_by = CASE WHEN $8 = 'active' THEN $10 ELSE approved_by END,
              approved_at = CASE WHEN $8 = 'active' THEN NOW() ELSE approved_at END,
              updated_at = NOW()
       WHERE id=$9 RETURNING *`,
      [title, description || null, location || null, event_date, start_time || null, end_time || null, scope, nextStatus, id, req.user!.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update event error:', err);
    res.status(500).json({ error: 'Failed to update event' });
  }
});

router.delete('/:id', authenticateToken, requireRole('faculty', 'admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const check = await pool.query("SELECT author_id FROM events WHERE id = $1 AND status != 'deleted'", [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Event not found' });

    if (check.rows[0].author_id !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to delete this event' });
    }

    await pool.query("UPDATE events SET status = 'deleted' WHERE id = $1", [id]);
    res.json({ message: 'Event deleted' });
  } catch (err) {
    console.error('Delete event error:', err);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

router.get('/pending/list', authenticateToken, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT e.*,
        u.first_name || ' ' || u.last_name as author_name,
        u.role as author_role,
        u.department as author_department,
        COALESCE(
          json_agg(
            json_build_object('id', ei.id, 'image_url', ei.image_url, 'display_order', ei.display_order)
          ) FILTER (WHERE ei.id IS NOT NULL), '[]'
        ) as images
      FROM events e
      LEFT JOIN users u ON e.author_id = u.id
      LEFT JOIN event_images ei ON ei.event_id = e.id
      WHERE e.status = 'pending'
      GROUP BY e.id, u.first_name, u.last_name, u.role, u.department
      ORDER BY e.event_date ASC, e.start_time ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Pending events error:', err);
    res.status(500).json({ error: 'Failed to fetch pending events' });
  }
});

router.post('/:id/approve', authenticateToken, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `UPDATE events
         SET status = 'active', approved_by = $1, approved_at = NOW(), rejection_reason = NULL, updated_at = NOW()
       WHERE id = $2 AND status = 'pending' RETURNING *`,
      [req.user!.id, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Pending event not found' });
    res.json({ message: 'Event approved', event: result.rows[0] });
  } catch (err) {
    console.error('Approve event error:', err);
    res.status(500).json({ error: 'Failed to approve event' });
  }
});

router.post('/:id/reject', authenticateToken, requireRole('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { reason } = req.body || {};
    const result = await pool.query(
      `UPDATE events
         SET status = 'rejected', approved_by = $1, approved_at = NOW(), rejection_reason = $2, updated_at = NOW()
       WHERE id = $3 AND status = 'pending' RETURNING *`,
      [req.user!.id, reason || null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Pending event not found' });
    res.json({ message: 'Event rejected', event: result.rows[0] });
  } catch (err) {
    console.error('Reject event error:', err);
    res.status(500).json({ error: 'Failed to reject event' });
  }
});

export default router;
