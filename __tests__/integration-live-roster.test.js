// Integration test mirroring the in-app (browser) generation path: a LIVE roster
// carries its own ids (not the fixture's r-ids); the burden fixture is mapped onto
// it BY LAST NAME, then the engine produces a locked-able order. This guards the
// data-mapping seam between the app and the engine.

const engine = require('../draft-order-engine');
const fx = require('../scripts/data/burden-2026-q2');

// A live-style roster: same Marines/seniority, but app-style ids (m1..m29).
const LIVE_ROSTER = fx.ROSTER.map((m, i) => ({
  id: 'm' + (i + 1), rank: m.rank, lastName: m.lastName, firstName: m.firstName, active: true,
}));
const liveId = (lastName) => LIVE_ROSTER.find((m) => m.lastName === lastName).id;

describe('live-roster mapping (browser generation path)', () => {
  test('buildHistoryForRoster keys burden by the live roster ids, matched by name', () => {
    const history = fx.buildHistoryForRoster(LIVE_ROSTER);
    expect(history.months.map((m) => m.key)).toEqual(['2026-04', '2026-05', '2026-06']);
    // Campa stood weekends in all three months under his LIVE id.
    expect(history.weekend[liveId('Campa')]).toEqual({ '2026-04': 1, '2026-05': 1, '2026-06': 1 });
    // Rosie has two May weekends.
    expect(history.weekend[liveId('Rosie')]['2026-05']).toBe(2);
    // Hallam's June double duty is recorded under his live id.
    expect(history.doubleDuty[liveId('Hallam')]).toEqual({ '2026-06': true });
    // No fixture r-ids leaked through.
    expect(history.weekend.r19).toBeUndefined();
  });

  test('engine generates a valid, lockable order from live ids + current double duty', () => {
    const history = fx.buildHistoryForRoster(LIVE_ROSTER);
    // Current-month double duty as the live app supplies it (state.doubleDuty map).
    const doubleDuty = { [liveId('Sakamoto')]: 2, [liveId('McBride')]: 2 };

    const { order, audit } = engine.generateDraftOrder('weighted_seniority', LIVE_ROSTER, history, {
      doubleDuty, seed: 'live-test', month: 6, year: 2026, generatedBy: 'sncoic',
    });

    // Front of order is the live double-duty Marines, both turns, most-senior first.
    expect(order.slice(0, 4)).toEqual([
      { id: liveId('Sakamoto'), turn: 1 }, { id: liveId('Sakamoto'), turn: 2 },
      { id: liveId('McBride'), turn: 1 }, { id: liveId('McBride'), turn: 2 },
    ]);
    // Complete, no duplicate Marines, all live ids.
    const ids = order.map((e) => e.id);
    expect(new Set(ids).size).toBe(29);
    ids.forEach((id) => expect(id).toMatch(/^m\d+$/));

    // Hallam's June double duty scores; Campa's May double duty does not.
    const hallam = audit.marines.find((r) => r.id === liveId('Hallam'));
    const campa = audit.marines.find((r) => r.id === liveId('Campa'));
    expect(hallam.doubleDutyPoints).toBe(5);
    expect(campa.doubleDutyPoints).toBe(0);
    expect(campa.weekendPoints).toBe(10);

    // The order is lockable and then gates the draft start.
    expect(engine.canStartDraft(audit)).toBe(false);
    const locked = engine.lockDraftOrder(audit, 'sncoic');
    expect(engine.canStartDraft(locked)).toBe(true);
    expect(engine.canRegenerate(locked)).toBe(false);
  });

  test('Marines missing from the fixture simply carry zero burden', () => {
    const roster = LIVE_ROSTER.concat([{ id: 'm99', rank: 'CPL', lastName: 'Newguy', firstName: 'Sam' }]);
    const history = fx.buildHistoryForRoster(roster);
    expect(history.weekend.m99).toBeUndefined();
    const { audit } = engine.generateDraftOrder('weighted_seniority', roster, history, { seed: 'x' });
    const ng = audit.marines.find((r) => r.id === 'm99');
    expect(ng.weekendPoints).toBe(0);
    expect(ng.doubleDutyPoints).toBe(0);
  });
});
