const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/database');
const { authenticateToken, ALL_MODULES } = require('../middleware/auth');
const { uploadProfile } = require('../middleware/upload');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/email');
const { normalizeEmail } = require('../utils/helpers');

const VALID_YEAR_LEVELS = ['1st', '2nd', '3rd', '4th'];
const VALID_STUDENT_TYPES = ['regular', 'irregular'];
const VALID_EMPLOYMENT_TYPES = ['part_time', 'full_time'];
const VALID_FACULTY_STATUSES = ['in_class', 'in_office', 'available', 'unavailable'];
const FACULTY_NUMBER_REGEX = /^F-\d{4}$/;

const EMBED_HOST_ALLOWLIST = [
  /^(docs|sheets|calendar|drive)\.google\.com$/i,
  /^(www\.)?canva\.com$/i,
  /^onedrive\.live\.com$/i,
  /^(view|embed|sway)\.office\.com$/i,
  /^1drv\.ms$/i,
  /^(www\.)?office\.com$/i,
  /^(www\.)?sway\.cloud\.microsoft$/i,
];

function generateVerificationCode() {
  return String(crypto.randomInt(100000, 999999));
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function isAllowedEmbedUrl(raw) {
  if (!raw) return true;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && EMBED_HOST_ALLOWLIST.some((rx) => rx.test(u.hostname));
  } catch (_) {
    return false;
  }
}

function signUserToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      first_name: user.first_name,
      middle_initial: user.middle_initial,
      last_name: user.last_name,
      department: user.department,
      section: user.section,
      year_level: user.year_level,
      student_type: user.student_type,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '4h' }
  );
}

/**
 * Standardized auth error handler with database connection failure detection
 */
function handleAuthError(err, res, defaultMsg = 'Operation failed', status = 500) {
  if (pool.isDbConnectionError && pool.isDbConnectionError(err)) {
    console.error(`[AUTH DATABASE ERROR] ${defaultMsg}:`, err.message || err.code);
    return res.status(503).json({
      error: 'Database service is temporarily unavailable. Please verify MySQL is running.',
      code: 'DATABASE_UNAVAILABLE',
    });
  }
  console.error(`[AUTH ERROR] ${defaultMsg}:`, err.message || err);
  return res.status(status).json({ error: defaultMsg });
}

