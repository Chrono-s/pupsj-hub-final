const pool = require('../src/config/database');

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('🔄 Starting database migration for guest accounts...');
    await client.query('BEGIN');

    // 1. Drop existing role constraint on users table
    console.log('🔄 Dropping users_role_check constraint...');
    await client.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check');

    // 2. Add new role constraint on users table to allow 'guest' role
    console.log('🔄 Adding updated users_role_check constraint...');
    await client.query("ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('student', 'faculty', 'admin', 'guest'))");

    // 3. Add approved column to lost_found table
    console.log('🔄 Adding approved column to lost_found table...');
    await client.query('ALTER TABLE lost_found ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT TRUE');

    await client.query('COMMIT');
    console.log('✅ Database migration completed successfully.');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
