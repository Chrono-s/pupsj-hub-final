const jwt = require('jsonwebtoken');
const pool = require('../config/database');

async function authenticateToken(req, res, next) {
  const token = req.cookies?.token || req.headers['authorization']?.split(' ')[1];
  const expectsJson = req.originalUrl?.startsWith('/api') || req.xhr || req.headers.accept?.includes('json');
  
  if (!token) {
    if (expectsJson) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    return res.redirect('/login');
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const result = await pool.query(
      'SELECT id, email, role, first_name, last_name, department, section, year_level, student_type, is_active, student_number FROM users WHERE id = $1',
      [decoded.id]
    );
    if (result.rows.length === 0) {
      throw new Error('USER_NOT_FOUND');
    }

    const user = result.rows[0];
    if (!user.is_active) {
      throw new Error('USER_INACTIVE');
    }

    if (user.role !== 'admin') {
      const allowed = await pool.query(
        'SELECT 1 FROM allowed_registrations WHERE UPPER(TRIM(id_number)) = UPPER(TRIM($1))',
        [user.student_number]
      );
      if (allowed.rows.length === 0) {
        throw new Error('ALLOWED_ID_REMOVED');
      }
    }

    req.user = user;
    next();
  } catch (err) {
    if (expectsJson) {
      if (err.message === 'ALLOWED_ID_REMOVED') {
        return res.status(403).json({ error: 'Your ID is no longer authorized. Please contact your admin.' });
      }
      if (err.message === 'USER_NOT_FOUND') {
        return res.status(403).json({ error: 'User not found' });
      }
      if (err.message === 'USER_INACTIVE') {
        return res.status(403).json({ error: 'Account is inactive' });
      }
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    return res.redirect('/login');
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

function optionalAuth(req, res, next) {
  const token = req.cookies?.token || req.headers['authorization']?.split(' ')[1];
  if (token) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    } catch (e) {
      // Token invalid, continue without user
    }
  }
  next();
}

module.exports = { authenticateToken, requireRole, optionalAuth };
