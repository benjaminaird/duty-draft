const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── IN-MEMORY STATE ────────────────────────────────────────────────────────
// Production: replace with PostgreSQL queries
let appState = getInitialState();

function getInitialState() {
  return {
    phase: 'setup',
    year: getTargetYear(),
    month: getTargetMonth(),
    marines: getDefaultMarines(),
    history: {
      weekendBurden: { junior: [], ssgt: [], gysgt: [] },
      extraDuty: [],
      dutyHistory: { junior: [], ssgt: [], gysgt: [] },
      lastDutyDay: {}
    },
    turnMins: 3,
    blackouts: [],
    extraWk: [],
    workdays: [],
    preAssigned: {},
    preAssignReasons: {},
    weekendDates: [],
    wkAssigneeIds: [],
    wkAssignees: { junior: [], ssgt: [], gysgt: [] },
    doubleDuty: {},
    shortMonth: false,
    shortRoster: null,
    prefs: {},
    nonAvail: {},
    assignments: {},
    draftOrder: [],
    draftIdx: 0,
    draftLive: false,
    draftDone: false,
    draftScheduled: null,
    voluntaryWkTakers: [],
    freedMarines: [],
    notifications: [
      {
        id: 1,
        title: 'DUTYDRAFT READY',
        body: 'Roster loaded. Duty NCOIC: begin setup for next month.',
        icon: '🛡',
        unread: true,
        targetMid: null,
        ts: Date.now()
      }
    ]
  };
}

function getTargetMonth() {
  const m = new Date().getMonth();
  return m === 11 ? 0 : m + 1;
}

function getTargetYear() {
  const now = new Date();
  return now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
}

function getDefaultMarines() {
  return [
    { id: 'm1',  rank: 'GYSGT', lastName: 'HARGROVE',   firstName: '', active: true },
    { id: 'm2',  rank: 'GYSGT', lastName: 'DELACROIX',  firstName: '', active: true },
    { id: 'm3',  rank: 'GYSGT', lastName: 'OKONKWO',    firstName: '', active: true },
    { id: 'm4',  rank: 'GYSGT', lastName: 'PIETERSEN',  firstName: '', active: true },
    { id: 'm5',  rank: 'GYSGT', lastName: 'YAMAMOTO',   firstName: '', active: true },
    { id: 'm6',  rank: 'SSGT',  lastName: 'CALDWELL',   firstName: '', active: true },
    { id: 'm7',  rank: 'SSGT',  lastName: 'REINHOLT',   firstName: '', active: true },
    { id: 'm8',  rank: 'SSGT',  lastName: 'MBEKI',      firstName: '', active: true },
    { id: 'm9',  rank: 'SSGT',  lastName: 'TORRIJOS',   firstName: '', active: true },
    { id: 'm10', rank: 'SSGT',  lastName: 'NAKAMURA',   firstName: '', active: true },
    { id: 'm11', rank: 'SSGT',  lastName: 'BERGSTROM',  firstName: '', active: true },
    { id: 'm12', rank: 'SSGT',  lastName: 'ODUYA',      firstName: '', active: true },
    { id: 'm13', rank: 'SSGT',  lastName: 'FINNERAN',   firstName: '', active: true },
    { id: 'm14', rank: 'SSGT',  lastName: 'VASQUEZ',    firstName: '', active: true },
    { id: 'm15', rank: 'SGT',   lastName: 'DRUMMOND',   firstName: '', active: true },
    { id: 'm16', rank: 'SGT',   lastName: 'KOWALSKI',   firstName: '', active: true },
    { id: 'm17', rank: 'SGT',   lastName: 'IBRAHIM',    firstName: '', active: true },
    { id: 'm18', rank: 'SGT',   lastName: 'PELLEGRINO', firstName: '', active: true },
    { id: 'm19', rank: 'SGT',   lastName: 'ASHFORD',    firstName: '', active: true },
    { id: 'm20', rank: 'CPL',   lastName: 'TRAN',       firstName: '', active: true },
    { id: 'm21', rank: 'CPL',   lastName: 'MWANGI',     firstName: '', active: true },
    { id: 'm22', rank: 'CPL',   lastName: 'ESPOSITO',   firstName: '', active: true },
    { id: 'm23', rank: 'CPL',   lastName: 'HOFFMANN',   firstName: '', active: true },
    { id: 'm24', rank: 'CPL',   lastName: 'OSEI',       firstName: '', active: true },
    { id: 'm25', rank: 'LCPL',  lastName: 'DEVEREAUX',  firstName: '', active: true },
    { id: 'm26', rank: 'LCPL',  lastName: 'SANTOS',     firstName: '', active: true },
    { id: 'm27', rank: 'LCPL',  lastName: 'NKRUMAH',    firstName: '', active: true },
    { id: 'm28', rank: 'LCPL',  lastName: 'PRZYBYLA',   firstName: '', active: true },
    { id: 'm29', rank: 'LCPL',  lastName: 'QUINTERO',   firstName: '', active: true }
  ];
}

// ─── API ROUTES ──────────────────────────────────────────────────────────────

// Get full state
app.get('/api/state', (req, res) => {
  res.json(appState);
});

// Replace full state (used for most SNCOIC actions)
app.post('/api/state', (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Invalid state' });
  }
  appState = { ...appState, ...req.body };
  res.json({ ok: true });
});

// Add a notification
app.post('/api/notif', (req, res) => {
  const { title, body, icon, targetMid } = req.body;
  const notif = {
    id: Date.now(),
    title,
    body,
    icon: icon || '🔔',
    unread: true,
    targetMid: targetMid || null,
    ts: Date.now()
  };
  appState.notifications = [notif, ...appState.notifications].slice(0, 200);
  res.json({ ok: true, notif });
});

// Mark notifications read
app.post('/api/notif/read', (req, res) => {
  const { mid } = req.body;
  appState.notifications = appState.notifications.map(n => {
    if (mid === 'all' || !n.targetMid || n.targetMid === mid) {
      return { ...n, unread: false };
    }
    return n;
  });
  res.json({ ok: true });
});

// Reset to initial state
app.post('/api/reset', (req, res) => {
  appState = getInitialState();
  res.json({ ok: true });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, phase: appState.phase, ts: Date.now() });
});

// Serve frontend for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`DutyDraft running on port ${PORT}`);
});
