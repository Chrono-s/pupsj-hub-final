-- ============================================
-- PROFESSOR LOCATOR - Migration
-- ============================================

-- Faculty Teaching Schedules (maintained by faculty/admin)
CREATE TABLE IF NOT EXISTS faculty_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    faculty_id UUID REFERENCES users(id) ON DELETE CASCADE,
    subject_code VARCHAR(20) NOT NULL,
    subject_name VARCHAR(255) NOT NULL,
    day_of_week VARCHAR(10) NOT NULL CHECK (day_of_week IN ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    room VARCHAR(100),
    section VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add faculty_user_id FK to student class_schedules (optional link to actual faculty user)
ALTER TABLE class_schedules
  ADD COLUMN IF NOT EXISTS faculty_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_faculty_schedules_faculty ON faculty_schedules(faculty_id);
CREATE INDEX IF NOT EXISTS idx_faculty_schedules_day_time ON faculty_schedules(day_of_week, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_class_schedules_faculty_user ON class_schedules(faculty_user_id);
