#!/usr/bin/env node
// ─── DutyDraft V1 SEED ─────────────────────────────────────────────────────────
// Idempotent, safe initial setup for a real V1 rollout. Seeds:
//   1. The 29-Marine duty roster (seniority order)
//   2. The 9 funeral buglers
//   3. The Master Admin account (baird_master_admin)
//
// SAFETY
//   - The duty roster is written ONLY when the current roster is empty or is the
//     built-in demo (ghost) roster. A real, non-demo roster is never overwritten
//     unless you pass --force. (Re-seeding the identical V1 roster is allowed.)
//   - Funeral buglers are written only when none are set yet, or with --force.
//   - The master admin is created only if the username does not already exist;
//     an existing master's password is NEVER reset by this script.
//
// USAGE
//   node scripts/seed-v1.js                 # seed against the configured backend
//   node scripts/seed-v1.js --force         # also overwrite an existing roster
//   node scripts/seed-v1.js --password=XYZ  # set a different master password
//   node scripts/seed-v1.js --dry-run       # show what would change, write nothing
//
// BACKEND: chosen by db.js — Postgres when DATABASE_URL is set (production),
// otherwise local files in .localdata/. dotenv is loaded so DATABASE_URL from
// .env is honored; the script prints which backend (and host) it will write to.
require('dotenv').config();
const db = require('./../db');
const auth = require('./../auth');
const { getInitialState } = require('./../state-defaults');

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY = args.includes('--dry-run');
const pwArg = args.find(a => a.startsWith('--password='));
const MASTER_USERNAME = 'baird_master_admin';
const MASTER_PASSWORD = pwArg ? pwArg.split('=').slice(1).join('=') : 'SetUpDutyDraft';

// Seniority-ordered roster: [rank, lastName, firstName]
const V1_ROSTER = [
  ['GYSGT', 'Pena', 'Jason'],
  ['GYSGT', 'McCreary', 'Patrick'],
  ['GYSGT', 'Aird', 'Benjamin'],
  ['GYSGT', 'Steel', 'Caleb'],
  ['GYSGT', 'Walker', 'Christopher'],
  ['GYSGT', 'Menz', 'Kyle'],
  ['SSGT', 'Weiland', 'Timothy'],
  ['SSGT', 'Kotasenski', 'Megan'],
  ['SSGT', 'Jensen', 'Michael'],
  ['SSGT', 'Donaldson', 'Eric'],
  ['SSGT', 'Miller', 'Eric'],
  ['SSGT', 'Mueller', 'Logan'],
  ['SSGT', 'Bumgarner', 'Brian'],
  ['SSGT', 'Johnson', 'Brandon'],
  ['SGT', 'Gaskin', 'Brady'],
  ['SGT', 'Capone', 'Leonardo'],
  ['SGT', 'Hallam', 'Jason'],
  ['SGT', 'Rosie', 'Michael'],
  ['SGT', 'Campa', 'Daniel'],
  ['CPL', 'Ramos', 'Micah'],
  ['CPL', 'Mashler', 'Quinton'],
  ['CPL', 'Ezeta', 'Gabriel'],
  ['CPL', 'Cendan', 'Benjamin'],
  ['CPL', 'Osterhout', 'Justin'],
  ['LCPL', 'Arriaga', 'Darian'],
  ['LCPL', 'Collins', 'Andrew'],
  ['LCPL', 'Walter', 'Zach'],
  ['LCPL', 'Sakamoto', 'Tate'],
  ['LCPL', 'McBride', 'Blake']
];

// Funeral buglers (by last name) — all are on the duty roster.
const FUNERAL_LASTNAMES = ['Weiland', 'Kotasenski', 'Miller', 'Cendan', 'Mashler', 'Ramos', 'Walter', 'Sakamoto', 'McBride'];

// A few distinctive demo last names — presence means the roster is still the demo.
const DEMO_SIGNATURE = new Set(['SLIMER', 'BEETLEJUICE', 'BLACKBEARD', 'DANNY PHANTOM', 'CASPER THE FRIENDLY GHOST', 'ZERO', 'KING HAMLET']);

const clean = s => String(s || '').replace(/\s+/g, ' ').replace(/,/g, '').trim();

function buildMarines() {
  return V1_ROSTER.map((r, i) => ({ id: 'm' + (i + 1), rank: r[0], lastName: clean(r[1]), firstName: clean(r[2]), active: true }));
}

