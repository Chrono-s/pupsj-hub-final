-- ============================================
-- PUPSJ HUB - Consolidated Database Schema (PostgreSQL)
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
    last_name VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'faculty', 'admin', 'guest', 'superadmin')),
    department VARCHAR(100),
    profile_image VARCHAR(500),
    is_verified BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    phone VARCHAR(30),
    bio TEXT,
    position VARCHAR(100),
    section VARCHAR(50),
    year_level VARCHAR(20),
    student_type VARCHAR(20),
    middle_initial VARCHAR(10),
    schedule_embed_url VARCHAR(1000),
    faculty_status VARCHAR(30) DEFAULT 'unavailable',
    faculty_status_room VARCHAR(100),
    faculty_status_note VARCHAR(255),
    faculty_status_until TIMESTAMP WITH TIME ZONE,
    faculty_status_updated_at TIMESTAMP WITH TIME ZONE,
    email_verification_token VARCHAR(255),
    email_verification_expires TIMESTAMP WITH TIME ZONE,
    password_reset_token VARCHAR(255),
    password_reset_expires TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 2. ALLOWED REGISTRATIONS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS allowed_registrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    id_number VARCHAR(20) UNIQUE NOT NULL,
    department VARCHAR(100),
    role VARCHAR(20) NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'faculty', 'admin', 'guest', 'superadmin')),
    is_used BOOLEAN DEFAULT FALSE,
    added_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 3. ANNOUNCEMENTS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS announcements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    department VARCHAR(100) DEFAULT 'General',
    is_anonymous BOOLEAN DEFAULT FALSE,
    is_pinned BOOLEAN DEFAULT FALSE,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
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
-- 4. EVENTS TABLE
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
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'completed', 'deleted')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 5. LOST AND FOUND TABLE
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
    matched_with UUID REFERENCES lost_found(id) ON DELETE SET NULL,
    match_review_status VARCHAR(20) DEFAULT 'none' CHECK (match_review_status IN ('none', 'pending', 'approved', 'rejected')),
    match_score DECIMAL(5,4),
    approved BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lost_found_images (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lost_found_id UUID REFERENCES lost_found(id) ON DELETE CASCADE,
    image_url VARCHAR(500) NOT NULL,
    display_order INT DEFAULT 0,
    image_fingerprint TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 6. FEEDBACK TABLE
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
-- 7. CHATBOT INTEGRATION TABLES
-- ============================================

CREATE TABLE IF NOT EXISTS chatbot_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    user_message TEXT NOT NULL,
    bot_response TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS handbook_chunks (
    id SERIAL PRIMARY KEY,
    chunk_text TEXT NOT NULL,
    chunk_index INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 8. NOTIFICATIONS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    message TEXT,
    type VARCHAR(50) DEFAULT 'general',
    is_read BOOLEAN DEFAULT FALSE,
    link VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 9. SCHEDULES & EMBEDS TABLES
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
    faculty_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    department VARCHAR(100),
    section VARCHAR(50),
    year_level VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS faculty_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    faculty_id UUID REFERENCES users(id) ON DELETE CASCADE,
    subject_code VARCHAR(20) NOT NULL,
    subject_name VARCHAR(255) NOT NULL,
    day_of_week VARCHAR(10) NOT NULL CHECK (day_of_week IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    room VARCHAR(50),
    section VARCHAR(50),
    department VARCHAR(100),
    year_level VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS section_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    posted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    department VARCHAR(100) NOT NULL,
    year_level VARCHAR(20) NOT NULL,
    section VARCHAR(50) NOT NULL,
    schedule_url VARCHAR(500),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS section_schedule_embeds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    department VARCHAR(100),
    year_level VARCHAR(20),
    section VARCHAR(20),
    title VARCHAR(200),
    embed_url TEXT NOT NULL,
    posted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    faculty_id UUID REFERENCES users(id) ON DELETE SET NULL,
    target_type VARCHAR(20) DEFAULT 'section' CHECK (target_type IN ('section', 'faculty')),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 10. SYSTEM SETTINGS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(255) PRIMARY KEY,
    value TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 11. DOCUMENTS TABLES
-- ============================================

CREATE TABLE IF NOT EXISTS document_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    department VARCHAR(100) DEFAULT 'General'
);

CREATE TABLE IF NOT EXISTS document_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category_id UUID REFERENCES document_categories(id) ON DELETE CASCADE,
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    file_url VARCHAR(500) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_size BIGINT DEFAULT 0,
    file_type VARCHAR(100),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
    download_count INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    department VARCHAR(100) DEFAULT 'General'
);

CREATE TABLE IF NOT EXISTS document_access (
    document_id UUID REFERENCES document_templates(id) ON DELETE CASCADE,
    student_id UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (document_id, student_id)
);

CREATE TABLE IF NOT EXISTS category_access (
    category_id UUID REFERENCES document_categories(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (category_id, user_id)
);

-- ============================================
-- 12. PAGES & COMMITEES TABLES
-- ============================================

CREATE TABLE IF NOT EXISTS pages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100) NOT NULL DEFAULT 'Organization',
    cover_image VARCHAR(500),
    logo_image VARCHAR(500),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
    rejection_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS page_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    page_id UUID REFERENCES pages(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (page_id, user_id)
);

-- ============================================
-- 14. FACULTY LOADING SYSTEM
-- ============================================

-- Course catalog (seeded from the official curriculum / "FULL COURSES").
-- Drives the cascading dropdowns: term -> type -> program -> subject.
CREATE TABLE IF NOT EXISTS courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subject_code VARCHAR(20),
    subject_name VARCHAR(255) NOT NULL,
    subject_type VARCHAR(20) NOT NULL CHECK (subject_type IN ('MAJOR', 'GEED', 'ELEC', 'NSTP', 'PATHFIT')),
    program VARCHAR(40),                       -- e.g. BSIT, BSA; NULL = shared (e.g. GEED)
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Admin-defined class offerings (the slots faculty can claim).
-- Times/rooms live HERE so faculty never type a raw time; this is what makes
-- conflict avoidance automatic.
CREATE TABLE IF NOT EXISTS class_offerings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    term VARCHAR(20) NOT NULL CHECK (term IN ('SUMMER', 'FIRST_SEMESTER', 'SECOND_SEMESTER')),
    course_id UUID REFERENCES courses(id) ON DELETE RESTRICT,
    subject_code VARCHAR(20),
    subject_name VARCHAR(255) NOT NULL,
    program VARCHAR(40),
    section VARCHAR(50),
    day_of_week VARCHAR(10) NOT NULL CHECK (day_of_week IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    room VARCHAR(50),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CHECK (start_time < end_time)
);

-- Faculty loading requests + admin review workflow.
-- A request is just a wish; multiple faculty may request the same offering.
-- Exclusivity is enforced only on APPROVED rows (see unique index below).
CREATE TABLE IF NOT EXISTS loading_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    faculty_id UUID REFERENCES users(id) ON DELETE CASCADE,
    offering_id UUID REFERENCES class_offerings(id) ON DELETE CASCADE,
    term VARCHAR(20) NOT NULL,
    remarks TEXT,                              -- faculty's note
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'returned')),
    admin_remarks TEXT,                        -- admin's note on reject/return
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- 15. ADMIN MODULE PERMISSIONS
-- ============================================

