// Tests for the DutyDraft draft-order engine. Uses the April/May/June 2026
// burden fixture and the real 29-Marine seniority roster. Current-month (July)
// double duty: #1 Sakamoto (r28), #2 McBride (r29).

const engine = require('../draft-order-engine');
const fx = require('../scripts/data/burden-2026-q2');

const { MODES } = engine;
const ROSTER = fx.ROSTER;
const HISTORY = fx.buildHistory();
const DD = fx.CURRENT_MONTH_DOUBLE_DUTY; // ['r28','r29']
const SEED = 'test-seed-2026-07';

function gen(mode, extra) {
  return engine.generateDraftOrder(mode, ROSTER, HISTORY, Object.assign(
    { doubleDuty: DD, seed: SEED, month: 6, year: 2026, generatedBy: 'master' },
    extra || {}
  ));
}

const POOL_IDS = ROSTER.map((m) => m.id).filter((id) => DD.indexOf(id) === -1); // r01..r27

describe('current-month double-duty priority (CORE RULE — all modes)', () => {
  // Requirement 1
  test.each(engine.ALL_MODES)('%s: double-duty Marines occupy the first slots, both turns', (mode) => {
    const { order, audit } = gen(mode);
    // Positions #1–#4: Sakamoto turn1, Sakamoto turn2, McBride turn1, McBride turn2.
    expect(order.slice(0, 4)).toEqual([
      { id: 'r28', turn: 1 },
      { id: 'r28', turn: 2 },
      { id: 'r29', turn: 1 },
      { id: 'r29', turn: 2 },
    ]);
    expect(audit.currentMonthDoubleDuty.map((d) => d.id)).toEqual(['r28', 'r29']);
    // Double-duty Marines are not re-listed in the scored remainder rows.
    expect(audit.marines.some((r) => r.id === 'r28' || r.id === 'r29')).toBe(false);
  });

  test('most-senior double-duty Marine picks first among the priority block', () => {
    // Pass them in reverse to prove ordering is by seniority, not input order.
    const { order } = gen(MODES.PURE_SENIORITY, { doubleDuty: ['r29', 'r28'] });
    expect(order[0].id).toBe('r28'); // Sakamoto (more senior) still #1
    expect(order[2].id).toBe('r29');
  });
});

describe('pure_seniority mode', () => {
  // Requirement 2
  test('preserves seniority order after the double-duty priority block', () => {
    const { order } = gen(MODES.PURE_SENIORITY);
    const rest = order.slice(4);
    expect(rest).toEqual(POOL_IDS.map((id) => ({ id, turn: 1 })));
  });

  test('no randomness: identical output regardless of seed', () => {
    const a = gen(MODES.PURE_SENIORITY, { seed: 'A' }).order;
    const b = gen(MODES.PURE_SENIORITY, { seed: 'B' }).order;
    expect(a).toEqual(b);
  });
});

describe('COA 1 — weighted_seniority', () => {
  // Requirement 3
  test('applies burden scoring and records the full audit breakdown', () => {
    const { audit } = gen(MODES.WEIGHTED_SENIORITY);
    const rows = audit.marines;
    expect(rows).toHaveLength(27);
    rows.forEach((r) => {
      ['base', 'weekendPoints', 'doubleDutyPoints', 'random', 'uncappedScore',
       'uncappedOrder', 'cappedOrder', 'finalPick'].forEach((k) => {
        expect(r[k]).toBeDefined();
      });
      expect(r.source).toBe('weighted-seniority');
    });

    // Campa (r19) carries the most weekend burden and must move EARLIER than pure seniority.
    const campa = rows.find((r) => r.id === 'r19');
    expect(campa.base).toBe(11);            // 29 - 18
    expect(campa.weekendPoints).toBe(10);   // Apr 1.65 + May 3.35 + Jun 5.00
    expect(campa.doubleDutyPoints).toBe(0); // May double duty is >1 month before July — no longer scores
    expect(campa.cappedOrder).toBeLessThan(campa.seniorityPos);

    // Hallam (r17) stood double duty in June — the month right before the July draft — so it scores.
    const hallam = rows.find((r) => r.id === 'r17');
    expect(hallam.doubleDutyPoints).toBe(5);

    // A zero-burden senior Marine should not be leapfrogged out of the cap by burden.
    const random = rows.find((r) => r.id === 'r07'); // Weiland, base 23, no burden
    expect(random.weekendPoints).toBe(0);
    expect(random.doubleDutyPoints).toBe(0);
  });

  // Requirement 4
  test('never moves a Marine more than ±8 positions from remaining pure seniority', () => {
    // Check across many seeds so the cap holds for any locked random draw.
    for (let i = 0; i < 50; i++) {
      const { audit } = gen(MODES.WEIGHTED_SENIORITY, { seed: 'cap-' + i });
      audit.marines.forEach((r) => {
        expect(Math.abs(r.cappedOrder - r.seniorityPos)).toBeLessThanOrEqual(8);
      });
      // capped order is a valid permutation of the 27-pool positions
      const positions = audit.marines.map((r) => r.cappedOrder).sort((a, b) => a - b);
      expect(positions).toEqual(POOL_IDS.map((_, idx) => idx));
    }
  });

  test('random adjustment is within ±randomRange and locked with the seed', () => {
    const a = gen(MODES.WEIGHTED_SENIORITY, { seed: 'X' });
    const b = gen(MODES.WEIGHTED_SENIORITY, { seed: 'X' });
    expect(a.order).toEqual(b.order); // reproducible
    a.audit.marines.forEach((r) => {
      expect(r.random).toBeGreaterThanOrEqual(-1);
      expect(r.random).toBeLessThanOrEqual(1);
    });
    expect(a.audit.randomSeed).toBe('X');
  });
});

