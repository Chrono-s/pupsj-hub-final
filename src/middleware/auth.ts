import { Response, NextFunction, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../config/database';
import { AuthRequest, AuthUser } from '../types';

interface JwtPayload {
  id: string;
}

export async function authenticateToken(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token =
    req.cookies?.token ||
    (req.headers['authorization'] as string | undefined)?.split(' ')[1];

  const expectsJson =
    req.originalUrl?.startsWith('/api') ||
    !!(req as any).xhr ||
    req.headers.accept?.includes('json');

  if (!token) {
    if (expectsJson) {
      res.status(401).json({ error: 'Authentication required' });
    } else {
      res.redirect('/login');
    }
    return;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;

    const result = await pool.query<AuthUser>(
      `SELECT id, email, role, first_name, last_name, department,
              section, year_level, student_type, is_active, student_number
       FROM users WHERE id = $1`,
      [decoded.id]
    );

    if (result.rows.length === 0) throw new Error('USER_NOT_FOUND');

    const user = result.rows[0];
    if (!user.is_active) throw new Error('USER_INACTIVE');

    if (user.role !== 'admin') {
      const allowed = await pool.query(
        `SELECT 1 FROM allowed_registrations
         WHERE UPPER(TRIM(id_number)) = UPPER(TRIM($1))`,
        [user.student_number]
      );
      if (allowed.rows.length === 0) throw new Error('ALLOWED_ID_REMOVED');
    }

    req.user = user;
    next();
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (expectsJson) {
      if (message === 'ALLOWED_ID_REMOVED') {
        res.status(403).json({ error: 'Your ID is no longer authorized. Please contact your admin.' });
      } else if (message === 'USER_NOT_FOUND') {
        res.status(403).json({ error: 'User not found' });
      } else if (message === 'USER_INACTIVE') {
        res.status(403).json({ error: 'Account is inactive' });
      } else {
        res.status(403).json({ error: 'Invalid or expired token' });
      }
    } else {
      res.redirect('/login');
    }
  }
}

export function requireRole(...roles: string[]): RequestHandler {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

export function optionalAuth(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): void {
  const token =
    req.cookies?.token ||
    (req.headers['authorization'] as string | undefined)?.split(' ')[1];

  if (token) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET as string) as AuthUser;
    } catch {
      // Invalid token — continue without user
    }
  }
  next();
}
