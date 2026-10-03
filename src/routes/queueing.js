const express = require('express');
const { EventEmitter } = require('events');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { authenticateToken, optionalAuth, requirePermission, requireRole } = require('../middleware/auth');
const { notifyUser, safeNotify } = require('../services/notifications');

const router = express.Router();
const queueEvents = new EventEmitter();
queueEvents.setMaxListeners(0);
const TZ = 'Asia/Manila';
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DEFAULT_HOURS = { mon: { open: '08:00', close: '17:00' }, tue: { open: '08:00', close: '17:00' }, wed: { open: '08:00', close: '17:00' }, thu: { open: '08:00', close: '17:00' }, fri: { open: '08:00', close: '17:00' } };
const WALK_IN_OPEN = '06:00';
const WALK_IN_CLOSE = '18:00';
const DAILY_WALK_IN_LIMIT = 50;
const DAILY_APPOINTMENT_LIMIT = 50;
const APPOINTMENT_INTERVAL_MINUTES = 15;
const validTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value || '');
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
const isSuperadmin = req => (req.user.actualRole || req.user.role) === 'superadmin';
const codeFor = value => {
  const raw = String(value || '').trim();
  if (!raw) return 'Q';
  const stopWords = new Set(['of', 'the', 'and', 'in', 'for', 'at', 'to', 'a', 'an', 'ng', 'mga', 'sa']);
  const words = raw.split(/[\s\-_/]+/).filter(w => w.length > 0 && !stopWords.has(w.toLowerCase()));
  if (words.length > 1) {
    const acr = words.map(w => w[0]).join('').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (acr.length >= 2) return acr.slice(0, 5);
  }
  const clean = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const common = { REGISTRAR: 'REG', CASHIER: 'CSH', ACCOUNTING: 'ACC', GUIDANCE: 'GC', LIBRARY: 'LIB', CLINIC: 'CLN', SECURITY: 'SEC', ADMISSION: 'ADM', ADMISSIONS: 'ADM', ADMINISTRATION: 'ADM' };
  if (common[clean]) return common[clean];
  return clean.slice(0, Math.min(clean.length, 4));
};
const today = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).formatToParts(new Date());
  const value = type => parts.find(part => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
};
const currentTime = () => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
function opening(office, date) { const hours = { ...DEFAULT_HOURS, ...(office.operating_hours || {}) }; const value = hours[DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]]; return value && validTime(value.open) && validTime(value.close) && value.open < value.close ? value : null; }
function validSlot(office, date, time) { const hours = opening(office, date); if (!hours || !validTime(time) || time < hours.open || time >= hours.close) return false; const minutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3)); const start = Number(hours.open.slice(0, 2)) * 60 + Number(hours.open.slice(3)); return (minutes - start) % APPOINTMENT_INTERVAL_MINUTES === 0; }
function signal(officeId) { queueEvents.emit('updated', officeId); }
async function officeFor(req, id) { const [rows] = await pool.query(isSuperadmin(req) ? 'SELECT * FROM queue_offices WHERE id=?' : 'SELECT * FROM queue_offices WHERE id=? AND (manager_user_id=? OR manager_user_id IS NULL)', isSuperadmin(req) ? [id] : [id, req.user.id]); return rows && rows[0]; }
function priority(body) { const isPriority = body.is_priority === true || body.is_priority === 'true'; const type = String(body.priority_type || '').trim(); if (isPriority && (!type || type.length > 80)) throw new Error('PRIORITY_TYPE_REQUIRED'); return { isPriority, type: isPriority ? type : null }; }

async function issueTicket(client, { office, serviceName, visitorName, studentId, source = 'walk_in', appointmentId = null, isPriority = false, priorityType = null, contactNumber = null }) {
  const queueDate = today();
  const [countRows] = await client.query(`SELECT COUNT(*) AS total FROM queue_tickets WHERE office_id=? AND queue_date=?`, [office.id, queueDate]);
  const seq = String(Number(countRows[0].total) + 1).padStart(3, '0');
  const officeCode = (office.code || codeFor(office.name) || 'Q').slice(0, 5);
  const number = `${officeCode}-${isPriority ? 'P' : ''}${seq}`;
  const newId = uuidv4();
  await client.query(
    `INSERT INTO queue_tickets (id, office_id, ticket_number, service_name, visitor_name, student_user_id, source, appointment_id, queue_date, is_priority, priority_type, contact_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [newId, office.id, number, serviceName || null, visitorName || null, studentId || null, source, appointmentId, queueDate, isPriority, priorityType, contactNumber || null]
  );
  const [ticketRows] = await client.query('SELECT * FROM queue_tickets WHERE id = ?', [newId]);
  return ticketRows[0];
}

router.get('/offices', async (_req, res) => {
  const [rows] = await pool.query('SELECT id, name, code, operating_hours FROM queue_offices WHERE is_active = TRUE ORDER BY name');
  res.json(rows || []);
});

router.get('/offices/:id/closures', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(schedule_date, '%Y-%m-%d') AS schedule_date
     FROM queue_schedule_closures
     WHERE office_id = ? AND schedule_date >= CURDATE()
     ORDER BY schedule_date ASC`,
    [req.params.id]
  );
  res.json((rows || []).map(r => r.schedule_date));
});