// ── Register ─────────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { student_number, email, password, first_name, middle_initial, last_name, section } = req.body;
    const year_level = typeof req.body.year_level === 'string' ? req.body.year_level.trim() : '';
    const student_type = typeof req.body.student_type === 'string' ? req.body.student_type.trim().toLowerCase() : '';
    const employment_type = typeof req.body.employment_type === 'string' ? req.body.employment_type.trim().toLowerCase() : '';
    const registrationRole = typeof req.body.registration_role === 'string' ? req.body.registration_role.trim().toLowerCase() : '';
    const normalizedEmail = normalizeEmail(email);

    if (!student_number || !normalizedEmail || !password || !first_name || !last_name) {
      return res.status(400).json({ error: 'First name, last name, ID number, email, and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const trimmedId = student_number.trim().toUpperCase();
    const [allowedRows] = await pool.query('SELECT * FROM allowed_registrations WHERE id_number = ?', [trimmedId]);
    if (!allowedRows.length) {
      return res.status(403).json({ error: 'Your ID number is not authorized to register. Please contact your admin.' });
    }

    const allowedEntry = allowedRows[0];
    if (registrationRole && registrationRole !== allowedEntry.role) {
      return res.status(400).json({ error: `This ID is approved for ${allowedEntry.role} registration.` });
    }
    const isStudent = allowedEntry.role === 'student';
    const isFaculty = allowedEntry.role === 'faculty';

    if (!isStudent && !FACULTY_NUMBER_REGEX.test(trimmedId)) {
      return res.status(400).json({ error: 'Faculty number must follow the format F-0000.' });
    }
    if (isFaculty) {
      if (!employment_type) return res.status(400).json({ error: 'Employment type is required for faculty registration' });
      if (!VALID_EMPLOYMENT_TYPES.includes(employment_type)) return res.status(400).json({ error: 'Invalid employment type. Must be part time or full time.' });
    }
    if (isStudent) {
      const normalizedSection = typeof section === 'string' ? section.trim() : '';
      if (!normalizedSection || !year_level || !student_type) {
        return res.status(400).json({ error: 'Section, year level, and student type are required for student registration' });
      }
      if (!VALID_YEAR_LEVELS.includes(year_level)) return res.status(400).json({ error: 'Invalid year level. Must be 1st, 2nd, 3rd, or 4th.' });
      if (!VALID_STUDENT_TYPES.includes(student_type)) return res.status(400).json({ error: 'Invalid student type. Must be regular or irregular.' });
    }

    const [existingUsers] = await pool.query(
      'SELECT id, is_verified, email, student_number FROM users WHERE email = ? OR student_number = ?',
      [normalizedEmail, trimmedId]
    );

    const verificationToken = generateVerificationCode();
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const password_hash = await bcrypt.hash(password, 12);

    if (existingUsers.length > 0) {
      const existing = existingUsers[0];
      if (existing.is_verified) {
        return res.status(400).json({ error: 'This Email or ID Number is already registered and verified. Please log in.' });
      }

      // Existing unverified account: update record and resend new verification code
      await pool.query(
        `UPDATE users SET
           student_number = ?,
           email = ?,
           password_hash = ?,
           first_name = ?,
           middle_initial = ?,
           last_name = ?,
           role = ?,
           department = ?,
           section = ?,
           year_level = ?,
           student_type = ?,
           employment_type = ?,
           email_verification_token = ?,
           email_verification_expires = ?,
           updated_at = NOW()
         WHERE id = ?`,
        [
          trimmedId,
          normalizedEmail,
          password_hash,
          first_name.trim(),
          middle_initial ? middle_initial.trim().substring(0, 10) : null,
          last_name.trim(),
          allowedEntry.role,
          allowedEntry.department,
          isStudent ? (typeof section === 'string' ? section.trim() : null) : null,
          isStudent ? year_level : null,
          isStudent ? student_type : null,
          isFaculty ? employment_type : null,
          verificationToken,
          verificationExpires,
          existing.id
        ]
      );

      await pool.query('UPDATE allowed_registrations SET is_used = true WHERE id = ?', [allowedEntry.id]);

      try {
        await sendVerificationEmail(normalizedEmail, first_name.trim(), verificationToken);
      } catch (e) {
        console.error('[Auth] Failed to send verification email:', e.message);
      }

      return res.status(201).json({
        message: 'Registration updated! A 6-digit verification code has been sent to your email.',
        requiresEmailVerification: true,
        email: normalizedEmail
      });
    }

    const newUserId = uuidv4();

    await pool.query(
      `INSERT INTO users (id, student_number, email, password_hash, first_name, middle_initial, last_name, role, department, section, year_level, student_type, employment_type, is_verified, email_verification_token, email_verification_expires)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, false, ?, ?)`,
      [
        newUserId,
        trimmedId,
        normalizedEmail,
        password_hash,
        first_name.trim(),
        middle_initial ? middle_initial.trim().substring(0, 10) : null,
        last_name.trim(),
        allowedEntry.role,
        allowedEntry.department,
        isStudent ? (typeof section === 'string' ? section.trim() : null) : null,
        isStudent ? year_level : null,
        isStudent ? student_type : null,
        isFaculty ? employment_type : null,
        verificationToken,
        verificationExpires
      ]
    );

    const [createdUserRows] = await pool.query(
      'SELECT id, first_name, middle_initial, last_name, role, department, section, year_level, student_type, employment_type FROM users WHERE id = ?',
      [newUserId]
    );

    await pool.query('UPDATE allowed_registrations SET is_used = true WHERE id = ?', [allowedEntry.id]);

    try {
      await sendVerificationEmail(normalizedEmail, first_name.trim(), verificationToken);
    } catch (e) {
      console.error('[Auth] Failed to send verification email:', e.message);
      return res.status(201).json({
        message: 'Registration successful, but we were unable to send the verification email. Please try resending it from the login screen or contact support.',
        requiresEmailVerification: true,
        emailSendError: true,
        user: createdUserRows[0],
        email: normalizedEmail
      });
    }

    res.status(201).json({
      message: 'Registration successful! A 6-digit verification code has been sent to your email.',
      requiresEmailVerification: true,
      user: createdUserRows[0],
      email: normalizedEmail
    });
  } catch (err) {
    return handleAuthError(err, res, 'Registration failed');
  }
});

