-- ============================================
-- PUPSJ HUB - Complete Database Schema (PostgreSQL)
-- Single source of truth — replaces all migration-*.sql files
-- Run once on a fresh database; safe to re-run (idempotent)
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- 1. USERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_number VARCHAR(20) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    middle_initial VARCHAR(10),
    last_name VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'faculty', 'admin')),
    department VARCHAR(100),
    section VARCHAR(50),
    year_level VARCHAR(20) CHECK (year_level IN ('1st', '2nd', '3rd', '4th')),
    student_type VARCHAR(20) CHECK (student_type IN ('regular', 'irregular')),
    profile_image VARCHAR(500),
    phone VARCHAR(30),
    bio TEXT,
    position VARCHAR(100),
    schedule_embed_url VARCHAR(1000),
    -- Manual faculty status (used by Professor Locator)
    faculty_status VARCHAR(30) DEFAULT 'unavailable'
        CHECK (faculty_status IN ('in_class', 'in_office', 'available', 'unavailable')),
    faculty_status_room VARCHAR(100),
    faculty_status_note VARCHAR(255),
    faculty_status_until TIMESTAMP WITH TIME ZONE,
    faculty_status_updated_at TIMESTAMP WITH TIME ZONE,
    -- Email verification & password reset
    email_verification_token VARCHAR(255),
    email_verification_expires TIMESTAMP WITH TIME ZONE,
    password_reset_token VARCHAR(255),
    password_reset_expires TIMESTAMP WITH TIME ZONE,
    is_verified BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 2. ANNOUNCEMENTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS announcements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    department VARCHAR(100) DEFAULT 'General',
    is_pinned BOOLEAN DEFAULT FALSE,
    status VARCHAR(20) DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'archived', 'deleted', 'rejected')),
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMP WITH TIME ZONE,
    rejection_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS announcement_images (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    announcement_id UUID REFERENCES announcements(id) ON DELETE CASCADE,
    image_url VARCHAR(500) NOT NULL,
    display_order INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 3. EVENTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    location VARCHAR(255),
    event_date DATE NOT NULL,
    start_time TIME,
    end_time TIME,
    department VARCHAR(100) DEFAULT 'General',
    status VARCHAR(20) DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'cancelled', 'completed', 'deleted', 'rejected')),
    approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMP WITH TIME ZONE,
    rejection_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_images (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    image_url VARCHAR(500) NOT NULL,
    display_order INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 4. LOST AND FOUND TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS lost_found (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reporter_id UUID REFERENCES users(id) ON DELETE SET NULL,
    type VARCHAR(10) NOT NULL CHECK (type IN ('lost', 'found')),
    item_name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(100),
    location_found VARCHAR(255),
    date_reported DATE DEFAULT CURRENT_DATE,
    contact_info VARCHAR(255),
    status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'matched', 'claimed', 'resolved', 'closed')),
    matched_with UUID REFERENCES lost_found(id),
    match_review_status VARCHAR(20) NOT NULL DEFAULT 'none'
        CHECK (match_review_status IN ('none', 'pending', 'approved', 'rejected')),
    match_score NUMERIC(5,4),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lost_found_images (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lost_found_id UUID REFERENCES lost_found(id) ON DELETE CASCADE,
    image_url VARCHAR(500) NOT NULL,
    image_fingerprint TEXT,
    display_order INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 5. FEEDBACK TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS feedback (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    event_id UUID REFERENCES events(id) ON DELETE CASCADE,
    rating INT CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    sentiment VARCHAR(20) DEFAULT 'neutral' CHECK (sentiment IN ('positive', 'neutral', 'negative')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feedback_images (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    feedback_id UUID REFERENCES feedback(id) ON DELETE CASCADE,
    image_url VARCHAR(500) NOT NULL,
    display_order INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 6. CHATBOT LOGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS chatbot_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    user_message TEXT NOT NULL,
    bot_response TEXT NOT NULL,
    confidence_tier VARCHAR(10),
    llm_used VARCHAR(20),
    sources_found INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 7. CHATBOT LOW-CONFIDENCE LOG
-- ============================================
CREATE TABLE IF NOT EXISTS chatbot_low_confidence_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_message TEXT NOT NULL,
    confidence_tier VARCHAR(10),
    top_similarity FLOAT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 8. CLASS SCHEDULES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS class_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    subject_code VARCHAR(20) NOT NULL,
    subject_name VARCHAR(255) NOT NULL,
    day_of_week VARCHAR(10) NOT NULL CHECK (day_of_week IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    room VARCHAR(50),
    instructor VARCHAR(255),
    department VARCHAR(100),
    section VARCHAR(50),
    year_level VARCHAR(20) CHECK (year_level IN ('1st', '2nd', '3rd', '4th')),
    faculty_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 9. FACULTY TEACHING SCHEDULES TABLE
-- ============================================
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
    department VARCHAR(100),
    year_level VARCHAR(20) CHECK (year_level IN ('1st', '2nd', '3rd', '4th')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 10. SECTION SCHEDULE EMBEDS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS section_schedule_embeds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    department VARCHAR(100) NOT NULL,
    year_level VARCHAR(20) NOT NULL,
    section VARCHAR(20) NOT NULL,
    title VARCHAR(200),
    embed_url TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    posted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 11. HANDBOOK CHUNKS TABLE (AI / RAG)
-- ============================================
CREATE TABLE IF NOT EXISTS handbook_chunks (
    id SERIAL PRIMARY KEY,
    chunk_text TEXT NOT NULL,
    chunk_index INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 12. DOCUMENT CATEGORIES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS document_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 13. DOCUMENT TEMPLATES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS document_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category_id UUID REFERENCES document_categories(id) ON DELETE CASCADE,
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    department VARCHAR(100) DEFAULT 'General',
    file_url VARCHAR(500) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_size BIGINT DEFAULT 0,
    file_type VARCHAR(100),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
    download_count INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 14. ALLOWED REGISTRATIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS allowed_registrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    id_number VARCHAR(20) UNIQUE NOT NULL,
    department VARCHAR(100),
    role VARCHAR(20) NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'faculty')),
    is_used BOOLEAN DEFAULT FALSE,
    added_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================

-- Users
CREATE INDEX IF NOT EXISTS idx_users_year_level ON users(year_level);
CREATE INDEX IF NOT EXISTS idx_users_email_verification_token
    ON users (email_verification_token) WHERE email_verification_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_password_reset_token
    ON users (password_reset_token) WHERE password_reset_token IS NOT NULL;

-- Announcements
CREATE INDEX IF NOT EXISTS idx_announcements_department ON announcements(department);
CREATE INDEX IF NOT EXISTS idx_announcements_created ON announcements(created_at DESC);

-- Events
CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
CREATE INDEX IF NOT EXISTS idx_event_images_event ON event_images(event_id);

-- Lost & Found
CREATE INDEX IF NOT EXISTS idx_lost_found_type ON lost_found(type);
CREATE INDEX IF NOT EXISTS idx_lost_found_status ON lost_found(status);

-- Feedback
CREATE INDEX IF NOT EXISTS idx_feedback_images_feedback ON feedback_images(feedback_id);

-- Chatbot
CREATE INDEX IF NOT EXISTS idx_low_conf_created ON chatbot_low_confidence_log(created_at DESC);

-- Class Schedules
CREATE INDEX IF NOT EXISTS idx_class_schedules_user ON class_schedules(user_id);
CREATE INDEX IF NOT EXISTS idx_class_schedules_department ON class_schedules(department);
CREATE INDEX IF NOT EXISTS idx_class_schedules_faculty_user ON class_schedules(faculty_user_id);
CREATE INDEX IF NOT EXISTS idx_class_schedules_year_section ON class_schedules(year_level, section);

-- Faculty Schedules
CREATE INDEX IF NOT EXISTS idx_faculty_schedules_faculty ON faculty_schedules(faculty_id);
CREATE INDEX IF NOT EXISTS idx_faculty_schedules_day_time ON faculty_schedules(day_of_week, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_faculty_schedules_department ON faculty_schedules(department);
CREATE INDEX IF NOT EXISTS idx_faculty_schedules_year_section ON faculty_schedules(year_level, section);

-- Section Schedule Embeds
CREATE INDEX IF NOT EXISTS idx_sse_dept_year_sec
    ON section_schedule_embeds (department, year_level, section);

-- Handbook
CREATE INDEX IF NOT EXISTS idx_handbook_chunks_index ON handbook_chunks(chunk_index);

-- Documents
CREATE INDEX IF NOT EXISTS idx_document_categories_status ON document_categories(status);
CREATE INDEX IF NOT EXISTS idx_document_templates_category ON document_templates(category_id);
CREATE INDEX IF NOT EXISTS idx_document_templates_status ON document_templates(status);
CREATE INDEX IF NOT EXISTS idx_document_templates_created ON document_templates(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_templates_department ON document_templates(department);

-- Allowed Registrations
CREATE INDEX IF NOT EXISTS idx_allowed_registrations_id_number ON allowed_registrations(id_number);
CREATE INDEX IF NOT EXISTS idx_allowed_registrations_department ON allowed_registrations(department);
CREATE INDEX IF NOT EXISTS idx_allowed_registrations_is_used ON allowed_registrations(is_used);

-- ============================================
-- DEFAULT ADMIN USER (password: admin123)
-- ============================================
-- Note: Run seed.js to insert the default admin (bcrypt hash generated at runtime)
