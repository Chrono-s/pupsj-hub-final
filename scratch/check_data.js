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
    const fs = await pool.query("SELECT department, subject_name FROM faculty_schedules");
    const s = await pool.query("SELECT id, first_name, department FROM users WHERE first_name = 'JUAN'");
    
    console.log('--- Faculty Schedules ---');
    fs.rows.forEach(r => console.log(`Dept: [${r.department}], Subject: ${r.subject_name}`));
    
    console.log('\n--- Student Details ---');
    if (s.rows.length > 0) {
      console.log(`User ID: ${s.rows[0].id}`);
      console.log(`First Name: ${s.rows[0].first_name}`);
      console.log(`Dept: [${s.rows[0].department}]`);
    } else {
      console.log('No user named JUAN found.');
    }
    
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
run();