// ── Login ────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = normalizeEmail(email);

    const [rows] = await pool.query('SELECT * FROM users WHERE email = ? AND is_active = true', [normalizedEmail]);
    if (!rows.length) {
      console.warn(`[AUTH] Failed login - unknown email: ${normalizedEmail} | IP: ${req.ip}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = rows[0];

    if (user.role !== 'admin' && user.role !== 'superadmin') {
      const [allowedRows] = await pool.query(
        'SELECT 1 FROM allowed_registrations WHERE UPPER(TRIM(id_number)) = UPPER(TRIM(?))',
        [user.student_number]
      );
      if (!allowedRows.length) {
        console.warn(`[AUTH] Login blocked - removed from allowed registrations: ${normalizedEmail} | IP: ${req.ip}`);
        return res.status(403).json({ error: 'Your ID is no longer authorized. Please contact your admin.' });
      }
    }

    if (!user.is_verified && user.role !== 'admin' && user.role !== 'superadmin') {
      console.warn(`[AUTH] Login blocked - unverified account: ${normalizedEmail} | IP: ${req.ip}`);
      return res.status(403).json({
        error: 'Please verify your email address before logging in. Check your inbox for the verification link.',
        code: 'EMAIL_NOT_VERIFIED'
      });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      console.warn(`[AUTH] Failed login - wrong password: ${normalizedEmail} | IP: ${req.ip}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signUserToken(user);
    console.log(`[AUTH] Successful login: ${normalizedEmail} (${user.role}) | IP: ${req.ip}`);

    let modules = [];
    if (user.role === 'superadmin') {
      modules = ALL_MODULES;
    } else if (user.role === 'admin') {
      const [permsRows] = await pool.query('SELECT module FROM admin_permissions WHERE user_id = ?', [user.id]);
      modules = permsRows.map(r => r.module);
    }

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        middle_initial: user.middle_initial,
        last_name: user.last_name,
        role: user.role,
        department: user.department,
        section: user.section,
        year_level: user.year_level,
        student_type: user.student_type,
        employment_type: user.employment_type || null,
        profile_image: user.profile_image,
        modules
      },
      token
    });
  } catch (err) {
    return handleAuthError(err, res, 'Login failed');
  }
});

// ── Logout ───────────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  res.json({ message: 'Logged out successfully' });
});

