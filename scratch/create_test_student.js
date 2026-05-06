const pool = require('../src/config/database');
const bcrypt = require('bcryptjs');

async function createStudent() {
  const hash = await bcrypt.hash('password123', 10);
  await pool.query(`INSERT INTO users (student_number, email, password_hash, first_name, last_name, role, is_verified, is_active)
                    VALUES ('TEST-001', 'test@pupsj.edu.ph', $1, 'Test', 'Student', 'student', true, true)
                    ON CONFLICT DO NOTHING`, [hash]);
  await pool.query(`INSERT INTO allowed_registrations (id_number, role, is_used) VALUES ('TEST-001', 'student', true) ON CONFLICT DO NOTHING`);
  console.log('Created test student');
  process.exit(0);
}
createStudent().catch(console.error);