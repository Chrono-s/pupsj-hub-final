const { Pool } = require('pg');
const pool = new Pool({
  host: 'localhost',
  user: 'postgres',
  password: '1234567',
  database: 'pupsj_hub',
  port: 5432
});

async function run() {
  try {
    const users = await pool.query("SELECT id, role, department FROM users ORDER BY created_at DESC LIMIT 5");
    console.log('--- Latest Users ---');
    users.rows.forEach(u => console.log(`ID: ${u.id}, Role: ${u.role}, Dept: ${u.department}`));
    
    const scheds = await pool.query("SELECT id, department, subject_name FROM faculty_schedules LIMIT 5");
    console.log('\n--- Faculty Schedules ---');
    scheds.rows.forEach(s => console.log(`ID: ${s.id}, Dept: ${s.department}, Subj: ${s.subject_name}`));
    
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
run();
