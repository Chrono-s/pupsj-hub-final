-- ============================================
-- PUPSJ HUB - Consolidated Database Schema (MySQL 8.0+)
-- ============================================

CREATE DATABASE IF NOT EXISTS pupsj_hub
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE pupsj_hub;

SET FOREIGN_KEY_CHECKS = 0;

-- ────────────────────────────────────────────
-- 1. USERS TABLE
-- ────────────────────────────────────────────
DROP TABLE IF EXISTS users;
CREATE TABLE users (
    id CHAR(36) PRIMARY KEY,
    student_number VARCHAR(20) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'faculty', 'admin', 'guest', 'superadmin')),
    department VARCHAR(100) NULL,
    profile_image VARCHAR(500) NULL,
    is_verified BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    phone VARCHAR(30) NULL,
    bio TEXT NULL,
    position VARCHAR(100) NULL,
    section VARCHAR(50) NULL,
    year_level VARCHAR(20) NULL,
    student_type VARCHAR(20) NULL,
    employment_type VARCHAR(20) NULL CHECK (employment_type IS NULL OR employment_type IN ('part_time', 'full_time')),
    middle_initial VARCHAR(10) NULL,
    schedule_embed_url VARCHAR(1000) NULL,
    faculty_status VARCHAR(30) DEFAULT 'unavailable',
    faculty_status_room VARCHAR(100) NULL,
    faculty_status_note VARCHAR(255) NULL,
    faculty_status_until DATETIME NULL,
    faculty_status_updated_at DATETIME NULL,
    faculty_credentials JSON NULL,
    faculty_profile_status VARCHAR(20) DEFAULT NULL CHECK (faculty_profile_status IS NULL OR faculty_profile_status IN ('pending', 'approved', 'rejected')),
    faculty_profile_remarks TEXT NULL,
    email_verification_token VARCHAR(255) NULL,
    email_verification_expires DATETIME NULL,
    password_reset_token VARCHAR(255) NULL,
    password_reset_expires DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────
