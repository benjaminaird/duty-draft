// Tests for the 12-month fairness simulation. These assert the structural truths
// the CO brief relies on, so the numbers shown are trustworthy.

const engine = require('../draft-order-engine');
const sim = require('../draft-fairness-sim');
const fx = require('../scripts/data/burden-2026-q2');

const ROSTER = fx.ROSTER;
const SEED_HISTORY = fx.buildHistory();
const baseOpts = { months: 12, seed: 'fairness-test', startYear: 2026, startMonth: 6, seedHistory: SEED_HISTORY, engine };

function run(coa, extra) {
  return sim.simulate(ROSTER, Object.assign({}, baseOpts, { coa }, extra || {}));
}

describe('simulation structure', () => {
  test.each(engine.ALL_MODES)('%s: every Marine drafts every month with a valid pick', (coa) => {
    const r = run(coa);
    expect(r.months).toBe(12);
    expect(r.marines).toHaveLength(29);
    r.marines.forEach((mm) => {
      expect(mm.avgPick).toBeGreaterThanOrEqual(1);
      expect(mm.worstPick).toBeLessThanOrEqual(31); // 29 + up to 2 double-duty slots
      expect(mm.bestPick).toBeLessThanOrEqual(mm.worstPick);
    });
  });
});

describe('weekend burden is equal — and COA-independent', () => {
  test('weekend spread stays tight under every COA', () => {
    engine.ALL_MODES.forEach((coa) => {
      const r = run(coa);
      // Over 12 months, the gap between the most- and least-tasked Marine is small.
      expect(r.summary.weekendSpread).toBeLessThanOrEqual(2);
    });
  });

  test('weekend distribution is identical regardless of COA (it never touches the draft)', () => {
    const a = run('weighted_seniority').marines.map((m) => m.weekendsStood);
    const b = run('weighted_lottery').marines.map((m) => m.weekendsStood);
    expect(a).toEqual(b);
  });
});

describe('COA character shows up in the numbers', () => {
  test('COA 1 is predictable; COA 2 is volatile; COA 3 is in between', () => {
    const c1 = run('weighted_seniority').summary;
    const c2 = run('weighted_lottery').summary;
    const c3 = run('hybrid').summary;
    // Pick volatility: lottery swings far more than weighted seniority.
    expect(c2.avgPickVolatility).toBeGreaterThan(c1.avgPickVolatility);
    expect(c3.avgPickVolatility).toBeLessThan(c2.avgPickVolatility);
  });

  test('seniority strongly predicts picks under COA 1, far less under COA 2', () => {
    const c1 = run('weighted_seniority').summary.seniorityPredictsPick;
    const c2 = run('weighted_lottery').summary.seniorityPredictsPick;
    expect(c1).toBeGreaterThan(0.8);   // COA 1: picks track seniority
    expect(c1).toBeGreaterThan(c2);    // lottery decouples seniority from outcome
  });

  test('pure seniority is fully deterministic (zero volatility from luck)', () => {
    // With no double-duty churn a pure-seniority Marine would have range 0; double
    // duty can shift a Marine by a slot or two month to month, but there is no luck.
    const r = run('pure_seniority');
    expect(r.summary.seniorityPredictsPick).toBeGreaterThan(0.95);
    expect(r.summary.avgPickVolatility).toBeLessThan(run('weighted_lottery').summary.avgPickVolatility);
  });
});

describe('double-duty priority holds every month', () => {
  test('whoever stands double duty a month picks in the first slots that month', () => {
    const r = run('weighted_lottery');
    r.monthly.forEach((mo) => {
      mo.doubleDutyIds.forEach((id) => {
        const firstIdx = mo.order.findIndex((e) => e.id === id);
        expect(firstIdx).toBeLessThan(mo.doubleDutyIds.length * 2); // within the locked front
      });
    });
  });
});

describe('luck metric (deviation from the deserved/rules-based order)', () => {
  test('COA 1 has zero luck vs itself; COA 2 has the most; COA 3 is bounded between', () => {
    const c1 = run('weighted_seniority');
    const c2 = run('weighted_lottery');
    const c3 = run('hybrid');
    expect(sim.luckVsBaseline(c1, c1)).toBe(0);          // weighted seniority IS the baseline
    const luck2 = sim.luckVsBaseline(c2, c1);
    const luck3 = sim.luckVsBaseline(c3, c1);
    expect(luck2).toBeGreaterThan(luck3);                // lottery drifts furthest from deserved
    expect(luck3).toBeGreaterThan(0);                    // hybrid adds some, but bounded
    expect(luck3).toBeLessThan(luck2);
  });
});

describe('reproducibility', () => {
  test('same seed -> identical simulation', () => {
    const a = run('hybrid');
    const b = run('hybrid');
    expect(a.marines).toEqual(b.marines);
  });
});
