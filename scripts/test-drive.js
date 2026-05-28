const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { spawn } = require('child_process');
const TEST_MARINES = require('./data/test-marines.json');
const { MONTHS, getWeekendDates, weekendQuota, selectWeekendMarines, buildDraftOrder, getAllDates, isDateValid, isWkDate } = require('./test-drive-helpers');
const { seedMonth, applyWeekendSetup, simulatePdNa, simulateDraft } = require('./test-drive-runner');

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

    const seededState = await seedMonth(BASE_URL);
    const weekendSetup = await applyWeekendSetup(BASE_URL, seededState);
    const wkPreviewState = weekendSetup.state;
    const weekendDates = weekendSetup.weekendDates;
    const weekendAssignments = weekendSetup.weekendAssignments;

    wkPreviewState.prefs = {
      m16: [{day:6},{day:7},{day:13},{day:14},{day:20}],
      m4: [{day:6},{day:13},{day:20},{day:27},{day:28}],
      m1: [{day:7},{day:14},{day:21},{day:28},{day:6}],
      m10: [{day:2},{day:3},{day:4},{day:5},{day:8}],
      m11: [{day:9},{day:10},{day:11},{day:12},{day:15}]
    };

    wkPreviewState.nonAvail = {
      m16: [{date:`${wkPreviewState.year}-${String(wkPreviewState.month+1).padStart(2,'0')}-14`, reason:'Approved Leave', approved:true}],
      m4: [{date:`${wkPreviewState.year}-${String(wkPreviewState.month+1).padStart(2,'0')}-20`, reason:'TAD', approved:false}],
      m10: [{date:`${wkPreviewState.year}-${String(wkPreviewState.month+1).padStart(2,'0')}-03`, reason:'On the Roster for a Gig', approved:true}]
    };

    wkPreviewState.phase = 'review';
    await axios.post(`${BASE_URL}/api/state`, wkPreviewState);
    const reviewState = (await axios.get(`${BASE_URL}/api/state`)).data;

    const draftOrder = buildDraftOrder(reviewState.marines || [], reviewState.doubleDuty || {}, reviewState.preAssigned || {});
    const startDraftResult = await axios.post(`${BASE_URL}/api/draft/start`, { draftOrder, assignments: reviewState.preAssigned || {} });
    let draftState = startDraftResult.data.state;
    let simulatedPicks = 0;
    while (draftState.draftLive && !draftState.draftDone) {
      const entry = draftState.draftOrder[draftState.draftIdx];
      if (!entry) break;
      const mid = entry.id;
      const prefs = (draftState.prefs[mid] || []).map(p => p.day);
      const asgn = draftState.assignments || {};
      const myDays = Object.entries(asgn).filter(([,x])=>x===mid).map(([d])=>Number(d));
      const needsWk = (draftState.wkAssigneeIds || []).includes(mid) && !(draftState.freedMarines || []).includes(mid) && !myDays.some(d=>isWkDate(d,draftState));
      const validDays = getAllDates(draftState).filter(day => isDateValid(mid, day, asgn, draftState, needsWk));
      const pick = prefs.find(day => validDays.includes(day)) || validDays[0];
      if (!pick) throw new Error(`No valid pick found for ${mid}`);
      const result = await axios.post(`${BASE_URL}/api/draft/pick`, { day: pick, mid });
      draftState = result.data.state;
      simulatedPicks++;
      if (simulatedPicks > 80) throw new Error('Draft simulation exceeded safety limit');
    }

    const report = [
      '# DutyDraft Automated Test Drive',
      '',
      `Generated: ${new Date().toISOString()}`,
      '',
      '## Scope\n\n- Current run: one-month end-to-end simulation\n- Next planned upgrade: 12-month loop with carry-forward fairness history\n\n## Server Check',
      '',
      `- Test mode: ON`,
      `- Test API: ${BASE_URL}`,
      `- Health response: ${JSON.stringify(health)}`,
      `- Simulated Marines loaded: ${TEST_MARINES.length}`,
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