// ── Get current user ─────────────────────────────────────────────────────
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, student_number, email, first_name, middle_initial, last_name, role, department, section,
              year_level, student_type, employment_type, profile_image, phone, bio, position, schedule_embed_url,
              CASE
                WHEN faculty_status_until IS NOT NULL AND faculty_status_until < NOW() THEN 'unavailable'
                ELSE TRIM(COALESCE(faculty_status, 'unavailable'))
              END AS faculty_status,
              CASE
                WHEN faculty_status_until IS NOT NULL AND faculty_status_until < NOW() THEN NULL
                ELSE faculty_status_room
              END AS faculty_status_room,
              CASE
                WHEN faculty_status_until IS NOT NULL AND faculty_status_until < NOW() THEN NULL
                ELSE faculty_status_note
              END AS faculty_status_note,
              CASE
                WHEN faculty_status_until IS NOT NULL AND faculty_status_until < NOW() THEN NULL
                ELSE faculty_status_until
              END AS faculty_status_until,
              faculty_status_updated_at, faculty_credentials, created_at
       FROM users WHERE id = ?`,
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ ...rows[0], modules: req.user.modules || [] });
  } catch (err) {
    return handleAuthError(err, res, 'Failed to fetch user');
  }
});

// ── Update profile ───────────────────────────────────────────────────────
router.patch('/me', authenticateToken, async (req, res) => {
  try {
    let { first_name, middle_initial, last_name, department, section, phone, bio, position, faculty_credentials } = req.body;
    
    const [userRows] = await pool.query('SELECT role, first_name, last_name, department, section FROM users WHERE id = ?', [req.user.id]);
    if (!userRows.length) return res.status(404).json({ error: 'User not found' });
    const user = userRows[0];

    if (user.role === 'student' || user.role === 'faculty') {
      first_name = user.first_name;
      last_name = user.last_name;
      department = user.department;
      section = user.section;
    } else if (user.role === 'admin' || user.role === 'superadmin') {
      department = null;
    }

    if (!first_name || !last_name) {
      return res.status(400).json({ error: 'First name and last name are required' });
    }

    await pool.query(
      `UPDATE users SET
         first_name = ?,
         middle_initial = ?,
         last_name  = ?,
         department = COALESCE(NULLIF(?,''), department),
         section    = COALESCE(NULLIF(?,''), section),
         phone      = ?,
         bio        = ?,
         position   = ?,
         faculty_credentials = COALESCE(?, faculty_credentials),
         updated_at = NOW()
       WHERE id = ?`,
      [
        first_name.trim(),
        middle_initial ? middle_initial.trim().substring(0, 10) : null,
        last_name.trim(),
        department || null,
        section || null,
        phone || null,
        bio || null,
        position || null,
        faculty_credentials !== undefined ? JSON.stringify(faculty_credentials) : null,
        req.user.id
      ]
    );

    const [fetchedRows] = await pool.query(
      'SELECT id, student_number, email, first_name, middle_initial, last_name, role, department, section, profile_image, phone, bio, position, faculty_credentials FROM users WHERE id = ?',
      [req.user.id]
    );
    res.json(fetchedRows[0]);
  } catch (err) {
    return handleAuthError(err, res, 'Failed to update profile');
  }
});

// ── Update schedule embed link ───────────────────────────────────────────
router.patch('/me/schedule', authenticateToken, async (req, res) => {
  try {
    const raw = typeof req.body.schedule_embed_url === 'string' ? req.body.schedule_embed_url.trim() : '';
    if (!isAllowedEmbedUrl(raw)) {
      return res.status(400).json({
        error: 'Only Google (Docs/Sheets/Calendar/Drive), Canva, or Microsoft (OneDrive/Office/Sway) HTTPS links are allowed.'
      });
    }
    await pool.query('UPDATE users SET schedule_embed_url = ?, updated_at = NOW() WHERE id = ?', [raw || null, req.user.id]);
    const [fetchedRows] = await pool.query('SELECT schedule_embed_url FROM users WHERE id = ?', [req.user.id]);
    res.json(fetchedRows[0]);
  } catch (err) {
    return handleAuthError(err, res, 'Failed to update schedule link');
  }
});

// ── Update faculty status ────────────────────────────────────────────────
router.patch('/me/faculty-status', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'faculty') {
      return res.status(403).json({ error: 'Only faculty can update their status' });
    }
    const { status, room, note, until } = req.body || {};
    if (!VALID_FACULTY_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${VALID_FACULTY_STATUSES.join(', ')}` });
    }

    let untilParsed = null;
    if (until) {
      const d = new Date(until);
      if (isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid "until" timestamp' });
      untilParsed = d;
    }

    await pool.query(
      `UPDATE users
         SET faculty_status = ?,
             faculty_status_room = ?,
             faculty_status_note = ?,
             faculty_status_until = ?,
             faculty_status_updated_at = NOW(),
             updated_at = NOW()
       WHERE id = ?`,
      [
        status,
        room ? String(room).trim().substring(0, 100) : null,
        note ? String(note).trim().substring(0, 255) : null,
        untilParsed,
        req.user.id
      ]
    );

    const [fetchedRows] = await pool.query(
      'SELECT TRIM(faculty_status) AS faculty_status, faculty_status_room, faculty_status_note, faculty_status_until, faculty_status_updated_at FROM users WHERE id = ?',
      [req.user.id]
    );
    res.json(fetchedRows[0]);
  } catch (err) {
    return handleAuthError(err, res, 'Failed to update status');
  }
});

