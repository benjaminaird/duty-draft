// Guardrail tests for the recently-shipped PD/NA process changes. These do not
// re-implement the UI; they pin the source so a future refactor can't silently
// undo the agreed behavior:
//   12. PD/NA is open from the 1st of the month until the SNCOIC closes it.
//   13. The PD/NA screen shows no countdown timer.

const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function fnBody(name) {
  // Extract a `function name(...) { ... }` body by brace matching.
  const start = INDEX.indexOf('function ' + name + '(');
  expect(start).toBeGreaterThan(-1);
  const open = INDEX.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < INDEX.length; i++) {
    if (INDEX[i] === '{') depth++;
    else if (INDEX[i] === '}') { depth--; if (depth === 0) return INDEX.slice(open, i + 1); }
  }
  throw new Error('Unbalanced braces extracting ' + name);
}

describe('Requirement 12 — PD/NA open from the 1st until the SNCOIC closes it', () => {
  const open = fnBody('subWindowOpen');
  const closed = fnBody('subWindowClosed');

  test('opens from the 1st of the month before the duty month', () => {
    // Date check resolves to the 1st (day = 1) of st.month-1.
    expect(open).toMatch(/new Date\(\s*st\.year\s*,\s*st\.month-1\s*,\s*1\s*\)/);
    expect(open).toMatch(/new Date\(\)\s*>=/);
  });

  test('stays open until the SNCOIC advances to review (no time-based cutoff)', () => {
    expect(open).toMatch(/PHASE_ORDER\.indexOf\('review'\)/);
    expect(closed).toMatch(/PHASE_ORDER\.indexOf\('review'\)/);
    // No countdown/deadline math gating the submission window.
    expect(open).not.toMatch(/countdown|fmtCD|setInterval|Date\.now\(\)\s*[-+]/);
  });
});

describe('Requirement 13 — PD/NA screen has no countdown timer', () => {
  test('the PD/NA phase card contains no countdown markup', () => {
    const start = INDEX.indexOf('PD / NA PHASE');
    expect(start).toBeGreaterThan(-1);
    const region = INDEX.slice(start, start + 4000);
    expect(region).not.toMatch(/draft-cd|fmtCD\(|STARTS IN|countdown/);
  });

  test('the only countdown timer belongs to the draft-start (draft-scheduled) screen', () => {
    // fmtCD is the countdown formatter; every use must sit next to "DRAFT STARTS IN".
    const uses = INDEX.split('fmtCD(').length - 1;
    expect(uses).toBeGreaterThan(0);
    const startsInIdx = INDEX.indexOf('DRAFT STARTS IN');
    const fmtIdx = INDEX.indexOf('fmtCD(', INDEX.indexOf('draft-cd-time'));
    expect(startsInIdx).toBeGreaterThan(-1);
    expect(Math.abs(fmtIdx - startsInIdx)).toBeLessThan(400);
  });
});
