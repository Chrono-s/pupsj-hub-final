const pool = require('../src/config/database');

async function check() {
  try {
    const fs = await pool.query('SELECT subject_name, department, year_level, section FROM faculty_schedules');
    console.log('Faculty Schedules:', JSON.stringify(fs.rows, null, 2));
    const cs = await pool.query('SELECT subject_name, department, year_level, section FROM class_schedules');
    console.log('Class Schedules:', JSON.stringify(cs.rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

check();
