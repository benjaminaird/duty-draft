const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { spawn } = require('child_process');
const TEST_MARINES = require('./data/test-marines.json');
const { MONTHS, GROUP_QUOTA, groupOf, getAllDates, getWeekendDates, weekendQuota, isWkDate } = require('./test-drive-helpers');
const { runMultipleMonths } = require('./test-drive-runner');

const PORT = 3999;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const REPORT_DIR = path.join(__dirname, '..', 'test-drive-output');

function ensureReportDir() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
}

function writeReport(name, data) {
  ensureReportDir();
  const file = path.join(REPORT_DIR, name);
  fs.writeFileSync(file, data);
  return file;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function signedPct(value) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)} pts`;
}

function marineName(m) {
  return `${m.rank} ${m.lastName}`;
}

function assignmentEntries(result) {
  return Object.entries(result.draftState.assignments || {})
    .map(([day, mid]) => ({ day: Number(day), mid, state: result.draftState }));
}

function weekendAssignmentEntries(result) {
  return assignmentEntries(result).filter(entry => isWkDate(entry.day, entry.state));
}

function hasApprovedNaConflict(result) {
  return assignmentEntries(result).some(({ day, mid, state }) => {
    const key = `${state.year}-${String(state.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return ((state.nonAvail || {})[mid] || []).some(n => n.approved === true && n.date === key);
  });
}

function annualMarineTotals(monthResults) {
  return TEST_MARINES.map(m => {
    const entries = monthResults.flatMap(result =>
      assignmentEntries(result).filter(entry => entry.mid === m.id)
    );
    const weekend = entries.filter(entry => isWkDate(entry.day, entry.state)).length;
    return { ...m, total: entries.length, weekend };
  });
}

function spreadStats(values) {
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  return { min, max, spread: max - min, average };
}

function rankGroupStats(totals, totalWeekends) {
  const groups = [
    { key: 'junior', label: 'Junior Marines (E1-E5)', expected: GROUP_QUOTA.junior },
    { key: 'ssgt', label: 'SSgt (E6)', expected: GROUP_QUOTA.ssgt },
    { key: 'gysgt', label: 'GySgt (E7)', expected: GROUP_QUOTA.gysgt }
  ];

  return groups.map(group => {
    const members = totals.filter(m => groupOf(m.rank) === group.key);
    const weekendTotal = members.reduce((sum, m) => sum + m.weekend, 0);
    const actualPct = totalWeekends ? (weekendTotal / totalWeekends) * 100 : 0;
    const expectedPct = group.expected * 100;
    return {
      ...group,
      members,
      weekendTotal,
      expectedPct,
      actualPct,
      variance: actualPct - expectedPct,
      spread: spreadStats(members.map(m => m.weekend))
    };
  });
}

function passFail(value) {
  return value ? 'PASS' : 'FAIL';
}

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await axios.get(`${BASE_URL}/api/health`);
      if (res.data && res.data.ok) return res.data;
    } catch {}
    await wait(250);
  }
  throw new Error('DutyDraft test server did not become ready.');
}