router.get('/offices/:id/availability', async (req, res) => {
  const date = String(req.query.date || '');
  if (!validDate(date)) return res.status(400).json({ error: 'A valid date is required.' });
  const [officeRows] = await pool.query('SELECT * FROM queue_offices WHERE id = ? AND is_active = TRUE', [req.params.id]);
  const office = officeRows && officeRows[0];
  if (!office) return res.status(404).json({ error: 'Office not found.' });
  if (date <= today()) return res.json({ date, slots: [], message: 'Appointments must be booked at least one day ahead.' });
  const hours = opening(office, date);
  if (!hours) return res.json({ date, slots: [], message: 'This office is closed on the selected day.' });

  const [closureRows] = await pool.query('SELECT 1 FROM queue_schedule_closures WHERE office_id = ? AND schedule_date = ?', [office.id, date]);
  if (closureRows && closureRows.length) return res.json({ date, slots: [], is_unavailable: true, message: 'The office/admin is unavailable for appointments on this date.' });

  const [bookedRows] = await pool.query(`SELECT COUNT(*) AS total FROM queue_appointments WHERE office_id = ? AND DATE(appointment_at) = ? AND status IN ('booked', 'checked_in')`, [office.id, date]);
  if (Number(bookedRows[0].total) >= DAILY_APPOINTMENT_LIMIT) return res.json({ date, slots: [], message: 'Fully booked for this day.' });

  const [usedRows] = await pool.query(`SELECT DATE_FORMAT(appointment_at, '%H:%i') AS time FROM queue_appointments WHERE office_id = ? AND DATE(appointment_at) = ? AND status IN ('booked', 'checked_in')`, [office.id, date]);
  const usedTimes = new Set((usedRows || []).map(row => row.time));

  const slots = [];
  for (let minutes = Number(hours.open.slice(0, 2)) * 60 + Number(hours.open.slice(3)); minutes < Number(hours.close.slice(0, 2)) * 60 + Number(hours.close.slice(3)); minutes += APPOINTMENT_INTERVAL_MINUTES) {
    const slot = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    if (!usedTimes.has(slot)) slots.push(slot);
  }
  res.json({ date, slots, interval_minutes: APPOINTMENT_INTERVAL_MINUTES });
});

router.get('/display/:code', async (req, res) => {
  const [officeRows] = await pool.query(
    "SELECT id, name, code FROM queue_offices WHERE (code = UPPER(?) OR (code = 'OSA' AND UPPER(?) = 'OFFICEOFSTUD') OR (code = 'REG' AND UPPER(?) = 'REGISTRAR')) AND is_active = TRUE",
    [req.params.code, req.params.code, req.params.code]
  );
  const office = officeRows && officeRows[0];
  if (!office) return res.status(404).json({ error: 'Office not found.' });
  const date = today();

  const [[currentRows], [waitingRows], [closureRows], [walkInsRows], [appointmentsRows]] = await Promise.all([
    pool.query(`SELECT ticket_number, service_name, source, is_priority, priority_type, status FROM queue_tickets WHERE office_id = ? AND status IN ('called', 'serving') AND queue_date = ? ORDER BY called_at IS NULL, called_at DESC LIMIT 1`, [office.id, date]),
    pool.query(`SELECT ticket_number, service_name, source, is_priority, priority_type FROM queue_tickets WHERE office_id = ? AND status = 'waiting' AND queue_date = ? ORDER BY is_priority DESC, queue_positioned_at, created_at`, [office.id, date]),
    pool.query('SELECT 1 FROM queue_schedule_closures WHERE office_id = ? AND schedule_date = ?', [office.id, date]),
    pool.query(`SELECT COUNT(*) AS total FROM queue_tickets WHERE office_id = ? AND queue_date = ? AND source = 'walk_in'`, [office.id, date]),
    pool.query(`SELECT COUNT(*) AS total FROM queue_appointments WHERE office_id = ? AND DATE(appointment_at) = ? AND status IN ('booked', 'checked_in')`, [office.id, date])
  ]);

  const waitingScheduled = (waitingRows || []).filter(ticket => ticket.source === 'appointment');
  const waitingWalkIns = (waitingRows || []).filter(ticket => ticket.source === 'walk_in');

  res.json({
    office,
    now_serving: currentRows && currentRows[0] ? currentRows[0] : null,
    scheduled: waitingScheduled.slice(0, 10),
    walk_ins: waitingWalkIns.slice(0, 10),
    scheduled_count: waitingScheduled.length,
    walk_ins_count: waitingWalkIns.length,
    scheduled_full: (closureRows && closureRows.length > 0) || Number(appointmentsRows[0].total) >= DAILY_APPOINTMENT_LIMIT,
    walk_ins_full: Number(walkInsRows[0].total) >= DAILY_WALK_IN_LIMIT
  });
});

