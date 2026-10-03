const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { authenticateToken, requireRole, requirePermission } = require('../middleware/auth');
const { uploadEvent } = require('../middleware/upload');
const { notifyAdmins, notifyAudience, notifyUser, safeNotify } = require('../services/notifications');

function actorName(user) {
  return [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() || 'A user';
}

const HOLIDAY_API_BASE = 'https://date.nager.at/api/v3/PublicHolidays';
const PUPSJ_OBSERVANCES = [
  {
    month: 7,
    day: 1,
    title: 'PUPSJ University Foundation Day',
    description: 'Annual campus observance for the PUP San Juan community.',
    location: 'PUP San Juan Campus',
  },
  {
    month: 8,
    day: 1,
    title: 'PUPSJ Enrollment Period Opens',
    description: 'Recurring enrollment kickoff period for the academic year.',
    location: 'PUP San Juan Campus',
  },
  {
    month: 1,
    day: 8,
    title: 'PUPSJ Second Semester Enrollment Reminder',
    description: 'Recurring campus enrollment reminder for the second semester.',
    location: 'PUP San Juan Campus',
  },
];

async function fetchPhilippineHolidays(year) {
  const response = await fetch(`${HOLIDAY_API_BASE}/${year}/PH`);
  if (!response.ok) throw new Error(`Holiday API responded with ${response.status}`);
  const holidays = await response.json();
  return Array.isArray(holidays) ? holidays : [];
}

function buildHolidayEntries(year, month, holidays) {
  return holidays
    .filter((holiday) => {
      const eventDate = new Date(`${holiday.date}T00:00:00`);
      return eventDate.getFullYear() === year && eventDate.getMonth() + 1 === month;
    })
    .map((holiday) => ({
      id: `holiday-${holiday.date}-${String(holiday.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      title: holiday.localName || holiday.name,
      description: holiday.name || holiday.localName,
      location: 'Philippines',
      event_date: holiday.date,
      start_time: null,
      end_time: null,
      department: 'Campus',
      status: 'active',
      author_id: null,
      author_name: 'Philippine Public Holidays',
      images: [],
      source_type: 'holiday',
      is_read_only: true,
    }));
}

function buildObservanceEntries(year, month) {
  return PUPSJ_OBSERVANCES
    .filter((entry) => entry.month === month)
    .map((entry) => ({
      id: `pupsj-${year}-${String(entry.month).padStart(2, '0')}-${String(entry.day).padStart(2, '0')}-${entry.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      title: entry.title,
      description: entry.description,
      location: entry.location || 'PUP San Juan Campus',
      event_date: `${year}-${String(entry.month).padStart(2, '0')}-${String(entry.day).padStart(2, '0')}`,
      start_time: null,
      end_time: null,
      department: 'Campus',
      status: 'active',
      author_id: null,
      author_name: 'PUPSJ Observance',
      images: [],
      source_type: 'observance',
      is_read_only: true,
    }));
}

// Get events
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { month, year, status: filterStatus } = req.query;

    await pool.query(
      `UPDATE events 
       SET is_archived = true 
       WHERE event_date < CURRENT_DATE - INTERVAL 3 MONTH 
         AND is_archived = false`
    ).catch(err => console.error('Auto-archive events error:', err));

    await pool.query(
      `DELETE FROM events 
       WHERE status = 'deleted' 
         AND updated_at < NOW() - INTERVAL 6 MONTH`
    ).catch(err => console.error('Auto-delete soft-deleted events error:', err));

    const isStaff = req.user.role === 'faculty' || req.user.role === 'admin' || req.user.role === 'superadmin';
    const isAdmin = req.user.role === 'admin';
    const params = [];

    let statusClause;
    if (isStaff) {
      if (filterStatus === 'archived') {
        statusClause = `(e.is_archived = true OR e.status = 'deleted')`;
      } else if (filterStatus && ['pending', 'active', 'cancelled', 'completed', 'rejected'].includes(filterStatus)) {
        params.push(filterStatus);
        statusClause = `e.status = ? AND e.is_archived = false`;
      } else {
        statusClause = `e.status != 'deleted' AND e.is_archived = false`;
      }
    } else {
      params.push(req.user.id);
      statusClause = `((e.status = 'active') OR (e.author_id = ? AND e.status != 'deleted')) AND e.is_archived = false`;
    }

    let deptClause = '';
    if (!isAdmin) {
      if (req.user.role === 'faculty') {
        deptClause = '';
      } else {
        params.push(req.user.department || '', req.user.id);
        deptClause = ` AND (e.department IN ('General','Campus') OR e.department = ? OR e.author_id = ?)`;
      }
    }

    if (month && year) {
      params.push(parseInt(month, 10), parseInt(year, 10));
      deptClause += ` AND MONTH(e.event_date) = ? AND YEAR(e.event_date) = ?`;
    }

    const query = `
      SELECT e.*, CONCAT(u.first_name, ' ', u.last_name) as author_name,
        p.name as page_name, p.logo_image as page_logo,
        COALESCE(
          CONCAT('[', GROUP_CONCAT(IF(ei.id IS NOT NULL, JSON_OBJECT('id', ei.id, 'image_url', ei.image_url, 'display_order', ei.display_order), NULL) SEPARATOR ','), ']'),
          '[]'
        ) as images
      FROM events e
      LEFT JOIN users u ON e.author_id = u.id
      LEFT JOIN pages p ON e.page_id = p.id
      LEFT JOIN event_images ei ON ei.event_id = e.id
      WHERE ${statusClause}${deptClause}
      GROUP BY e.id, u.first_name, u.last_name, p.name, p.logo_image
      ORDER BY e.event_date ASC, e.start_time ASC
    `;

    const [rows] = await pool.query(query, params);
    let entries = (rows || []).map(r => {
      if (typeof r.images === 'string') {
        try { r.images = JSON.parse(r.images); } catch (_) { r.images = []; }
      }
      if (!Array.isArray(r.images)) r.images = [];
      return r;
    });
    const requestedMonth = Number.parseInt(month, 10);
    const requestedYear = Number.parseInt(year, 10);
    if (Number.isInteger(requestedMonth) && Number.isInteger(requestedYear)) {
      try {
        const holidays = await fetchPhilippineHolidays(requestedYear);
        entries = entries.concat(
          buildHolidayEntries(requestedYear, requestedMonth, holidays),
          buildObservanceEntries(requestedYear, requestedMonth)
        );
      } catch (holidayErr) {
        console.error('Fetch holiday events error:', holidayErr);
        entries = entries.concat(buildObservanceEntries(requestedYear, requestedMonth));
      }
    }

    entries.sort((a, b) => {
      const dateCompare = new Date(a.event_date) - new Date(b.event_date);
      if (dateCompare !== 0) return dateCompare;
      return String(a.start_time || '').localeCompare(String(b.start_time || ''));
    });

    res.json(entries);
  } catch (err) {
    console.error('Get events error:', err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// Create event
router.post('/', authenticateToken, requireRole('faculty', 'admin', 'student'), uploadEvent.array('images', 5), async (req, res) => {
  try {
    const { title, description, location, event_date, start_time, end_time, department } = req.body;
    if (!title || !event_date) return res.status(400).json({ error: 'Title and event date are required' });

    const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
    const isFaculty = req.user.role === 'faculty';
    const isStudent = req.user.role === 'student';
    const scope = (department || 'General').trim();

    if (isStudent) {
      const { page_id } = req.body;
      if (!page_id) {
        return res.status(403).json({ error: 'Students must select a page to post events on behalf of.' });
      }
      const [pageCheck] = await pool.query(
        `SELECT id FROM pages WHERE id = ? AND status = 'approved' AND (owner_id = ? OR id IN (SELECT page_id FROM page_members WHERE user_id = ?))`,
        [page_id, req.user.id, req.user.id]
      );
      if (!pageCheck || pageCheck.length === 0) {
        return res.status(403).json({ error: 'You are not a member of that page, or the page is not approved.' });
      }
    }

    if (scope === 'Campus' && !isAdmin && !isFaculty) {
      return res.status(403).json({ error: 'Only faculty and admins can post campus-wide events.' });
    }

    const autoApprove = isAdmin;
    const status = autoApprove ? 'active' : 'pending';
    const approvedBy = autoApprove ? req.user.id : null;
    const approvedAt = autoApprove ? new Date() : null;

    let feedbackFormSchema = null;
    if (req.body.feedback_form_schema) {
      try {
        feedbackFormSchema = typeof req.body.feedback_form_schema === 'string'
          ? JSON.parse(req.body.feedback_form_schema)
          : req.body.feedback_form_schema;
      } catch (e) {
        console.error('Failed to parse feedback form schema:', e.message);
      }
    }

    const pageIdValue = isStudent ? (req.body.page_id || null) : null;
    const newId = uuidv4();

    await pool.query(
      `INSERT INTO events (id, author_id, title, description, location, event_date, start_time, end_time, department, status, approved_by, approved_at, feedback_form_schema, page_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId, req.user.id, title, description, location, event_date, start_time, end_time, scope, status, approvedBy, approvedAt, feedbackFormSchema ? JSON.stringify(feedbackFormSchema) : null, pageIdValue]
    );

    const [createdRows] = await pool.query('SELECT * FROM events WHERE id = ?', [newId]);
    const event = createdRows[0];

    if (req.files && req.files.length > 0) {
      for (let i = 0; i < req.files.length; i++) {
        const imageUrl = `/uploads/events/${req.files[i].filename}`;
        const newImgId = uuidv4();
        await pool.query(
          `INSERT INTO event_images (id, event_id, image_url, display_order) VALUES (?, ?, ?, ?)`,
          [newImgId, event.id, imageUrl, i]
        );
      }
    }

    await safeNotify('event create', async () => {
      if (status === 'pending') {
        await notifyAdmins(
          pool,
          {
            title: 'Event awaiting review',
            message: `${actorName(req.user)} submitted "${title}" for approval.`,
            type: 'event',
            link: 'page:admin-dashboard',
          },
          [req.user.id]
        );
        return;
      }

      await notifyAudience(
        pool,
        { department: scope, excludeUserIds: [req.user.id] },
        {
          title: 'New event posted',
          message: `"${title}" is now listed in the Event Calendar.`,
          type: 'event',
          link: 'page:events',
        }
      );
    });

    res.status(201).json({
      message: isAdmin ? 'Event created' : 'Event submitted for admin approval',
      event
    });
  } catch (err) {
    console.error('Create event error:', err);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// Get single event by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (id && (id.startsWith('holiday-') || id.startsWith('pupsj-'))) {
      const parts = id.split('-');
      if (parts.length >= 4) {
        const year = parseInt(parts[1], 10);
        const month = parseInt(parts[2], 10);
        if (id.startsWith('holiday-')) {
          try {
            const holidays = await fetchPhilippineHolidays(year);
            const entries = buildHolidayEntries(year, month, holidays);
            const match = entries.find(e => e.id === id);
            if (match) return res.json(match);
          } catch (e) {}
        } else {
          const entries = buildObservanceEntries(year, month);
          const match = entries.find(e => e.id === id);
          if (match) return res.json(match);
        }
      }
      return res.status(404).json({ error: 'Event not found' });
    }

    const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!UUID_REGEX.test(id)) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const isStaff = req.user.role === 'faculty' || req.user.role === 'admin' || req.user.role === 'superadmin';
    const statusClause = isStaff ? '1=1' : "e.status != 'deleted'";
    const query = `
      SELECT e.*, CONCAT(u.first_name, ' ', u.last_name) as author_name,
        p.name as page_name, p.logo_image as page_logo,
        COALESCE(
          CONCAT('[', GROUP_CONCAT(IF(ei.id IS NOT NULL, JSON_OBJECT('id', ei.id, 'image_url', ei.image_url, 'display_order', ei.display_order), NULL) SEPARATOR ','), ']'),
          '[]'
        ) as images
      FROM events e
      LEFT JOIN users u ON e.author_id = u.id
      LEFT JOIN pages p ON e.page_id = p.id
      LEFT JOIN event_images ei ON ei.event_id = e.id
      WHERE e.id = ? AND ${statusClause}
      GROUP BY e.id, u.first_name, u.last_name, p.name, p.logo_image
    `;

    const [rows] = await pool.query(query, [id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const ev = rows[0];
    if (typeof ev.images === 'string') {
      try { ev.images = JSON.parse(ev.images); } catch (_) { ev.images = []; }
    }
    if (!Array.isArray(ev.images)) ev.images = [];
    res.json(ev);
  } catch (err) {
    console.error('Get single event error:', err);
    res.status(500).json({ error: 'Failed to fetch event' });
  }
});

// Update event
router.patch('/:id', authenticateToken, requireRole('faculty', 'admin', 'student'), async (req, res) => {
  try {
    const { id } = req.params;
    const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!UUID_REGEX.test(id)) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const { title, description, location, event_date, start_time, end_time, department } = req.body;
    if (!title || !event_date) return res.status(400).json({ error: 'Title and event date are required' });

    const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
    const isStudent = req.user.role === 'student';
    const scope = (department || 'General').trim();

    if (isStudent) {
      const userDept = (req.user.department || '').trim();
      const allowed = ['General', userDept].filter(Boolean);
      if (!allowed.includes(scope)) {
        return res.status(403).json({ error: 'Students can only post General events or events for their own department.' });
      }
    }

    if (scope === 'Campus' && !isAdmin && req.user.role !== 'faculty') {
      return res.status(403).json({ error: 'Only faculty and admins can post campus-wide events.' });
    }

    const [checkRows] = await pool.query("SELECT author_id, status, title, description, location, event_date, start_time, end_time, department FROM events WHERE id = ? AND status != 'deleted'", [id]);
    if (!checkRows || checkRows.length === 0) return res.status(404).json({ error: 'Event not found' });
    const dbEvent = checkRows[0];
    if (dbEvent.author_id !== req.user.id && !isAdmin) {
      return res.status(403).json({ error: 'Not authorized to edit this event' });
    }

    const d = new Date(dbEvent.event_date);
    const datePart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let targetTime = dbEvent.end_time || dbEvent.start_time || '23:59:59';
    if (targetTime.split(':').length === 2) targetTime += ':00';
    const eventDateTime = new Date(`${datePart}T${targetTime}`);
    const eventHasConcluded = new Date() >= eventDateTime;

    if (!isAdmin && eventHasConcluded) {
      return res.status(403).json({ error: 'Cannot modify event details or questionnaire after the event has concluded.' });
    }

    const nextStatus = isAdmin ? 'active' : 'pending';

    let feedbackFormSchema = undefined;
    if (req.body.feedback_form_schema !== undefined) {
      try {
        feedbackFormSchema = typeof req.body.feedback_form_schema === 'string'
          ? JSON.parse(req.body.feedback_form_schema)
          : req.body.feedback_form_schema;
      } catch (e) {
        console.error('Failed to parse feedback form schema:', e.message);
      }
    }

    const queryParams = [
      title,
      description || null,
      location || null,
      event_date,
      start_time || null,
      end_time || null,
      scope,
      nextStatus,
      req.user.id
    ];

    let updateFields = `
      title = ?, description = ?, location = ?, event_date = ?,
      start_time = ?, end_time = ?, department = COALESCE(?, department), status = ?,
      approved_by = CASE WHEN ? = 'active' THEN ? ELSE approved_by END,
      approved_at = CASE WHEN ? = 'active' THEN NOW() ELSE approved_at END,
      updated_at = NOW()
    `;
    queryParams.splice(8, 0, nextStatus, nextStatus);

    if (feedbackFormSchema !== undefined) {
      queryParams.push(feedbackFormSchema ? JSON.stringify(feedbackFormSchema) : null);
      updateFields += `, feedback_form_schema = ?`;
    }

    queryParams.push(id);
    await pool.query(
      `UPDATE events SET ${updateFields} WHERE id = ?`,
      queryParams
    );

    const [updatedRows] = await pool.query('SELECT * FROM events WHERE id = ?', [id]);
    res.json(updatedRows[0]);
  } catch (err) {
    console.error('Update event error:', err);
    res.status(500).json({ error: 'Failed to update event' });
  }
});

router.delete('/:id', authenticateToken, requireRole('faculty', 'admin', 'student'), async (req, res) => {
  try {
    const { id } = req.params;
    const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!UUID_REGEX.test(id)) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const [checkRows] = await pool.query("SELECT author_id FROM events WHERE id = ? AND status != 'deleted'", [id]);
    if (!checkRows || checkRows.length === 0) return res.status(404).json({ error: 'Event not found' });

    if (checkRows[0].author_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized to delete this event' });
    }

    await pool.query("UPDATE events SET status = 'deleted' WHERE id = ?", [id]);
    res.json({ message: 'Event deleted' });
  } catch (err) {
    console.error('Delete event error:', err);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

router.get('/pending/list', authenticateToken, requireRole('admin'), requirePermission('events'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT e.*,
        CONCAT(u.first_name, ' ', u.last_name) as author_name,
        u.role as author_role,
        u.department as author_department,
        p.name as page_name, p.logo_image as page_logo,
        COALESCE(
          CONCAT('[', GROUP_CONCAT(IF(ei.id IS NOT NULL, JSON_OBJECT('id', ei.id, 'image_url', ei.image_url, 'display_order', ei.display_order), NULL) SEPARATOR ','), ']'),
          '[]'
        ) as images
      FROM events e
      LEFT JOIN users u ON e.author_id = u.id
      LEFT JOIN pages p ON e.page_id = p.id
      LEFT JOIN event_images ei ON ei.event_id = e.id
      WHERE e.status = 'pending'
      GROUP BY e.id, u.first_name, u.last_name, u.role, u.department, p.name, p.logo_image
      ORDER BY e.event_date ASC, e.start_time ASC
    `);
    (rows || []).forEach(r => {
      if (typeof r.images === 'string') {
        try { r.images = JSON.parse(r.images); } catch (_) { r.images = []; }
      }
      if (!Array.isArray(r.images)) r.images = [];
    });
    res.json(rows || []);
  } catch (err) {
    console.error('Pending events error:', err);
    res.status(500).json({ error: 'Failed to fetch pending events' });
  }
});

router.post('/:id/approve', authenticateToken, requireRole('admin'), requirePermission('events'), async (req, res) => {
  try {
    const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!UUID_REGEX.test(req.params.id)) {
      return res.status(404).json({ error: 'Pending event not found' });
    }
    const [checkRows] = await pool.query("SELECT * FROM events WHERE id = ? AND status = 'pending'", [req.params.id]);
    if (!checkRows || checkRows.length === 0) return res.status(404).json({ error: 'Pending event not found' });

    await pool.query(
      `UPDATE events
         SET status = 'active', approved_by = ?, approved_at = NOW(), rejection_reason = NULL, updated_at = NOW()
       WHERE id = ? AND status = 'pending'`,
      [req.user.id, req.params.id]
    );

    const [updatedRows] = await pool.query('SELECT * FROM events WHERE id = ?', [req.params.id]);
    const event = updatedRows[0];

    await safeNotify('event approve', async () => {
      await notifyUser(pool, event.author_id, {
        title: 'Event approved',
        message: `"${event.title}" is now live in the Event Calendar.`,
        type: 'event',
        link: 'page:events',
      });

      await notifyAudience(
        pool,
        { department: event.department, excludeUserIds: [event.author_id] },
        {
          title: 'New event posted',
          message: `"${event.title}" is now listed in the Event Calendar.`,
          type: 'event',
          link: 'page:events',
        }
      );
    });

    res.json({ message: 'Event approved', event });
  } catch (err) {
    console.error('Approve event error:', err);
    res.status(500).json({ error: 'Failed to approve event' });
  }
});

router.post('/:id/reject', authenticateToken, requireRole('admin'), requirePermission('events'), async (req, res) => {
  try {
    const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!UUID_REGEX.test(req.params.id)) {
      return res.status(404).json({ error: 'Pending event not found' });
    }
    const { reason } = req.body || {};
    const [checkRows] = await pool.query("SELECT * FROM events WHERE id = ? AND status = 'pending'", [req.params.id]);
    if (!checkRows || checkRows.length === 0) return res.status(404).json({ error: 'Pending event not found' });

    await pool.query(
      `UPDATE events
         SET status = 'rejected', approved_by = ?, approved_at = NOW(), rejection_reason = ?, updated_at = NOW()
       WHERE id = ? AND status = 'pending'`,
      [req.user.id, reason || null, req.params.id]
    );
    const [updatedRows] = await pool.query('SELECT * FROM events WHERE id = ?', [req.params.id]);
    const event = updatedRows[0];

    await safeNotify('event reject', async () => {
      await notifyUser(pool, event.author_id, {
        title: 'Event rejected',
        message: reason
          ? `"${event.title}" was rejected: ${reason}`
          : `"${event.title}" was rejected by an administrator.`,
        type: 'event',
        link: 'page:events',
      });
    });

    res.json({ message: 'Event rejected', event });
  } catch (err) {
    console.error('Reject event error:', err);
    res.status(500).json({ error: 'Failed to reject event' });
  }
});

// ════════════════════════════════════════════
//  EVENT FEEDBACK CUSTOM SYSTEM
// ════════════════════════════════════════════

router.get('/:id/feedback-form', authenticateToken, async (req, res) => {
  try {
    const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!UUID_REGEX.test(req.params.id)) {
      return res.json({
        schema: null,
        eventDate: null,
        startTime: null,
        endTime: null,
        alreadySubmitted: false
      });
    }

    const [eventRows] = await pool.query('SELECT feedback_form_schema, event_date, start_time, end_time FROM events WHERE id = ? AND status != \'deleted\'', [req.params.id]);
    if (!eventRows || eventRows.length === 0) return res.status(404).json({ error: 'Event not found' });
    
    const [userCheck] = await pool.query('SELECT id FROM event_feedback_responses WHERE event_id = ? AND user_id = ?', [req.params.id, req.user.id]);
    const alreadySubmitted = userCheck && userCheck.length > 0;
    
    res.json({
      schema: eventRows[0].feedback_form_schema,
      eventDate: eventRows[0].event_date,
      startTime: eventRows[0].start_time,
      endTime: eventRows[0].end_time,
      alreadySubmitted
    });
  } catch (err) {
    console.error('Get feedback form schema error:', err);
    res.status(500).json({ error: 'Failed to fetch feedback form schema' });
  }
});