describe('COA 2 — weighted_lottery', () => {
  // Requirement 5
  test('produces a complete order with no duplicate Marines', () => {
    const { order, audit } = gen(MODES.WEIGHTED_LOTTERY);
    expect(order).toHaveLength(31); // 4 double-duty slots + 27 single picks
    const poolIds = order.slice(4).map((e) => e.id);
    expect(new Set(poolIds).size).toBe(27);
    expect(poolIds.slice().sort()).toEqual(POOL_IDS.slice().sort());
    audit.marines.forEach((r) => {
      ['base', 'weekendTickets', 'doubleDutyTickets', 'tickets', 'drawPosition'].forEach((k) => {
        expect(r[k]).toBeDefined();
      });
    });
  });

  // Requirement 6
  test('removes a Marine (all their tickets) from the pool after each draw', () => {
    const part = engine.partitionRoster(ROSTER, { doubleDuty: DD });
    const rng = engine.makeRng(SEED);
    const ctx = { history: HISTORY, config: engine.DEFAULT_CONFIG, rng,
      baseScoreById: part.baseScoreById };
    const result = engine.generateWeightedLotteryOrder(part.pool, ctx);

    expect(result.drawn).toHaveLength(27);
    expect(result.remaining).toHaveLength(0);
    const ids = result.drawn.map((r) => r.marine.id);
    expect(new Set(ids).size).toBe(27); // no Marine drawn twice

    // Total ticket pool strictly shrinks each draw -> tickets were removed.
    for (let i = 1; i < result.drawn.length; i++) {
      expect(result.drawn[i].totalTicketsAtDraw)
        .toBeLessThan(result.drawn[i - 1].totalTicketsAtDraw);
    }
  });

  test('tickets reflect base seniority + equal weekend + double-duty (no recency)', () => {
    const c = engine.DEFAULT_CONFIG;
    // Campa r19: base 11, weekends 3 (=15 tickets); May double duty is outside the
    // 1-month lookback, so it adds 0 double-duty tickets.
    const campa = engine.calculateBurdenInputs('r19', HISTORY, c);
    expect(campa.weekendCount).toBe(3);
    expect(campa.weekendTickets).toBe(15);
    expect(campa.doubleDutyTickets).toBe(0);
    // Hallam r17: June double duty is inside the lookback -> 5 double-duty tickets.
    const hallam = engine.calculateBurdenInputs('r17', HISTORY, c);
    expect(hallam.doubleDutyTickets).toBe(5);
  });
});

