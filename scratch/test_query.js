const pool = require('../src/config/database');

async function testQuery() {
  const searchDept = 'BSENTREP';
  const query = `
    SELECT * FROM (
      SELECT 
        cs.id, cs.subject_code, cs.subject_name, cs.day_of_week,
        cs.start_time, cs.end_time, cs.room,
        cs.instructor,
        cs.department, cs.section, cs.year_level, cs.created_at,
        u.first_name || ' ' || u.last_name AS faculty_name,
        cs.faculty_user_id,
        FALSE AS from_faculty_schedule
      FROM class_schedules cs
      LEFT JOIN users u ON cs.faculty_user_id = u.id
      WHERE cs.department IS NOT NULL

      UNION ALL

      SELECT 
        fs.id, fs.subject_code, fs.subject_name, fs.day_of_week,
        fs.start_time, fs.end_time, fs.room,
        f.first_name || ' ' || f.last_name AS instructor,
        fs.department, fs.section, fs.year_level, fs.created_at,
        f.first_name || ' ' || f.last_name AS faculty_name,
        fs.faculty_id AS faculty_user_id,
        TRUE AS from_faculty_schedule
      FROM faculty_schedules fs
      LEFT JOIN users f ON fs.faculty_id = f.id
      WHERE fs.department IS NOT NULL
    ) AS all_schedules
    WHERE LOWER(TRIM(department)) = LOWER(TRIM($1))
       OR LOWER(TRIM(department)) = 'general'
  `;
  try {
    const res = await pool.query(query, [searchDept]);
    console.log('Results for BSENTREP:', res.rows.length);
    console.log(JSON.stringify(res.rows, null, 2));
  } finally {
    await pool.end();
  }
}

testQuery();