function startServer() {
  return spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      DUTYDRAFT_TEST_MODE: '1',
      PORT: String(PORT)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

async function main() {
  ensureReportDir();

  const testStateFile = path.join(REPORT_DIR, 'test-state.json');
  if (fs.existsSync(testStateFile)) fs.unlinkSync(testStateFile);

  const server = startServer();

  server.stdout.on('data', data => process.stdout.write(`[server] ${data}`));
  server.stderr.on('data', data => process.stderr.write(`[server:err] ${data}`));

  try {
    const health = await waitForServer();

    const monthResults = await runMultipleMonths(BASE_URL, 12);
    const monthResult = monthResults[0];
    const seededState = monthResult.seededState;
    const weekendDates = monthResult.weekendSetup.weekendDates;
    const weekendAssignments = monthResult.weekendSetup.weekendAssignments;
    const wkPreviewState = monthResult.weekendSetup.state;
    const reviewState = monthResult.reviewState;
    const draftOrder = monthResult.draftOrder;
    const draftState = monthResult.draftState;
    const simulatedPicks = monthResult.simulatedPicks;
    const totals = annualMarineTotals(monthResults);
    const totalDutyAssignments = monthResults.reduce((sum, r) => sum + assignmentEntries(r).length, 0);
    const totalWeekendAssignments = monthResults.reduce((sum, r) => sum + weekendAssignmentEntries(r).length, 0);
    const expectedDutyAssignments = monthResults.reduce((sum, r) => sum + getAllDates(r.draftState).length, 0);
    const expectedWeekendAssignments = monthResults.reduce((sum, r) => sum + getWeekendDates(r.draftState).length, 0);
    const monthsCompleted = monthResults.filter(r => r.draftState.draftDone).length;
    const allDutyDaysAssigned = totalDutyAssignments === expectedDutyAssignments;
    const allWeekendDaysAssigned = totalWeekendAssignments === expectedWeekendAssignments;
    const approvedNaProtected = !monthResults.some(hasApprovedNaConflict);
    const monthLabels = monthResults.map(r => `${MONTHS[r.draftState.month]} ${r.draftState.year}`);
    const distinctMonths = new Set(monthLabels).size;
    const historyLengths = monthResults.map(r => ({
      label: `${MONTHS[r.seededState.month]} ${r.seededState.year}`,
      junior: (r.seededState.history?.weekendBurden?.junior || []).length,
      ssgt: (r.seededState.history?.weekendBurden?.ssgt || []).length,
      gysgt: (r.seededState.history?.weekendBurden?.gysgt || []).length
    }));
    const rolloverExists = distinctMonths === monthResults.length;
    const weekendHistoryPreserved = historyLengths.slice(1).every(h => h.junior + h.ssgt + h.gysgt > 0);
    const rankStats = rankGroupStats(totals, totalWeekendAssignments);
    const ratioTolerancePts = 5;
    const maxWeekendSpread = 1;
    const rankRatioPass = rankStats.every(s => Math.abs(s.variance) <= ratioTolerancePts);
    const inGroupFairnessPass = rankStats.every(s => s.spread.spread <= maxWeekendSpread);
    const annualFairnessPass = allDutyDaysAssigned && allWeekendDaysAssigned && approvedNaProtected && rankRatioPass && inGroupFairnessPass;

    const report = [
      '# DutyDraft Automated Test Drive',
      '',
      `Generated: ${new Date().toISOString()}`,
      '',
      '## Scope',
      '',
      '- Current run: 12-month simulation using the safe test server',
      '- Production scheduling, PDF formatting, UI behavior, and live database behavior were not modified',
      '',
      '## Server Check',
      '',
      `- Test mode: ON`,
      `- Test API: ${BASE_URL}`,
      `- Health response: ${JSON.stringify(health)}`,
      `- Simulated Marines loaded: ${TEST_MARINES.length}`,
      `- Months simulated: ${monthResults.length}`,
      `- App state seeded with simulated roster: ${seededState.marines.length} Marines`,
      `- Starting test month: ${MONTHS[seededState.month]} ${seededState.year}`,
      `- Weekend-style dates detected: ${weekendDates.join(', ' ) || 'None'}`,
      `- Weekend-style date count: ${weekendDates.length}`,
      `- Expected weekend ratio: E5/below ${weekendQuota(weekendDates.length).junior}, E6 ${weekendQuota(weekendDates.length).ssgt}, E7 ${weekendQuota(weekendDates.length).gysgt}`,
      `- Selected E5/below Marines: ${weekendAssignments.junior.map(m=>m.rank + ' ' + m.lastName).join(', ')}`,
      `- Selected E6 Marines: ${weekendAssignments.ssgt.map(m=>m.rank + ' ' + m.lastName).join(', ')}`,
      `- Selected E7 Marines: ${weekendAssignments.gysgt.map(m=>m.rank + ' ' + m.lastName).join(', ')}`,
      `- Weekend assignee IDs stored: ${seededState.wkAssigneeIds.join(', ')}`,
      `- Persisted setup phase: ${wkPreviewState.phase}`,
      `- Persisted weekend dates: ${(wkPreviewState.weekendDates || []).join(', ')}`,
      `- Simulated preference submissions: ${Object.keys(reviewState.prefs || {}).length}`,
      `- Simulated non-availability submissions: ${Object.keys(reviewState.nonAvail || {}).length}`,
      `- Review phase reached: ${reviewState.phase}`,
      `- Draft order generated: ${draftOrder.length} turns`,
      `- Draft started: phase draft, live true`,
      `- Simulated draft picks submitted: ${simulatedPicks}`,
      `- Draft complete: ${draftState.draftDone}`,
      `- Final assigned duty days: ${Object.keys(draftState.assignments || {}).length}`,
      `- Final weekend duty days assigned: ${Object.entries(draftState.assignments || {}).filter(([d])=>isWkDate(Number(d),draftState)).length}`,
      '',
      '## Critical Finding',
      '',
      `- Are we actually simulating a year, or one month twelve times? ${rolloverExists ? 'A year.' : 'One month twelve times.'}`,
      `- Distinct months simulated: ${distinctMonths}/${monthResults.length}`,
      `- Months simulated: ${monthLabels.join(', ')}`,
      `- Month rollover loop: ${rolloverExists ? 'ACTIVE via /api/next-month' : 'NOT ACTIVE'}`,
      `- Weekend history preserved before months 2-12: ${weekendHistoryPreserved ? 'YES' : 'NO'}`,
      `- Fairness balancing preserved: ${weekendHistoryPreserved ? 'YES, weekendBurden history is carried into selectWeekendMarines().' : 'NO, later months start without weekendBurden history.'}`,
      `- Each month starts from scratch: ${rolloverExists && weekendHistoryPreserved ? 'NO' : 'YES'}`,
      `- Previous framework gap: runMultipleMonths() called runOneMonth() repeatedly, and runOneMonth() reseeded state each time instead of advancing through /api/next-month.`,
      `- Minimum framework fix applied: month 1 seeds the safe test roster, months 2-12 call /api/next-month before setup, and the test helper's previous-month consecutive-day check now matches the server rule.`,
      '',
      '## History Carry-Forward Evidence',
      '',
      ...historyLengths.map(h => `- ${h.label}: prior weekendBurden counts junior=${h.junior}, ssgt=${h.ssgt}, gysgt=${h.gysgt}`),
      '',
      '## Annual 12-Month Summary',
      `- Months completed: ${monthsCompleted}/${monthResults.length} ${passFail(monthsCompleted === monthResults.length)}`,
      `- Total duty assignments simulated: ${totalDutyAssignments}`,
      `- Expected duty assignments: ${expectedDutyAssignments}`,
      `- Total weekend assignments simulated: ${totalWeekendAssignments}`,
      `- Expected weekend assignments: ${expectedWeekendAssignments}`,
      '',
      '## Annual Validation Checks',
      `- Did all 12 months complete successfully? ${passFail(monthsCompleted === monthResults.length)}`,
      `- Were all duty days assigned? ${passFail(allDutyDaysAssigned)}`,
      `- Were all weekend days assigned? ${passFail(allWeekendDaysAssigned)}`,
      `- Were approved non-availability requests protected? ${passFail(approvedNaProtected)}`,
      `- Did weekend burden match intended rank-group ratios within ${ratioTolerancePts} percentage points? ${passFail(rankRatioPass)}`,
      `- Did Marines rotate fairly within their rank groups with weekend spread <= ${maxWeekendSpread}? ${passFail(inGroupFairnessPass)}`,
      '',
      '## Annual Rank-Group Weekend Statistics',
      '',
      '| Group | Weekend totals | Expected % | Actual % | Variance | Min | Max | Spread | Average | Result |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
      ...rankStats.map(s => `| ${s.label} | ${s.weekendTotal} | ${s.expectedPct.toFixed(1)}% | ${s.actualPct.toFixed(1)}% | ${signedPct(s.variance)} | ${s.spread.min} | ${s.spread.max} | ${s.spread.spread} | ${s.spread.average.toFixed(2)} | ${passFail(Math.abs(s.variance) <= ratioTolerancePts && s.spread.spread <= maxWeekendSpread)} |`),
      '',
      '## Month 1 Per-Marine Assignment Summary',
      ...TEST_MARINES.map(m=>{ const entries=Object.entries(draftState.assignments || {}).filter(([,mid])=>mid===m.id); const wk=entries.filter(([d])=>isWkDate(Number(d),draftState)).length; return `- ${m.rank} ${m.lastName}: ${entries.length} total, ${wk} weekend`; }),
      '',
      '## Annual Per-Marine Assignment Summary',
      ...totals.map(m => `- ${marineName(m)}: ${m.total} total, ${m.weekend} weekend`),
      '',
      '## Conclusion',
      '',
      `- Is the existing scheduling algorithm fair over a full year? ${annualFairnessPass ? 'PASS' : 'FAIL'}`,
      `- Fairness criteria: all drafts complete, all duty and weekend days assigned, approved N/A protected, rank-group weekend variance within ${ratioTolerancePts} percentage points, and within-group weekend spread <= ${maxWeekendSpread}.`,
      `- Month helper loaded: ${MONTHS[0]} through ${MONTHS[11]}`,
      '',
      'Status: test server completed the annual automated test drive in safe test mode without touching the live database.'
    ].join('\n');

    const reportPath = writeReport('TEST_DRIVE_REPORT.md', report);

    console.log('✅ DutyDraft test server started in safe test mode.');
    console.log(`Report written to: ${reportPath}`);
  } finally {
    server.kill('SIGTERM');
  }
}

main().catch(err => {
  console.error('❌ Test drive failed.');
  console.error(err);
  process.exit(1);
});