-- 2. FACULTY ALLOWED PROGRAMS
-- ────────────────────────────────────────────
DROP TABLE IF EXISTS faculty_allowed_programs;
CREATE TABLE faculty_allowed_programs (
    id CHAR(36) PRIMARY KEY,
    faculty_id CHAR(36) NOT NULL,
    program VARCHAR(40) NOT NULL,
    assigned_by CHAR(36) NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_faculty_program (faculty_id, program),
    CONSTRAINT fk_fap_faculty FOREIGN KEY (faculty_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_fap_assigned_by FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────
-- 3. ALLOWED REGISTRATIONS TABLE
-- ────────────────────────────────────────────
DROP TABLE IF EXISTS allowed_registrations;
CREATE TABLE allowed_registrations (
    id CHAR(36) PRIMARY KEY,
    id_number VARCHAR(20) UNIQUE NOT NULL,
    department VARCHAR(100) NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'faculty', 'admin', 'guest', 'superadmin')),
    is_used BOOLEAN DEFAULT FALSE,
    added_by CHAR(36) NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ar_added_by FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────
-- 4. PAGES & COMMITTEES TABLES
-- ────────────────────────────────────────────
DROP TABLE IF EXISTS page_members;
DROP TABLE IF EXISTS pages;

CREATE TABLE pages (
    id CHAR(36) PRIMARY KEY,
    owner_id CHAR(36) NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT NULL,
    category VARCHAR(100) NOT NULL DEFAULT 'Organization',
    cover_image VARCHAR(500) NULL,
    logo_image VARCHAR(500) NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
    rejection_reason TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_pages_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE page_members (
    id CHAR(36) PRIMARY KEY,
    page_id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    role VARCHAR(20) DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_page_member (page_id, user_id),
    CONSTRAINT fk_pm_page FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE,
    CONSTRAINT fk_pm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────
-- 5. ANNOUNCEMENTS TABLE
-- ────────────────────────────────────────────
DROP TABLE IF EXISTS announcement_images;
DROP TABLE IF EXISTS announcements;

CREATE TABLE announcements (
    id CHAR(36) PRIMARY KEY,
    author_id CHAR(36) NULL,
    page_id CHAR(36) NULL,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    department VARCHAR(100) DEFAULT 'General',
    is_anonymous BOOLEAN DEFAULT FALSE,
    is_pinned BOOLEAN DEFAULT FALSE,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'pending', 'rejected', 'archived', 'deleted')),
    approved_by CHAR(36) NULL,
    approved_at DATETIME NULL,
    rejection_reason TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_ann_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_ann_page FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE SET NULL,
    CONSTRAINT fk_ann_approved_by FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE announcement_images (
    id CHAR(36) PRIMARY KEY,
    announcement_id CHAR(36) NOT NULL,
    image_url VARCHAR(500) NOT NULL,
    display_order INT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ai_announcement FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────
-- 6. EVENTS TABLE
-- ────────────────────────────────────────────
DROP TABLE IF EXISTS event_images;
DROP TABLE IF EXISTS events;

CREATE TABLE events (
    id CHAR(36) PRIMARY KEY,
    author_id CHAR(36) NULL,
    page_id CHAR(36) NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NULL,
    location VARCHAR(255) NULL,
    event_date DATE NOT NULL,
    start_time TIME NULL,
    end_time TIME NULL,
    department VARCHAR(100) DEFAULT 'General',
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'pending', 'rejected', 'cancelled', 'completed', 'deleted')),
    is_archived BOOLEAN DEFAULT FALSE,
    approved_by CHAR(36) NULL,
    approved_at DATETIME NULL,
    rejection_reason TEXT NULL,
    feedback_form_schema JSON NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_events_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_events_page FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE SET NULL,
    CONSTRAINT fk_events_approved_by FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE event_images (
    id CHAR(36) PRIMARY KEY,
    event_id CHAR(36) NOT NULL,
    image_url VARCHAR(500) NOT NULL,
    display_order INT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ei_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────
-- 7. EVENT FEEDBACK & AI ANALYSIS
-- ────────────────────────────────────────────
DROP TABLE IF EXISTS event_feedback_responses;
CREATE TABLE event_feedback_responses (
    id CHAR(36) PRIMARY KEY,
    event_id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    answers JSON NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_event_user (event_id, user_id),
    CONSTRAINT fk_efr_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    CONSTRAINT fk_efr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS event_feedback_ai_analysis;
CREATE TABLE event_feedback_ai_analysis (
    event_id CHAR(36) PRIMARY KEY,
    analysis JSON NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_efaa_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────
-- 8. GENERAL FEEDBACK TABLE
-- ────────────────────────────────────────────
DROP TABLE IF EXISTS feedback_images;
DROP TABLE IF EXISTS feedback;

CREATE TABLE feedback (
    id CHAR(36) PRIMARY KEY,
    user_id CHAR(36) NULL,
    event_id CHAR(36) NULL,
    rating INT CHECK (rating BETWEEN 1 AND 5),
    comment TEXT NULL,
    sentiment VARCHAR(20) DEFAULT 'neutral' CHECK (sentiment IN ('positive', 'neutral', 'negative')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_feedback_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_feedback_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE feedback_images (
    id CHAR(36) PRIMARY KEY,
    feedback_id CHAR(36) NOT NULL,
    image_url VARCHAR(500) NOT NULL,
    display_order INT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_fi_feedback FOREIGN KEY (feedback_id) REFERENCES feedback(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────
-- 9. LOST AND FOUND TABLE
-- ────────────────────────────────────────────
DROP TABLE IF EXISTS lost_found_images;
DROP TABLE IF EXISTS lost_found;

CREATE TABLE lost_found (
    id CHAR(36) PRIMARY KEY,
    reporter_id CHAR(36) NULL,
    type VARCHAR(10) NOT NULL CHECK (type IN ('lost', 'found')),
    item_name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(100) NULL,
    location_found VARCHAR(255) NULL,
    date_reported DATE DEFAULT (CURRENT_DATE),
    date_lost_found DATE DEFAULT (CURRENT_DATE),
    contact_info VARCHAR(255) NULL,
    status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'matched', 'claimed', 'resolved', 'closed', 'deleted')),
    is_archived BOOLEAN DEFAULT FALSE,
    matched_with CHAR(36) NULL,
    match_review_status VARCHAR(20) DEFAULT 'none' CHECK (match_review_status IN ('none', 'pending', 'approved', 'rejected')),
    match_score DECIMAL(5,4) NULL,
    approved BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_lf_reporter FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_lf_matched FOREIGN KEY (matched_with) REFERENCES lost_found(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE lost_found_images (
    id CHAR(36) PRIMARY KEY,
    lost_found_id CHAR(36) NOT NULL,
    image_url VARCHAR(500) NOT NULL,
    display_order INT DEFAULT 0,
    image_fingerprint TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_lfi_lost_found FOREIGN KEY (lost_found_id) REFERENCES lost_found(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────
-- 10. CHATBOT TABLES
-- ────────────────────────────────────────────
DROP TABLE IF EXISTS chatbot_logs;
CREATE TABLE chatbot_logs (
    id CHAR(36) PRIMARY KEY,
    user_id CHAR(36) NULL,
    user_message TEXT NOT NULL,
    bot_response TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_cbl_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS handbook_chunks;
CREATE TABLE handbook_chunks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    chunk_text TEXT NOT NULL,
    chunk_index INT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────
-- 11. NOTIFICATIONS TABLE
-- ────────────────────────────────────────────
DROP TABLE IF EXISTS notifications;
CREATE TABLE notifications (
    id CHAR(36) PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NULL,
    type VARCHAR(50) DEFAULT 'general',
    is_read BOOLEAN DEFAULT FALSE,
    link VARCHAR(500) NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────
-- 12. SCHEDULES TABLES
-- ────────────────────────────────────────────
DROP TABLE IF EXISTS class_schedules;
CREATE TABLE class_schedules (
    id CHAR(36) PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    subject_code VARCHAR(20) NOT NULL,
    subject_name VARCHAR(255) NOT NULL,
    day_of_week VARCHAR(10) NOT NULL CHECK (day_of_week IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    room VARCHAR(50) NULL,
    instructor VARCHAR(255) NULL,
    faculty_user_id CHAR(36) NULL,
    department VARCHAR(100) NULL,
    section VARCHAR(50) NULL,
    year_level VARCHAR(20) NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_cs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_cs_faculty FOREIGN KEY (faculty_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS faculty_schedules;
CREATE TABLE faculty_schedules (
    id CHAR(36) PRIMARY KEY,
    faculty_id CHAR(36) NOT NULL,
    term VARCHAR(20) NULL CHECK (term IS NULL OR term IN ('SUMMER', 'FIRST_SEMESTER', 'SECOND_SEMESTER')),
    academic_year VARCHAR(9) NULL,
    subject_code VARCHAR(20) NOT NULL,
    subject_name VARCHAR(255) NOT NULL,
    day_of_week VARCHAR(10) NOT NULL CHECK (day_of_week IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    room VARCHAR(50) NULL,
    section VARCHAR(50) NULL,
    department VARCHAR(100) NULL,
    year_level VARCHAR(20) NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_fs_faculty FOREIGN KEY (faculty_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS section_schedules;
CREATE TABLE section_schedules (
    id CHAR(36) PRIMARY KEY,
    posted_by CHAR(36) NULL,
    title VARCHAR(255) NOT NULL,
    department VARCHAR(100) NOT NULL,
    year_level VARCHAR(20) NOT NULL,
    section VARCHAR(50) NOT NULL,
    schedule_url VARCHAR(500) NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_ss_posted_by FOREIGN KEY (posted_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS section_schedule_embeds;
CREATE TABLE section_schedule_embeds (
    id CHAR(36) PRIMARY KEY,
    department VARCHAR(100) NULL,
    year_level VARCHAR(20) NULL,
    section VARCHAR(20) NULL,
    title VARCHAR(200) NULL,
    embed_url TEXT NOT NULL,
    posted_by CHAR(36) NULL,
    faculty_id CHAR(36) NULL,
    target_type VARCHAR(20) DEFAULT 'section' CHECK (target_type IN ('section', 'faculty')),
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_sse_posted_by FOREIGN KEY (posted_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_sse_faculty FOREIGN KEY (faculty_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────
-- 13. SYSTEM SETTINGS TABLE
-- ────────────────────────────────────────────
DROP TABLE IF EXISTS system_settings;
CREATE TABLE system_settings (
    `key` VARCHAR(255) PRIMARY KEY,
    `value` TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────
-- 14. DOCUMENTS TABLES
-- ────────────────────────────────────────────
DROP TABLE IF EXISTS document_access;
DROP TABLE IF EXISTS category_access;
DROP TABLE IF EXISTS document_templates;
DROP TABLE IF EXISTS document_categories;

CREATE TABLE document_categories (
    id CHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT NULL,
    created_by CHAR(36) NULL,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
    department VARCHAR(100) DEFAULT 'General',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_dc_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE document_templates (
    id CHAR(36) PRIMARY KEY,
    category_id CHAR(36) NOT NULL,
    uploaded_by CHAR(36) NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NULL,
    file_url VARCHAR(500) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_size BIGINT DEFAULT 0,
    file_type VARCHAR(100) NULL,
    target_scope VARCHAR(50) DEFAULT 'public',
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
    download_count INT DEFAULT 0,
    department VARCHAR(100) DEFAULT 'General',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_dt_category FOREIGN KEY (category_id) REFERENCES document_categories(id) ON DELETE CASCADE,
    CONSTRAINT fk_dt_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE document_access (
    document_id CHAR(36) NOT NULL,
    student_id CHAR(36) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (document_id, student_id),
    CONSTRAINT fk_da_document FOREIGN KEY (document_id) REFERENCES document_templates(id) ON DELETE CASCADE,
    CONSTRAINT fk_da_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE category_access (
    category_id CHAR(36) NOT NULL,
    user_id CHAR(36) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (category_id, user_id),
    CONSTRAINT fk_ca_category FOREIGN KEY (category_id) REFERENCES document_categories(id) ON DELETE CASCADE,
    CONSTRAINT fk_ca_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────
-- 15. FACULTY LOADING SYSTEM
-- ────────────────────────────────────────────
DROP TABLE IF EXISTS loading_requests;
DROP TABLE IF EXISTS class_offerings;
DROP TABLE IF EXISTS courses;

CREATE TABLE courses (
    id CHAR(36) PRIMARY KEY,
    subject_code VARCHAR(20) NULL,
    subject_name VARCHAR(255) NOT NULL,
    subject_type VARCHAR(20) NOT NULL CHECK (subject_type IN ('MAJOR', 'GEED', 'ELEC', 'NSTP', 'PATHFIT')),
    program VARCHAR(40) NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE class_offerings (
    id CHAR(36) PRIMARY KEY,
    term VARCHAR(20) NOT NULL CHECK (term IN ('SUMMER', 'FIRST_SEMESTER', 'SECOND_SEMESTER')),
    academic_year VARCHAR(9) NULL,
    course_id CHAR(36) NULL,
    subject_code VARCHAR(20) NULL,
    subject_name VARCHAR(255) NOT NULL,
    program VARCHAR(40) NULL,
    section VARCHAR(50) NULL,
    day_of_week VARCHAR(10) NOT NULL CHECK (day_of_week IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    room VARCHAR(50) NULL,
    created_by CHAR(36) NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_offering_time CHECK (start_time < end_time),
    CONSTRAINT fk_co_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE RESTRICT,
    CONSTRAINT fk_co_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE loading_requests (
    id CHAR(36) PRIMARY KEY,
    faculty_id CHAR(36) NOT NULL,
    offering_id CHAR(36) NOT NULL,
    term VARCHAR(20) NOT NULL,
    academic_year VARCHAR(9) NULL,
    remarks TEXT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'returned')),
    admin_remarks TEXT NULL,
    reviewed_by CHAR(36) NULL,
    reviewed_at DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_lr_faculty FOREIGN KEY (faculty_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_lr_offering FOREIGN KEY (offering_id) REFERENCES class_offerings(id) ON DELETE CASCADE,
    CONSTRAINT fk_lr_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────
-- 16. ADMIN PERMISSIONS
-- ────────────────────────────────────────────
DROP TABLE IF EXISTS admin_permissions;
CREATE TABLE admin_permissions (
    id CHAR(36) PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    module VARCHAR(40) NOT NULL,
    granted_by CHAR(36) NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_admin_module (user_id, module),
    CONSTRAINT fk_ap_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_ap_granted_by FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────
-- 17. QUEUEING SYSTEM
-- ────────────────────────────────────────────
DROP TABLE IF EXISTS queue_schedule_closures;
DROP TABLE IF EXISTS queue_tickets;
DROP TABLE IF EXISTS queue_appointments;
DROP TABLE IF EXISTS queue_offices;

CREATE TABLE queue_offices (
    id CHAR(36) PRIMARY KEY,
    name VARCHAR(120) NOT NULL UNIQUE,
    code VARCHAR(24) NOT NULL UNIQUE,
    manager_user_id CHAR(36) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    operating_hours JSON NOT NULL,
    appointment_interval_minutes SMALLINT NOT NULL DEFAULT 15,
    appointment_capacity SMALLINT NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_qo_manager FOREIGN KEY (manager_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE queue_appointments (
    id CHAR(36) PRIMARY KEY,
    office_id CHAR(36) NOT NULL,
    student_user_id CHAR(36) NOT NULL,
    appointment_at DATETIME NOT NULL,
    service_name VARCHAR(120) NULL,
    visitor_name VARCHAR(150) NULL,
    contact_number VARCHAR(50) NULL,
    is_priority BOOLEAN NOT NULL DEFAULT FALSE,
    priority_type VARCHAR(80) NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'checked_in', 'cancelled', 'no_show', 'completed')),
    checked_in_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    cancelled_at DATETIME NULL,
    CONSTRAINT fk_qa_office FOREIGN KEY (office_id) REFERENCES queue_offices(id) ON DELETE CASCADE,
    CONSTRAINT fk_qa_student FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE queue_tickets (
    id CHAR(36) PRIMARY KEY,
    office_id CHAR(36) NOT NULL,
    ticket_number VARCHAR(32) NOT NULL,
    service_name VARCHAR(120) NULL,
    visitor_name VARCHAR(120) NULL,
    contact_number VARCHAR(50) NULL,
    student_user_id CHAR(36) NULL,
    queue_date DATE NOT NULL,
    source VARCHAR(16) NOT NULL DEFAULT 'walk_in' CHECK (source IN ('walk_in', 'appointment')),
    appointment_id CHAR(36) NULL,
    is_priority BOOLEAN NOT NULL DEFAULT FALSE,
    priority_type VARCHAR(80) NULL,
    queue_positioned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(16) NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','called','serving','skipped','completed','cancelled')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    called_at DATETIME NULL,
    completed_at DATETIME NULL,
    UNIQUE KEY uniq_queue_ticket_per_day (office_id, ticket_number, queue_date),
    CONSTRAINT fk_qt_office FOREIGN KEY (office_id) REFERENCES queue_offices(id) ON DELETE CASCADE,
    CONSTRAINT fk_qt_student FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_qt_appointment FOREIGN KEY (appointment_id) REFERENCES queue_appointments(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE queue_schedule_closures (
    office_id CHAR(36) NOT NULL,
    schedule_date DATE NOT NULL,
    closed_by_user_id CHAR(36) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (office_id, schedule_date),
    CONSTRAINT fk_qsc_office FOREIGN KEY (office_id) REFERENCES queue_offices(id) ON DELETE CASCADE,
    CONSTRAINT fk_qsc_closed_by FOREIGN KEY (closed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ────────────────────────────────────────────
-- 18. INDEXES
-- ────────────────────────────────────────────
CREATE INDEX idx_announcements_department ON announcements(department);
CREATE INDEX idx_announcements_created ON announcements(created_at DESC);
CREATE INDEX idx_events_date ON events(event_date);
CREATE INDEX idx_lost_found_type ON lost_found(type);
CREATE INDEX idx_lost_found_status ON lost_found(status);
CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX idx_class_schedules_user ON class_schedules(user_id);
CREATE INDEX idx_faculty_schedules_faculty ON faculty_schedules(faculty_id);
CREATE INDEX idx_allowed_registrations_id_number ON allowed_registrations(id_number);
CREATE INDEX idx_document_templates_category ON document_templates(category_id);
CREATE INDEX idx_courses_lookup ON courses(subject_type, program, is_active);
CREATE INDEX idx_offerings_term ON class_offerings(term, is_active);
CREATE INDEX idx_loading_requests_faculty ON loading_requests(faculty_id);
CREATE INDEX idx_loading_requests_offering ON loading_requests(offering_id);
CREATE INDEX idx_admin_permissions_user ON admin_permissions(user_id);
CREATE INDEX idx_queue_tickets_office_status ON queue_tickets(office_id, queue_date, status, created_at);
CREATE INDEX idx_queue_tickets_queue_order ON queue_tickets(office_id, queue_date, status, source, is_priority DESC, queue_positioned_at);
CREATE INDEX idx_queue_appointments_office_time ON queue_appointments(office_id, appointment_at, status);

-- ────────────────────────────────────────────
-- 19. SYSTEM DEFAULTS
-- ────────────────────────────────────────────
INSERT IGNORE INTO system_settings (`key`, `value`) VALUES ('active_term', 'FIRST_SEMESTER');
INSERT IGNORE INTO system_settings (`key`, `value`) VALUES ('active_year', '2025-2026');

SET FOREIGN_KEY_CHECKS = 1;