describe('COA 3 — hybrid', () => {
  // Requirement 7
  test('uses the lottery for exactly five slots after double-duty priority', () => {
    const { order, audit } = gen(MODES.HYBRID);
    const lottery = audit.marines.filter((r) => r.source === 'lottery');
    expect(lottery).toHaveLength(5);
    // Those five are draft positions #5–#9 (right after the 4 double-duty slots).
    expect(lottery.map((r) => r.finalPick).sort((a, b) => a - b)).toEqual([5, 6, 7, 8, 9]);
    const lotteryIds = lottery.map((r) => r.id);
    expect(order.slice(4, 9).map((e) => e.id)).toEqual(lotteryIds);
  });

  // Requirement 8
  test('orders all remaining Marines with weighted seniority', () => {
    const { audit } = gen(MODES.HYBRID);
    const remainder = audit.marines.filter((r) => r.source === 'weighted-seniority');
    expect(remainder).toHaveLength(22); // 27 pool - 5 lottery
    remainder.forEach((r) => {
      expect(r.uncappedOrder).toBeDefined();
      expect(r.cappedOrder).toBeDefined();
    });
    // Lottery picks are excluded from the weighted-seniority remainder.
    const lotteryIds = new Set(audit.marines.filter((r) => r.source === 'lottery').map((r) => r.id));
    remainder.forEach((r) => expect(lotteryIds.has(r.id)).toBe(false));
    // Every pool Marine is accounted for exactly once across the two groups.
    const all = audit.marines.map((r) => r.id).sort();
    expect(all).toEqual(POOL_IDS.slice().sort());
  });

  test('movement cap still holds within the weighted-seniority remainder', () => {
    const { audit } = gen(MODES.HYBRID);
    audit.marines.filter((r) => r.source === 'weighted-seniority').forEach((r) => {
      expect(Math.abs(r.cappedOrder - r.seniorityPos)).toBeLessThanOrEqual(8);
    });
  });
});

describe('weekend distribution — equal, not rank-quota (Requirement 9)', () => {
  test('engine no longer encodes the 60/25/15 rank quotas', () => {
    const src = require('fs').readFileSync(require.resolve('../draft-order-engine'), 'utf8');
    expect(src).not.toMatch(/0\.60|0\.25|0\.15/);
    expect(engine).not.toHaveProperty('GROUP_QUOTA');
  });

  test('assigns by least weekend burden across the whole company, regardless of rank', () => {
    const marines = [
      { id: 'g1', rank: 'GYSGT' }, { id: 'g2', rank: 'GYSGT' },
      { id: 's1', rank: 'SSGT' },
      { id: 'j1', rank: 'LCPL' }, { id: 'j2', rank: 'LCPL' }, { id: 'j3', rank: 'LCPL' },
    ];
    // Junior Marines are heavily burdened; the GYSGTs have none.
    const history = { g1: 0, g2: 0, s1: 5, j1: 4, j2: 4, j3: 4 };
    // Old quota logic (gysgt 15% of 2 -> 0) would NEVER pick a GYSGT. Equal logic does.
    const picked = engine.computeWeekendAssignees(marines, 2, history).map((m) => m.id);
    expect(picked.sort()).toEqual(['g1', 'g2']);
  });

  test('the fairness statement reflects equal weekend burden', () => {
    expect(engine.FAIRNESS_STATEMENT).toBe(
      'Weekend burden is tracked equally across all Marines. ' +
      'Seniority affects draft order, not weekend obligation.'
    );
  });
});

describe('burden math (recency window)', () => {
  test('explicit per-month weekend points are used (June > May > April)', () => {
    // Hallam r17: May weekend (3.35) + June double-duty month (scores 5).
    const h = engine.calculateBurdenInputs('r17', HISTORY, engine.DEFAULT_CONFIG);
    expect(h.weekendPointsCOA1).toBe(3.35);
    expect(h.doubleDutyPointsCOA1).toBe(5);
    // Rosie r18: two May weekends (2 * 3.35 = 6.70). She did stand May double duty,
    // but May is >1 month before the draft so it no longer scores.
    const r = engine.calculateBurdenInputs('r18', HISTORY, engine.DEFAULT_CONFIG);
    expect(r.weekendPointsCOA1).toBe(6.7);
    expect(r.ddMonthCount).toBe(1);            // recorded in the window
    expect(r.recentDoubleDutyCount).toBe(0);   // but outside the lookback
    expect(r.doubleDutyPointsCOA1).toBe(0);    // so it scores nothing
  });

  test('falls back to config recency weights when a month omits weekendPoints', () => {
    const history = {
      months: [
        { key: '2026-04', label: 'April' },   // oldest -> 1.65
        { key: '2026-05', label: 'May' },     // middle -> 3.35
        { key: '2026-06', label: 'June' },    // newest -> 5.00
      ],
      weekend: { x: { '2026-04': 1, '2026-05': 1, '2026-06': 1 } },
      doubleDuty: {},
    };
    const h = engine.calculateBurdenInputs('x', history, engine.DEFAULT_CONFIG);
    expect(h.weekendPointsCOA1).toBe(10); // 1.65 + 3.35 + 5.00
  });
});