// ── Verify Email ─────────────────────────────────────────────────────────
router.all('/verify-email', async (req, res) => {
  try {
    const rawToken = (req.query.token || req.body?.token || req.body?.code || req.headers['x-verify-token'] || '').toString().trim().replace(/\s+/g, '');
    const userEmail = (req.query.email || req.body?.email || '').toString().trim().toLowerCase();

    // Check if this is a direct browser top-level navigation requesting HTML
    const isBrowserHtmlNav = req.method === 'GET' &&
      req.headers.accept &&
      req.headers.accept.includes('text/html') &&
      !req.xhr &&
      !req.headers['x-requested-with'];

    if (!rawToken) {
      if (isBrowserHtmlNav) {
        return res.redirect('/?verify_error=' + encodeURIComponent('Verification code or token is missing.'));
      }
      return res.status(400).json({ error: 'Verification code is required.' });
    }

    let rows;
    if (userEmail) {
      const [r] = await pool.query(
        'SELECT * FROM users WHERE (email_verification_token = ? OR email_verification_token = ?) AND email = ?',
        [rawToken, rawToken.toLowerCase(), userEmail]
      );
      rows = r;
    } else {
      const [r] = await pool.query(
        'SELECT * FROM users WHERE email_verification_token = ? OR email_verification_token = ?',
        [rawToken, rawToken.toLowerCase()]
      );
      rows = r;
    }

    if (!rows || !rows.length) {
      if (isBrowserHtmlNav) {
        return res.redirect('/?verify_error=' + encodeURIComponent('Invalid or expired verification code.'));
      }
      return res.status(400).json({ error: 'Invalid or expired verification code.' });
    }

    const user = rows[0];
    if (user.is_verified) {
      if (isBrowserHtmlNav) {
        return res.redirect('/?verify_success=' + encodeURIComponent('Email is already verified. You can log in.'));
      }
      const token = signUserToken(user);
      return res.json({ message: 'Email already verified. You can log in.', alreadyVerified: true, verified: true, user, token });
    }

    if (user.email_verification_expires && new Date() > new Date(user.email_verification_expires)) {
      if (isBrowserHtmlNav) {
        return res.redirect('/?verify_error=' + encodeURIComponent('Verification code has expired. Please request a new code.'));
      }
      return res.status(400).json({ error: 'Verification code has expired. Please request a new code.' });
    }

    await pool.query(
      'UPDATE users SET is_verified = true, email_verification_token = NULL, email_verification_expires = NULL, updated_at = NOW() WHERE id = ?',
      [user.id]
    );

    console.log(`[Auth] Email verified successfully for: ${user.email}`);

    if (isBrowserHtmlNav) {
      return res.redirect('/?verify_success=' + encodeURIComponent('Email verified successfully! You can now log in.'));
    }

    const token = signUserToken(user);

    let modules = [];
    if (user.role === 'superadmin') {
      modules = ALL_MODULES;
    } else if (user.role === 'admin') {
      const [permsRows] = await pool.query('SELECT module FROM admin_permissions WHERE user_id = ?', [user.id]);
      modules = permsRows.map(r => r.module);
    }

    return res.json({
      message: 'Email verified successfully! Welcome to PUPSJ HUB.',
      verified: true,
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        middle_initial: user.middle_initial,
        last_name: user.last_name,
        role: user.role,
        department: user.department,
        section: user.section,
        year_level: user.year_level,
        student_type: user.student_type,
        employment_type: user.employment_type || null,
        profile_image: user.profile_image,
        modules
      },
      token
    });
  } catch (err) {
    return handleAuthError(err, res, 'Email verification failed');
  }
});

// ── Forgot Password ──────────────────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const rawIdentifier = (req.body.email || req.body.identifier || '').trim();
    if (!rawIdentifier) return res.status(400).json({ error: 'Email or ID number is required' });

    const [rows] = await pool.query(
      'SELECT id, first_name, email FROM users WHERE (LOWER(TRIM(email)) = ? OR UPPER(TRIM(student_number)) = ?) AND is_active = true',
      [normalizeEmail(rawIdentifier), rawIdentifier.toUpperCase()]
    );

    if (rows.length > 0) {
      const user = rows[0];
      const resetToken = generateToken();
      const resetExpires = new Date(Date.now() + 60 * 60 * 1000);

      await pool.query(
        'UPDATE users SET password_reset_token = ?, password_reset_expires = ?, updated_at = NOW() WHERE id = ?',
        [resetToken, resetExpires, user.id]
      );

      try {
        await sendPasswordResetEmail(user.email, user.first_name, resetToken);
        console.log(`[Auth] Password reset email sent: ${user.email}`);
      } catch (e) {
        console.error('[Auth] Failed to send password reset email:', e.message);
      }
    }

    res.json({ message: 'If that account is registered, a password reset link has been sent to the registered email.' });
  } catch (err) {
    return handleAuthError(err, res, 'Failed to process request');
  }
});

