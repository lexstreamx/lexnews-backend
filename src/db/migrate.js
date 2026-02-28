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
    {
      name: 'create_users_table',
      sql: `
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          learnworlds_user_id TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE NOT NULL,
          username TEXT,
          display_name TEXT,
          avatar_url TEXT,
          learnworlds_tags TEXT[] DEFAULT '{}',
          category_slugs TEXT[] DEFAULT '{}',
          lw_access_token TEXT,
          lw_refresh_token TEXT,
          lw_token_expires_at TIMESTAMPTZ,
          last_login_at TIMESTAMPTZ DEFAULT NOW(),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        CREATE INDEX IF NOT EXISTS idx_users_lw_id ON users(learnworlds_user_id);
      `,
    },
    {
      name: 'add_user_id_to_saved_read_articles',
      sql: `
        TRUNCATE saved_articles, read_articles;
        ALTER TABLE saved_articles ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
        ALTER TABLE saved_articles DROP CONSTRAINT IF EXISTS saved_articles_article_id_key;
        ALTER TABLE saved_articles ADD CONSTRAINT saved_articles_user_article_unique UNIQUE(user_id, article_id);
        CREATE INDEX IF NOT EXISTS idx_saved_articles_user ON saved_articles(user_id);

        ALTER TABLE read_articles ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
        ALTER TABLE read_articles DROP CONSTRAINT IF EXISTS read_articles_article_id_key;
        ALTER TABLE read_articles ADD CONSTRAINT read_articles_user_article_unique UNIQUE(user_id, article_id);
        CREATE INDEX IF NOT EXISTS idx_read_articles_user ON read_articles(user_id);
      `,
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
