// ─── AUTH CORE ────────────────────────────────────────────────────────────────
// Built entirely on Node's `crypto` (scrypt password hashing + HMAC bearer
// tokens) — no third-party auth dependency, nothing to compile on Render.
//
// AUTH BYPASS: when DUTYDRAFT_TEST_MODE=1 the middleware injects a synthetic
// master-admin user and every guard passes. This keeps the automated test
// drive and its unauthenticated API calls working unchanged. The bypass is the
// ONLY place auth is skipped; local file-storage dev (no DATABASE_URL) still
// runs the real login/role logic.
const crypto = require('crypto');

const TEST_MODE = process.env.DUTYDRAFT_TEST_MODE === '1';
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days — "stay logged in"

const ROLES = { PENDING: 'pending', MARINE: 'marine', SNCOIC: 'sncoic', MASTER: 'master' };
const ADMIN_ROLES = new Set([ROLES.SNCOIC, ROLES.MASTER]);

let SECRET = null;

// Resolve the token-signing secret once at startup: env var if provided,
// otherwise a persisted random secret (so tokens survive restarts).
async function initAuth(db) {
  if (process.env.SESSION_SECRET) {
    SECRET = process.env.SESSION_SECRET;
    return;
  }
  let stored = null;
  try { stored = await db.getMeta('session_secret'); } catch (e) { /* ignore */ }
  if (!stored) {
    stored = crypto.randomBytes(32).toString('hex');
    try { await db.setMeta('session_secret', stored); } catch (e) { /* ignore */ }
  }
  SECRET = stored;
  if (!process.env.SESSION_SECRET) {
    console.warn('SESSION_SECRET not set in env — using a persisted generated secret. Set SESSION_SECRET in production to control token signing across instances.');
  }
}

// ─── PASSWORDS ────────────────────────────────────────────────────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, saltHex, hashHex] = String(stored).split('$');
    if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(String(password), salt, expected.length);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch (e) {
    return false;
  }
}

// ─── TOKENS (stateless, HMAC-signed) ──────────────────────────────────────────
function signToken(user) {
  if (!SECRET) throw new Error('auth not initialized');
  const payload = {
    uid: user.id,
    role: user.role,
    mid: user.marineId || null,
    iat: Date.now(),
    exp: Date.now() + TOKEN_TTL_MS
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verifyToken(token) {
  if (!SECRET || !token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (e) { return null; }
  if (!payload || payload.uid == null) return null;
  if (payload.exp && Date.now() > payload.exp) return null;
  return payload;
}

// ─── MIDDLEWARE & GUARDS ──────────────────────────────────────────────────────
// Populates req.user from the bearer token (loading the live user record so
// role/link changes take effect without re-login). Never blocks — guards do.
function makeAuthMiddleware(db) {
  return async function authMiddleware(req, res, next) {
    if (TEST_MODE) {
      req.user = { id: 0, username: 'testmode', role: ROLES.MASTER, marineId: null, testMode: true };
      return next();
    }
    req.user = null;
    const hdr = req.headers['authorization'] || '';
    const m = hdr.match(/^Bearer\s+(.+)$/i);
    if (m) {
      const payload = verifyToken(m[1]);
      if (payload) {
        try {
          const u = await db.getUserById(payload.uid);
          if (u) {
            req.user = {
              id: u.id, username: u.username, role: u.role, marineId: u.marineId || null,
              rank: u.rank, firstName: u.firstName, lastName: u.lastName
            };
          }
        } catch (e) { /* leave req.user null */ }
      }
    }
    next();
  };
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.user.role === ROLES.PENDING) {
    return res.status(403).json({ error: 'Your account is waiting for admin assignment.', pending: true });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (!ADMIN_ROLES.has(req.user.role)) return res.status(403).json({ error: 'Admin access required' });
  next();
}

function requireMaster(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (req.user.role !== ROLES.MASTER) return res.status(403).json({ error: 'Master admin access required' });
  next();
}

function isAdmin(user) {
  return !!user && ADMIN_ROLES.has(user.role);
}

module.exports = {
  TEST_MODE,
  ROLES,
  ADMIN_ROLES,
  initAuth,
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  makeAuthMiddleware,
  requireAuth,
  requireAdmin,
  requireMaster,
  isAdmin
};