// ── Reset Password ───────────────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and new password are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const [rows] = await pool.query(
      'SELECT id, email, first_name, password_reset_expires FROM users WHERE password_reset_token = ?',
      [token]
    );
    if (!rows.length) return res.status(400).json({ error: 'Invalid or expired reset link.' });

    const user = rows[0];
    if (new Date() > new Date(user.password_reset_expires)) {
      return res.status(400).json({ error: 'Reset link has expired. Please request a new one.' });
    }

    const password_hash = await bcrypt.hash(password, 12);
    await pool.query(
      'UPDATE users SET password_hash = ?, password_reset_token = NULL, password_reset_expires = NULL, updated_at = NOW() WHERE id = ?',
      [password_hash, user.id]
    );

    console.log(`[Auth] Password reset successful: ${user.email}`);
    res.json({ message: 'Password reset successfully! You can now log in with your new password.' });
  } catch (err) {
    return handleAuthError(err, res, 'Failed to reset password');
  }
});

// ── Resend Verification Email ────────────────────────────────────────────
router.post('/resend-verification', async (req, res) => {
  try {
    const rawInput = (req.body.email || req.body.identifier || req.body.student_number || '').trim();
    if (!rawInput) return res.status(400).json({ error: 'Email or ID number is required' });

    const normalizedEmail = normalizeEmail(rawInput);
    const upperId = rawInput.toUpperCase();

    const [rows] = await pool.query(
      'SELECT id, first_name, email, student_number, is_verified FROM users WHERE email = ? OR UPPER(TRIM(student_number)) = ?',
      [normalizedEmail, upperId]
    );

    if (!rows.length || rows[0].is_verified) {
      return res.json({ message: 'If that account requires verification, a new 6-digit code has been sent to your email.' });
    }

    const user = rows[0];
    const verificationToken = generateVerificationCode();
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await pool.query(
      'UPDATE users SET email_verification_token = ?, email_verification_expires = ?, updated_at = NOW() WHERE id = ?',
      [verificationToken, verificationExpires, user.id]
    );

    try {
      await sendVerificationEmail(user.email, user.first_name, verificationToken);
      console.log(`[Auth] Resent verification code ${verificationToken} to ${user.email}`);
    } catch (e) {
      console.error('[Auth] Failed to resend verification email:', e.message);
      return res.status(500).json({ error: 'We were unable to send the verification email. Please check your internet connection or try again.' });
    }

    res.json({ message: 'A new 6-digit verification code has been sent to your email. Please check your inbox.', email: user.email });
  } catch (err) {
    return handleAuthError(err, res, 'Failed to resend verification email');
  }
});

// ── Upload Avatar ────────────────────────────────────────────────────────
router.post('/me/avatar', authenticateToken, uploadProfile.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const url = `/uploads/profiles/${req.file.filename}`;
    await pool.query('UPDATE users SET profile_image = ?, updated_at = NOW() WHERE id = ?', [url, req.user.id]);
    const [fetchedRows] = await pool.query('SELECT profile_image FROM users WHERE id = ?', [req.user.id]);
    res.json({ profile_image: fetchedRows[0].profile_image });
  } catch (err) {
    return handleAuthError(err, res, 'Failed to upload avatar');
  }
});

// ── Guest Login ──────────────────────────────────────────────────────────
router.post('/guest-login', async (req, res) => {
  try {
    const uniqueSuffix = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    const guestStudentNumber = ('GST-' + uniqueSuffix).toUpperCase().substring(0, 20);
    const guestEmail = `guest_${uniqueSuffix}@pupsj.edu.ph`;
    const guestHash = '$2b$10$epNz8x74.c6sK5rLg3u/veC1hC8sXnOsqj.r9Q3iJ7.7uVvL0e0c2';
    const newGuestId = uuidv4();

    await pool.query(
      `INSERT INTO users (id, student_number, email, password_hash, first_name, last_name, role, is_verified, is_active)
       VALUES (?, ?, ?, ?, 'Guest', 'User', 'guest', true, true)`,
      [newGuestId, guestStudentNumber, guestEmail, guestHash]
    );

    const [fetchedGuestRows] = await pool.query('SELECT * FROM users WHERE id = ?', [newGuestId]);
    const user = fetchedGuestRows[0];
    const token = signUserToken(user);

    res.json({
      message: 'Guest login successful',
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role,
        department: user.department,
        section: user.section,
        year_level: user.year_level,
        student_type: user.student_type,
        profile_image: user.profile_image
      },
      token
    });
  } catch (err) {
    return handleAuthError(err, res, 'Guest login failed');
  }
});

module.exports = router;
