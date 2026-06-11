const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// ─── BACKEND SELECTION ────────────────────────────────────────────────────────
// Three storage modes, chosen at load time:
//   TEST_MODE  (DUTYDRAFT_TEST_MODE=1)   -> JSON files in test-drive-output/  (automated test drive; auth also bypassed)
//   LOCAL      (no DATABASE_URL set)     -> JSON files in .localdata/         (local dev / manual verification; auth ENABLED)
//   PG         (DATABASE_URL set)        -> Postgres                          (production on Render)
//
// IMPORTANT: file vs Postgres is a storage choice only. Auth bypass is a SEPARATE
// flag (DUTYDRAFT_TEST_MODE) handled in auth.js, so local file-mode dev still
// exercises the real login/role logic.
const TEST_MODE = process.env.DUTYDRAFT_TEST_MODE === '1';
const PG_MODE = !TEST_MODE && !!process.env.DATABASE_URL;

const DATA_DIR = TEST_MODE
  ? path.join(__dirname, 'test-drive-output')
  : path.join(__dirname, '.localdata');

const STATE_FILE = path.join(DATA_DIR, TEST_MODE ? 'test-state.json' : 'state.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const META_FILE = path.join(DATA_DIR, 'meta.json');

let pool = null;
if (PG_MODE) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

// ─── FILE HELPERS ─────────────────────────────────────────────────────────────
function readJsonFile(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`Failed to read ${path.basename(file)}:`, err.message);
    return fallback;
  }
}

function writeJsonFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ─── APP STATE ────────────────────────────────────────────────────────────────
async function getState() {
  if (!PG_MODE) {
    return readJsonFile(STATE_FILE, null);
  }
  const res = await pool.query('SELECT data FROM app_state WHERE id = 1');
  if (res.rows.length === 0) return null;
  return res.rows[0].data;
}

async function saveState(state) {
  const toSave = { ...state, turnSecsRemaining: 0 };
  if (!PG_MODE) {
    writeJsonFile(STATE_FILE, toSave);
    return;
  }
  await pool.query(`
    INSERT INTO app_state (id, data) VALUES (1, $1)
    ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = NOW()
  `, [JSON.stringify(toSave)]);
}

// ─── USERS ────────────────────────────────────────────────────────────────────
// User shape: { id, username, passwordHash, role, marineId, rank, firstName, lastName, createdAt }
//   role ∈ 'pending' | 'marine' | 'sncoic' | 'master'
//   marineId links to a roster Marine in app_state (null for pending / master).

function rowToUser(r) {
  if (!r) return null;
  return {
    id: r.id,
    username: r.username,
    passwordHash: r.password_hash,
    role: r.role,
    marineId: r.marine_id || null,
    rank: r.rank || null,
    firstName: r.first_name || null,
    lastName: r.last_name || null,
    createdAt: r.created_at || null
  };
}

async function getUsers() {
  if (!PG_MODE) {
    return readJsonFile(USERS_FILE, []);
  }
  const res = await pool.query('SELECT * FROM users ORDER BY id ASC');
  return res.rows.map(rowToUser);
}

async function getUserByUsername(username) {
  if (!username) return null;
  const uname = String(username).trim().toLowerCase();
  if (!PG_MODE) {
    const users = readJsonFile(USERS_FILE, []);
    return users.find(u => u.username.toLowerCase() === uname) || null;
  }
  const res = await pool.query('SELECT * FROM users WHERE LOWER(username) = $1', [uname]);
  return rowToUser(res.rows[0]);
}

async function getUserById(id) {
  if (id == null) return null;
  if (!PG_MODE) {
    const users = readJsonFile(USERS_FILE, []);
    return users.find(u => String(u.id) === String(id)) || null;
  }
  const res = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rowToUser(res.rows[0]);
}

async function getUserByMarineId(marineId) {
  if (!marineId) return null;
  if (!PG_MODE) {
    const users = readJsonFile(USERS_FILE, []);
    return users.find(u => u.marineId === marineId) || null;
  }
  const res = await pool.query('SELECT * FROM users WHERE marine_id = $1', [marineId]);
  return rowToUser(res.rows[0]);
}

async function createUser({ username, passwordHash, role = 'pending', marineId = null, rank = null, firstName = null, lastName = null }) {
  if (!PG_MODE) {
    const users = readJsonFile(USERS_FILE, []);
    const id = users.reduce((max, u) => Math.max(max, Number(u.id) || 0), 0) + 1;
    const user = { id, username, passwordHash, role, marineId, rank, firstName, lastName, createdAt: new Date().toISOString() };
    users.push(user);
    writeJsonFile(USERS_FILE, users);
    return user;
  }
  const res = await pool.query(
    `INSERT INTO users (username, password_hash, role, marine_id, rank, first_name, last_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [username, passwordHash, role, marineId, rank, firstName, lastName]
  );
  return rowToUser(res.rows[0]);
}

async function updateUser(id, patch) {
  if (!PG_MODE) {
    const users = readJsonFile(USERS_FILE, []);
    const idx = users.findIndex(u => String(u.id) === String(id));
    if (idx === -1) return null;
    users[idx] = { ...users[idx], ...patch };
    writeJsonFile(USERS_FILE, users);
    return users[idx];
  }
  const colMap = {
    username: 'username', passwordHash: 'password_hash', role: 'role',
    marineId: 'marine_id', rank: 'rank', firstName: 'first_name', lastName: 'last_name'
  };
  const sets = [];
  const vals = [];
  let i = 1;
  for (const [key, col] of Object.entries(colMap)) {
    if (patch[key] !== undefined) { sets.push(`${col} = $${i++}`); vals.push(patch[key]); }
  }
  if (!sets.length) return getUserById(id);
  vals.push(id);
  const res = await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals);
  return rowToUser(res.rows[0]);
}

async function deleteUser(id) {
  if (!PG_MODE) {
    const users = readJsonFile(USERS_FILE, []);
    const next = users.filter(u => String(u.id) !== String(id));
    writeJsonFile(USERS_FILE, next);
    return;
  }
  await pool.query('DELETE FROM users WHERE id = $1', [id]);
}

// ─── META (key/value, used for a persisted SESSION_SECRET in file mode) ────────
async function getMeta(key) {
  if (!PG_MODE) {
    const meta = readJsonFile(META_FILE, {});
    return meta[key] ?? null;
  }
  const res = await pool.query('SELECT value FROM app_meta WHERE key = $1', [key]);
  return res.rows.length ? res.rows[0].value : null;
}

async function setMeta(key, value) {
  if (!PG_MODE) {
    const meta = readJsonFile(META_FILE, {});
    meta[key] = value;
    writeJsonFile(META_FILE, meta);
    return;
  }
  await pool.query(
    `INSERT INTO app_meta (key, value) VALUES ($1,$2)
     ON CONFLICT (key) DO UPDATE SET value = $2`,
    [key, value]
  );
}

module.exports = {
  pool,
  PG_MODE,
  TEST_MODE,
  getState,
  saveState,
  getUsers,
  getUserByUsername,
  getUserById,
  getUserByMarineId,
  createUser,
  updateUser,
  deleteUser,
  getMeta,
  setMeta
};