function buildFuneralMarines(marines) {
  const want = new Set(FUNERAL_LASTNAMES.map(n => n.toUpperCase()));
  return marines
    .filter(m => want.has(m.lastName.toUpperCase()))
    .map((m, i) => ({ id: 'f' + (i + 1), rank: m.rank, lastName: m.lastName, firstName: m.firstName || '' }));
}

function rosterLooksDemoOrEmpty(marines) {
  if (!marines || marines.length === 0) return true;
  return marines.some(m => DEMO_SIGNATURE.has(String(m.lastName || '').toUpperCase()));
}

function rosterIsAlreadyV1(marines, v1) {
  if (!marines || marines.length !== v1.length) return false;
  const cur = marines.map(m => `${m.rank}|${m.lastName.toUpperCase()}`).sort();
  const want = v1.map(m => `${m.rank}|${m.lastName.toUpperCase()}`).sort();
  return cur.every((x, i) => x === want[i]);
}

async function main() {
  const backend = db.PG_MODE ? 'Postgres (production DATABASE_URL)' : (db.TEST_MODE ? 'TEST file store' : 'local file store (.localdata)');
  console.log(`DutyDraft V1 seed`);
  console.log(`  backend: ${backend}`);
  if (db.PG_MODE) {
    try { console.log(`  host:    ${new URL(process.env.DATABASE_URL).host}`); } catch (e) { /* ignore */ }
  }
  if (DRY) console.log('  mode:    DRY RUN (no writes)');
  console.log('');

  const marines = buildMarines();
  const funeralMarines = buildFuneralMarines(marines);

  // ── State (roster + funeral buglers) ──
  let state = await db.getState();
  if (!state) {
    console.log('• No existing app_state — initializing a fresh state.');
    state = getInitialState();
  }

  const current = state.marines || [];
  const alreadyV1 = rosterIsAlreadyV1(current, marines);
  const safeToSeed = rosterLooksDemoOrEmpty(current) || alreadyV1 || FORCE;

  let rosterChanged = false;
  if (!safeToSeed) {
    console.log(`⚠ Current roster has ${current.length} non-demo Marines — NOT overwriting. Re-run with --force to replace it.`);
  } else if (alreadyV1 && !FORCE) {
    console.log('• Duty roster already matches the V1 roster — leaving Marine records as-is.');
  } else {
    state.marines = marines;
    rosterChanged = true;
    console.log(`• Seeding duty roster: ${marines.length} Marines (seniority order).`);
  }

  let funeralChanged = false;
  const curFuneral = state.funeralMarines || [];
  if (curFuneral.length === 0 || FORCE) {
    state.funeralMarines = funeralMarines;
    funeralChanged = (curFuneral.length === 0) || FORCE;
    if (funeralChanged) console.log(`• Seeding funeral buglers: ${funeralMarines.map(f => f.rank + ' ' + f.lastName).join(', ')}.`);
  } else {
    console.log(`• Funeral roster already has ${curFuneral.length} Marine(s) — leaving as-is.`);
  }

  if ((rosterChanged || funeralChanged) && !DRY) {
    await db.saveState(state);
    console.log('  → state saved.');
  }

  // ── Master admin account ──
  const existing = await db.getUserByUsername(MASTER_USERNAME);
  if (existing) {
    console.log(`• Master admin '${MASTER_USERNAME}' already exists (role=${existing.role}) — password NOT changed.`);
  } else if (DRY) {
    console.log(`• Would create master admin '${MASTER_USERNAME}'.`);
  } else {
    await db.createUser({
      username: MASTER_USERNAME,
      passwordHash: auth.hashPassword(MASTER_PASSWORD),
      role: 'master',
      marineId: null
    });
    console.log(`• Created master admin '${MASTER_USERNAME}' (password: ${pwArg ? '«from --password»' : MASTER_PASSWORD}).`);
  }

  console.log('');
  console.log('Done.');
  console.log('Next steps:');
  console.log(`  1. Log in as ${MASTER_USERNAME} and CHANGE THE PASSWORD immediately (Settings → Change Password).`);
  console.log('  2. Have SSgt Weiland sign up, then (as master) link his account to the Weiland roster Marine and assign him SNCOIC.');
  console.log('  3. To remove the master admin later: delete the row from the users table (or use the master-only delete in the Accounts panel for non-master accounts).');
  process.exit(0);
}

main().catch(err => { console.error('Seed failed:', err); process.exit(1); });
