const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { spawn } = require('child_process');
const TEST_MARINES = require('./data/test-marines.json');
const { MONTHS, getWeekendDates, weekendQuota, selectWeekendMarines } = require('./test-drive-helpers');

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

    await axios.post(`${BASE_URL}/api/state`, { marines: TEST_MARINES, turnMins: 1 });
    const seededState = (await axios.get(`${BASE_URL}/api/state`)).data;
    const weekendDates = getWeekendDates(seededState);
    const weekendAssignments = selectWeekendMarines(TEST_MARINES, weekendDates.length);

    const report = [
      '# DutyDraft Automated Test Drive',
      '',
      `Generated: ${new Date().toISOString()}`,
      '',
      '## Server Check',
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