describe('double-duty lookback (only the month before the draft scores)', () => {
  test('June double duty scores +5; May/April double duty score nothing', () => {
    const hallam = engine.calculateBurdenInputs('r17', HISTORY, engine.DEFAULT_CONFIG); // June DD
    const campa = engine.calculateBurdenInputs('r19', HISTORY, engine.DEFAULT_CONFIG);  // May DD
    expect(hallam.scoringDoubleDutyMonths).toEqual(['2026-06']);
    expect(hallam.doubleDutyPointsCOA1).toBe(5);
    expect(campa.doubleDutyMonths).toEqual(['2026-05']);   // still recorded for the audit
    expect(campa.scoringDoubleDutyMonths).toEqual([]);     // but excluded from scoring
    expect(campa.doubleDutyPointsCOA1).toBe(0);
  });

  test('the month OF double duty is the front-of-roster priority, not a score bump', () => {
    // Sakamoto/McBride stand double duty IN July (the draft month) -> picks #1-#4.
    const { order, audit } = gen(MODES.WEIGHTED_SENIORITY);
    expect(order.slice(0, 4).map((e) => e.id)).toEqual(['r28', 'r28', 'r29', 'r29']);
    expect(audit.marines.some((r) => r.id === 'r28' || r.id === 'r29')).toBe(false);
  });

  test('lookback is configurable (3 months counts all double duty in the window)', () => {
    const cfg3 = Object.assign({}, engine.DEFAULT_CONFIG, { doubleDutyLookbackMonths: 3 });
    const campa = engine.calculateBurdenInputs('r19', HISTORY, cfg3); // May DD now in range
    expect(campa.doubleDutyPointsCOA1).toBe(5);
  });
});

describe('audit record completeness', () => {
  test('captures everything leadership needs to explain the order', () => {
    const { audit } = gen(MODES.WEIGHTED_SENIORITY);
    expect(audit.draftOrderMode).toBe(MODES.WEIGHTED_SENIORITY);
    expect(audit.generatedBy).toBe('master');
    expect(audit.month).toBe(6);
    expect(audit.year).toBe(2026);
    expect(audit.randomSeed).toBe(SEED);
    expect(audit.locked).toBe(false);
    expect(audit.burdenWindow.map((m) => m.key)).toEqual(['2026-04', '2026-05', '2026-06']);
    expect(audit.currentMonthDoubleDuty).toHaveLength(2);
    expect(audit.order).toHaveLength(31);
    expect(typeof audit.generatedAt).toBe('string');
    expect(audit.modeExplanation).toMatch(/seniority/i);
  });
});

describe('locking + workflow guards', () => {
  // Requirement 10
  test('a locked draft order cannot be casually regenerated', () => {
    const { audit } = gen(MODES.WEIGHTED_SENIORITY);
    expect(engine.canRegenerate(audit)).toBe(true);
    const locked = engine.lockDraftOrder(audit, 'sncoic');
    expect(locked.locked).toBe(true);
    expect(locked.lockedBy).toBe('sncoic');
    expect(typeof locked.lockedAt).toBe('string');
    expect(engine.canRegenerate(locked)).toBe(false);
    expect(() => engine.assertRegenerationAllowed(locked)).toThrow(/locked/i);
  });

  // Requirement 11
  test('the draft cannot start until the order is locked', () => {
    const { audit } = gen(MODES.WEIGHTED_SENIORITY);
    expect(engine.canStartDraft(audit)).toBe(false);
    const locked = engine.lockDraftOrder(audit);
    expect(engine.canStartDraft(locked)).toBe(true);
  });
});

describe('determinism + validation', () => {
  test('same seed -> identical order for every mode', () => {
    engine.ALL_MODES.forEach((mode) => {
      expect(gen(mode, { seed: 'D' }).order).toEqual(gen(mode, { seed: 'D' }).order);
    });
  });

  test('rejects unknown modes', () => {
    expect(() => engine.generateDraftOrder('bogus', ROSTER, HISTORY, {})).toThrow(/Unknown/);
  });

  test('excludes pre-assigned Marines from the draft', () => {
    const { order } = gen(MODES.PURE_SENIORITY, { preAssigned: { 5: 'r10' } });
    const ids = order.map((e) => e.id);
    expect(ids).not.toContain('r10');
    expect(new Set(ids).size).toBe(28); // 29 roster - 1 pre-assigned
  });
});