router.get('/stream/:code', async (req, res) => {
  const [officeRows] = await pool.query(
    "SELECT id FROM queue_offices WHERE (code = UPPER(?) OR (code = 'OSA' AND UPPER(?) = 'OFFICEOFSTUD') OR (code = 'REG' AND UPPER(?) = 'REGISTRAR')) AND is_active = TRUE",
    [req.params.code, req.params.code, req.params.code]
  );
  if (!officeRows || !officeRows[0]) return res.status(404).end();
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
  const update = id => {
    if (id === officeRows[0].id) res.write('event: queue-update\ndata: updated\n\n');
  };
  queueEvents.on('updated', update);
  const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 25000);
  req.on('close', () => {
    clearInterval(keepAlive);
    queueEvents.off('updated', update);
  });
});

router.post('/appointments', authenticateToken, async (req, res) => {
  const { office_id: officeId, date, time, service_name: serviceName, visitor_name: visitorName, contact_number: contactNumber } = req.body;
  if (!validDate(date) || !validTime(time)) return res.status(400).json({ error: 'Choose a valid appointment date and time.' });
  if (date <= today()) return res.status(400).json({ error: 'Appointments must be booked at least one day ahead.' });

  if (req.user.role === 'guest') {
    const trimmedName = String(visitorName || '').trim();
    const trimmedContact = String(contactNumber || '').trim();
    if (!trimmedName) {
      return res.status(400).json({ error: 'Please provide your full name for the appointment.' });
    }
    if (!trimmedContact) {
      return res.status(400).json({ error: 'Please provide your contact number for the appointment.' });
    }
    const cleanPhone = trimmedContact.replace(/[\s\-\(\)]/g, '');
    if (!/^(\+?63|0)?[0-9]{7,12}$/.test(cleanPhone)) {
      return res.status(400).json({ error: 'Please provide a valid contact number (e.g. 09123456789).' });
    }
  }

  let p;
  try { p = priority(req.body); } catch (_) { return res.status(400).json({ error: 'Specify the priority group type.' }); }
  const [officeRows] = await pool.query('SELECT * FROM queue_offices WHERE id = ? AND is_active = TRUE', [officeId]);
  const office = officeRows && officeRows[0];
  if (!office) return res.status(404).json({ error: 'Office not found.' });
  if (!validSlot(office, date, time)) return res.status(400).json({ error: 'Choose an available 15-minute appointment slot.' });

  const client = await pool.getConnection();
  try {
    await client.beginTransaction();
    const [closureRows] = await client.query('SELECT 1 FROM queue_schedule_closures WHERE office_id = ? AND schedule_date = ?', [officeId, date]);
    if (closureRows && closureRows.length) throw new Error('SCHEDULE_CLOSED');

    const [dailyRows] = await client.query(
      `SELECT COUNT(*) AS total FROM queue_appointments WHERE office_id = ? AND DATE(appointment_at) = ? AND status IN ('booked', 'checked_in')`,
      [officeId, date]
    );
    if (Number(dailyRows[0].total) >= DAILY_APPOINTMENT_LIMIT) throw new Error('DAY_FULL');

    const appointmentTime = `${date} ${time}:00`;
    const [slotRows] = await client.query(
      `SELECT 1 FROM queue_appointments WHERE office_id = ? AND appointment_at = ? AND status IN ('booked', 'checked_in')`,
      [officeId, appointmentTime]
    );
    if (slotRows && slotRows.length) throw new Error('SLOT_FULL');

    const vName = visitorName?.trim() || (req.user.role !== 'guest' ? `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim() : null);
    const cNumber = contactNumber?.trim() || null;
    const newId = uuidv4();

    await client.query(
      `INSERT INTO queue_appointments (id, office_id, student_user_id, appointment_at, service_name, is_priority, priority_type, visitor_name, contact_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId, officeId, req.user.id, appointmentTime, serviceName || null, p.isPriority, p.type, vName, cNumber]
    );
    await client.commit();
    const [createdRows] = await pool.query('SELECT * FROM queue_appointments WHERE id = ?', [newId]);
    res.status(201).json(createdRows[0]);
  } catch (error) {
    try { await client.rollback(); } catch (_) {}
    const messages = { SCHEDULE_CLOSED: 'Appointment scheduling is closed for this date.', DAY_FULL: 'Fully booked for this day.', SLOT_FULL: 'That slot was just booked. Choose another time.' };
    res.status(messages[error.message] ? 409 : 500).json({ error: messages[error.message] || 'Unable to book the appointment.' });
  } finally {
    client.release();
  }
});

