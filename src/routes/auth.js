const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { uploadProfile } = require('../middleware/upload');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/email');

const VALID_YEAR_LEVELS = ['1st', '2nd', '3rd', '4th'];
const VALID_STUDENT_TYPES = ['regular', 'irregular'];

/** Generate a cryptographically secure URL-safe token */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Register
router.post('/register', async (req, res) => {
  try {
    const { student_number, email, password, first_name, middle_initial, last_name, section } = req.body;
    const year_level = typeof req.body.year_level === 'string' ? req.body.year_level.trim() : '';
    const student_type = typeof req.body.student_type === 'string' ? req.body.student_type.trim().toLowerCase() : '';
    const registrationRole = typeof req.body.registration_role === 'string' ? req.body.registration_role.trim().toLowerCase() : '';

    if (!student_number || !email || !password || !first_name || !last_name) {
      return res.status(400).json({ error: 'First name, last name, ID number, email, and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const trimmedId = student_number.trim().toUpperCase();

    // Check if this ID is in the allowed registrations list
    const allowed = await pool.query(
      'SELECT * FROM allowed_registrations WHERE id_number = $1',
      [trimmedId]
    );
    if (allowed.rows.length === 0) {
      return res.status(403).json({ error: 'Your ID number is not authorized to register. Please contact your admin.' });
    }

    const allowedEntry = allowed.rows[0];
    if (registrationRole && registrationRole !== allowedEntry.role) {
      return res.status(400).json({ error: `This ID is approved for ${allowedEntry.role} registration.` });
    }
    if (allowedEntry.is_used) {
      // Recover stale "used" IDs when the linked user no longer exists (e.g., deleted account).
      const existingById = await pool.query(
        'SELECT id FROM users WHERE student_number = $1',
        [trimmedId]
      );
      if (existingById.rows.length === 0) {
        await pool.query(
          'UPDATE allowed_registrations SET is_used = false WHERE id = $1',
          [allowedEntry.id]
        );
        allowedEntry.is_used = false;
      } else {
        return res.status(400).json({ error: 'This ID number has already been used to register' });
      }
    }

    // Check existing user
    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR student_number = $2',
      [email, trimmedId]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email or ID Number already registered' });
    }

    const password_hash = await bcrypt.hash(password, 12);
    const normalizedSection = typeof section === 'string' ? section.trim() : '';
    const isStudentRegistration = allowedEntry.role === 'student';
    if (isStudentRegistration) {
      if (!normalizedSection || !year_level || !student_type) {
        return res.status(400).json({ error: 'Section, year level, and student type are required for student registration' });
      }
      if (!VALID_YEAR_LEVELS.includes(year_level)) {
        return res.status(400).json({ error: 'Invalid year level. Must be 1st, 2nd, 3rd, or 4th.' });
      }
      if (!VALID_STUDENT_TYPES.includes(student_type)) {
        return res.status(400).json({ error: 'Invalid student type. Must be regular or irregular.' });
      }
    }

    // Generate email verification token (expires in 24 hours)
    const verificationToken = generateToken();
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Auto-assign role and department from allowed_registrations
    // is_verified = false — user must verify email before logging in
    const result = await pool.query(
      `INSERT INTO users (student_number, email, password_hash, first_name, middle_initial, last_name, role, department, section, year_level, student_type, is_verified, email_verification_token, email_verification_expires)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, $12, $13) RETURNING id, first_name, middle_initial, last_name, role, department, section, year_level, student_type`,
      [
        trimmedId,
        email,
        password_hash,
        first_name.trim(),
        middle_initial ? middle_initial.trim().substring(0, 10) : null,
        last_name.trim(),
        allowedEntry.role,
        allowedEntry.department,
        isStudentRegistration ? normalizedSection : null,
        isStudentRegistration ? year_level : null,
        isStudentRegistration ? student_type : null,
        verificationToken,
        verificationExpires
      ]
    );

    // Mark the allowed registration as used
    await pool.query('UPDATE allowed_registrations SET is_used = true WHERE id = $1', [allowedEntry.id]);

    // Send verification email (non-blocking — don't fail registration if email fails)
    sendVerificationEmail(email, first_name.trim(), verificationToken).catch(e =>
      console.error('[Auth] Failed to send verification email:', e.message)
    );

    res.status(201).json({
      message: 'Registration successful! Please check your email to verify your account before logging in.',
      requiresEmailVerification: true,
      user: result.rows[0]
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND is_active = true',
      [email]
    );

    if (result.rows.length === 0) {
      console.warn(`[AUTH] Failed login — unknown email: ${email} | IP: ${req.ip}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    if (user.role !== 'admin') {
      const allowed = await pool.query(
        'SELECT 1 FROM allowed_registrations WHERE UPPER(TRIM(id_number)) = UPPER(TRIM($1))',
        [user.student_number]
      );
      if (allowed.rows.length === 0) {
        console.warn(`[AUTH] Login blocked - removed from allowed registrations: ${email} | IP: ${req.ip}`);
        return res.status(403).json({ error: 'Your ID is no longer authorized. Please contact your admin.' });
      }
    }

    if (!user.is_verified && user.role !== 'admin') {
      console.warn(`[AUTH] Login blocked — unverified account: ${email} | IP: ${req.ip}`);
      return res.status(403).json({
        error: 'Please verify your email address before logging in. Check your inbox for the verification link.',
        code: 'EMAIL_NOT_VERIFIED'
      });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      console.warn(`[AUTH] Failed login — wrong password: ${email} | IP: ${req.ip}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
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
        student_type: user.student_type
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '4h' }
    );

    console.log(`[AUTH] Successful login: ${email} (${user.role}) | IP: ${req.ip}`);

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
        profile_image: user.profile_image
      },
      token
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  res.json({ message: 'Logged out successfully' });
});

// Get current user
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, student_number, email, first_name, middle_initial, last_name, role, department, section,
              year_level, student_type, profile_image, phone, bio, position, schedule_embed_url,
              faculty_status, faculty_status_room, faculty_status_note, faculty_status_until,
              faculty_status_updated_at, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Update profile (text fields)
router.patch('/me', authenticateToken, async (req, res) => {
  try {
    const { first_name, middle_initial, last_name, department, section, phone, bio, position } = req.body;
    if (!first_name || !last_name) {
      return res.status(400).json({ error: 'First name and last name are required' });
    }
    const result = await pool.query(
      `UPDATE users SET
         first_name = $1,
         middle_initial = $2,
         last_name  = $3,
         department = COALESCE(NULLIF($4,''), department),
         section    = COALESCE(NULLIF($5,''), section),
         phone      = $6,
         bio        = $7,
         position   = $8,
         updated_at = NOW()
       WHERE id = $9
       RETURNING id, student_number, email, first_name, middle_initial, last_name, role, department, section, profile_image, phone, bio, position`,
      [
        first_name.trim(),
        middle_initial ? middle_initial.trim().substring(0, 10) : null,
        last_name.trim(),
        department || null,
        section || null,
        phone || null,
        bio || null,
        position || null,
        req.user.id
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ── Schedule embed URL (Google Docs/Sheets/Calendar, Canva, Microsoft only) ──
// Matches whole-host to prevent e.g. "evil.docs.google.com" bypass.
const EMBED_HOST_ALLOWLIST = [
  /^(docs|sheets|calendar)\.google\.com$/i,
  /^drive\.google\.com$/i,
  /^(www\.)?canva\.com$/i,
  /^onedrive\.live\.com$/i,
  /^(view|embed|sway)\.office\.com$/i,
  /^1drv\.ms$/i,                 // OneDrive short links
  /^(www\.)?office\.com$/i,
  /^(www\.)?sway\.cloud\.microsoft$/i,
];

function isAllowedEmbedUrl(raw) {
  if (!raw) return true; // empty clears the URL
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    return EMBED_HOST_ALLOWLIST.some((rx) => rx.test(u.hostname));
  } catch (_) {
    return false;
  }
}

router.patch('/me/schedule', authenticateToken, async (req, res) => {
  try {
    const raw = typeof req.body.schedule_embed_url === 'string' ? req.body.schedule_embed_url.trim() : '';
    if (!isAllowedEmbedUrl(raw)) {
      return res.status(400).json({
        error: 'Only Google (Docs/Sheets/Calendar/Drive), Canva, or Microsoft (OneDrive/Office/Sway) HTTPS links are allowed.'
      });
    }
    const result = await pool.query(
      `UPDATE users SET schedule_embed_url = $1, updated_at = NOW() WHERE id = $2 RETURNING schedule_embed_url`,
      [raw || null, req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update schedule embed error:', err);
    res.status(500).json({ error: 'Failed to update schedule link' });
  }
});

// ── Faculty manual status (Professor Locator, Option B) ──
const VALID_FACULTY_STATUSES = ['in_class', 'in_office', 'available', 'unavailable'];

router.patch('/me/faculty-status', authenticateToken, async (req, res) => {
  try {
    if (!['faculty', 'admin'].includes(req.user.role)) {
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
    const result = await pool.query(
      `UPDATE users
         SET faculty_status = $1,
             faculty_status_room = $2,
             faculty_status_note = $3,
             faculty_status_until = $4,
             faculty_status_updated_at = NOW(),
             updated_at = NOW()
       WHERE id = $5
       RETURNING faculty_status, faculty_status_room, faculty_status_note, faculty_status_until, faculty_status_updated_at`,
      [
        status,
        room ? String(room).trim().substring(0, 100) : null,
        note ? String(note).trim().substring(0, 255) : null,
        untilParsed,
        req.user.id
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update faculty status error:', err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// ── Verify Email ──────────────────────────────────────────────────────────────
// GET /api/auth/verify-email?token=xxx
router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Verification token is required' });

    const result = await pool.query(
      `SELECT id, email, first_name, is_verified, email_verification_expires
       FROM users WHERE email_verification_token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired verification link.' });
    }

    const user = result.rows[0];

    if (user.is_verified) {
      return res.json({ message: 'Email already verified. You can log in.', alreadyVerified: true });
    }

    if (new Date() > new Date(user.email_verification_expires)) {
      return res.status(400).json({ error: 'Verification link has expired. Please re-register or contact your admin.' });
    }

    // Mark as verified and clear token
    await pool.query(
      `UPDATE users
         SET is_verified = true,
             email_verification_token = NULL,
             email_verification_expires = NULL,
             updated_at = NOW()
       WHERE id = $1`,
      [user.id]
    );

    console.log(`[Auth] Email verified: ${user.email}`);
    res.json({ message: 'Email verified successfully! You can now log in.', verified: true });
  } catch (err) {
    console.error('Verify email error:', err);
    res.status(500).json({ error: 'Email verification failed' });
  }
});

// ── Forgot Password ────────────────────────────────────────────────────────────
// POST /api/auth/forgot-password  { email }
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    // Always respond with success to prevent email enumeration
    const result = await pool.query(
      'SELECT id, first_name, email FROM users WHERE email = $1 AND is_active = true',
      [email.trim().toLowerCase()]
    );

    if (result.rows.length > 0) {
      const user = result.rows[0];
      const resetToken = generateToken();
      const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await pool.query(
        `UPDATE users SET password_reset_token = $1, password_reset_expires = $2, updated_at = NOW() WHERE id = $3`,
        [resetToken, resetExpires, user.id]
      );

      sendPasswordResetEmail(user.email, user.first_name, resetToken).catch(e =>
        console.error('[Auth] Failed to send password reset email:', e.message)
      );

      console.log(`[Auth] Password reset requested: ${user.email}`);
    }

    res.json({ message: 'If that email is registered, a password reset link has been sent.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// ── Reset Password ─────────────────────────────────────────────────────────────
// POST /api/auth/reset-password  { token, password }
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and new password are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const result = await pool.query(
      `SELECT id, email, first_name, password_reset_expires
       FROM users WHERE password_reset_token = $1`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset link.' });
    }

    const user = result.rows[0];
    if (new Date() > new Date(user.password_reset_expires)) {
      return res.status(400).json({ error: 'Reset link has expired. Please request a new one.' });
    }

    const password_hash = await bcrypt.hash(password, 12);
    await pool.query(
      `UPDATE users
         SET password_hash = $1,
             password_reset_token = NULL,
             password_reset_expires = NULL,
             updated_at = NOW()
       WHERE id = $2`,
      [password_hash, user.id]
    );

    console.log(`[Auth] Password reset successful: ${user.email}`);
    res.json({ message: 'Password reset successfully! You can now log in with your new password.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// ── Resend Verification Email ──────────────────────────────────────────────────
// POST /api/auth/resend-verification  { email }
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const result = await pool.query(
      'SELECT id, first_name, email, is_verified FROM users WHERE email = $1',
      [email.trim().toLowerCase()]
    );

    if (result.rows.length === 0 || result.rows[0].is_verified) {
      return res.json({ message: 'If that email needs verification, a new link has been sent.' });
    }

    const user = result.rows[0];
    const verificationToken = generateToken();
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await pool.query(
      `UPDATE users SET email_verification_token = $1, email_verification_expires = $2, updated_at = NOW() WHERE id = $3`,
      [verificationToken, verificationExpires, user.id]
    );

    sendVerificationEmail(user.email, user.first_name, verificationToken).catch(e =>
      console.error('[Auth] Failed to resend verification email:', e.message)
    );

    res.json({ message: 'Verification email sent! Please check your inbox.' });
  } catch (err) {
    console.error('Resend verification error:', err);
    res.status(500).json({ error: 'Failed to resend verification email' });
  }
});

// Upload profile picture
router.post('/me/avatar', authenticateToken, uploadProfile.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const url = `/uploads/profiles/${req.file.filename}`;
    const result = await pool.query(
      `UPDATE users SET profile_image = $1, updated_at = NOW() WHERE id = $2 RETURNING profile_image`,
      [url, req.user.id]
    );
    res.json({ profile_image: result.rows[0].profile_image });
  } catch (err) {
    console.error('Upload avatar error:', err);
    res.status(500).json({ error: 'Failed to upload avatar' });
  }
});

module.exports = router;
