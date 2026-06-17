#!/usr/bin/env node
// ============================================================================
// DutyDraft — Day-level Draft Simulation (COA 1 / 2 / 3)
// ============================================================================
// Runs the ACTUAL draft, day by day, the way the live app does: it drives the
// real draft-order engine (draft-order-engine.js) for the chosen COA, equalizes
// weekends with the real computeWeekendAssignees, rotates double duty to the most
// junior, then has every Marine AUTO-PICK their best available day using pick
// logic replicated faithfully from server.js (isDateValid / currentNeedsWk /
// doAutoPick / autoFreeBlockedMarines). Marines submit preferred dates, so a
// Marine gets a "best day" when they land a preferred date — early pickers win
// their picks, late pickers get leftovers.
//
// 5-year horizon with realistic turnover (2-3 depart/yr, promotion cascade, new
// PFC accession; roster held at 29-30), 200 trials per COA. Measures:
//   • where Marines land in the draft order vs. their seniority,
//   • preferred-date success (#1 / top-3 / any) by draft position,
//   • weekend distribution and double-duty distribution (must stay EQUAL — these
//     are slated/rotated outside the draft), with discrepancy flags,
//   • hard-rule invariants (no back-to-back, no unfilled days, weekend
//     obligations honored).
//
//   node scripts/draft-day-sim.js [--trials=200] [--years=5]
// ============================================================================
const engine = require('../draft-order-engine');

const RANKS = ['GYSGT', 'SSGT', 'SGT', 'CPL', 'LCPL', 'PFC'];
const START_DIST = { GYSGT: 6, SSGT: 8, SGT: 5, CPL: 5, LCPL: 5 };

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pad2 = (n) => String(n).padStart(2, '0');
const getDIM = (y, m) => new Date(y, m + 1, 0).getDate();
const isNatWk = (y, m, d) => { const w = new Date(y, m, d).getDay(); return w === 0 || w === 6; };
const isConsec = (d, list) => list.some((a) => Math.abs(d - a) === 1);
function shuffle(rnd, arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const pickN = (rnd, arr, k) => shuffle(rnd, arr).slice(0, k);
function stat(xs) { if (!xs.length) return { mean: 0, sd: 0, cv: 0, spread: 0 }; const n = xs.length, mean = xs.reduce((a, b) => a + b, 0) / n; const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n); return { mean, sd, cv: mean ? sd / mean : 0, spread: Math.max(...xs) - Math.min(...xs), min: Math.min(...xs), max: Math.max(...xs) }; }
function pearson(xs, ys) { const n = xs.length; if (!n) return 0; const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n; let num = 0, dx = 0, dy = 0; for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; } return (dx && dy) ? num / Math.sqrt(dx * dy) : 0; }