router.get('/my-appointments', authenticateToken, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT qa.*, qo.name AS office_name,
            DATE_FORMAT(qa.appointment_at, '%Y-%m-%d') AS date,
            DATE_FORMAT(qa.appointment_at, '%H:%i') AS time
     FROM queue_appointments qa
     JOIN queue_offices qo ON qo.id = qa.office_id
     WHERE qa.student_user_id = ? AND qa.status IN ('booked', 'checked_in')
     ORDER BY qa.appointment_at`,
    [req.user.id]
  );
  res.json(rows || []);
});

router.post('/my-appointments/:id/cancel', authenticateToken, async (req, res) => {
  const client = await pool.getConnection();
  try {
    await client.beginTransaction();
    const [appointmentRows] = await client.query(
      `SELECT * FROM queue_appointments WHERE id = ? AND student_user_id = ? AND status IN ('booked', 'checked_in') FOR UPDATE`,
      [req.params.id, req.user.id]
    );
    const appointment = appointmentRows && appointmentRows[0];
    if (!appointment) return res.status(404).json({ error: 'Appointment not found or already cancelled.' });

    await client.query(`UPDATE queue_appointments SET status = 'cancelled', cancelled_at = NOW() WHERE id = ?`, [appointment.id]);
    await client.query(`UPDATE queue_tickets SET status = 'cancelled' WHERE appointment_id = ? AND status IN ('waiting', 'called')`, [appointment.id]);
    await client.commit();
    signal(appointment.office_id);
    res.json({ message: 'Appointment cancelled successfully.', appointment });
  } catch (err) {
    try { await client.rollback(); } catch (_) {}
    res.status(500).json({ error: 'Unable to cancel appointment.' });
  } finally {
    client.release();
  }
});

router.post('/appointments/:id/check-in', authenticateToken, async (req, res) => {
  const client = await pool.getConnection();
  try {
    await client.beginTransaction();
    const [appointmentRows] = await client.query(
      `SELECT qa.*, qo.code, qo.operating_hours, qo.name, qo.is_active
       FROM queue_appointments qa
       JOIN queue_offices qo ON qo.id = qa.office_id
       WHERE qa.id = ? AND qa.student_user_id = ? FOR UPDATE`,
      [req.params.id, req.user.id]
    );
    const appointment = appointmentRows && appointmentRows[0];
    if (!appointment || appointment.status !== 'booked') throw new Error('NOT_AVAILABLE');

    const [dateRows] = await client.query(`SELECT DATE_FORMAT(appointment_at, '%Y-%m-%d') AS date FROM queue_appointments WHERE id = ?`, [appointment.id]);
    if (dateRows[0].date !== today()) throw new Error('NOT_TODAY');

    const ticket = await issueTicket(client, {
      office: appointment,
      serviceName: appointment.service_name,
      visitorName: appointment.visitor_name,
      contactNumber: appointment.contact_number,
      studentId: req.user.id,
      source: 'appointment',
      appointmentId: appointment.id,
      isPriority: appointment.is_priority,
      priorityType: appointment.priority_type
    });
    await client.query(`UPDATE queue_appointments SET status = 'checked_in', checked_in_at = NOW() WHERE id = ?`, [appointment.id]);
    await client.commit();
    signal(appointment.office_id);
    res.status(201).json(ticket);
  } catch (error) {
    try { await client.rollback(); } catch (_) {}
    res.status(400).json({ error: error.message === 'NOT_TODAY' ? 'Appointments can only be checked in on their scheduled date.' : 'This appointment cannot be checked in.' });
  } finally {
    client.release();
  }
});

router.post('/tickets', optionalAuth, async (req, res) => {
  const { office_id: officeId, service_name: serviceName, visitor_name: visitorName } = req.body;
  let p;
  try { p = priority(req.body); } catch (_) { return res.status(400).json({ error: 'Specify the priority group type.' }); }
  const [officeRows] = await pool.query('SELECT * FROM queue_offices WHERE id = ? AND is_active = TRUE', [officeId]);
  const office = officeRows && officeRows[0];
  if (!office) return res.status(404).json({ error: 'Office not found.' });
  if (currentTime() < WALK_IN_OPEN || currentTime() >= WALK_IN_CLOSE) return res.status(400).json({ error: 'Walk-in tickets are available daily from 06:00 to 18:00 only.' });

  const client = await pool.getConnection();
  try {
    await client.beginTransaction();
    const [countRows] = await client.query(
      `SELECT COUNT(*) AS total FROM queue_tickets WHERE office_id = ? AND queue_date = ? AND source = 'walk_in'`,
      [officeId, today()]
    );
    if (Number(countRows[0].total) >= DAILY_WALK_IN_LIMIT) throw new Error('DAY_FULL');

    if (req.user?.id && req.user.role !== 'guest') {
      const [activeRows] = await client.query(
        `SELECT 1 FROM queue_tickets WHERE office_id = ? AND student_user_id = ? AND status IN ('waiting', 'called', 'serving') AND queue_date = ?`,
        [officeId, req.user.id, today()]
      );
      if (activeRows && activeRows.length) throw new Error('ACTIVE_TICKET');
    }

    const ticket = await issueTicket(client, { office, serviceName, visitorName, studentId: req.user?.id, isPriority: p.isPriority, priorityType: p.type });
    await client.commit();
    signal(officeId);
    res.status(201).json(ticket);
  } catch (error) {
    try { await client.rollback(); } catch (_) {}
    const messages = { DAY_FULL: 'Fully booked for today.', ACTIVE_TICKET: 'You already have an active ticket for this office today.' };
    res.status(messages[error.message] ? 409 : 500).json({ error: messages[error.message] || 'Unable to issue a ticket.' });
  } finally {
    client.release();
  }
});

router.get('/my-tickets/active/current', authenticateToken, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT qt.id, qt.ticket_number, qt.status, qt.service_name, qt.source, qt.is_priority, qt.priority_type, qo.name AS office_name
     FROM queue_tickets qt
     JOIN queue_offices qo ON qo.id = qt.office_id
     WHERE qt.student_user_id = ? AND qt.status IN ('waiting', 'called', 'serving') AND qt.queue_date = ?
     ORDER BY qt.created_at DESC LIMIT 1`,
    [req.user.id, today()]
  );
  res.json(rows && rows[0] ? rows[0] : null);
});

