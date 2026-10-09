const pool = require('../src/config/database');

async function runMigration() {
  const client = await pool.getConnection();
  try {
    console.log('🔄 Starting database migration for system settings...');
    await client.beginTransaction();

    // 1. Create system_settings table
    console.log('🔄 Creating system_settings table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        \`key\` VARCHAR(255) PRIMARY KEY,
        \`value\` TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 2. Seed default values
    console.log('🔄 Seeding default system settings...');
    const defaultSettings = [
      ['landing_hero_image', '/landing_hero.png'],
      ['system_logo_url', '/icons/pup_logo.png'],
      ['system_brand_name', 'PUPSJ HUB'],
      ['system_subtitle', 'San Juan Campus'],
      ['landing_hero_title', 'PUPSJ HUB <br><span>San Juan Campus Hub</span>'],
      ['landing_hero_text', 'Welcome to the complete campus progressive web application. Access class schedules, stay updated with campus announcements, report or find lost items, download academic forms & templates, and interact with our smart AI companion, PUPBot.']
    ];

    for (const [key, val] of defaultSettings) {
      await client.query(`
        INSERT IGNORE INTO system_settings (\`key\`, \`value\`)
        VALUES (?, ?)
      `, [key, val]);
    }

    await client.commit();
    console.log('✅ Database migration completed successfully.');
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
