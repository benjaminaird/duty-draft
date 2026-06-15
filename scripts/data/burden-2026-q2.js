// ============================================================================
// DutyDraft — Burden fixture: April / May / June 2026 (testing & import scenario)
// ============================================================================
//
// The 3-month historical burden window used to test and demonstrate the draft-
// order engine for the upcoming JULY 2026 draft. Mirrors the data taken from the
// uploaded April/May/June 2026 rosters. Gunny Torres is omitted (off the roster).
//
// Dual-loadable, same as the engine:
//   • Node / Jest:  const fx = require('./scripts/data/burden-2026-q2');
//   • Browser:      <script src="/burden-2026-q2.js">  ->  window.DutyDraftBurden
// (Wrapped in an IIFE so internal names like MONTHS don't collide with the page's
// own globals.)
//
// Rules encoded here (matching the engine contract):
//   • Weekend burden counts STARRED WEEKEND duties only. Past comp days do NOT count.
//   • Double-duty burden counts months where a Marine stood TWO duty dates.
//   • Current-month (July) double duty is handled separately as the #1/#2 priority
//     rule — in the live app it comes from state.doubleDuty, not this fixture.
//
// TODO(import): going forward, capture this per-Marine / per-month data from the
// real monthly rosters (starred weekend days + double-duty days) instead of this
// hand-built fixture, and feed it to the engine as `history`. The live app does not
// yet track per-month burden, so for now the in-app generator reads this fixture and
// matches it to the current roster BY LAST NAME (see buildHistoryForRoster).
// ============================================================================

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.DutyDraftBurden = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Seniority order, highest -> lowest. [id, rank, lastName, firstName]
  const ROSTER = [
    ['r01', 'GYSGT', 'Pena', 'Jason'],
    ['r02', 'GYSGT', 'McCreary', 'Patrick'],
    ['r03', 'GYSGT', 'Aird', 'Benjamin'],
    ['r04', 'GYSGT', 'Steel', 'Caleb'],
    ['r05', 'GYSGT', 'Walker', 'Christopher'],
    ['r06', 'GYSGT', 'Menz', 'Kyle'],
    ['r07', 'SSGT', 'Weiland', 'Timothy'],
    ['r08', 'SSGT', 'Kotasenski', 'Megan'],
    ['r09', 'SSGT', 'Jensen', 'Michael'],
    ['r10', 'SSGT', 'Donaldson', 'Eric'],
    ['r11', 'SSGT', 'Miller', 'Eric'],
    ['r12', 'SSGT', 'Mueller', 'Logan'],
    ['r13', 'SSGT', 'Bumgarner', 'Brian'],
    ['r14', 'SSGT', 'Johnson', 'Brandon'],
    ['r15', 'SGT', 'Gaskin', 'Brady'],
    ['r16', 'SGT', 'Capone', 'Leonardo'],
    ['r17', 'SGT', 'Hallam', 'Jason'],
    ['r18', 'SGT', 'Rosie', 'Michael'],
    ['r19', 'SGT', 'Campa', 'Daniel'],
    ['r20', 'CPL', 'Ramos', 'Micah'],
    ['r21', 'CPL', 'Mashler', 'Quinton'],
    ['r22', 'CPL', 'Ezeta', 'Gabriel'],
    ['r23', 'CPL', 'Cendan', 'Benjamin'],
    ['r24', 'CPL', 'Osterhout', 'Justin'],
    ['r25', 'LCPL', 'Arriaga', 'Darian'],
    ['r26', 'LCPL', 'Collins', 'Andrew'],
    ['r27', 'LCPL', 'Walter', 'Zach'],
    ['r28', 'LCPL', 'Sakamoto', 'Tate'],
    ['r29', 'LCPL', 'McBride', 'Blake'],
  ].map(function (a) { return { id: a[0], rank: a[1], lastName: a[2], firstName: a[3] }; });

  const ID = {};
  ROSTER.forEach(function (m) { ID[m.lastName] = m.id; });

  // 3-month window, OLDEST -> NEWEST, with explicit recency-weighted weekend points
  // (June full, May ~2/3, April ~1/3) so the math is transparent.
  const MONTHS = [
    { key: '2026-04', label: 'April 2026', weekendPoints: 1.65 },
    { key: '2026-05', label: 'May 2026', weekendPoints: 3.35 },
    { key: '2026-06', label: 'June 2026', weekendPoints: 5.00 },
  ];

  // Starred WEEKEND duties per month (one tick per starred weekend duty).
  // Rosie has TWO starred weekends in May; everyone else listed once per month.
  const APRIL_WEEKEND = ['Ramos', 'Campa', 'Donaldson', 'Mueller', 'Menz', 'Walker', 'McBride', 'Sakamoto'];
  const MAY_WEEKEND = ['Rosie', 'Hallam', 'Donaldson', 'Jensen', 'Aird', 'McCreary', 'Arriaga', 'Collins', 'Campa', 'Rosie'];
  const JUNE_WEEKEND = ['Johnson', 'Miller', 'Walker', 'Steel', 'Ramos', 'Campa'];

  // Months in which a Marine stood DOUBLE DUTY (two duty dates that month).
  const DOUBLE_DUTY_BY_MONTH = {
    '2026-04': [],
    '2026-05': ['Campa', 'Rosie'],
    '2026-06': ['Hallam'],
  };

  const WEEKEND_BY_MONTH = {
    '2026-04': APRIL_WEEKEND,
    '2026-05': MAY_WEEKEND,
    '2026-06': JUNE_WEEKEND,
  };

  // Build the engine `history` keyed by an arbitrary id resolver. resolve(lastName)
  // returns the id to use (or null to skip). Used both for the fixture's own r-ids
  // and for mapping onto a live roster by last name.
  function buildHistoryWith(resolve) {
    const weekend = {};
    const doubleDuty = {};
    Object.keys(WEEKEND_BY_MONTH).forEach(function (mk) {
      WEEKEND_BY_MONTH[mk].forEach(function (ln) {
        const id = resolve(ln);
        if (!id) return;
        weekend[id] = weekend[id] || {};
        weekend[id][mk] = (weekend[id][mk] || 0) + 1;
      });
    });
    Object.keys(DOUBLE_DUTY_BY_MONTH).forEach(function (mk) {
      DOUBLE_DUTY_BY_MONTH[mk].forEach(function (ln) {
        const id = resolve(ln);
        if (!id) return;
        doubleDuty[id] = doubleDuty[id] || {};
        doubleDuty[id][mk] = true;
      });
    });
    return { months: MONTHS.map(function (m) { return Object.assign({}, m); }), weekend: weekend, doubleDuty: doubleDuty };
  }

  // History keyed by the fixture's own r-ids (used by the engine unit tests).
  function buildHistory() {
    return buildHistoryWith(function (ln) { return ID[ln] || null; });
  }

  // History keyed by a LIVE roster's ids, matched by last name (case-insensitive).
  // This is what the in-app generator uses: the live roster Marines carry their own
  // ids, so we map the fixture's by-name burden onto them.
  function buildHistoryForRoster(roster) {
    const idByLast = {};
    (roster || []).forEach(function (m) {
      if (m && m.lastName) idByLast[String(m.lastName).toUpperCase()] = m.id;
    });
    return buildHistoryWith(function (ln) { return idByLast[String(ln).toUpperCase()] || null; });
  }

  // Current-month (July) double-duty priority picks, resolved against a live roster
  // by last name: #1 Sakamoto, #2 McBride. The live app normally takes this from
  // state.doubleDuty; this is a fallback/demo helper.
  function currentDoubleDutyForRoster(roster) {
    const idByLast = {};
    (roster || []).forEach(function (m) {
      if (m && m.lastName) idByLast[String(m.lastName).toUpperCase()] = m.id;
    });
    return ['SAKAMOTO', 'MCBRIDE'].map(function (ln) { return idByLast[ln]; }).filter(Boolean);
  }

  // Current-month double-duty using the fixture's own r-ids (for unit tests).
  const CURRENT_MONTH_DOUBLE_DUTY = [ID.Sakamoto, ID.McBride];

  return {
    ROSTER: ROSTER,
    ID: ID,
    MONTHS: MONTHS,
    buildHistory: buildHistory,
    buildHistoryForRoster: buildHistoryForRoster,
    currentDoubleDutyForRoster: currentDoubleDutyForRoster,
    CURRENT_MONTH_DOUBLE_DUTY: CURRENT_MONTH_DOUBLE_DUTY,
    APRIL_WEEKEND: APRIL_WEEKEND,
    MAY_WEEKEND: MAY_WEEKEND,
    JUNE_WEEKEND: JUNE_WEEKEND,
    DOUBLE_DUTY_BY_MONTH: DOUBLE_DUTY_BY_MONTH,
  };
});
