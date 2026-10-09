const pool = require('../src/config/database');

async function runMigration() {
  const client = await pool.getConnection();
  try {
    console.log('🔄 Checking database schema for guest accounts and lost_found...');
    await client.beginTransaction();

    // Ensure role column on users allows guest
    await client.query("ALTER TABLE users MODIFY COLUMN role ENUM('student', 'faculty', 'admin', 'superadmin', 'guest') NOT NULL DEFAULT 'student'").catch(() => {});

    // Ensure approved column exists on lost_found
    await client.query('ALTER TABLE lost_found ADD COLUMN approved BOOLEAN DEFAULT TRUE').catch(() => {});

    await client.commit();
    console.log('✅ Migration check completed successfully.');
  } catch (err) {
    try {
      await client.rollback();
    } catch (_) {}
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
