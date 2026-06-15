#!/usr/bin/env node
// ============================================================================
// DutyDraft — Draft Order Demo / COA comparison (CLI)
// ============================================================================
// Generates the draft order for the upcoming JULY 2026 draft under every COA,
// using the April/May/June 2026 burden fixture, and prints each order with a
// plain-language explanation. This is the command-line form of the master-admin
// "run mock draft orders to show command" tool — safe to run anytime; it touches
// no app state or database.
//
//   node scripts/draft-order-demo.js            # all modes, fixed demo seed
//   node scripts/draft-order-demo.js hybrid     # one mode
//   node scripts/draft-order-demo.js --seed 42  # choose the locked random seed
// ============================================================================

const engine = require('../draft-order-engine');
const fx = require('./data/burden-2026-q2');

const args = process.argv.slice(2);
const seedArg = args.indexOf('--seed');
const seed = seedArg !== -1 ? args[seedArg + 1] : 'demo-2026-07';
const modeArg = args.find((a) => engine.ALL_MODES.indexOf(a) !== -1);
const modes = modeArg ? [modeArg] : engine.ALL_MODES;

const ROSTER = fx.ROSTER;
const HISTORY = fx.buildHistory();
const nameById = {};
ROSTER.forEach((m) => { nameById[m.id] = `${m.rank} ${m.lastName}`; });

function printOrder(mode) {
  const { order, audit } = engine.generateDraftOrder(mode, ROSTER, HISTORY, {
    doubleDuty: fx.CURRENT_MONTH_DOUBLE_DUTY,
    seed, month: 6, year: 2026, generatedBy: 'demo',
  });

  console.log('\n' + '='.repeat(72));
  console.log(`MODE: ${mode}   (seed: ${seed})`);
  console.log(audit.modeExplanation);
  console.log('='.repeat(72));

  const auditById = {};
  audit.marines.forEach((r) => { auditById[r.id] = r; });
  const ddIds = new Set(audit.currentMonthDoubleDuty.map((d) => d.id));
  const frontLen = audit.currentMonthDoubleDuty.length * 2; // double-duty Marines take two slots each
  // In hybrid, the weighted-seniority round starts AFTER the lottery picks, so its
  // seniority baseline is offset by the number of lottery selections.
  const lotteryCount = audit.marines.filter((r) => r.source === 'lottery').length;

  let pick = 0;
  const seen = new Set();
  order.forEach((e) => {
    pick++;
    const name = nameById[e.id];
    if (ddIds.has(e.id)) {
      console.log(`  #${String(pick).padStart(2)}  ${name.padEnd(22)} [DOUBLE DUTY — turn ${e.turn}]`);
      return;
    }
    if (seen.has(e.id)) return;
    seen.add(e.id);
    const r = auditById[e.id] || {};
    let detail = '';
    if (r.source === 'weighted-seniority') {
      detail = `base ${r.base} + wknd ${r.weekendPoints} + dd ${r.doubleDutyPoints} + rnd ${r.random} = ${r.uncappedScore}`;
      // Post-lottery seniority slot vs. where burden (within the cap) actually landed
      // them. In pure COA1 lotteryCount is 0; in hybrid it shifts the baseline past
      // the lottery picks, so the move reflects burden only — not the lottery's shuffle.
      const seniorityPick = frontLen + lotteryCount + r.seniorityPos + 1;
      const move = seniorityPick - r.finalPick; // +ve = moved earlier (up), -ve = moved later (down)
      if (move !== 0) {
        detail += `  (seniority #${seniorityPick} → #${r.finalPick}, ${move > 0 ? '+' + move + ' up' : move + ' down'})`;
      }
    } else if (r.source === 'lottery') {
      detail = `LOTTERY  tickets ${r.tickets} (base ${r.base} + wknd ${r.weekendTickets} + dd ${r.doubleDutyTickets})`;
    }
    console.log(`  #${String(pick).padStart(2)}  ${name.padEnd(22)} ${detail}`);
  });
}

console.log('\nDutyDraft — Draft Order Engine demo');
console.log('Upcoming draft: JULY 2026   |   Burden window: April–June 2026');
console.log('Current-month double duty (priority #1/#2): ' +
  fx.CURRENT_MONTH_DOUBLE_DUTY.map((id) => nameById[id]).join(', '));
console.log(engine.FAIRNESS_STATEMENT);

modes.forEach(printOrder);
console.log('');