router.post('/my-tickets/:id/cancel', authenticateToken, async (req, res) => {
  const [checkRows] = await pool.query('SELECT * FROM queue_tickets WHERE id = ? AND student_user_id = ? AND status IN (\'waiting\', \'called\')', [req.params.id, req.user.id]);
  if (!checkRows || !checkRows[0]) return res.status(409).json({ error: 'This ticket can no longer be cancelled. Please ask the office for assistance.' });

  await pool.query(`UPDATE queue_tickets SET status = 'cancelled' WHERE id = ?`, [req.params.id]);
  signal(checkRows[0].office_id);
  res.json({ message: 'Queue ticket cancelled.', ticket: { ...checkRows[0], status: 'cancelled' } });
});

router.use('/manage', authenticateToken, requirePermission('queueing'));

router.get('/manage/offices', async (req, res) => {
  const [rows] = await pool.query(
    isSuperadmin(req) ? 'SELECT * FROM queue_offices ORDER BY name' : 'SELECT * FROM queue_offices WHERE manager_user_id = ? OR manager_user_id IS NULL ORDER BY name',
    isSuperadmin(req) ? [] : [req.user.id]
  );
  res.json(rows || []);
});

router.get('/manage/offices/code/:code', async (req, res) => {
  const [rows] = await pool.query(
    isSuperadmin(req)
      ? "SELECT id, name, code FROM queue_offices WHERE (code = UPPER(?) OR (code = 'OSA' AND UPPER(?) = 'OFFICEOFSTUD') OR (code = 'REG' AND UPPER(?) = 'REGISTRAR'))"
      : "SELECT id, name, code FROM queue_offices WHERE (code = UPPER(?) OR (code = 'OSA' AND UPPER(?) = 'OFFICEOFSTUD') OR (code = 'REG' AND UPPER(?) = 'REGISTRAR')) AND (manager_user_id = ? OR manager_user_id IS NULL)",
    isSuperadmin(req) ? [req.params.code, req.params.code, req.params.code] : [req.params.code, req.params.code, req.params.code, req.user.id]
  );
  if (!rows || !rows[0]) return res.status(404).json({ error: 'Office access denied.' });
  res.json(rows[0]);
});

