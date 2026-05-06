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
    const studentRes = await pool.query("SELECT id, department, role FROM users WHERE first_name = 'JUAN'");
    const juan = studentRes.rows[0];
    if (!juan) { console.log('Juan not found'); process.exit(1); }
    
    console.log(`Testing for User: ${juan.first_name} (${juan.id}), Role: ${juan.role}, Dept: ${juan.department}`);

    // MOCK THE LOGIC of schedules.js
    const userRes = await pool.query('SELECT department FROM users WHERE id = $1', [juan.id]);
    const searchDept = (userRes.rows[0]?.department || '').trim();
    
    const query = `
          SELECT * FROM (
            SELECT 
              cs.id, cs.subject_code, cs.subject_name, cs.day_of_week,
              cs.start_time, cs.end_time, cs.room,
              cs.department, cs.section, cs.year_level
            FROM class_schedules cs
            WHERE cs.department IS NOT NULL

            UNION ALL

            SELECT 
              fs.id, fs.subject_code, fs.subject_name, fs.day_of_week,
              fs.start_time, fs.end_time, fs.room,
              fs.department, fs.section, fs.year_level
            FROM faculty_schedules fs
            WHERE fs.department IS NOT NULL
          ) AS all_schedules
          -- WHERE LOWER(TRIM(department)) = LOWER(TRIM($1))
          --   OR LOWER(TRIM(department)) = 'general'
    `;

    const result = await pool.query(query);
    console.log(`Found ${result.rows.length} rows total (UNFILTERED).`);
    
    const filteredQuery = query.replace('-- ', '').replace('-- ', ''); // Un-comment the WHERE
    const filteredResult = await pool.query(`
        SELECT * FROM (
            SELECT 1 as dummy, cs.department FROM class_schedules cs UNION ALL SELECT 1, fs.department FROM faculty_schedules fs
        ) t WHERE LOWER(TRIM(department)) = LOWER(TRIM($1)) OR LOWER(TRIM(department)) = 'general'
    `, [searchDept]);

    console.log(`Found ${filteredResult.rows.length} rows (FILTERED for ${searchDept}).`);

    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
run();