// ── Pick logic faithfully replicated from server.js (state-scoped) ───────────
const dk = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
function isWkDate(d, s) { const k = dk(s.year, s.month, d); if ((s.workdays || []).includes(k)) return false; return isNatWk(s.year, s.month, d) || (s.extraWk || []).includes(k); }
function getAllDates(s) { const total = getDIM(s.year, s.month); return Array.from({ length: total }, (_, i) => i + 1).filter((d) => !(s.blackouts || []).includes(dk(s.year, s.month, d))); }
function isDateValid(mid, d, asgn, s, needsWk) {
  const k = dk(s.year, s.month, d);
  if ((s.blackouts || []).includes(k)) return false;
  const pa = s.preAssigned || {}; if (pa[d] && pa[d] !== mid) return false;
  const approvedNA = new Set(((s.nonAvail || {})[mid] || []).filter((n) => n.approved === true).map((n) => n.date));
  if (approvedNA.has(k)) return false;
  if (asgn[d] && asgn[d] !== mid) return false;
  if (asgn[d] === mid) return false;
  const myDays = Object.entries(asgn).filter(([, x]) => x === mid).map(([dd]) => Number(dd));
  if (isConsec(d, myDays)) return false;
  if (needsWk && !isWkDate(d, s)) return false;
  return true;
}
function currentNeedsWk(mid, turn, asgn, s) {
  const isDD = !!(s.doubleDuty || {})[mid];
  const isWkSlotted = (s.wkAssigneeIds || []).includes(mid);
  const isFreed = (s.freedMarines || []).includes(mid);
  if (!isWkSlotted || isFreed) return false;
  const myDays = Object.entries(asgn || {}).filter(([, x]) => x === mid).map(([d]) => Number(d));
  if (myDays.some((d) => isWkDate(d, s))) return false;
  return isDD ? turn === 1 : true;
}
function doAutoPick(mid, s, asgn, turn) {
  const allDates = getAllDates(s);
  const needsWk = currentNeedsWk(mid, turn, asgn, s);
  const valid = allDates.filter((d) => isDateValid(mid, d, asgn, s, needsWk));
  if (!valid.length) return null;
  const myPrefs = ((s.prefs || {})[mid] || []).map((p) => p.day);
  const isWkSlotted = (s.wkAssigneeIds || []).includes(mid);
  const pool = isWkSlotted ? valid : valid.slice().sort((a, b) => { const aw = isWkDate(a, s), bw = isWkDate(b, s); return aw && !bw ? 1 : !aw && bw ? -1 : 0; });
  for (const p of myPrefs) { if (pool.includes(p)) return p; }
  return pool[0];
}
function autoFreeBlockedMarines(asgn, s, currentIdx) {
  const order = s.draftOrder || [];
  const newFreed = [...(s.freedMarines || [])];
  const availableWk = getAllDates(s).filter((d) => isWkDate(d, s) && !asgn[d]);
  for (let i = currentIdx; i < order.length; i++) {
    const mid = order[i].id;
    if (!(s.wkAssigneeIds || []).includes(mid) || newFreed.includes(mid)) continue;
    const myDays = Object.entries(asgn).filter(([, x]) => x === mid).map(([d]) => Number(d));
    if (myDays.some((d) => isWkDate(d, s))) continue;
    if (!availableWk.some((d) => isDateValid(mid, d, asgn, s, false))) newFreed.push(mid);
  }
  return newFreed;
}

// ── Trailing-window engine history from per-month logs ───────────────────────
function engineHistory(weekendLog, ddLog, windowMonths) {
  const recent = weekendLog.slice(-windowMonths);
  const months = recent.map((e) => ({ key: e.key, label: e.key }));
  const weekend = {}, doubleDuty = {};
  recent.forEach((e) => e.ids.forEach((id) => { weekend[id] = weekend[id] || {}; weekend[id][e.key] = (weekend[id][e.key] || 0) + 1; }));
  ddLog.slice(-windowMonths).forEach((e) => e.ids.forEach((id) => { doubleDuty[id] = doubleDuty[id] || {}; doubleDuty[id][e.key] = true; }));
  return { months, weekend, doubleDuty };
}

