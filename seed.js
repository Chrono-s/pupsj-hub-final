const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function seed() {
  try {
    const dbName = process.env.DB_NAME || 'pupsj_hub';
    console.log(`🔄 Checking database '${dbName}'...`);
    const initConn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
    });
    await initConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await initConn.end();

    const pool = require('./src/config/database');
    console.log('🔄 Running database schema...');
    const schema = fs.readFileSync(path.join(__dirname, 'database', 'schema.sql'), 'utf8');
    await pool.query(schema);
    console.log('✅ Schema created');

    // Create admin user
    console.log('🔄 Creating admin users...');
    const adminHash = await bcrypt.hash('admin123', 12);
    const adminId = uuidv4();
    await pool.query(`
      INSERT INTO users (id, student_number, email, password_hash, first_name, last_name, role, is_verified, is_active)
      VALUES (?, 'ADMIN-001', 'admin@pupsj.edu.ph', ?, 'Admin', 'User', 'admin', true, true)
      ON DUPLICATE KEY UPDATE id=id
    `, [adminId, adminHash]);

    // Create superadmin user
    const superAdminId = uuidv4();
    await pool.query(`
      INSERT INTO users (id, student_number, email, password_hash, first_name, last_name, role, is_verified, is_active)
      VALUES (?, 'SUPERADMIN-001', 'superadmin@pupsj.edu.ph', ?, 'Super', 'Admin', 'superadmin', true, true)
      ON DUPLICATE KEY UPDATE id=id
    `, [superAdminId, adminHash]);

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

      // Sample matched lost & found reports
      const lostWatchId = uuidv4();
      const foundWatchId = uuidv4();
      const lostEarbudsId = uuidv4();
      const foundEarbudsId = uuidv4();
      const lostKeysId = uuidv4();
      const foundKeysId = uuidv4();
      const lostIdCardId = uuidv4();
      const foundIdCardId = uuidv4();
      const lostUmbrellaId = uuidv4();
      const foundUmbrellaId = uuidv4();

      await pool.query(`
        INSERT IGNORE INTO lost_found (id, reporter_id, type, item_name, description, category, location_found, contact_info, approved, status, match_review_status, match_score, date_lost_found)
        VALUES 
          (?, ?, 'lost', 'black smart watch', 'all black smart watch with rectangular dial', 'Personal Items', 'pup clinic', 'Contact via PUPSJ HUB', true, 'open', 'pending', 1.00, CURDATE() - INTERVAL 2 DAY),
          (?, ?, 'found', 'All black smart watch', 'with rectangular dial', 'Personal Items', 'pup grounds', 'OSAS Office', true, 'open', 'pending', 1.00, CURDATE() - INTERVAL 1 DAY),
          (?, ?, 'lost', 'White Wireless Earbuds', 'AirPods Pro 2 in white silicone case with yellow keychain', 'Electronics', 'Library 2nd Floor', 'Contact via PUPSJ HUB', true, 'open', 'pending', 0.85, CURDATE() - INTERVAL 3 DAY),
          (?, ?, 'found', 'White AirPods Earbuds', 'White earbuds found on study desk in library', 'Electronics', 'Library 2nd Floor', 'Library Desk', true, 'open', 'pending', 0.85, CURDATE() - INTERVAL 2 DAY),
          (?, ?, 'lost', 'Dorm Key Set', '3 keys with metallic blue carabiner and PUP lanyard', 'Personal Items', 'Gymnasium', 'Contact via PUPSJ HUB', true, 'matched', 'approved', 0.90, CURDATE() - INTERVAL 5 DAY),
          (?, ?, 'found', 'Set of Keys with Blue Carabiner', 'Keys found on bleachers in the gymnasium', 'Personal Items', 'Gymnasium', 'Guard Post', true, 'matched', 'approved', 0.90, CURDATE() - INTERVAL 4 DAY),
          (?, ?, 'lost', 'Student ID Card BSIT', 'PUP student ID with green lace', 'Documents', 'Canteen', 'Contact via PUPSJ HUB', true, 'matched', 'approved', 0.95, CURDATE() - INTERVAL 6 DAY),
          (?, ?, 'found', 'PUP Student ID Card', 'BSIT student ID found on canteen table', 'Documents', 'Canteen', 'Guard Post', true, 'matched', 'approved', 0.95, CURDATE() - INTERVAL 5 DAY),
          (?, ?, 'lost', 'Black Folding Umbrella', 'Automatic black umbrella with wooden handle', 'Personal Items', 'Room 302', 'Contact via PUPSJ HUB', true, 'open', 'rejected', 0.65, CURDATE() - INTERVAL 7 DAY),
          (?, ?, 'found', 'Black Compact Umbrella', 'Manual 3-fold umbrella with plastic handle', 'Personal Items', 'Room 304', 'Guard Post', true, 'open', 'rejected', 0.65, CURDATE() - INTERVAL 6 DAY)
      `, [
        lostWatchId, sId, foundWatchId, fId,
        lostEarbudsId, sId, foundEarbudsId, aId,
        lostKeysId, sId, foundKeysId, fId,
        lostIdCardId, sId, foundIdCardId, aId,
        lostUmbrellaId, sId, foundUmbrellaId, fId
      ]);

      await pool.query(`UPDATE lost_found SET matched_with = ? WHERE id = ?`, [foundWatchId, lostWatchId]);
      await pool.query(`UPDATE lost_found SET matched_with = ? WHERE id = ?`, [lostWatchId, foundWatchId]);
      await pool.query(`UPDATE lost_found SET matched_with = ? WHERE id = ?`, [foundEarbudsId, lostEarbudsId]);
      await pool.query(`UPDATE lost_found SET matched_with = ? WHERE id = ?`, [lostEarbudsId, foundEarbudsId]);
      await pool.query(`UPDATE lost_found SET matched_with = ? WHERE id = ?`, [foundKeysId, lostKeysId]);
      await pool.query(`UPDATE lost_found SET matched_with = ? WHERE id = ?`, [lostKeysId, foundKeysId]);
      await pool.query(`UPDATE lost_found SET matched_with = ? WHERE id = ?`, [foundIdCardId, lostIdCardId]);
      await pool.query(`UPDATE lost_found SET matched_with = ? WHERE id = ?`, [lostIdCardId, foundIdCardId]);
      await pool.query(`UPDATE lost_found SET matched_with = ? WHERE id = ?`, [foundUmbrellaId, lostUmbrellaId]);
      await pool.query(`UPDATE lost_found SET matched_with = ? WHERE id = ?`, [lostUmbrellaId, foundUmbrellaId]);
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
