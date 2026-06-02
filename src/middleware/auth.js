const jwt = require('jsonwebtoken');
const pool = require('../config/database');

// All admin-gated modules. Superadmin is implicitly granted every module.
const ALL_MODULES = [
  'announcements', 'events', 'lost_found', 'feedback',
  'documents', 'schedules', 'loading_requests', 'faculty',
  'notifications', 'accounts', 'chatbot', 'pages',
];

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

    if (user.role !== 'admin' && user.role !== 'superadmin' && user.role !== 'guest') {
      const allowed = await pool.query(
        'SELECT 1 FROM allowed_registrations WHERE UPPER(TRIM(id_number)) = UPPER(TRIM($1))',
        [user.student_number]
      );
      if (allowed.rows.length === 0) {
        throw new Error('ALLOWED_ID_REMOVED');
      }
    }

    // Role inheritance helper: Superadmin inherits all admin capabilities seamlessly
    user.actualRole = user.role;
    if (user.role === 'superadmin') {
      Object.defineProperty(user, 'role', {
        get() { return 'admin'; },
        set(v) { user.actualRole = v; },
        configurable: true,
        enumerable: true
      });
    }

    // Attach granted admin modules so routes/UI can gate by module.
    // Superadmin gets all modules implicitly; admins get only what's granted.
    if (user.actualRole === 'superadmin') {
      user.modules = ALL_MODULES;
    } else if (user.actualRole === 'admin') {
      const perms = await pool.query('SELECT module FROM admin_permissions WHERE user_id = $1', [user.id]);
      user.modules = perms.rows.map(r => r.module);
    } else {
      user.modules = [];
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
    if (!req.user) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const actualRole = req.user.actualRole || req.user.role;
    const userRole = req.user.role;

    let isAllowed = roles.includes(userRole);

    // If route strictly requires 'superadmin' but not 'admin'
    if (roles.includes('superadmin') && !roles.includes('admin')) {
      isAllowed = (actualRole === 'superadmin');
    }

    if (!isAllowed) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Gate a route by admin module. Superadmin always passes; an 'admin' passes only
// if the module was granted to them; everyone else is denied. Must read actualRole
// because superadmin masquerades as 'admin' via the role getter above.
function requirePermission(module) {
  return async (req, res, next) => {
    const actualRole = req.user?.actualRole || req.user?.role;
    if (actualRole === 'superadmin') return next();
    if (actualRole !== 'admin') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    // Prefer the modules already attached at auth time; fall back to a query.
    if (Array.isArray(req.user.modules)) {
      if (req.user.modules.includes(module)) return next();
      return res.status(403).json({ error: 'You do not have access to this module' });
    }
    try {
      const r = await pool.query(
        'SELECT 1 FROM admin_permissions WHERE user_id = $1 AND module = $2',
        [req.user.id, module]
      );
      if (r.rows.length === 0) {
        return res.status(403).json({ error: 'You do not have access to this module' });
      }
      next();
    } catch (err) {
      console.error('[Auth] requirePermission error:', err);
      res.status(500).json({ error: 'Permission check failed' });
    }
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

module.exports = { authenticateToken, requireRole, requirePermission, optionalAuth, ALL_MODULES };
