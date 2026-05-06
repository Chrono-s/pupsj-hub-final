const pool = require('../src/config/database');

async function checkUser() {
  try {
    const res = await pool.query("SELECT id, role, department, year_level, section FROM users WHERE first_name = 'JIM'");
    console.log('User Jim:', JSON.stringify(res.rows, null, 2));
  } finally {
    await pool.end();
  }
}

checkUser();
