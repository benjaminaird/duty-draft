const fs = require('fs');
const path = require('path');

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

async function main() {
  ensureReportDir();

  const report = [
    '# DutyDraft Automated Test Drive',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    'Status: scaffold created successfully.',
    '',
    'Next step: connect this driver to the running DutyDraft API.'
  ].join('\n');

  const reportPath = writeReport('TEST_DRIVE_REPORT.md', report);

  console.log('✅ DutyDraft test-drive scaffold ran successfully.');
  console.log(`Report written to: ${reportPath}`);
}

main().catch(err => {
  console.error('❌ Test drive failed.');
  console.error(err);
  process.exit(1);
});
