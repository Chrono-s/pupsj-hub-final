const bcrypt = require('bcryptjs');
const pool = require('./src/config/database');
const fs = require('fs');
const path = require('path');

async function seed() {
  try {
    console.log('🔄 Running database schema...');
    const schema = fs.readFileSync(path.join(__dirname, 'database', 'schema.sql'), 'utf8');
    await pool.query(schema);
    // Since all schemas (including allowed_registrations and lost_found_images columns) are consolidated in schema.sql, 
    // separate migration files are no longer required.
    console.log('✅ Schema created');

    // Create admin user
    console.log('🔄 Creating admin user...');
    const adminHash = await bcrypt.hash('admin123', 12);
    await pool.query(`
      INSERT INTO users (student_number, email, password_hash, first_name, last_name, role, is_verified, is_active)
      VALUES ('ADMIN-001', 'admin@pupsj.edu.ph', $1, 'Super', 'Admin', 'admin', true, true)
      ON CONFLICT (email) DO NOTHING
    `, [adminHash]);

    // Create sample faculty
    const facultyHash = await bcrypt.hash('faculty123', 12);
    await pool.query(`
      INSERT INTO users (student_number, email, password_hash, first_name, last_name, role, department, is_verified, is_active)
      VALUES ('FAC-001', 'faculty@pupsj.edu.ph', $1, 'Juan', 'Dela Cruz', 'faculty', 'BSIT', true, true)
      ON CONFLICT (email) DO NOTHING
    `, [facultyHash]);

    // Create sample student
    const studentHash = await bcrypt.hash('student123', 12);
    await pool.query(`
      INSERT INTO users (student_number, email, password_hash, first_name, last_name, role, department, is_verified, is_active)
      VALUES ('2024-00001-SJ-0', 'student@pupsj.edu.ph', $1, 'Maria', 'Santos', 'student', 'BSIT', true, true)
      ON CONFLICT (email) DO NOTHING
    `, [studentHash]);

    // Sample announcements
    const adminUser = await pool.query("SELECT id FROM users WHERE email = 'admin@pupsj.edu.ph'");
    const facultyUser = await pool.query("SELECT id FROM users WHERE email = 'faculty@pupsj.edu.ph'");

    if (adminUser.rows.length > 0) {
      const adminId = adminUser.rows[0].id;
      const facultyId = facultyUser.rows[0]?.id || adminId;

      await pool.query(`
        INSERT INTO announcements (author_id, title, content, department, is_pinned)
        VALUES 
          ($1, 'Welcome to PUPSJ HUB!', 'We are excited to launch the PUPSJ HUB — your one-stop platform for campus announcements, events, lost & found, class schedules, and more. Stay tuned for updates!', 'General', true),
          ($2, 'Midterm Examination Schedule', 'The midterm examination for all BSIT students will be held from March 24-28. Please review your exam permits and schedules through the SIS portal. Good luck, Iskolar ng Bayan!', 'BSIT', false),
          ($1, 'Campus Wi-Fi Maintenance', 'The campus Wi-Fi network will undergo scheduled maintenance this Saturday from 8:00 AM to 12:00 PM. Please plan your online activities accordingly.', 'General', false)
        ON CONFLICT DO NOTHING
      `, [adminId, facultyId]);

      // Sample events
      const today = new Date();
      const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
      const nextMonth = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

      await pool.query(`
        INSERT INTO events (author_id, title, description, location, event_date, start_time, end_time, department)
        VALUES 
          ($1, 'IT Week 2025', 'Annual Information Technology Week featuring tech talks, coding competitions, and exhibits.', 'PUP San Juan Gymnasium', $2, '08:00', '17:00', 'BSIT'),
          ($1, 'Campus Clean-Up Drive', 'Join the community service activity to keep our campus clean and green.', 'PUP San Juan Campus', $3, '07:00', '12:00', 'General'),
          ($4, 'Research Colloquium', 'Presentation of capstone projects from graduating BSIT students.', 'Room 301', $5, '09:00', '16:00', 'BSIT')
        ON CONFLICT DO NOTHING
      `, [adminId, nextWeek.toISOString().split('T')[0], nextMonth.toISOString().split('T')[0], facultyId, new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]]);

      // Sample lost and found
      const studentUser = await pool.query("SELECT id FROM users WHERE email = 'student@pupsj.edu.ph'");
      if (studentUser.rows.length > 0) {
        await pool.query(`
          INSERT INTO lost_found (reporter_id, type, item_name, description, category, location_found, contact_info)
          VALUES 
            ($1, 'lost', 'Blue Water Bottle', 'Stainless steel blue water bottle with PUP sticker. Lost near the canteen area during lunch.', 'Personal Items', 'Canteen Area', 'Contact via PUPSJ HUB'),
            ($2, 'found', 'Scientific Calculator', 'Casio fx-991ES found at Room 205 after the Math class. Claim at the guard house.', 'School Supplies', 'Room 205', 'Guard House - Main Gate')
          ON CONFLICT DO NOTHING
        `, [studentUser.rows[0].id, facultyId]);
      }
    }

    console.log('✅ Seed data inserted');
    console.log('\n📋 Default Login Credentials:');
    console.log('   Admin:   admin@pupsj.edu.ph / admin123');
    console.log('   Faculty: faculty@pupsj.edu.ph / faculty123');
    console.log('   Student: student@pupsj.edu.ph / student123');

    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('❌ Seed error:', err);
    await pool.end();
    process.exit(1);
  }
}

seed();