-- Per-admin module access. Superadmin is implicitly granted all modules and is
-- never restricted by this table. An 'admin' can only access modules listed here.
CREATE TABLE IF NOT EXISTS admin_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    module VARCHAR(40) NOT NULL,
    granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (user_id, module)
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_announcements_department ON announcements(department);
CREATE INDEX IF NOT EXISTS idx_announcements_created ON announcements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
CREATE INDEX IF NOT EXISTS idx_lost_found_type ON lost_found(type);
CREATE INDEX IF NOT EXISTS idx_lost_found_status ON lost_found(status);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_class_schedules_user ON class_schedules(user_id);
CREATE INDEX IF NOT EXISTS idx_faculty_schedules_faculty ON faculty_schedules(faculty_id);
CREATE INDEX IF NOT EXISTS idx_allowed_registrations_id_number ON allowed_registrations(id_number);
CREATE INDEX IF NOT EXISTS idx_document_templates_category ON document_templates(category_id);

-- Faculty loading system
CREATE INDEX IF NOT EXISTS idx_courses_lookup ON courses(subject_type, program, is_active);
CREATE INDEX IF NOT EXISTS idx_offerings_term ON class_offerings(term, is_active);
CREATE INDEX IF NOT EXISTS idx_loading_requests_faculty ON loading_requests(faculty_id);
CREATE INDEX IF NOT EXISTS idx_loading_requests_offering ON loading_requests(offering_id);
-- Exclusivity: at most one APPROVED request per offering (race-proof at the DB level)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_approved_offering
    ON loading_requests (offering_id) WHERE status = 'approved';

-- Admin module permissions
CREATE INDEX IF NOT EXISTS idx_admin_permissions_user ON admin_permissions(user_id);

-- ============================================
-- BACKFILL: grant every existing admin all modules so access is unchanged
-- after this migration. Trim individual admins afterwards as needed.
-- Idempotent (ON CONFLICT DO NOTHING).
-- ============================================
INSERT INTO admin_permissions (user_id, module)
SELECT u.id, m.module
FROM users u
CROSS JOIN (VALUES
    ('announcements'), ('events'), ('lost_found'), ('feedback'),
    ('documents'), ('schedules'), ('loading_requests'), ('faculty'),
    ('notifications'), ('accounts'), ('chatbot'), ('pages')
) AS m(module)
WHERE u.role = 'admin'
ON CONFLICT (user_id, module) DO NOTHING;