router.post('/:id/feedback-submit', authenticateToken, async (req, res) => {
  try {
    const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!UUID_REGEX.test(req.params.id)) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const [eventResult] = await pool.query('SELECT event_date, start_time, end_time, feedback_form_schema FROM events WHERE id = ? AND status != \'deleted\'', [req.params.id]);
    if (!eventResult || eventResult.length === 0) return res.status(404).json({ error: 'Event not found' });
    const event = eventResult[0];
    
    const d = new Date(event.event_date);
    const datePart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let targetTime = event.end_time || event.start_time || '23:59:59';
    if (targetTime.split(':').length === 2) {
      targetTime += ':00';
    }
    const eventDateTime = new Date(`${datePart}T${targetTime}`);
    if (new Date() < eventDateTime) {
      return res.status(400).json({ error: 'Feedback can only be submitted after the event has concluded' });
    }
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    if (new Date() - eventDateTime > threeDaysMs) {
      return res.status(400).json({ error: 'Feedback submission period is closed. Reviews are only accepted within 3 days after the event has concluded.' });
    }
    
    if (!event.feedback_form_schema) {
      return res.status(400).json({ error: 'No feedback form configured for this event' });
    }
    
    if (req.user.role !== 'student' && req.user.role !== 'faculty') {
      return res.status(403).json({ error: 'Only students and faculty can submit event feedback' });
    }
    
    const [dupCheck] = await pool.query('SELECT id FROM event_feedback_responses WHERE event_id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (dupCheck && dupCheck.length > 0) {
      return res.status(400).json({ error: 'You have already submitted feedback for this event' });
    }
    
    const { answers } = req.body;
    if (!answers || typeof answers !== 'object') {
      return res.status(400).json({ error: 'Answers must be a valid JSON object' });
    }
    
    const newFeedbackId = uuidv4();
    await pool.query(
      'INSERT INTO event_feedback_responses (id, event_id, user_id, answers) VALUES (?, ?, ?, ?)',
      [newFeedbackId, req.params.id, req.user.id, JSON.stringify(answers)]
    );
    
    res.status(201).json({ message: 'Feedback submitted successfully' });
  } catch (err) {
    console.error('Submit event feedback error:', err);
    res.status(500).json({ error: 'Failed to submit event feedback' });
  }
});