function runTrial(coa, seed, opts) {
  const rnd = rng(seed);
  const YEARS = opts.years || 5;
  // Build roster in seniority order (index 0 = most senior).
  let nextNum = 1;
  const roster = [];
  for (const rank of RANKS) for (let i = 0; i < (START_DIST[rank] || 0); i++) roster.push({ id: 'm' + (nextNum++), rank, lastName: 'M' + (nextNum), firstName: '', joinMonth: 0, monthsPresent: 0 });
  if (rnd() < 0.5) roster.push({ id: 'm' + (nextNum++), rank: 'LCPL', lastName: 'Mx', firstName: '', joinMonth: 0, monthsPresent: 0 });

  // Schedule turnover: 2-3/yr, different ranks, different months.
  const turnovers = [];
  for (let yr = 0; yr < YEARS; yr++) {
    const k = 2 + (rnd() < 0.5 ? 1 : 0);
    const ranks = pickN(rnd, ['GYSGT', 'SSGT', 'SGT', 'CPL', 'LCPL'], k);
    const months = pickN(rnd, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], k);
    ranks.forEach((rk, i) => turnovers.push({ month: yr * 12 + months[i], rank: rk }));
  }

  const weekendLog = [], ddLog = [];
  const lastDutyDay = {};
  // Per-Marine accumulators (keyed by id; ids are unique across the whole run).
  const acc = {}; // id -> { months, weekend, dd, gotFirst, gotTop3, gotAny, prefMonths, draftPosSum, draftPosN, seniorityRankSum }
  const ensure = (id) => (acc[id] = acc[id] || { months: 0, weekend: 0, dd: 0, gotFirst: 0, gotTop3: 0, gotAny: 0, prefMonths: 0, posSum: 0, posN: 0, joinMonth: 0, rank: '' });
  // By-draft-position-tertile preference success (early/mid/late).
  const tier = { early: { n: 0, first: 0, top3: 0, any: 0 }, mid: { n: 0, first: 0, top3: 0, any: 0 }, late: { n: 0, first: 0, top3: 0, any: 0 } };
  const inv = { backToBack: 0, unfilled: 0, wkUnfulfilled: 0, totalDuty: 0 };
  // Seniority-vs-pick correlation samples (per month).
  const seniorityVsPos = [];

  for (let month = 0; month < YEARS * 12; month++) {
    // Turnover at start of month.
    turnovers.filter((t) => t.month === month).forEach((t) => {
      let li = roster.findIndex((m) => m.rank === t.rank);
      if (li === -1) li = 0;
      roster.splice(li, 1);                         // depart (array compacts: juniors gain seniority)
      // promotion cascade (relabel ranks for realism; seniority is array position)
      const fromIdx = RANKS.indexOf(t.rank);
      for (let r = fromIdx; r < RANKS.length - 1; r++) { const p = roster.find((m) => m.rank === RANKS[r + 1]); if (p) p.rank = RANKS[r]; }
      roster.push({ id: 'm' + (nextNum++), rank: 'PFC', lastName: 'M' + nextNum, firstName: '', joinMonth: month, monthsPresent: 0 }); // new PFC, most junior
    });

    roster.forEach((m) => { m.monthsPresent += 1; });
    const ids = roster.map((m) => m.id);
    const seniorityIndex = {}; roster.forEach((m, i) => { seniorityIndex[m.id] = i; });
    roster.forEach((m) => { const a = ensure(m.id); a.rank = m.rank; a.joinMonth = m.joinMonth; });

    const y = 2026 + Math.floor(month / 12), mo = month % 12;
    const dim = getDIM(y, mo);
    const key = `${y}-${pad2(mo + 1)}`;
    let wkDays = 0; for (let d = 1; d <= dim; d++) if (isNatWk(y, mo, d)) wkDays++;

    // 1) Weekend slate — equal across the company, by RECENT weekend burden (trailing
    //    window) so newcomers don't have to "catch up" to veterans' lifetime totals.
    const WK_WINDOW = opts.weekendWindow || 12;
    const priorWeekendFlat = []; weekendLog.slice(-WK_WINDOW).forEach((e) => e.ids.forEach((id) => priorWeekendFlat.push(id)));
    const wkAssigneeIds = engine.computeWeekendAssignees(roster, wkDays, priorWeekendFlat).map((m) => m.id);

    // 2) Double duty — fewest prior DD first, then most junior.
    const ddCount = Math.max(0, dim - roster.length);
    const ddSoFar = {}; ids.forEach((id) => { ddSoFar[id] = 0; }); ddLog.forEach((e) => e.ids.forEach((id) => { ddSoFar[id] = (ddSoFar[id] || 0) + 1; }));
    const ddIds = roster.slice().sort((a, b) => { const ca = ddSoFar[a.id] || 0, cb = ddSoFar[b.id] || 0; if (ca !== cb) return ca - cb; return seniorityIndex[b.id] - seniorityIndex[a.id]; }).slice(0, ddCount).map((m) => m.id);
    const ddMap = {}; ddIds.forEach((id) => { ddMap[id] = 2; });

    // 3) Draft order under the COA.
    const history = engineHistory(weekendLog, ddLog, opts.windowMonths || 3);
    const result = engine.generateDraftOrder(coa, roster, history, { doubleDuty: ddMap, seed: seed + '-' + month, month: mo, year: y });
    const order = result.order;

    // 4) Preferences — weekend-slotted prefer weekend dates, others prefer weekdays.
    const wkSet = new Set(wkAssigneeIds);
    const dutyDays = getAllDates({ year: y, month: mo, blackouts: [] });
    const weekendDays = dutyDays.filter((d) => isNatWk(y, mo, d));
    const weekdayDays = dutyDays.filter((d) => !isNatWk(y, mo, d));
    const prefs = {};
    roster.forEach((m) => {
      const pool = wkSet.has(m.id) ? weekendDays : weekdayDays;
      const want = Math.min(pool.length, 3 + Math.floor(rnd() * 6)); // 3-8 preferred dates
      prefs[m.id] = pickN(rnd, pool, want).map((day) => ({ day }));
    });

    // 5) Approved non-availability — light, to stress the draft.
    const nonAvail = {};
    roster.forEach((m) => { if (rnd() > 0.15) return; const start = 1 + Math.floor(rnd() * Math.max(1, dim - 2)); const len = 1 + Math.floor(rnd() * 3); const dates = []; for (let d = start; d < start + len && d <= dim; d++) dates.push(dk(y, mo, d)); nonAvail[m.id] = dates.map((date) => ({ date, approved: true })); });

    // 6) Run the actual draft, day by day (faithful to server doAutoPick).
    const s = { year: y, month: mo, blackouts: [], workdays: [], extraWk: [], preAssigned: {}, nonAvail, wkAssigneeIds, doubleDuty: ddMap, freedMarines: [], prefs, draftOrder: order, history: { lastDutyDay } };
    const asgn = {};
    const totalDuty = getAllDates(s).length;
    inv.totalDuty += totalDuty;
    let assigned = 0;
    const firstPosThisMonth = {};   // id -> draft index of their first pick
    const gotPrefThisMonth = {};    // id -> {first, top3, any} for their first pick
    for (let idx = 0; idx < order.length && assigned < totalDuty; idx++) {
      const { id, turn } = order[idx];
      s.assignments = asgn;
      const day = doAutoPick(id, s, asgn, turn);
      if (day == null) continue;                 // blocked / sits out
      asgn[day] = id; assigned++;
      s.freedMarines = autoFreeBlockedMarines(asgn, s, idx + 1);
      if (firstPosThisMonth[id] == null) {
        firstPosThisMonth[id] = idx;
        const pl = (prefs[id] || []).map((p) => p.day);
        const rank = pl.indexOf(day);
        gotPrefThisMonth[id] = { first: rank === 0, top3: rank >= 0 && rank < 3, any: rank >= 0, hadPrefs: pl.length > 0 };
      }
    }

    // 7) Invariant checks + record outcomes.
    for (let d = 1; d <= dim; d++) { if (!isNatWk(y, mo, d) === false) {} }
    if (assigned < totalDuty) inv.unfilled += (totalDuty - assigned);
    // back-to-back check
    const byMarine = {}; Object.entries(asgn).forEach(([d, id]) => { (byMarine[id] = byMarine[id] || []).push(Number(d)); });
    Object.values(byMarine).forEach((days) => { const ss = days.slice().sort((a, b) => a - b); for (let i = 1; i < ss.length; i++) if (ss[i] - ss[i - 1] === 1) inv.backToBack++; });
    // weekend obligation: slotted, not freed, but no weekend stood
    wkAssigneeIds.forEach((id) => { if ((s.freedMarines || []).includes(id)) return; const days = byMarine[id] || []; if (!days.some((d) => isWkDate(d, s))) inv.wkUnfulfilled++; });

    // Per-Marine records this month
    const monthSenior = [], monthPos = [];
    roster.forEach((m) => {
      const a = ensure(m.id); a.months += 1;
      const days = byMarine[m.id] || [];
      const wknd = days.filter((d) => isWkDate(d, s)).length;
      a.weekend += wknd;
      if (ddIds.includes(m.id)) a.dd += 1;
      const g = gotPrefThisMonth[m.id];
      if (g && g.hadPrefs && firstPosThisMonth[m.id] != null) {
        a.prefMonths += 1; if (g.first) a.gotFirst += 1; if (g.top3) a.gotTop3 += 1; if (g.any) a.gotAny += 1;
      }
      if (firstPosThisMonth[m.id] != null) { a.posSum += firstPosThisMonth[m.id] + 1; a.posN += 1; monthSenior.push(seniorityIndex[m.id] + 1); monthPos.push(firstPosThisMonth[m.id] + 1); }
    });
    if (monthSenior.length > 3) seniorityVsPos.push(pearson(monthSenior, monthPos));

    // Tertile preference success by draft position.
    const positioned = Object.keys(firstPosThisMonth).map((id) => ({ id, pos: firstPosThisMonth[id] })).sort((a, b) => a.pos - b.pos);
    const t = Math.max(1, Math.floor(positioned.length / 3));
    positioned.forEach((e, i) => {
      const g = gotPrefThisMonth[e.id]; if (!g || !g.hadPrefs) return;
      const bucket = i < t ? tier.early : i < 2 * t ? tier.mid : tier.late;
      bucket.n += 1; if (g.first) bucket.first += 1; if (g.top3) bucket.top3 += 1; if (g.any) bucket.any += 1;
    });

    // 8) Commit burden + advance lastDutyDay. Record ACTUAL weekends stood (the
    //    way the live app does in /api/next-month) — not the slate — so the
    //    equalizer corrects for any weekend a Marine was forced onto in the draft.
    const actualWkStanders = [];
    Object.entries(asgn).forEach(([d, id]) => { if (isWkDate(Number(d), s)) actualWkStanders.push(id); });
    weekendLog.push({ key, ids: actualWkStanders });
    ddLog.push({ key, ids: ddIds.slice() });
    Object.entries(byMarine).forEach(([id, days]) => { lastDutyDay[id] = Math.max(...days); });
  }

  return { acc, tier, inv, seniorityVsPos };
}

