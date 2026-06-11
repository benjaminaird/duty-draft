const { pool, PG_MODE } = require('./db');

async function migrate() {
  if (!PG_MODE || !pool) {
    console.log('No DATABASE_URL set — running in file-storage mode. No SQL migration needed.');
    process.exit(0);
  }

  // App state: single-row JSON blob (unchanged).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Users: accounts that link to roster Marines.
  //   role ∈ 'pending' | 'marine' | 'sncoic' | 'master'
  //   marine_id is NULLABLE — pending users and the master admin have no roster Marine.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'pending',
      marine_id TEXT,
      rank TEXT,
      first_name TEXT,
      last_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Idempotent fixes for databases that ran the earlier strict schema
  // (marine_id was UNIQUE NOT NULL and the rank/name columns did not exist).
  await pool.query(`ALTER TABLE users ALTER COLUMN marine_id DROP NOT NULL`);
  await pool.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_marine_id_key`);
  await pool.query(`ALTER TABLE users ALTER COLUMN role SET DEFAULT 'pending'`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS rank TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT`);

  // Small key/value table (e.g. a persisted SESSION_SECRET if none is set in env).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  console.log('Migration complete.');
  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