router.get('/:id/feedback-stats', authenticateToken, async (req, res) => {
  try {
    const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!UUID_REGEX.test(req.params.id)) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const [eventRows] = await pool.query('SELECT author_id, feedback_form_schema FROM events WHERE id = ? AND status != \'deleted\'', [req.params.id]);
    if (!eventRows || eventRows.length === 0) return res.status(404).json({ error: 'Event not found' });
    
    const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
    if (eventRows[0].author_id !== req.user.id && !isAdmin) {
      return res.status(403).json({ error: 'Only the event creator or an administrator can view feedback results' });
    }
    
    const schema = eventRows[0].feedback_form_schema || [];
    const [responses] = await pool.query('SELECT answers FROM event_feedback_responses WHERE event_id = ?', [req.params.id]);
    const totalResponses = responses.length;
    
    const stats = schema.map(q => {
      const qId = q.id;
      const type = q.type;
      const label = q.title;
      
      const results = {
        id: qId,
        type,
        label,
        total: 0
      };
      
      const allAnswers = responses
        .map(r => r.answers[qId])
        .filter(ans => ans !== undefined && ans !== null && ans !== '');
        
      results.total = allAnswers.length;
      
      if (type === 'Short Answer' || type === 'Paragraph') {
        results.responses = allAnswers;
      } else if (type === 'Multiple Choice' || type === 'Dropdown') {
        const frequencies = {};
        (q.options || []).forEach(opt => frequencies[opt] = 0);
        allAnswers.forEach(ans => {
          frequencies[ans] = (frequencies[ans] || 0) + 1;
        });
        results.frequencies = frequencies;
      } else if (type === 'Checkboxes') {
        const frequencies = {};
        (q.options || []).forEach(opt => frequencies[opt] = 0);
        allAnswers.forEach(ansList => {
          if (Array.isArray(ansList)) {
            ansList.forEach(ans => {
              frequencies[ans] = (frequencies[ans] || 0) + 1;
            });
          } else if (typeof ansList === 'string') {
            frequencies[ansList] = (frequencies[ansList] || 0) + 1;
          }
        });
        results.frequencies = frequencies;
      } else if (type === 'Linear Scale' || type === 'Rating') {
        let sum = 0;
        const distribution = {};
        const min = type === 'Rating' ? 1 : parseInt(q.scale_min || 1);
        const max = type === 'Rating' ? 5 : parseInt(q.scale_max || 5);
        
        for (let i = min; i <= max; i++) distribution[i] = 0;
        
        allAnswers.forEach(ans => {
          const val = parseInt(ans);
          if (!isNaN(val)) {
            sum += val;
            distribution[val] = (distribution[val] || 0) + 1;
          }
        });
        
        results.average = allAnswers.length > 0 ? parseFloat((sum / allAnswers.length).toFixed(2)) : 0;
        results.distribution = distribution;
        results.min = min;
        results.max = max;
      }
      
      return results;
    });
    
    res.json({
      total: totalResponses,
      stats
    });
  } catch (err) {
    console.error('Get event feedback stats error:', err);
    res.status(500).json({ error: 'Failed to fetch event feedback stats' });
  }
});

