require('dotenv').config();
const pool = require('./src/config/database');

async function run() {
  await pool.query(`CREATE TABLE IF NOT EXISTS section_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    posted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    department VARCHAR(100) NOT NULL,
    year_level VARCHAR(20) NOT NULL,
    section VARCHAR(50) NOT NULL,
    schedule_url VARCHAR(500),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`);
  console.log('section_schedules table ready');

  await pool.query('ALTER TABLE announcements ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN DEFAULT FALSE');
  console.log('announcements.is_anonymous column ready');

  await pool.end();
}
run().catch(e => { console.error(e.message); process.exit(1); });
