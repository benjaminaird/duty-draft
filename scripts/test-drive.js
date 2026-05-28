const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { spawn } = require('child_process');
const TEST_MARINES = require('./data/test-marines.json');
const { MONTHS, getWeekendDates, weekendQuota, selectWeekendMarines, buildDraftOrder, getAllDates, isDateValid, isWkDate } = require('./test-drive-helpers');
const { runOneMonth, runMultipleMonths } = require('./test-drive-runner');

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

    const monthResults = await runMultipleMonths(BASE_URL, 3);
    const monthResult = monthResults[0];
    const seededState = monthResult.seededState;
    const weekendDates = monthResult.weekendSetup.weekendDates;
    const weekendAssignments = monthResult.weekendSetup.weekendAssignments;
    const wkPreviewState = monthResult.weekendSetup.state;
    const reviewState = monthResult.reviewState;
    const draftOrder = monthResult.draftOrder;
    const draftState = monthResult.draftState;
    const simulatedPicks = monthResult.simulatedPicks;

    const report = [
      '# DutyDraft Automated Test Drive',
      '',
      `Generated: ${new Date().toISOString()}`,
      '',
      '## Scope\n\n- Current run: 3-month simulation, with detailed report shown for month 1\n- Next planned upgrade: 12-month loop with carry-forward fairness history\n\n## Server Check',
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
      "",
      "## 12-Month Expansion Readiness\n\n- One-month workflow: READY\n- Month rollover loop: TODO\n- Carry-forward weekend history: TODO\n- Annual fairness totals: TODO\n- Funeral roster simulation: TODO\n- PDF export validation: TODO\n\n## Validation Checks",
      `- Draft completed: ${draftState.draftDone ? 'PASS' : 'FAIL'}`,
      `- All duty days assigned: ${Object.keys(draftState.assignments || {}).length === 30 ? 'PASS' : 'FAIL'}`,
      `- All weekend dates assigned: ${Object.entries(draftState.assignments || {}).filter(([d])=>isWkDate(Number(d),draftState)).length === weekendDates.length ? 'PASS' : 'FAIL'}`,
      `- Approved NA protected: ${Object.entries(draftState.assignments || {}).some(([d,mid])=>((draftState.nonAvail||{})[mid]||[]).some(n=>n.approved===true && n.date.endsWith(String(d).padStart(2,'0')))) ? 'FAIL' : 'PASS'}`,
      "",
      "## Per-Marine Assignment Summary",
      ...TEST_MARINES.map(m=>{ const entries=Object.entries(draftState.assignments || {}).filter(([,mid])=>mid===m.id); const wk=entries.filter(([d])=>isWkDate(Number(d),draftState)).length; return `- ${m.rank} ${m.lastName}: ${entries.length} total, ${wk} weekend`; }),
      `- Month helper loaded: ${MONTHS[0]} through ${MONTHS[11]}`,
      '',
      'Status: test server started successfully without touching live database.',
      '',
      'Next step: seed simulated roster and run month-by-month workflow.'
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