router.post('/:id/feedback-ai-analysis', authenticateToken, async (req, res) => {
  try {
    const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!UUID_REGEX.test(req.params.id)) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const [eventRows] = await pool.query('SELECT title, author_id, feedback_form_schema FROM events WHERE id = ? AND status != \'deleted\'', [req.params.id]);
    if (!eventRows || eventRows.length === 0) return res.status(404).json({ error: 'Event not found' });
    
    const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
    if (eventRows[0].author_id !== req.user.id && !isAdmin) {
      return res.status(403).json({ error: 'Only the event creator or an administrator can generate AI analysis' });
    }
    
    const schema = eventRows[0].feedback_form_schema || [];
    const [responses] = await pool.query('SELECT answers FROM event_feedback_responses WHERE event_id = ?', [req.params.id]);
    
    if (!responses || responses.length === 0) {
      return res.status(400).json({ error: 'Cannot generate AI analysis without responses' });
    }
    
    let feedbackText = `Event: "${eventRows[0].title}"\n`;
    feedbackText += `Total Responses: ${responses.length}\n\n`;
    
    schema.forEach(q => {
      const qId = q.id;
      const qTitle = q.title;
      const type = q.type;
      
      feedbackText += `Question: "${qTitle}" (Type: ${type})\n`;
      
      const qAnswers = responses
        .map(r => r.answers[qId])
        .filter(ans => ans !== undefined && ans !== null && ans !== '');
        
      if (type === 'Short Answer' || type === 'Paragraph') {
        qAnswers.forEach((ans, idx) => {
          feedbackText += `  - Response ${idx + 1}: "${ans}"\n`;
        });
      } else if (type === 'Multiple Choice' || type === 'Dropdown' || type === 'Checkboxes') {
        const freqs = {};
        qAnswers.forEach(ans => {
          if (Array.isArray(ans)) {
            ans.forEach(a => freqs[a] = (freqs[a] || 0) + 1);
          } else {
            freqs[ans] = (freqs[ans] || 0) + 1;
          }
        });
        Object.keys(freqs).forEach(opt => {
          feedbackText += `  - "${opt}": ${freqs[opt]} selections\n`;
        });
      } else if (type === 'Linear Scale' || type === 'Rating') {
        let sum = 0;
        qAnswers.forEach(ans => sum += parseInt(ans));
        const avg = qAnswers.length > 0 ? (sum / qAnswers.length).toFixed(2) : 'N/A';
        feedbackText += `  - Average rating: ${avg} out of rating range\n`;
      }
      feedbackText += '\n';
    });
    
    const prompt = `You are the campus AI assistant, PUPBot. Analyze the feedback responses for the event "${eventRows[0].title}". 
    Below is the compilation of all question schemas and student/faculty answers:
    
    ${feedbackText}
    
    Please produce a highly comprehensive, beautiful, and structured analysis formatted in clean markdown.
    Do not use excessive intros, jump straight into the analysis.
    Use the following sections exactly:
    
    ### Sentiment Summary
    [Provide a brief sentiment overview. List percentages or qualitative summaries of how many responses feel positive, neutral, or negative.]
    
    ### Key Themes
    [Identify the major topics, recurrent threads, or key subjects mentioned across the textual and choices responses.]
    
    ### Strengths
    [Bullet points listing clear strengths identified from the feedback, including highlights and positive remarks.]
    
    ### Areas for Improvement
    [Bullet points listing weaknesses, complaints, or recommended areas for improvements identified from the feedback.]
    
    ### Conclusion
    [A single short, well-crafted overall conclusion paragraph offering suggestions or final remarks for future runs of the event.]`;
    
    const AI_SIDECAR_URL = process.env.AI_SIDECAR_URL || 'http://localhost:8001';
    const sidecarRes = await fetch(`${AI_SIDECAR_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: prompt, history: [], doc_context: [], live_data: {} }),
      signal: AbortSignal.timeout(45000)
    });
    
    if (!sidecarRes.ok) {
      throw new Error(`AI sidecar returned status ${sidecarRes.status}`);
    }
    
    const data = await sidecarRes.json();
    const responseText = data.response || '';
    
    await pool.query(
      `INSERT INTO event_feedback_ai_analysis (event_id, analysis, created_at) 
       VALUES (?, ?, NOW())
       ON DUPLICATE KEY UPDATE analysis = VALUES(analysis), created_at = NOW()`,
      [req.params.id, JSON.stringify({ markdown: responseText })]
    );
    
    res.json({ markdown: responseText });
  } catch (err) {
    console.error('Generate event feedback AI analysis error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate AI analysis' });
  }
});

router.get('/:id/feedback-ai-analysis', authenticateToken, async (req, res) => {
  try {
    const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!UUID_REGEX.test(req.params.id)) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const [eventRows] = await pool.query('SELECT author_id FROM events WHERE id = ? AND status != \'deleted\'', [req.params.id]);
    if (!eventRows || eventRows.length === 0) return res.status(404).json({ error: 'Event not found' });
    
    const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
    if (eventRows[0].author_id !== req.user.id && !isAdmin) {
      return res.status(403).json({ error: 'Only the event creator or an administrator can view AI analysis' });
    }
    
    const [rows] = await pool.query('SELECT analysis FROM event_feedback_ai_analysis WHERE event_id = ?', [req.params.id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'AI analysis not generated yet' });
    }
    
    res.json(rows[0].analysis);
  } catch (err) {
    console.error('Get event feedback AI analysis error:', err);
    res.status(500).json({ error: 'Failed to fetch AI analysis' });
  }
});

module.exports = router;
