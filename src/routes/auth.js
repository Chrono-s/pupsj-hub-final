const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { uploadProfile } = require('../middleware/upload');

// Register
router.post('/register', async (req, res) => {
  try {
    const { student_number, email, password, first_name, last_name, role, department } = req.body;

    // Check existing
    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR student_number = $2',
      [email, student_number]
    );
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email or Student Number already registered' });
    }

    const password_hash = await bcrypt.hash(password, 12);
    const userRole = role === 'faculty' ? 'faculty' : 'student';

    const result = await pool.query(
      `INSERT INTO users (student_number, email, password_hash, first_name, last_name, role, department, is_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, first_name, last_name, role`,
      [student_number, email, password_hash, first_name, last_name, userRole, department || null, false]
    );

    res.status(201).json({
      message: 'Registration successful. Please wait for admin approval.',
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
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    if (!user.is_verified && user.role !== 'admin') {
      return res.status(403).json({ error: 'Account pending admin approval' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        first_name: user.first_name,
        last_name: user.last_name,
        department: user.department
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role,
        department: user.department,
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
  res.clearCookie('token');
  res.json({ message: 'Logged out successfully' });
});

// Get current user
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, student_number, email, first_name, last_name, role, department,
              profile_image, phone, bio, position, created_at
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
    const { first_name, last_name, department, phone, bio, position } = req.body;
    if (!first_name || !last_name) {
      return res.status(400).json({ error: 'First name and last name are required' });
    }
    const result = await pool.query(
      `UPDATE users SET
         first_name = $1,
         last_name  = $2,
         department = COALESCE(NULLIF($3,''), department),
         phone      = $4,
         bio        = $5,
         position   = $6,
         updated_at = NOW()
       WHERE id = $7
       RETURNING id, student_number, email, first_name, last_name, role, department, profile_image, phone, bio, position`,
      [first_name.trim(), last_name.trim(), department || null, phone || null, bio || null, position || null, req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
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