router.post('/manage/offices', requireRole('superadmin'), async (req, res) => {
  const { name, code, manager_user_id: managerId } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Office name is required.' });
  const newId = uuidv4();
  await pool.query(
    `INSERT INTO queue_offices (id, name, code, manager_user_id, appointment_interval_minutes, appointment_capacity, operating_hours)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
    [newId, name.trim(), codeFor(code) || codeFor(name), managerId || null, APPOINTMENT_INTERVAL_MINUTES, JSON.stringify(DEFAULT_HOURS)]
  );
  const [createdRows] = await pool.query('SELECT * FROM queue_offices WHERE id = ?', [newId]);
  res.status(201).json(createdRows[0]);
});

router.delete('/manage/offices/:id', requireRole('superadmin'), async (req, res) => {
  const [checkRows] = await pool.query('SELECT id, name FROM queue_offices WHERE id = ?', [req.params.id]);
  if (!checkRows || !checkRows[0]) return res.status(404).json({ error: 'Office not found.' });
  await pool.query('DELETE FROM queue_offices WHERE id = ?', [req.params.id]);
  signal(req.params.id);
  res.json({ message: 'Office deleted.', office: checkRows[0] });
});

router.get('/manage/admins', requireRole('superadmin'), async (_req, res) => {
  const [rows] = await pool.query(`SELECT id, first_name, department FROM users WHERE role = 'admin' AND is_active = TRUE ORDER BY first_name`);
  res.json(rows || []);
});

router.get('/manage/offices/:id/tickets', async (req, res) => {
  if (!await officeFor(req, req.params.id)) return res.status(403).json({ error: 'Office access denied.' });
  const [rows] = await pool.query(
    `SELECT qt.*, qa.appointment_at
     FROM queue_tickets qt
     LEFT JOIN queue_appointments qa ON qa.id = qt.appointment_id
     WHERE qt.office_id = ? AND qt.queue_date = ? AND qt.status NOT IN ('completed', 'cancelled')
     ORDER BY CASE qt.status WHEN 'serving' THEN 0 WHEN 'called' THEN 1 WHEN 'waiting' THEN 2 ELSE 3 END,
              CASE qt.source WHEN 'appointment' THEN 0 ELSE 1 END,
              qt.is_priority DESC,
              qt.queue_positioned_at,
              qa.appointment_at IS NULL,
              qa.appointment_at,
              qt.created_at`,
    [req.params.id, today()]
  );
  res.json(rows || []);
});

router.get('/manage/offices/:id/appointments', async (req, res) => {
  if (!await officeFor(req, req.params.id)) return res.status(403).json({ error: 'Office access denied.' });
  const [rows] = await pool.query(
    `SELECT qa.id, qa.status, qa.service_name, qa.is_priority, qa.priority_type,
            qa.visitor_name, qa.contact_number,
            DATE_FORMAT(qa.appointment_at, '%Y-%m-%d') AS date,
            DATE_FORMAT(qa.appointment_at, '%H:%i') AS time,
            u.first_name, u.last_name, u.role,
            qt.ticket_number, qt.status AS ticket_status
     FROM queue_appointments qa
     JOIN users u ON u.id = qa.student_user_id
     LEFT JOIN queue_tickets qt ON qt.appointment_id = qa.id
     WHERE qa.office_id = ?
       AND qa.status IN ('booked', 'checked_in')
       AND qa.appointment_at >= CURDATE()
     ORDER BY qa.appointment_at LIMIT 50`,
    [req.params.id]
  );
  res.json(rows || []);
});

router.post('/manage/appointments/:id/check-in', async (req, res) => {
  const client = await pool.getConnection();
  try {
    await client.beginTransaction();
    const [appointmentRows] = await client.query(
      `SELECT qa.*, qo.code, qo.operating_hours, qo.name, qo.is_active
       FROM queue_appointments qa
       JOIN queue_offices qo ON qo.id = qa.office_id
       WHERE qa.id = ? FOR UPDATE`,
      [req.params.id]
    );
    const appointment = appointmentRows && appointmentRows[0];
    if (!appointment) throw new Error('NOT_FOUND');
    if (!await officeFor(req, appointment.office_id)) return res.status(403).json({ error: 'Office access denied.' });
    if (appointment.status !== 'booked') throw new Error('ALREADY_CHECKED_IN');

    const ticket = await issueTicket(client, {
      office: appointment,
      serviceName: appointment.service_name,
      visitorName: appointment.visitor_name,
      contactNumber: appointment.contact_number,
      studentId: appointment.student_user_id,
      source: 'appointment',
      appointmentId: appointment.id,
      isPriority: appointment.is_priority,
      priorityType: appointment.priority_type
    });
    await client.query(`UPDATE queue_appointments SET status = 'checked_in', checked_in_at = NOW() WHERE id = ?`, [appointment.id]);
    await client.commit();
    signal(appointment.office_id);
    res.status(201).json({ message: 'Admitted to live queue', ticket });
  } catch (error) {
    try { await client.rollback(); } catch (_) {}
    const errMap = { NOT_FOUND: 'Appointment not found.', ALREADY_CHECKED_IN: 'This appointment has already been checked in.' };
    res.status(400).json({ error: errMap[error.message] || 'Unable to admit appointment to queue.' });
  } finally {
    client.release();
  }
});

router.post('/manage/appointments/:id/decline', async (req, res) => {
  const client = await pool.getConnection();
  try {
    await client.beginTransaction();
    const [appointmentRows] = await client.query(
      `SELECT qa.*, qo.name AS office_name,
              DATE_FORMAT(qa.appointment_at, '%Y-%m-%d') AS date,
              DATE_FORMAT(qa.appointment_at, '%H:%i') AS time
       FROM queue_appointments qa
       JOIN queue_offices qo ON qo.id = qa.office_id
       WHERE qa.id = ? FOR UPDATE`,
      [req.params.id]
    );
    const appointment = appointmentRows && appointmentRows[0];
    if (!appointment) throw new Error('NOT_FOUND');
    if (!await officeFor(req, appointment.office_id)) return res.status(403).json({ error: 'Office access denied.' });

    await client.query(`UPDATE queue_appointments SET status = 'cancelled', cancelled_at = NOW() WHERE id = ?`, [appointment.id]);
    await client.query(`UPDATE queue_tickets SET status = 'cancelled' WHERE appointment_id = ? AND status IN ('waiting', 'called')`, [appointment.id]);
    await client.commit();
    signal(appointment.office_id);

    await safeNotify('appointment declined', () =>
      notifyUser(pool, appointment.student_user_id, {
        title: 'Appointment Declined',
        message: `Your appointment for ${appointment.date} at ${appointment.time} (${appointment.office_name}) was declined by the office administration.`,
        type: 'queueing',
        link: '/#queueing'
      })
    );

    res.json({ message: 'Appointment request declined.', appointment });
  } catch (error) {
    try { await client.rollback(); } catch (_) {}
    res.status(error.message === 'NOT_FOUND' ? 404 : 500).json({ error: error.message === 'NOT_FOUND' ? 'Appointment not found.' : 'Unable to decline appointment.' });
  } finally {
    client.release();
  }
});

router.delete('/manage/appointments/:id', async (req, res) => {
  const client = await pool.getConnection();
  try {
    await client.beginTransaction();
    const [appointmentRows] = await client.query(
      `SELECT qa.* FROM queue_appointments qa WHERE qa.id = ? FOR UPDATE`,
      [req.params.id]
    );
    const appointment = appointmentRows && appointmentRows[0];
    if (!appointment) throw new Error('NOT_FOUND');
    if (!await officeFor(req, appointment.office_id)) return res.status(403).json({ error: 'Office access denied.' });

    await client.query(`UPDATE queue_tickets SET appointment_id = NULL WHERE appointment_id = ?`, [appointment.id]);
    await client.query(`DELETE FROM queue_appointments WHERE id = ?`, [appointment.id]);
    await client.commit();
    signal(appointment.office_id);

    res.json({ message: 'Appointment permanently deleted.' });
  } catch (error) {
    try { await client.rollback(); } catch (_) {}
    res.status(error.message === 'NOT_FOUND' ? 404 : 500).json({ error: error.message === 'NOT_FOUND' ? 'Appointment not found.' : 'Unable to delete appointment.' });
  } finally {
    client.release();
  }
});

router.post('/manage/offices/:id/schedule-closures', async (req, res) => {
  const office = await officeFor(req, req.params.id);
  const date = String(req.body?.date || '');
  if (!office) return res.status(403).json({ error: 'Office access denied.' });
  if (!validDate(date) || date < today()) return res.status(400).json({ error: 'Choose today or a future date.' });
  await pool.query(
    `INSERT IGNORE INTO queue_schedule_closures (office_id, schedule_date, closed_by_user_id) VALUES (?, ?, ?)`,
    [office.id, date, req.user.id]
  );
  signal(office.id);
  res.status(201).json({ message: 'Appointment schedule ended for the selected date.', date });
});

router.get('/manage/offices/:id/schedule-closures', async (req, res) => {
  const office = await officeFor(req, req.params.id);
  if (!office) return res.status(403).json({ error: 'Office access denied.' });
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(schedule_date, '%Y-%m-%d') AS schedule_date, created_at
     FROM queue_schedule_closures
     WHERE office_id = ? AND schedule_date >= CURDATE()
     ORDER BY schedule_date ASC`,
    [office.id]
  );
  res.json((rows || []).map(r => r.schedule_date));
});

