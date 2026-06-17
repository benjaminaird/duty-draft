// ============================================================================
// DutyDraft — Draft Order Engine
// ============================================================================
//
// A modular, strategy-based draft-order generator. DutyDraft is a RULE-BASED
// duty scheduler — there is no AI here. Every number this engine produces is
// explainable: a SNCOIC must be able to say "here is the order, here is the
// selected COA, here is why the double-duty Marines are first, and here is how
// recent burden affected the rest."
//
// This file is intentionally dependency-free and is loadable two ways:
//   • Node / Jest:  const engine = require('./draft-order-engine');
//   • Browser:      <script src="/draft-order-engine.js"></script>  ->  window.DraftOrderEngine
//
// It does NOT touch the DOM, the network, or app state. It takes plain data in
// and returns plain data out, which keeps it unit-testable and keeps business
// logic out of the React UI.
//
// ---------------------------------------------------------------------------
// CORE RULE (applies to EVERY mode)
// ---------------------------------------------------------------------------
// Current-month double-duty Marines always go first. If the upcoming month has
// more duty days than Marines, one or more Marines must stand TWO duty days that
// month. Those Marines are placed at the very top of the draft order, ahead of
// any COA logic, and (matching DutyDraft's existing draft mechanics) each keeps
// BOTH of their picks — two consecutive turns. So two double-duty Marines fill
// draft positions #1–#4 as [A,turn1],[A,turn2],[B,turn1],[B,turn2], ordered
// most-senior-first among themselves. This is a current-month COMPENSATION
// rule, not a following-month reward.
//
// ---------------------------------------------------------------------------
// MODES (draftOrderMode)
// ---------------------------------------------------------------------------
//   'pure_seniority'      — safe fallback: seniority order, no burden/random/lottery.
//   'weighted_seniority'  — COA 1: seniority dominant; recent burden nudges modestly; ±5 cap.
//   'weighted_lottery'    — COA 2: weighted draw; seniority + burden raise the odds.
//   'hybrid'              — COA 3: lottery for the top 5 slots, weighted seniority for the rest.
//
// ---------------------------------------------------------------------------
// INPUT SHAPES
// ---------------------------------------------------------------------------
// roster:  Array of Marine objects in SENIORITY ORDER (index 0 = most senior).
//          Each: { id, rank, lastName, firstName }. Seniority is purely array
//          position — rank is display only. Base seniority score = N..1 where
//          N = roster.length (most senior gets N, most junior gets 1).
//
// history: The 3-month recent-burden window. Weekend burden counts STARRED
//          WEEKEND duties only (past comp days do not count). Shape:
//            {
//              months: [ { key:'2026-04', label:'April 2026', weekendPoints?:1.65 }, ... ],
//                        // ordered OLDEST -> NEWEST. weekendPoints is optional;
//                        // if omitted it is derived by recency from config.
//              weekend:    { [marineId]: { [monthKey]: count } },  // # starred weekend duties
//              doubleDuty: { [marineId]: { [monthKey]: true } },   // stood 2 duty dates that month
//            }
//          Burden is tracked EQUALLY across all Marines — there is no rank quota.
//
// options:
//   {
//     doubleDuty,      // current-month double-duty: array of ids OR map { id: 2 }
//     preAssigned,     // ids excluded from the draft: array OR map { day: id }
//     seed,            // RNG seed (number/string). Generated + recorded if omitted.
//     month, year,     // draft month/year (0-based month), for the audit record.
//     generatedBy,     // username/role string, for the audit record.
//     config,          // optional overrides of DEFAULT_CONFIG.
//     now,             // Date override (testing); defaults to new Date().
//   }
//
// ---------------------------------------------------------------------------
// OUTPUT
// ---------------------------------------------------------------------------
//   {
//     order: [ { id, turn }, ... ],   // drop-in for /api/draft/start (turn 1, or 1&2 for double duty)
//     audit: { ...full explainable breakdown... },   // see buildDraftOrderAuditBreakdown
//   }
// ============================================================================

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;            // Node / Jest
  } else {
    root.DraftOrderEngine = api;     // Browser global
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── Mode identifiers ──────────────────────────────────────────────────────
  const MODES = {
    PURE_SENIORITY: 'pure_seniority',
    WEIGHTED_SENIORITY: 'weighted_seniority',   // COA 1
    WEIGHTED_LOTTERY: 'weighted_lottery',       // COA 2
    HYBRID: 'hybrid',                           // COA 3
  };
  const ALL_MODES = [
    MODES.PURE_SENIORITY,
    MODES.WEIGHTED_SENIORITY,
    MODES.WEIGHTED_LOTTERY,
    MODES.HYBRID,
  ];

  // Default mode for the app until the master admin chooses the final COA.
  // TODO(ui): expose this as a master-admin setting (draftOrderMode) and persist
  // it on app state so the workflow reads it instead of this constant.
  const DEFAULT_MODE = MODES.WEIGHTED_SENIORITY; // COA 1

  // Shown to Marines / leadership. Replaces the old rank-quota fairness wording.
  const FAIRNESS_STATEMENT =
    'Weekend burden is tracked equally across all Marines. ' +
    'Seniority affects draft order, not weekend obligation.';

  // Plain-language explanation of each mode, for the Marine-facing screen.
  const MODE_EXPLANATIONS = {
    [MODES.PURE_SENIORITY]:
      'Draft order is based on seniority after current-month double-duty priority picks.',
    [MODES.WEIGHTED_SENIORITY]:
      'Draft order is based primarily on seniority, adjusted by recent weekend/double-duty burden, with limited movement.',
    [MODES.WEIGHTED_LOTTERY]:
      'Draft order was generated by weighted lottery using seniority and recent burden.',
    [MODES.HYBRID]:
      'Top positions include current-month double-duty priority and limited weighted lottery picks; the remainder uses weighted seniority.',
  };

  const DEFAULT_CONFIG = {
    // COA 1 — weighted seniority
    movementCap: 8,                 // max ± positions from remaining pure-seniority position
    weekendPointsByRecency: [5.00, 3.35, 1.65], // index 0 = most recent month, then older
    doubleDutyPointValue: 5,        // +5 for a double-duty month inside the lookback window
    // Double-duty burden looks back only this many months (the month(s) immediately
    // before the draft). The month OF the double duty is handled by the front-of-roster
    // priority rule; the month AFTER counts +5; anything older drops off and only
    // weekends move the score. Default 1 = just the month right before the draft.
    doubleDutyLookbackMonths: 1,
    randomRange: 1,                 // small adjustment uniformly in [-randomRange, +randomRange]
    // COA 2 — weighted lottery (tickets are NOT recency-weighted; each weekend counts equally)
    weekendTicketValue: 5,          // +5 tickets per weekend duty in the window
    doubleDutyTicketValue: 5,       // +5 tickets per double-duty month inside the lookback window
    // COA 3 — hybrid
    hybridLotterySlots: 5,          // lottery fills exactly this many slots after double-duty priority
  };

  // ── Helpers ────────────────────────────────────────────────────────────────

  function cfg(options) {
    return Object.assign({}, DEFAULT_CONFIG, (options && options.config) || {});
  }

  // Normalize options.doubleDuty (array of ids OR { id: 2 } map) to a Set of ids.
  function doubleDutyIdSet(doubleDuty) {
    if (!doubleDuty) return new Set();
    if (Array.isArray(doubleDuty)) return new Set(doubleDuty);
    return new Set(Object.keys(doubleDuty).filter((id) => doubleDuty[id]));
  }

  // Normalize options.preAssigned (array of ids OR { day: id } map) to a Set of ids.
  function preAssignedIdSet(preAssigned) {
    if (!preAssigned) return new Set();
    if (Array.isArray(preAssigned)) return new Set(preAssigned);
    return new Set(Object.values(preAssigned));
  }

  // Seedable PRNG (mulberry32). Deterministic for a given seed so that a locked
  // draft order is reproducible and auditable. Returns floats in [0, 1).
  function makeRng(seed) {
    let a = hashSeed(seed) >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashSeed(seed) {
    if (typeof seed === 'number' && isFinite(seed)) return Math.floor(seed) || 1;
    const str = String(seed == null ? '' : seed);
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) || 1;
  }

  function marineName(m) {
    if (!m) return '';
    const first = m.firstName ? ' ' + m.firstName : '';
    return (m.rank ? m.rank + ' ' : '') + (m.lastName || m.id) + first;
  }

  // Per-month weekend point value for COA 1 (recency-weighted). If the month
  // record carries an explicit weekendPoints, use it (transparent + overridable);
  // otherwise derive it from config by the month's recency rank (0 = newest).
  function weekendPointsForMonth(month, monthsOldestFirst, config) {
    if (typeof month.weekendPoints === 'number') return month.weekendPoints;
    const recencyIndex = monthsOldestFirst.length - 1 - monthsOldestFirst.indexOf(month);
    const table = config.weekendPointsByRecency;
    return table[Math.min(recencyIndex, table.length - 1)] || 0;
  }

  // ── Burden inputs ───────────────────────────────────────────────────────────
  // Translate the raw 3-month history into the numbers each COA consumes. Kept
  // separate from ordering so the weekend-burden accounting is independent of
  // draft-order generation (a Maj-Morris requirement: burden is tracked equally;
  // rank/seniority must not influence weekend obligation).
  function calculateBurdenInputs(marineId, history, config) {
    config = config || DEFAULT_CONFIG;
    const months = (history && history.months) || [];
    const weekend = (history && history.weekend && history.weekend[marineId]) || {};
    const dd = (history && history.doubleDuty && history.doubleDuty[marineId]) || {};

    let weekendCount = 0;          // total starred weekends in the window (equal-weight)
    let weekendPointsCOA1 = 0;     // recency-weighted weekend points (COA 1)
    const weekendByMonth = {};
    months.forEach((mo) => {
      const c = Number(weekend[mo.key] || 0);
      weekendByMonth[mo.key] = c;
      weekendCount += c;
      weekendPointsCOA1 += c * weekendPointsForMonth(mo, months, config);
    });

    const doubleDutyMonths = months.filter((mo) => dd[mo.key]).map((mo) => mo.key); // full window (history/audit)
    const ddMonthCount = doubleDutyMonths.length;

    // Only double-duty months inside the lookback window (the most-recent N months
    // of the window) count toward the score. With the default lookback of 1, this is
    // just the month immediately before the draft — older double duty no longer moves
    // the score (only weekends do).
    const lookback = config.doubleDutyLookbackMonths == null ? 1 : config.doubleDutyLookbackMonths;
    const recentKeys = new Set(months.slice(Math.max(0, months.length - lookback)).map((mo) => mo.key));
    const scoringDoubleDutyMonths = doubleDutyMonths.filter((k) => recentKeys.has(k));
    const recentDoubleDutyCount = scoringDoubleDutyMonths.length;

    return {
      weekendCount,
      weekendByMonth,
      weekendPointsCOA1: round2(weekendPointsCOA1),
      doubleDutyMonths,            // every double-duty month in the window (for the record)
      scoringDoubleDutyMonths,     // the ones inside the lookback window that actually score
      ddMonthCount,                // full-window count (visibility)
      recentDoubleDutyCount,       // lookback-window count (drives the score)
      // Pre-multiplied values the COAs add directly:
      doubleDutyPointsCOA1: recentDoubleDutyCount * config.doubleDutyPointValue,
      weekendTickets: weekendCount * config.weekendTicketValue,
      doubleDutyTickets: recentDoubleDutyCount * config.doubleDutyTicketValue,
    };
  }

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  // ── Pool construction ────────────────────────────────────────────────────────
  // Split the roster into the locked double-duty priority Marines and the
  // remaining pool that every COA orders. Pre-assigned Marines are excluded from
  // the draft entirely (they already have a duty day), matching existing behavior.
  function partitionRoster(roster, options) {
    const ddSet = doubleDutyIdSet(options && options.doubleDuty);
    const preSet = preAssignedIdSet(options && options.preAssigned);

    const eligible = roster.filter((m) => !preSet.has(m.id));
    // Double-duty priority Marines, ordered most-senior-first among themselves
    // (their order within the roster is already seniority order).
    const priority = eligible.filter((m) => ddSet.has(m.id));
    const pool = eligible.filter((m) => !ddSet.has(m.id));

    // Absolute base seniority score: most senior gets roster.length, down to 1.
    const baseScoreById = {};
    roster.forEach((m, i) => { baseScoreById[m.id] = roster.length - i; });

    return { priority, pool, baseScoreById, preSet, ddSet };
  }

  // ── COA 1 — Weighted Seniority ───────────────────────────────────────────────
  // Seniority dominates; recent burden nudges a Marine modestly; a hard ±cap on
  // positional movement prevents chaos. Returns ordered Marines + per-Marine
  // audit rows. `rng` is shared so the single random draw is locked with the order.
  function generateWeightedSeniorityOrder(pool, ctx) {
    const { history, config, rng, baseScoreById } = ctx;

    // Score each Marine. seniorityPos = index within THIS pool (after double-duty
    // removal) — the movement cap is measured against this remaining position.
    const scored = pool.map((m, seniorityPos) => {
      const burden = calculateBurdenInputs(m.id, history, config);
      const base = baseScoreById[m.id];
      const random = round2((rng() * 2 - 1) * config.randomRange); // [-range, +range]
      const finalScore = round2(
        base + burden.weekendPointsCOA1 + burden.doubleDutyPointsCOA1 + random
      );
      return {
        marine: m,
        seniorityPos,
        base,
        weekendPoints: burden.weekendPointsCOA1,
        doubleDutyPoints: burden.doubleDutyPointsCOA1,
        random,
        finalScore,
        burden,
      };
    });

    // Uncapped order: highest final score first; ties broken by seniority (stable).
    const uncapped = scored.slice().sort((a, b) => {
      if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
      return a.seniorityPos - b.seniorityPos;
    });
    uncapped.forEach((row, i) => { row.uncappedOrder = i; });

    // Apply the ±cap movement constraint against remaining pure-seniority position.
    const capped = applyMovementCap(scored, uncapped, config.movementCap);
    capped.forEach((row, i) => { row.cappedOrder = i; });

    return capped;
  }

  // Slot-filling placement that honors score preference while guaranteeing no
  // Marine ends up more than `cap` positions from their pure-seniority position.
  //
  // Each Marine m may occupy slots [seniorityPos-cap, seniorityPos+cap]. We fill
  // slots left to right. If some Marine's last allowable slot (seniorityPos+cap)
  // is exactly this slot, they are FORCED in (otherwise the cap would break).
  // Positions are distinct, so at most one Marine is forced per slot. Otherwise
  // we place the highest-scoring still-eligible Marine. The identity (seniority)
  // placement is always a feasible completion, so a Marine is always available.
  function applyMovementCap(scored, scoreOrder, cap) {
    const n = scored.length;
    const prefRank = new Map();           // marine -> position in score order (lower = better)
    scoreOrder.forEach((row, i) => prefRank.set(row, i));

    const placed = new Array(n).fill(null);
    const used = new Set();
    const remaining = scored.slice();

    for (let slot = 0; slot < n; slot++) {
      // Forced: a Marine whose upper bound is exactly this slot.
      let pick = remaining.find((r) => !used.has(r) && r.seniorityPos + cap === slot);
      if (!pick) {
        const eligible = remaining.filter(
          (r) => !used.has(r) &&
            r.seniorityPos - cap <= slot &&
            slot <= r.seniorityPos + cap
        );
        // Highest score first (smallest preference rank).
        eligible.sort((a, b) => prefRank.get(a) - prefRank.get(b));
        pick = eligible[0];
      }
      // Defensive fallback (should never trigger given feasibility proof above):
      if (!pick) pick = remaining.find((r) => !used.has(r));
      placed[slot] = pick;
      used.add(pick);
    }
    return placed;
  }

  // ── COA 2 — Weighted Lottery ─────────────────────────────────────────────────
  // Every Marine can move; seniority + burden raise the odds. Tickets are NOT
  // recency-weighted (each weekend counts equally) — keeping the lottery simple
  // and explainable. Draw WITHOUT replacement: once drawn, a Marine's tickets are
  // removed and the next position is drawn from the rest. `count` limits how many
  // positions are drawn (COA 3 draws only the top 5); omit to draw the whole pool.
  function generateWeightedLotteryOrder(pool, ctx, count) {
    const { history, config, rng, baseScoreById } = ctx;
    const limit = (count == null) ? pool.length : Math.min(count, pool.length);

    const ticketRows = pool.map((m) => {
      const burden = calculateBurdenInputs(m.id, history, config);
      const base = baseScoreById[m.id];
      const tickets = base + burden.weekendTickets + burden.doubleDutyTickets;
      return {
        marine: m,
        base,
        weekendTickets: burden.weekendTickets,
        doubleDutyTickets: burden.doubleDutyTickets,
        tickets,
        burden,
      };
    });

    const remaining = ticketRows.slice();
    const drawn = [];
    for (let i = 0; i < limit && remaining.length; i++) {
      const total = remaining.reduce((s, r) => s + r.tickets, 0);
      let r = rng() * total;
      let idx = remaining.length - 1; // guard against FP rounding on the last bucket
      for (let j = 0; j < remaining.length; j++) {
        r -= remaining[j].tickets;
        if (r < 0) { idx = j; break; }
      }
      const row = remaining.splice(idx, 1)[0];
      row.drawPosition = drawn.length;
      row.totalTicketsAtDraw = total;
      drawn.push(row);
    }

    // `drawn` are the ordered picks; `remaining` are everyone not drawn (used by COA 3).
    return { drawn, remaining: remaining.map((r) => r.marine), drawnRows: drawn, ticketRows };
  }

  // ── COA 3 — Hybrid ───────────────────────────────────────────────────────────
  // Visible opportunity near the top, structure for the rest: lottery for exactly
  // the next `hybridLotterySlots` positions, weighted seniority for the remainder.
  function generateHybridOrder(pool, ctx) {
    const slots = ctx.config.hybridLotterySlots;
    const lottery = generateWeightedLotteryOrder(pool, ctx, slots);
    const lotteryMarines = lottery.drawn.map((r) => r.marine);
    const remainderPool = lottery.remaining; // already in seniority order (pool order preserved)
    const remainderRows = generateWeightedSeniorityOrder(remainderPool, ctx);
    return {
      lotteryRows: lottery.drawn,
      lotteryMarines,
      remainderRows,
      remainderMarines: remainderRows.map((r) => r.marine),
    };
  }

  // ── Double-duty priority ─────────────────────────────────────────────────────
  // Build the locked front of the order: each current-month double-duty Marine,
  // most-senior-first, with BOTH of their picks (turn 1 and turn 2).
  function applyCurrentMonthDoubleDutyPriority(priority) {
    const order = [];
    priority.forEach((m) => {
      order.push({ id: m.id, turn: 1 });
      order.push({ id: m.id, turn: 2 });
    });
    return order;
  }

  // ── Pure seniority ───────────────────────────────────────────────────────────
  function generatePureSeniorityOrder(pool) {
    return pool.map((m) => ({ id: m.id, turn: 1 }));
  }

  // ── Audit ────────────────────────────────────────────────────────────────────
  // The permanent, explainable record of how an order was produced. Stored with
  // the draft/month so leadership can later reconstruct exactly why it came out
  // the way it did.
  function buildDraftOrderAuditBreakdown(args) {
    const {
      mode, roster, history, priority, order, marineRows, seed, options, config,
    } = args;
    const byId = {};
    roster.forEach((m) => { byId[m.id] = m; });

    return {
      mode,
      draftOrderMode: mode,
      generatedAt: ((options && options.now) || new Date()).toISOString(),
      generatedBy: (options && options.generatedBy) || null,
      month: options && options.month != null ? options.month : null,
      year: options && options.year != null ? options.year : null,
      fairnessStatement: FAIRNESS_STATEMENT,
      modeExplanation: MODE_EXPLANATIONS[mode] || '',
      burdenWindow: (history && history.months ? history.months : []).map((mo) => ({
        key: mo.key, label: mo.label || mo.key,
        weekendPoints: typeof mo.weekendPoints === 'number' ? mo.weekendPoints : null,
      })),
      config: {
        movementCap: config.movementCap,
        weekendPointsByRecency: config.weekendPointsByRecency.slice(),
        doubleDutyPointValue: config.doubleDutyPointValue,
        doubleDutyLookbackMonths: config.doubleDutyLookbackMonths,
        randomRange: config.randomRange,
        weekendTicketValue: config.weekendTicketValue,
        doubleDutyTicketValue: config.doubleDutyTicketValue,
        hybridLotterySlots: config.hybridLotterySlots,
      },
      randomSeed: seed,
      currentMonthDoubleDuty: priority.map((m, i) => ({
        id: m.id, name: marineName(m), pickSlots: [i * 2 + 1, i * 2 + 2],
      })),
      // Final pick numbers are 1-based positions in `order` (double-duty Marines
      // appear twice). pickNumbers lists every slot a Marine occupies.
      order: order.map((e, i) => ({ pick: i + 1, id: e.id, turn: e.turn, name: marineName(byId[e.id]) })),
      marines: marineRows,   // per-Marine calculation rows (shape depends on mode)
      locked: false,
      lockedAt: null,
    };
  }

  // ── Top-level entry point ────────────────────────────────────────────────────
  function generateDraftOrder(mode, roster, history, options) {
    options = options || {};
    mode = mode || DEFAULT_MODE;
    if (ALL_MODES.indexOf(mode) === -1) {
      throw new Error('Unknown draftOrderMode: ' + mode);
    }
    if (!Array.isArray(roster)) throw new Error('roster must be an array');

    const config = cfg(options);
    const seed = (options.seed != null) ? options.seed : Date.now();
    const rng = makeRng(seed);

    const { priority, pool, baseScoreById } = partitionRoster(roster, options);
    const ctx = { history: history || { months: [], weekend: {}, doubleDuty: {} }, config, rng, baseScoreById };

    // Locked front: double-duty priority Marines (both turns each).
    const frontOrder = applyCurrentMonthDoubleDutyPriority(priority);

    let restOrder = [];
    let marineRows = [];

    if (mode === MODES.PURE_SENIORITY) {
      restOrder = generatePureSeniorityOrder(pool);
      marineRows = pool.map((m, i) => ({
        id: m.id, name: marineName(m), source: 'seniority',
        seniorityPos: i, finalPick: frontOrder.length + i + 1,
      }));

    } else if (mode === MODES.WEIGHTED_SENIORITY) {
      const rows = generateWeightedSeniorityOrder(pool, ctx);
      restOrder = rows.map((r) => ({ id: r.marine.id, turn: 1 }));
      marineRows = rows.map((r) => weightedSeniorityAuditRow(r, frontOrder.length));

    } else if (mode === MODES.WEIGHTED_LOTTERY) {
      const lottery = generateWeightedLotteryOrder(pool, ctx);
      restOrder = lottery.drawn.map((r) => ({ id: r.marine.id, turn: 1 }));
      marineRows = lottery.drawn.map((r) => lotteryAuditRow(r, frontOrder.length, 'lottery'));

    } else if (mode === MODES.HYBRID) {
      const hybrid = generateHybridOrder(pool, ctx);
      restOrder = hybrid.lotteryMarines.map((m) => ({ id: m.id, turn: 1 }))
        .concat(hybrid.remainderMarines.map((m) => ({ id: m.id, turn: 1 })));
      const lotteryRows = hybrid.lotteryRows.map((r) => lotteryAuditRow(r, frontOrder.length, 'lottery'));
      const offset = frontOrder.length + hybrid.lotteryMarines.length;
      const remainderRows = hybrid.remainderRows.map((r) => {
        const row = weightedSeniorityAuditRow(r, offset);
        row.source = 'weighted-seniority';
        return row;
      });
      marineRows = lotteryRows.concat(remainderRows);
    }

    const order = frontOrder.concat(restOrder);
    const audit = buildDraftOrderAuditBreakdown({
      mode, roster, history: ctx.history, priority, order, marineRows, seed, options, config,
    });

    return { order, audit };
  }

  function weightedSeniorityAuditRow(r, pickOffset) {
    return {
      id: r.marine.id,
      name: marineName(r.marine),
      source: 'weighted-seniority',
      seniorityPos: r.seniorityPos,
      base: r.base,
      weekendPoints: r.weekendPoints,
      doubleDutyPoints: r.doubleDutyPoints,
      doubleDutyMonths: r.burden ? r.burden.doubleDutyMonths : [],
      scoringDoubleDutyMonths: r.burden ? r.burden.scoringDoubleDutyMonths : [],
      random: r.random,
      uncappedScore: r.finalScore,
      uncappedOrder: r.uncappedOrder,
      cappedOrder: r.cappedOrder,
      finalPick: pickOffset + r.cappedOrder + 1,
    };
  }

  function lotteryAuditRow(r, pickOffset, source) {
    return {
      id: r.marine.id,
      name: marineName(r.marine),
      source: source,
      base: r.base,
      weekendTickets: r.weekendTickets,
      doubleDutyTickets: r.doubleDutyTickets,
      tickets: r.tickets,
      totalTicketsAtDraw: r.totalTicketsAtDraw,
      drawPosition: r.drawPosition,
      finalPick: pickOffset + r.drawPosition + 1,
    };
  }

  // ── Equal weekend distribution ───────────────────────────────────────────────
  // Replaces the old rank-quota weekend split (E1–E5 60% / E6 25% / E7 15%).
  // Weekend burden is now distributed EQUALLY across the whole company: the
  // Marines with the least weekend burden so far are assigned first, regardless
  // of rank. Rank/seniority no longer influences weekend obligation.
  //
  // weekendHistory: { [marineId]: count } OR an array of marineIds (one entry per
  // past weekend duty). Returns the selected Marines (length = min(wkCount, n)).
  function computeWeekendAssignees(marines, wkCount, weekendHistory) {
    if (!wkCount || !marines.length) return [];
    const counts = Object.assign({}, normalizeWeekendHistory(weekendHistory));
    // New-arrival fairness: a Marine with no weekend history would otherwise sort
    // first forever (count 0) and get hammered with weekends after joining the
    // unit mid-stream (turnover/promotions). Seed any no-history Marine in the
    // current roster at the MEDIAN weekend count of the Marines who DO have
    // history, so newcomers slot into the middle of the rotation, not the front.
    // (At the very first draft everyone has 0 history -> no seeding -> unchanged.)
    const histVals = marines.map((m) => counts[m.id] || 0).filter((c) => c > 0).sort((a, b) => a - b);
    if (histVals.length) {
      const mid = Math.floor(histVals.length / 2);
      const median = histVals.length % 2 ? histVals[mid] : (histVals[mid - 1] + histVals[mid]) / 2;
      marines.forEach((m) => { if (!(counts[m.id] > 0)) counts[m.id] = median; });
    }
    const lastIndex = {};
    if (Array.isArray(weekendHistory)) {
      weekendHistory.forEach((id, i) => { lastIndex[id] = i; });
    }
    const ranked = marines
      .map((m, i) => ({ m, i }))
      .sort((a, b) => {
        const ca = counts[a.m.id] || 0;
        const cb = counts[b.m.id] || 0;
        if (ca !== cb) return ca - cb;                  // fewest weekends first
        const la = lastIndex[a.m.id] == null ? -1 : lastIndex[a.m.id];
        const lb = lastIndex[b.m.id] == null ? -1 : lastIndex[b.m.id];
        if (la !== lb) return la - lb;                  // longest-ago first
        return a.i - b.i;                               // stable; NOT rank-based
      });
    return ranked.slice(0, Math.min(wkCount, marines.length)).map((x) => x.m);
  }

  function normalizeWeekendHistory(weekendHistory) {
    if (!weekendHistory) return {};
    if (Array.isArray(weekendHistory)) {
      const counts = {};
      weekendHistory.forEach((id) => { counts[id] = (counts[id] || 0) + 1; });
      return counts;
    }
    return weekendHistory;
  }

  // ── Locking (used by the workflow in pass 2; testable now) ────────────────────
  function lockDraftOrder(audit, lockedBy) {
    return Object.assign({}, audit, {
      locked: true,
      lockedAt: new Date().toISOString(),
      lockedBy: lockedBy || (audit && audit.generatedBy) || null,
    });
  }
  // The SNCOIC must not casually reroll. Once locked, regeneration is refused.
  function canRegenerate(audit) {
    return !(audit && audit.locked);
  }
  function assertRegenerationAllowed(audit) {
    if (!canRegenerate(audit)) {
      throw new Error('Draft order is locked and cannot be regenerated. Reset is required first.');
    }
  }
  // The draft cannot start until the order is locked.
  function canStartDraft(audit) {
    return !!(audit && audit.locked);
  }

  return {
    MODES,
    ALL_MODES,
    DEFAULT_MODE,
    DEFAULT_CONFIG,
    FAIRNESS_STATEMENT,
    MODE_EXPLANATIONS,
    // primary API
    generateDraftOrder,
    // building blocks (exported for testing + reuse)
    applyCurrentMonthDoubleDutyPriority,
    generatePureSeniorityOrder,
    generateWeightedSeniorityOrder,
    generateWeightedLotteryOrder,
    generateHybridOrder,
    calculateBurdenInputs,
    buildDraftOrderAuditBreakdown,
    applyMovementCap,
    partitionRoster,
    computeWeekendAssignees,
    makeRng,
    // locking / workflow guards
    lockDraftOrder,
    canRegenerate,
    assertRegenerationAllowed,
    canStartDraft,
  };
});