function runCOA(coa, opts) {
  const TRIALS = opts.trials || 200, SEED0 = opts.seed || 1;
  const tier = { early: { n: 0, first: 0, top3: 0, any: 0 }, mid: { n: 0, first: 0, top3: 0, any: 0 }, late: { n: 0, first: 0, top3: 0, any: 0 } };
  const inv = { backToBack: 0, unfilled: 0, wkUnfulfilled: 0, totalDuty: 0 };
  const seniorityCorr = [];
  const wkCVs = [], wkSpreads = [], worstDevs = [], ddPerYearAll = [], vetWk = [], newWk = [];
  const byRank = {}; RANKS.forEach((rk) => { byRank[rk] = { posSum: 0, posN: 0, first: 0, prefMonths: 0, wknd: 0, mm: 0 }; });
  const CAREER = (opts.years || 5) * 12 - 12; // present ~all but one year => a "career" Marine for this run
  for (let t = 0; t < TRIALS; t++) {
    const r = runTrial(coa, SEED0 + t * 7919, opts);
    ['early', 'mid', 'late'].forEach((k) => { ['n', 'first', 'top3', 'any'].forEach((x) => { tier[k][x] += r.tier[k][x]; }); });
    inv.backToBack += r.inv.backToBack; inv.unfilled += r.inv.unfilled; inv.wkUnfulfilled += r.inv.wkUnfulfilled; inv.totalDuty += r.inv.totalDuty;
    r.seniorityVsPos.forEach((c) => seniorityCorr.push(c));
    // WITHIN-TRIAL weekend fairness among career Marines (present ~the whole run),
    // per year of service — this is the real "is the unit fair" question. Pooling
    // every short-tenure newcomer across every trial would inflate the spread.
    const career = Object.values(r.acc).filter((a) => a.months >= CAREER);
    const rates = career.map((a) => a.weekend / (a.months / 12));
    if (rates.length) { const s = stat(rates); wkCVs.push(s.cv); wkSpreads.push(s.spread); if (s.mean) worstDevs.push(Math.max(...rates.map((x) => Math.abs(x - s.mean) / s.mean))); }
    Object.values(r.acc).forEach((a) => {
      if (a.months >= 12) ddPerYearAll.push(a.dd / (a.months / 12));
      if (a.months >= CAREER && a.joinMonth === 0) vetWk.push(a.weekend / (a.months / 12));
      else if (a.joinMonth > 0 && a.months >= 12) newWk.push(a.weekend / (a.months / 12));
      const b = byRank[a.rank]; if (b) { b.posSum += a.posSum; b.posN += a.posN; b.first += a.gotFirst; b.prefMonths += a.prefMonths; b.wknd += a.weekend; b.mm += a.months; }
    });
  }
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    coa, tier, inv, byRank,
    seniorityCorr: mean(seniorityCorr),
    careerWkCV: mean(wkCVs), careerWkSpread: mean(wkSpreads), worstCareerDev: mean(worstDevs),
    vetWk: mean(vetWk), newWk: mean(newWk), ddPerYear: stat(ddPerYearAll),
  };
}

