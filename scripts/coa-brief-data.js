#!/usr/bin/env node
// Computes every figure used in the CO COA-comparison brief by running the real
// engine + 12-month fairness simulation, and writes scripts/coa-brief-data.json.
// The Python PDF renderer reads that JSON. Keeping the numbers here means the brief
// always reflects the tested engine — no hand-typed figures.

const fs = require('fs');
const path = require('path');
const engine = require('../draft-order-engine');
const sim = require('../draft-fairness-sim');
const fx = require('../scripts/data/burden-2026-q2');

const ROSTER = fx.ROSTER;
const SEED_HISTORY = fx.buildHistory();
const RANK_DISPLAY = { GYSGT: 'GySgt', SSGT: 'SSgt', SGT: 'Sgt', CPL: 'Cpl', LCPL: 'LCpl', PFC: 'PFC', PVT: 'Pvt' };
const dispRank = (r) => RANK_DISPLAY[r] || r;
const senOf = (id) => ROSTER.findIndex((m) => m.id === id) + 1;
const nameOf = (id) => { const m = ROSTER.find((x) => x.id === id); return dispRank(m.rank) + ' ' + m.lastName; };
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (key) => { const [y, m] = key.split('-'); return MONTH_ABBR[Number(m) - 1] + ' ' + y; };

const SEED = 'co-brief';
const opts = (coa) => ({ months: 12, seed: SEED, startYear: 2026, startMonth: 6, seedHistory: SEED_HISTORY, coa, engine });
const C1 = sim.simulate(ROSTER, opts('weighted_seniority'));
const C2 = sim.simulate(ROSTER, opts('weighted_lottery'));
const C3 = sim.simulate(ROSTER, opts('hybrid'));

// ── Weekend equality (identical across COAs) ──
const wk = C1.marines.map((m) => m.weekendsStood);
const weekend = { min: Math.min.apply(null, wk), max: Math.max.apply(null, wk), avg: C1.summary.avgWeekends, spread: C1.summary.weekendSpread };

// ── Luck swing vs the deserved (weighted-seniority) order ──
const luck = { c1: sim.luckVsBaseline(C1, C1), c2: sim.luckVsBaseline(C2, C1), c3: sim.luckVsBaseline(C3, C1) };
const seniorityPredicts = { c1: C1.summary.seniorityPredictsPick, c2: C2.summary.seniorityPredictsPick, c3: C3.summary.seniorityPredictsPick };

// ── Double-duty rotation (proves it climbs the seniority line, fairly) ──
const ddRotation = C1.monthly.map((mo) => ({
  month: monthLabel(mo.key),
  marines: mo.doubleDutyIds.length ? mo.doubleDutyIds.map((id) => nameOf(id) + ' (#' + senOf(id) + ')').join(',  ') : '— (short month)',
}));

// ── Per-Marine 12-month table ──
const byId = (run) => { const o = {}; run.marines.forEach((m) => { o[m.id] = m; }); return o; };
const M1 = byId(C1), M2 = byId(C2), M3 = byId(C3);
const cell = (m) => m.avgPick + ' [' + m.bestPick + '–' + m.worstPick + ']';
const perMarine = ROSTER.map((r) => ({
  sen: senOf(r.id), name: nameOf(r.id),
  c1: cell(M1[r.id]), c2: cell(M2[r.id]), c3: cell(M3[r.id]),
  weekends: M1[r.id].weekendsStood, doubleDuties: M1[r.id].doubleDuties,
}));

// ── The senior-Marine example (GySgt Aird, #3) — "even a senior lands at the bottom" ──
const P1 = sim.perMarineMonthlyPicks(C1), P2 = sim.perMarineMonthlyPicks(C2), P3 = sim.perMarineMonthlyPicks(C3);
const airdId = ROSTER.find((m) => m.lastName === 'Aird').id;
const example = {
  name: nameOf(airdId) + ' (#' + senOf(airdId) + ' most senior)',
  c1: P1[airdId], c2: P2[airdId], c3: P3[airdId],
  c1Worst: Math.max.apply(null, P1[airdId]), c2Worst: Math.max.apply(null, P2[airdId]),
};

// ── One month, side by side (the real upcoming July 2026 draft) ──
const orderRow = (order, i) => { const e = order[i]; if (!e) return ''; const dd = order.filter((x) => x.id === e.id).length > 1; return nameOf(e.id) + (dd ? ' (×2·t' + e.turn + ')' : ''); };
const maxLen = Math.max(C1.monthly[0].order.length, C2.monthly[0].order.length, C3.monthly[0].order.length);
const oneMonth = { label: monthLabel(C1.monthly[0].key), rows: [] };
for (let i = 0; i < maxLen; i++) {
  oneMonth.rows.push({ pick: i + 1, c1: orderRow(C1.monthly[0].order, i), c2: orderRow(C2.monthly[0].order, i), c3: orderRow(C3.monthly[0].order, i) });
}

const data = {
  meta: {
    generated: new Date().toISOString().slice(0, 10),
    months: 12, startLabel: 'July 2026', endLabel: 'June 2027', rosterSize: ROSTER.length,
    cap: engine.DEFAULT_CONFIG.movementCap,
  },
  weekend, luck, seniorityPredicts, ddRotation, perMarine, example, oneMonth,
};

const outPath = path.join(__dirname, 'coa-brief-data.json');
fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
console.log('Wrote ' + outPath);
console.log('luck swing  C1=' + luck.c1 + '  C2=' + luck.c2 + '  C3=' + luck.c3);
console.log('weekend spread=' + weekend.spread + '  ' + example.name + ' worst pick: COA1=' + example.c1Worst + ' COA2=' + example.c2Worst);