router.delete('/manage/offices/:id/schedule-closures/:date', async (req, res) => {
  const office = await officeFor(req, req.params.id);
  const date = String(req.params.date || '');
  if (!office) return res.status(403).json({ error: 'Office access denied.' });
  if (!validDate(date)) return res.status(400).json({ error: 'Invalid date.' });
  await pool.query(
    `DELETE FROM queue_schedule_closures WHERE office_id = ? AND schedule_date = ?`,
    [office.id, date]
  );
  signal(office.id);
  res.json({ message: 'Appointment schedule reopened for the selected date.', date });
});

router.post('/manage/offices/:id/next', async (req, res) => {
  const office = await officeFor(req, req.params.id);
  if (!office) return res.status(403).json({ error: 'Office access denied.' });
  const client = await pool.getConnection();
  try {
    await client.beginTransaction();
    const [activeRows] = await client.query(
      `SELECT id, ticket_number, status FROM queue_tickets WHERE office_id = ? AND status IN ('called', 'serving') AND queue_date = ? FOR UPDATE`,
      [office.id, today()]
    );
    if (req.body?.action === 'skip') {
      if (!activeRows[0]) throw new Error('NO_ACTIVE');
      await client.query(`UPDATE queue_tickets SET status = 'waiting', called_at = NULL, queue_positioned_at = NOW() WHERE id = ?`, [activeRows[0].id]);
      const [requeuedRows] = await client.query('SELECT * FROM queue_tickets WHERE id = ?', [activeRows[0].id]);
      await client.commit();
      signal(office.id);
      return res.json({ requeued_ticket: requeuedRows[0] });
    }

    let completed = null;
    if (activeRows[0]) {
      await client.query(`UPDATE queue_tickets SET status = 'completed', completed_at = NOW() WHERE id = ?`, [activeRows[0].id]);
      const [compRows] = await client.query('SELECT * FROM queue_tickets WHERE id = ?', [activeRows[0].id]);
      completed = compRows[0];
    }

    const [nextRows] = await client.query(
      `SELECT qt.id
       FROM queue_tickets qt
       LEFT JOIN queue_appointments qa ON qa.id = qt.appointment_id
       WHERE qt.office_id = ? AND qt.status = 'waiting' AND qt.queue_date = ? AND (qt.source = 'walk_in' OR qa.appointment_at <= NOW())
       ORDER BY CASE qt.source WHEN 'appointment' THEN 0 ELSE 1 END,
                qt.is_priority DESC,
                qt.queue_positioned_at,
                qa.appointment_at IS NULL,
                qa.appointment_at,
                qt.created_at
       LIMIT 1`,
      [office.id, today()]
    );

    if (!nextRows || !nextRows[0]) {
      await client.commit();
      signal(office.id);
      return res.json({ ticket: null, completed_ticket: completed });
    }

    await client.query(`UPDATE queue_tickets SET status = 'called', called_at = NOW() WHERE id = ?`, [nextRows[0].id]);
    const [ticketRows] = await client.query('SELECT * FROM queue_tickets WHERE id = ?', [nextRows[0].id]);
    const ticket = ticketRows[0];
    await client.commit();
    signal(office.id);

    await safeNotify('queue ticket called', () =>
      notifyUser(pool, ticket.student_user_id, {
        title: 'Ticket Called',
        message: `Queue ticket ${ticket.ticket_number} has been called. Please proceed to the office counter.`,
        type: 'queueing',
        link: '/#queueing'
      })
    );
    res.json({ ...ticket, completed_ticket: completed });
  } catch (error) {
    try { await client.rollback(); } catch (_) {}
    res.status(error.message === 'NO_ACTIVE' ? 409 : 500).json({ error: error.message === 'NO_ACTIVE' ? 'There is no active ticket to skip.' : 'Unable to update the queue.' });
  } finally {
    client.release();
  }
});

