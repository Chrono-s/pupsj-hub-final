/**
 * Shared TypeScript types for PUPSJ HUB Express backend.
 * Import from here in every route/middleware file.
 */

import { Request } from 'express';

// ── Role & status enums ────────────────────────────────────────────────────
export type UserRole   = 'student' | 'faculty' | 'admin';
export type UserStatus = 'pending' | 'verified' | 'deactivated';
export type FacultyStatus = 'in_class' | 'in_office' | 'available' | 'unavailable';

// ── User shape returned from the DB after JWT verification ────────────────
export interface AuthUser {
  id:             string;
  email:          string;
  role:           UserRole;
  first_name:     string;
  last_name:      string;
  department:     string | null;
  section:        string | null;
  year_level:     string | null;
  student_type:   string | null;
  is_active:      boolean;
  student_number: string | null;
}

/** Express Request extended with the authenticated user (set by authenticateToken). */
export interface AuthRequest extends Request {
  user?: AuthUser;
}

// ── Database row types ─────────────────────────────────────────────────────
export interface DbUser {
  id:             string;
  email:          string;
  role:           UserRole;
  first_name:     string;
  last_name:      string;
  department:     string | null;
  section:        string | null;
  year_level:     string | null;
  student_type:   string | null;
  student_number: string | null;
  is_active:      boolean;
  status:         UserStatus;
  created_at:     Date;
}

export interface DbAnnouncement {
  id:          string;
  title:       string;
  content:     string;
  department:  string | null;
  status:      string;
  images:      string[] | null;
  posted_by:   string;
  created_at:  Date;
  updated_at:  Date;
}

export interface DbEvent {
  id:           string;
  title:        string;
  description:  string | null;
  event_date:   Date;
  start_time:   string | null;
  end_time:     string | null;
  location:     string | null;
  department:   string | null;
  status:       string;
  images:       string[] | null;
  created_by:   string;
  created_at:   Date;
}

export interface DbFeedback {
  id:          string;
  event_id:    string;
  user_id:     string;
  rating:      number;
  comment:     string | null;
  sentiment:   string | null;
  images:      string[] | null;
  created_at:  Date;
}

export interface DbLostFound {
  id:             string;
  item_name:      string;
  description:    string | null;
  type:           'Lost' | 'Found';
  status:         string;
  location_found: string | null;
  images:         string[] | null;
  reported_by:    string;
  created_at:     Date;
}

export interface DbScheduleEmbed {
  id:          string;
  department:  string;
  year_level:  string;
  section:     string;
  title:       string | null;
  embed_url:   string;
  posted_by:   string;
  created_at:  Date;
  updated_at:  Date;
}

// ── Firewall stats ─────────────────────────────────────────────────────────
export interface FirewallStats {
  bannedIPs:      number;
  trackedIPs:     number;
  blacklistedIPs: number;
  bans: Array<{ ip: string; remainingSeconds: number }>;
}
