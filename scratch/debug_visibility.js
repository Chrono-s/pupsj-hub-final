const pool = require('../src/config/database');

async function check() {
  try {
    const res = await pool.query('SELECT title, department, status FROM announcements');
    console.log('Announcements:', JSON.stringify(res.rows, null, 2));
    const users = await pool.query("SELECT first_name, last_name, role, department FROM users WHERE role = 'student'");
    console.log('Students:', JSON.stringify(users.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

check();