router.patch('/manage/tickets/:id', async (req, res) => {
  const { status } = req.body;
  if (!['serving', 'skipped', 'completed', 'cancelled'].includes(status)) return res.status(400).json({ error: 'Invalid ticket status.' });
  const [ticketRows] = await pool.query('SELECT * FROM queue_tickets WHERE id = ?', [req.params.id]);
  const ticket = ticketRows && ticketRows[0];
  if (!ticket || !await officeFor(req, ticket.office_id)) return res.status(403).json({ error: 'Office access denied.' });
  if (status === 'serving' && ticket.status !== 'called') return res.status(409).json({ error: 'Only a called queue number can be marked in progress.' });

  if (status === 'skipped') {
    await pool.query(`UPDATE queue_tickets SET status = 'waiting', called_at = NULL, queue_positioned_at = NOW() WHERE id = ?`, [ticket.id]);
  } else {
    await pool.query(
      `UPDATE queue_tickets SET status = ?, completed_at = CASE WHEN ? = 'completed' THEN NOW() ELSE completed_at END WHERE id = ?`,
      [status, status, ticket.id]
    );
  }
  const [updatedRows] = await pool.query('SELECT * FROM queue_tickets WHERE id = ?', [ticket.id]);
  signal(ticket.office_id);
  res.json(updatedRows[0]);
});

module.exports = router;
