const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const TEST_MODE = process.env.DUTYDRAFT_TEST_MODE === '1';
const TEST_DB_FILE = path.join(__dirname, 'test-drive-output', 'test-state.json');

let pool = null;

if (!TEST_MODE) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

async function getState() {
  if (TEST_MODE) {
    if (!fs.existsSync(TEST_DB_FILE)) return null;
    return JSON.parse(fs.readFileSync(TEST_DB_FILE, 'utf8'));
  }

  const res = await pool.query('SELECT data FROM app_state WHERE id = 1');
  if (res.rows.length === 0) return null;
  return res.rows[0].data;
}

async function saveState(state) {
  const toSave = { ...state, turnSecsRemaining: 0 };

  if (TEST_MODE) {
    fs.mkdirSync(path.dirname(TEST_DB_FILE), { recursive: true });
    fs.writeFileSync(TEST_DB_FILE, JSON.stringify(toSave, null, 2));
    return;
  }

  await pool.query(`
    INSERT INTO app_state (id, data) VALUES (1, $1)
    ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = NOW()
  `, [JSON.stringify(toSave)]);
}

module.exports = { pool, getState, saveState };
