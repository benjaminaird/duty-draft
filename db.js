const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function getState() {
  const res = await pool.query('SELECT data FROM app_state WHERE id = 1');
  if (res.rows.length === 0) return null;
  return res.rows[0].data;
}

async function saveState(state) {
  // Remove live timer value — it's always recomputed, never stored
  const toSave = { ...state, turnSecsRemaining: 0 };
  await pool.query(`
    INSERT INTO app_state (id, data) VALUES (1, $1)
    ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = NOW()
  `, [JSON.stringify(toSave)]);
}

module.exports = { pool, getState, saveState };