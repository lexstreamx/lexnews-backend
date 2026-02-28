require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./pool');

async function migrate() {
  const schema = fs.readFileSync(
    path.join(__dirname, 'schema.sql'),
    'utf-8'
  );

  const INCREMENTAL_MIGRATIONS = [
    {
      name: 'add_image_url_to_articles',
      sql: 'ALTER TABLE articles ADD COLUMN IF NOT EXISTS image_url TEXT;',
    },
  ];

  try {
    await pool.query(schema);
    console.log('Schema migration completed successfully.');

    for (const migration of INCREMENTAL_MIGRATIONS) {
      try {
        await pool.query(migration.sql);
        console.log(`Migration "${migration.name}" applied.`);
      } catch (err) {
        if (err.code !== '42701') throw err;
        console.log(`Migration "${migration.name}" already applied, skipping.`);
      }
    }

    console.log('All migrations completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
