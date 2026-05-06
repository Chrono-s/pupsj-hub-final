const pool = require('../src/config/database');

async function testAsJim() {
  const jimId = 'f6caf1e0-d6c5-4ee5-91e0-4b0c3116063c';
  try {
    const userRes = await pool.query('SELECT department, year_level, section FROM users WHERE id = $1', [jimId]);
    const { department: dbDept, year_level: dbYear, section: dbSection } = userRes.rows[0] || {};
    const searchDept = (dbDept || '').trim();
    const searchYear = (dbYear || '').trim();
    const searchSection = (dbSection || '').trim();

    console.log(`Jim Profile: Dept="${searchDept}", Year="${searchYear}", Section="${searchSection}"`);

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
          WHERE (LOWER(TRIM(department)) = LOWER(TRIM($1)) OR LOWER(TRIM(department)) = 'general')
            AND (
              ($2 = '' OR LOWER(TRIM(year_level)) = LOWER(TRIM($2)) OR year_level IS NULL OR year_level = 'General')
              AND
              ($3 = '' OR LOWER(TRIM(section)) = LOWER(TRIM($3)) OR section IS NULL OR section = '' OR section = 'General')
            )
    `;
    const res = await pool.query(query, [searchDept, searchYear, searchSection]);
    console.log(`Found ${res.rows.length} rows for Jim`);
    res.rows.forEach(r => console.log(`- ${r.subject_name} (${r.day_of_week} ${r.start_time})` ));
  } finally {
    await pool.end();
  }
}

testAsJim();
