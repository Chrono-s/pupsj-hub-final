    -- ============================================
    -- PUPSJ HUB - Database Schema (PostgreSQL)
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
        role VARCHAR(20) NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'faculty', 'admin')),
        department VARCHAR(100),
        profile_image VARCHAR(500),
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
        status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'completed', 'deleted')),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
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
        status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'matched', 'claimed', 'closed')),
        matched_with UUID REFERENCES lost_found(id),
        match_review_status VARCHAR(20) DEFAULT 'none' CHECK (match_review_status IN ('none', 'pending', 'approved', 'rejected')),
        match_score DECIMAL(5,4),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS lost_found_images (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        lost_found_id UUID REFERENCES lost_found(id) ON DELETE CASCADE,
        image_url VARCHAR(500) NOT NULL,
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

    -- ============================================
    -- 6. CHATBOT CONVERSATIONS TABLE
    -- ============================================

    CREATE TABLE IF NOT EXISTS chatbot_logs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        user_message TEXT NOT NULL,
        bot_response TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    -- ============================================
    -- 7. NOTIFICATIONS TABLE
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
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    -- ============================================
    -- INDEXES
    -- ============================================

    CREATE INDEX idx_announcements_department ON announcements(department);
    CREATE INDEX idx_announcements_created ON announcements(created_at DESC);
    CREATE INDEX idx_events_date ON events(event_date);
    CREATE INDEX idx_lost_found_type ON lost_found(type);
    CREATE INDEX idx_lost_found_status ON lost_found(status);
    CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);
    CREATE INDEX idx_class_schedules_user ON class_schedules(user_id);

    -- ============================================
    -- DEFAULT ADMIN USER (password: admin123)
    -- ============================================

