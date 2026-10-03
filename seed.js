const bcrypt = require('bcryptjs');
const pool = require('./src/config/database');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

async function seed() {
  try {
    console.log('🔄 Running database schema...');
    const schema = fs.readFileSync(path.join(__dirname, 'database', 'schema.sql'), 'utf8');
    await pool.query(schema);
    console.log('✅ Schema created');

    // Create admin user
    console.log('🔄 Creating admin user...');
    const adminHash = await bcrypt.hash('admin123', 12);
    const adminId = uuidv4();
    await pool.query(`
      INSERT INTO users (id, student_number, email, password_hash, first_name, last_name, role, is_verified, is_active)
      VALUES (?, 'ADMIN-001', 'admin@pupsj.edu.ph', ?, 'Super', 'Admin', 'admin', true, true)
      ON DUPLICATE KEY UPDATE id=id
    `, [adminId, adminHash]);

    // Create sample faculty
    const facultyHash = await bcrypt.hash('faculty123', 12);
    const facultyId = uuidv4();
    await pool.query(`
      INSERT INTO users (id, student_number, email, password_hash, first_name, last_name, role, department, is_verified, is_active)
      VALUES (?, 'FAC-001', 'faculty@pupsj.edu.ph', ?, 'Juan', 'Dela Cruz', 'faculty', 'BSIT', true, true)
      ON DUPLICATE KEY UPDATE id=id
    `, [facultyId, facultyHash]);

    // Create sample student
    const studentHash = await bcrypt.hash('student123', 12);
    const studentId = uuidv4();
    await pool.query(`
      INSERT INTO users (id, student_number, email, password_hash, first_name, last_name, role, department, is_verified, is_active)
      VALUES (?, '2024-00001-SJ-0', 'student@pupsj.edu.ph', ?, 'Maria', 'Santos', 'student', 'BSIT', true, true)
      ON DUPLICATE KEY UPDATE id=id
    `, [studentId, studentHash]);

    // Fetch actual user IDs (in case they already existed)
    const [adminUser] = await pool.query("SELECT id FROM users WHERE email = 'admin@pupsj.edu.ph'");
    const [facultyUser] = await pool.query("SELECT id FROM users WHERE email = 'faculty@pupsj.edu.ph'");
    const [studentUser] = await pool.query("SELECT id FROM users WHERE email = 'student@pupsj.edu.ph'");

    if (adminUser.length > 0) {
      const aId = adminUser[0].id;
      const fId = facultyUser[0]?.id || aId;
      const sId = studentUser[0]?.id || aId;

      await pool.query(`
        INSERT IGNORE INTO announcements (id, author_id, title, content, department, is_pinned)
        VALUES 
          (?, ?, 'Welcome to PUPSJ HUB!', 'We are excited to launch the PUPSJ HUB — your one-stop platform for campus announcements, events, lost & found, class schedules, and more. Stay tuned for updates!', 'General', true),
          (?, ?, 'Midterm Examination Schedule', 'The midterm examination for all BSIT students will be held from March 24-28. Please review your exam permits and schedules through the SIS portal. Good luck, Iskolar ng Bayan!', 'BSIT', false),
          (?, ?, 'Campus Wi-Fi Maintenance', 'The campus Wi-Fi network will undergo scheduled maintenance this Saturday from 8:00 AM to 12:00 PM. Please plan your online activities accordingly.', 'General', false)
      `, [uuidv4(), aId, uuidv4(), fId, uuidv4(), aId]);

      // Sample events
      const today = new Date();
      const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
      const nextMonth = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
      const inTwoWeeks = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);

      await pool.query(`
        INSERT IGNORE INTO events (id, author_id, title, description, location, event_date, start_time, end_time, department)
        VALUES 
          (?, ?, 'IT Week 2025', 'Annual Information Technology Week featuring tech talks, coding competitions, and exhibits.', 'PUP San Juan Gymnasium', ?, '08:00', '17:00', 'BSIT'),
          (?, ?, 'Campus Clean-Up Drive', 'Join the community service activity to keep our campus clean and green.', 'PUP San Juan Campus', ?, '07:00', '12:00', 'General'),
          (?, ?, 'Research Colloquium', 'Presentation of capstone projects from graduating BSIT students.', 'Room 301', ?, '09:00', '16:00', 'BSIT')
      `, [uuidv4(), aId, nextWeek.toISOString().split('T')[0], uuidv4(), aId, nextMonth.toISOString().split('T')[0], uuidv4(), fId, inTwoWeeks.toISOString().split('T')[0]]);

      await pool.query(`
        INSERT IGNORE INTO lost_found (id, reporter_id, type, item_name, description, category, location_found, contact_info)
        VALUES 
          (?, ?, 'lost', 'Blue Water Bottle', 'Stainless steel blue water bottle with PUP sticker. Lost near the canteen area during lunch.', 'Personal Items', 'Canteen Area', 'Contact via PUPSJ HUB'),
          (?, ?, 'found', 'Scientific Calculator', 'Casio fx-991ES found at Room 205 after the Math class. Claim at the guard house.', 'School Supplies', 'Room 205', 'Guard House - Main Gate')
      `, [uuidv4(), sId, uuidv4(), fId]);
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
