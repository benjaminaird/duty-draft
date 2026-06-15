// ============================================================================
// DutyDraft — Draft Fairness Simulation
// ============================================================================
//
// Runs the REAL draft-order engine month-over-month so leadership can see how a
// COA behaves over a year, not just one draft. It answers the question a CO
// actually asks: "if I pick this method, is it fair to my Marines over time?"
//
// It is a SIMULATION, not a pass/fail test — it characterizes outcomes using the
// production engine, the real roster, and a realistic monthly duty model.
//
// Dual-loadable (Node/Jest + browser global window.DraftFairnessSim), same as the
// engine. It resolves the draft-order engine from an explicit option, the browser
// global, or require().
//
// ---------------------------------------------------------------------------
// MONTHLY MODEL (explicit + defensible — state these assumptions to command)
// ---------------------------------------------------------------------------
//   • 12 consecutive real calendar months from the start month.
//   • Weekend days each month = the real count of Saturdays + Sundays. These are
//     assigned EQUALLY (least recent weekend burden first) — the same logic the
//     live app uses — and become each Marine's weekend burden.
//   • Double duty occurs when the month has more duty days than Marines
//     (daysInMonth > roster size); the extra slots go to the most-junior Marines
//     on rotation (fewest prior double duties first). Those Marines are the
//     #1/#2 priority picks that month.
//   • Every Marine drafts every month (short-month sit-outs are not modeled, so
//     pick numbers stay comparable month to month).
//   • The first draft is primed with a seed burden history (e.g., the Apr–Jun
//     2026 window) so month 1 matches what we've already shown.
//
// Output: per-Marine aggregates (avg/best/worst pick, weekends stood, double
// duties) + summary fairness metrics (weekend spread, pick volatility, how well
// seniority predicts picks). See README of the return value at the bottom.
// ============================================================================

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DraftFairnessSim = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function resolveEngine(explicit) {
    if (explicit) return explicit;
    if (typeof self !== 'undefined' && self.DraftOrderEngine) return self.DraftOrderEngine;
    if (typeof require === 'function') { try { return require('./draft-order-engine'); } catch (e) {} }
    throw new Error('DraftFairnessSim: draft-order engine not found');
  }

  const pad2 = (n) => String(n).padStart(2, '0');
  const monthKey = (y, m) => y + '-' + pad2(m + 1);
  const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
  function weekendDayCount(y, m) {
    let c = 0;
    const dim = daysInMonth(y, m);
    for (let d = 1; d <= dim; d++) { const w = new Date(y, m, d).getDay(); if (w === 0 || w === 6) c++; }
    return c;
  }

  // Convert a seed engine-history (months + weekend{ id:{key:count} } + doubleDuty
  // { id:{key:true} }) into per-month logs of who stood weekends / double duty.
  function seedLogsFromHistory(seedHistory) {
    const weekendLog = [], doubleDutyLog = [];
    if (!seedHistory || !seedHistory.months) return { weekendLog, doubleDutyLog };
    seedHistory.months.forEach((mo) => {
      const wkIds = [];
      Object.keys(seedHistory.weekend || {}).forEach((id) => {
        const c = (seedHistory.weekend[id] || {})[mo.key] || 0;
        for (let k = 0; k < c; k++) wkIds.push(id);
      });
      const ddIds = [];
      Object.keys(seedHistory.doubleDuty || {}).forEach((id) => {
        if ((seedHistory.doubleDuty[id] || {})[mo.key]) ddIds.push(id);
      });
      weekendLog.push({ key: mo.key, ids: wkIds });
      doubleDutyLog.push({ key: mo.key, ids: ddIds });
    });
    return { weekendLog, doubleDutyLog };
  }

  // Build the engine `history` from the trailing N months of the logs (prior only).
  function engineHistoryFromLogs(weekendLog, doubleDutyLog, windowMonths) {
    const recentWk = weekendLog.slice(-windowMonths);
    const months = recentWk.map((e) => ({ key: e.key, label: e.key })); // oldest -> newest; engine recency-weights
    const ddByKey = {};
    doubleDutyLog.slice(-windowMonths).forEach((e) => { ddByKey[e.key] = e.ids; });
    const weekend = {}, doubleDuty = {};
    recentWk.forEach((e) => {
      e.ids.forEach((id) => {
        weekend[id] = weekend[id] || {};
        weekend[id][e.key] = (weekend[id][e.key] || 0) + 1;
      });
      (ddByKey[e.key] || []).forEach((id) => {
        doubleDuty[id] = doubleDuty[id] || {};
        doubleDuty[id][e.key] = true;
      });
    });
    return { months, weekend, doubleDuty };
  }

  function simulate(roster, options) {
    options = options || {};
    const engine = resolveEngine(options.engine);
    const months = options.months || 12;
    const coa = options.coa || engine.DEFAULT_MODE;
    const seed = options.seed == null ? 'sim' : options.seed;
    const windowMonths = options.windowMonths || 3;
    let y = options.startYear == null ? 2026 : options.startYear;
    let m = options.startMonth == null ? 6 : options.startMonth; // 0-based; default July

    const ids = roster.map((r) => r.id);
    const seniorityIndex = {}; roster.forEach((r, i) => { seniorityIndex[r.id] = i; });

    const seeded = seedLogsFromHistory(options.seedHistory);
    const weekendLog = seeded.weekendLog.slice();
    const doubleDutyLog = seeded.doubleDutyLog.slice();

    // Per-Marine accumulators over the SIMULATED months only.
    const picks = {}; ids.forEach((id) => { picks[id] = []; });
    const weekendsStood = {}; ids.forEach((id) => { weekendsStood[id] = 0; });
    const doubleDuties = {}; ids.forEach((id) => { doubleDuties[id] = 0; });
    const monthly = [];

    for (let i = 0; i < months; i++) {
      const key = monthKey(y, m);
      const wkDays = weekendDayCount(y, m);
      const dim = daysInMonth(y, m);
      const ddCount = Math.max(0, dim - roster.length); // more duty days than Marines -> double duty

      // 1) Weekend assignment — equal across the company, using PRIOR weekend burden.
      const priorWeekendFlat = [];
      weekendLog.forEach((e) => e.ids.forEach((id) => priorWeekendFlat.push(id)));
      const weekendMarines = engine.computeWeekendAssignees(roster, wkDays, priorWeekendFlat);
      const weekendIds = weekendMarines.map((mm) => mm.id);

      // 2) Double duty — most-junior on rotation (fewest prior double duties first).
      const ddSoFar = {}; ids.forEach((id) => { ddSoFar[id] = 0; });
      doubleDutyLog.forEach((e) => e.ids.forEach((id) => { ddSoFar[id] = (ddSoFar[id] || 0) + 1; }));
      const ddMarines = roster.slice().sort((a, b) => {
        const ca = ddSoFar[a.id] || 0, cb = ddSoFar[b.id] || 0;
        if (ca !== cb) return ca - cb;                       // fewest prior double duties first
        return seniorityIndex[b.id] - seniorityIndex[a.id];  // then most junior
      }).slice(0, ddCount);
      const ddIds = ddMarines.map((mm) => mm.id);

      // 3) Draft order under the COA, using the trailing-window burden as history
      //    and THIS month's double duty as the front-of-roster priority.
      const history = engineHistoryFromLogs(weekendLog, doubleDutyLog, windowMonths);
      const ddMap = {}; ddIds.forEach((id) => { ddMap[id] = 2; });
      const result = engine.generateDraftOrder(coa, roster, history, {
        doubleDuty: ddMap, seed: seed + '-' + i, month: m, year: y,
      });

      // 4) Record each Marine's first pick number this month.
      const firstPick = {};
      result.order.forEach((e, idx) => { if (firstPick[e.id] == null) firstPick[e.id] = idx + 1; });
      ids.forEach((id) => { if (firstPick[id] != null) picks[id].push(firstPick[id]); });
      weekendIds.forEach((id) => { weekendsStood[id] += 1; });
      ddIds.forEach((id) => { doubleDuties[id] += 1; });

      monthly.push({ key, weekendDays: wkDays, doubleDutyIds: ddIds, weekendIds, order: result.order });

      // 5) Commit this month's burden to the logs for future months, then advance.
      weekendLog.push({ key, ids: weekendIds });
      doubleDutyLog.push({ key, ids: ddIds });
      if (m === 11) { m = 0; y++; } else { m++; }
    }

    return summarize(roster, coa, months, seniorityIndex, picks, weekendsStood, doubleDuties, monthly);
  }

  function mean(arr) { return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0; }
  function pearson(xs, ys) {
    const n = xs.length; if (!n) return 0;
    const mx = mean(xs), my = mean(ys);
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
    return (dx && dy) ? num / Math.sqrt(dx * dy) : 0;
  }
  const round1 = (n) => Math.round(n * 10) / 10;

  function summarize(roster, coa, months, seniorityIndex, picks, weekendsStood, doubleDuties, monthly) {
    const marines = roster.map((r) => {
      const p = picks[r.id] || [];
      const avg = mean(p);
      return {
        id: r.id, rank: r.rank, lastName: r.lastName,
        seniorityRank: seniorityIndex[r.id] + 1,
        avgPick: round1(avg),
        bestPick: p.length ? Math.min.apply(null, p) : null,
        worstPick: p.length ? Math.max.apply(null, p) : null,
        pickRange: p.length ? (Math.max.apply(null, p) - Math.min.apply(null, p)) : 0,
        weekendsStood: weekendsStood[r.id] || 0,
        doubleDuties: doubleDuties[r.id] || 0,
      };
    });

    const wkVals = marines.map((x) => x.weekendsStood);
    const weekendSpread = Math.max.apply(null, wkVals) - Math.min.apply(null, wkVals);
    const avgPickVolatility = round1(mean(marines.map((x) => x.pickRange)));
    // How strongly seniority predicts the average pick. Closer to 1 = seniority
    // dominates (predictable); closer to 0 = picks decoupled from seniority (luck).
    const seniorityPredictsPick = round1(
      pearson(marines.map((x) => x.seniorityRank), marines.map((x) => x.avgPick))
    );

    // Luck flags: a senior Marine (top third) whose worst pick was deep, or a
    // junior (bottom third) whose best pick was very early. Concrete examples.
    const third = Math.max(1, Math.floor(roster.length / 3));
    const seniorHosed = marines
      .filter((x) => x.seniorityRank <= third && x.worstPick != null)
      .reduce((w, x) => (!w || x.worstPick > w.worstPick ? x : w), null);
    const juniorLucky = marines
      .filter((x) => x.seniorityRank > roster.length - third && x.bestPick != null)
      .reduce((b, x) => (!b || x.bestPick < b.bestPick ? x : b), null);

    return {
      coa, months,
      marines,
      monthly,
      summary: {
        weekendSpread,                 // max-min weekends stood (small = equal burden)
        avgWeekends: round1(mean(wkVals)),
        avgPickVolatility,             // mean per-Marine (worst-best) pick swing
        seniorityPredictsPick,         // correlation seniority<->avg pick (1=predictable, ~0=luck)
        totalDoubleDuties: marines.reduce((s, x) => s + x.doubleDuties, 0),
        seniorHosed: seniorHosed && { name: seniorHosed.rank + ' ' + seniorHosed.lastName, seniorityRank: seniorHosed.seniorityRank, worstPick: seniorHosed.worstPick },
        juniorLucky: juniorLucky && { name: juniorLucky.rank + ' ' + juniorLucky.lastName, seniorityRank: juniorLucky.seniorityRank, bestPick: juniorLucky.bestPick },
      },
    };
  }

  // Per-Marine list of monthly pick numbers (first slot each month).
  function perMarineMonthlyPicks(run) {
    const o = {};
    run.marines.forEach((m) => { o[m.id] = []; });
    run.monthly.forEach((mo) => {
      const seen = {};
      mo.order.forEach((e, i) => { if (seen[e.id] == null) seen[e.id] = i + 1; });
      Object.keys(o).forEach((id) => { o[id].push(seen[id] == null ? null : seen[id]); });
    });
    return o;
  }

  // THE headline fairness metric: average distance (in pick slots) between a COA's
  // monthly pick and the DESERVED rules-based pick (a weighted-seniority baseline
  // run over the identical month/burden sequence). 0 = every pick is explainable by
  // rank + earned burden; higher = luck piled on top of the rules.
  function luckVsBaseline(run, baselineRun) {
    const a = perMarineMonthlyPicks(run), b = perMarineMonthlyPicks(baselineRun);
    let s = 0, n = 0;
    Object.keys(a).forEach((id) => {
      const ar = a[id], br = b[id] || [];
      for (let i = 0; i < ar.length; i++) {
        if (ar[i] != null && br[i] != null) { s += Math.abs(ar[i] - br[i]); n++; }
      }
    });
    return n ? Math.round((s / n) * 10) / 10 : 0;
  }

  return {
    simulate,
    perMarineMonthlyPicks,
    luckVsBaseline,
    _internals: { engineHistoryFromLogs, seedLogsFromHistory, weekendDayCount, daysInMonth },
  };
});