if (require.main === module) {
  const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? Number(a.split('=')[1]) : d; };
  const opts = { trials: arg('trials', 200), years: arg('years', 5) };
  const COAS = [
    { mode: engine.MODES.WEIGHTED_SENIORITY, label: 'COA 1 — Weighted Seniority' },
    { mode: engine.MODES.WEIGHTED_LOTTERY, label: 'COA 2 — Weighted Lottery' },
    { mode: engine.MODES.HYBRID, label: 'COA 3 — Hybrid (lottery top 5 + weighted seniority)' },
  ];
  const pct = (x) => (x * 100).toFixed(1) + '%';
  console.log(`\nDutyDraft — Day-level draft simulation · ${opts.trials} trials × ${opts.years} years × COA 1/2/3 (with turnover)\n`);
  for (const c of COAS) {
    const R = runCOA(c.mode, opts);
    console.log('============================================================');
    console.log(c.label);
    console.log('============================================================');
    console.log('SENIORITY → DRAFT POSITION');
    console.log('  correlation (1=seniority dominates, 0=luck):', R.seniorityCorr.toFixed(3));
    console.log('  avg first-pick position by rank:');
    RANKS.forEach((rk) => { const b = R.byRank[rk]; if (b.posN) console.log('    ' + rk.padEnd(6), 'avg pick #' + (b.posSum / b.posN).toFixed(1)); });
    console.log('\nBEST DAYS (got a PREFERRED date) by draft position:');
    console.log('  bucket   got #1     top-3      any');
    ['early', 'mid', 'late'].forEach((k) => { const b = R.tier[k]; console.log('  ' + k.padEnd(6), pct(b.first / b.n).padStart(7), '  ', pct(b.top3 / b.n).padStart(7), '  ', pct(b.any / b.n).padStart(7)); });
    console.log('\nWEEKEND FAIRNESS (career Marines, within-unit — must stay EQUAL):');
    console.log('  within-trial weekend CV:', pct(R.careerWkCV), ' spread:', R.careerWkSpread.toFixed(2), '/yr  worst career Marine:', pct(R.worstCareerDev));
    console.log('  veteran vs newcomer weekends/yr:', R.vetWk.toFixed(2), 'vs', R.newWk.toFixed(2));
    console.log('  double duty/Marine/yr: mean', R.ddPerYear.mean.toFixed(2), ' CV', pct(R.ddPerYear.cv), '(rotated to most-junior by design)');
    console.log('\nHARD-RULE INVARIANTS (must be 0):');
    console.log('  back-to-back days:', R.inv.backToBack, ' unfilled days:', R.inv.unfilled, ' weekend obligations missed:', R.inv.wkUnfulfilled);
    console.log('');
  }
}

module.exports = { runCOA, runTrial };
