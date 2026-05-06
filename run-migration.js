const pool = require('./src/config/database');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  try {
    console.log('🔄 Running migration: Add match columns to lost_found table...');
    const migration = fs.readFileSync(path.join(__dirname, 'database', 'migration-add-match-columns.sql'), 'utf8');
    await pool.query(migration);
    console.log('✅ Migration completed successfully');
  } catch (error) {
    console.error('❌ Migration failed:', error);
  } finally {
    await pool.end();
  }
}

runMigration();