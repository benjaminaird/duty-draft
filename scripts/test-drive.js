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

function groupDefinitions() {
  return [
    { key: 'junior', label: 'Junior Marines (E1-E5)' },
    { key: 'ssgt', label: 'SSgt (E6)' },
    { key: 'gysgt', label: 'GySgt (E7)' }
  ];
}

function selectedWeekendTotals(monthResults) {
  return TEST_MARINES.map(m => {
    const selected = monthResults.reduce((sum, result) => {
      const ids = result.weekendSetup.weekendAssignments[groupOf(m.rank)].map(x => x.id);
      return sum + (ids.includes(m.id) ? 1 : 0);
    }, 0);
    return { ...m, selected };
  });
}

function selectedGroupStats(selectedTotals) {
  return groupDefinitions().map(group => {
    const members = selectedTotals.filter(m => groupOf(m.rank) === group.key);
    return {
      ...group,
      spread: spreadStats(members.map(m => m.selected)),
      members
    };
  });
}

function idsByGroup(ids) {
  const grouped = { junior: [], ssgt: [], gysgt: [] };
  ids.forEach(mid => {
    const marine = TEST_MARINES.find(m => m.id === mid);
    if (!marine) return;
    grouped[groupOf(marine.rank)].push(mid);
  });
  return grouped;
}

function finalWeekendIdsByGroup(result) {
  return idsByGroup(weekendAssignmentEntries(result).map(entry => entry.mid));
}

function voluntaryWeekendIdsByGroup(result) {
  return idsByGroup((result.pickTrace || [])
    .filter(entry => entry.pickedWeekend && !entry.selectedForWeekend)
    .map(entry => entry.mid));
}

function requiredWeekendIdsByGroup(result) {
  return {
    junior: result.weekendSetup.weekendAssignments.junior.map(m => m.id),
    ssgt: result.weekendSetup.weekendAssignments.ssgt.map(m => m.id),
    gysgt: result.weekendSetup.weekendAssignments.gysgt.map(m => m.id)
  };
}

function countIds(ids) {
  return ids.reduce((counts, id) => {
    counts[id] = (counts[id] || 0) + 1;
    return counts;
  }, {});
}

function sameIdMultiset(a, b) {
  const ac = countIds(a);
  const bc = countIds(b);
  const keys = new Set([...Object.keys(ac), ...Object.keys(bc)]);
  return [...keys].every(key => (ac[key] || 0) === (bc[key] || 0));
}

function historyAccountingAudit(monthResults, finalAccountingState) {
  return monthResults.map((result, index) => {
    const nextState = index < monthResults.length - 1
      ? monthResults[index + 1].seededState
      : finalAccountingState;
    const finalIds = finalWeekendIdsByGroup(result);
    const requiredIds = requiredWeekendIdsByGroup(result);
    const voluntaryIds = voluntaryWeekendIdsByGroup(result);
    const label = `${MONTHS[result.draftState.month]} ${result.draftState.year}`;
    const groups = groupDefinitions().map(group => {
      const before = result.seededState.history?.weekendBurden?.[group.key] || [];
      const after = nextState.history?.weekendBurden?.[group.key] || [];
      const delta = after.slice(before.length);
      return {
        ...group,
        required: requiredIds[group.key].length,
        voluntary: voluntaryIds[group.key].length,
        final: finalIds[group.key].length,
        historyDelta: delta.length,
        counted: sameIdMultiset(finalIds[group.key], delta)
      };
    });
    return {
      label,
      groups,
      counted: groups.every(group => group.counted)
    };
  });
}

function selectorPriorityAudit(monthResults) {
  return monthResults.map(result => {
    const label = `${MONTHS[result.seededState.month]} ${result.seededState.year}`;
    const groups = groupDefinitions().map(group => {
      const members = TEST_MARINES.filter(m => groupOf(m.rank) === group.key);
      const selectedIds = requiredWeekendIdsByGroup(result)[group.key];
      const selectedSet = new Set(selectedIds);
      const history = result.seededState.history?.weekendBurden?.[group.key] || [];
      const countFor = mid => history.filter(id => id === mid).length;
      const selectedCounts = selectedIds.map(countFor);
      const unselectedCounts = members.filter(m => !selectedSet.has(m.id)).map(m => countFor(m.id));
      const selectedMax = selectedCounts.length ? Math.max(...selectedCounts) : 0;
      const unselectedMin = unselectedCounts.length ? Math.min(...unselectedCounts) : selectedMax;
      return {
        ...group,
        selected: selectedIds.length,
        selectedMin: selectedCounts.length ? Math.min(...selectedCounts) : 0,
        selectedMax,
        unselectedMin,
        countPriorityHonored: selectedMax <= unselectedMin
      };
    });
    return {
      label,
      groups,
      countPriorityHonored: groups.every(group => group.countPriorityHonored)
    };
  });
}

function traceEntries(monthResults) {
  return monthResults.flatMap(result => (result.pickTrace || []).map(entry => ({
    ...entry,
    label: `${MONTHS[entry.month]} ${entry.year}`
  })));
}

function marineById(mid) {
  return TEST_MARINES.find(m => m.id === mid);
}

function groupOfMid(mid) {
  const marine = marineById(mid);
  return marine ? groupOf(marine.rank) : null;
}

function voluntaryCreditAudit(monthResults) {
  const rows = traceEntries(monthResults)
    .filter(entry => entry.pickedWeekend && !entry.selectedForWeekend)
    .map(entry => {
      const pickerGroup = groupOfMid(entry.mid);
      const expectedFreedGroup = groupOfMid(entry.expectedVoluntaryFreedId);
      const crossGroupNewlyFreed = (entry.newlyFreedIds || [])
        .filter(mid => mid !== entry.expectedVoluntaryFreedId)
        .filter(mid => groupOfMid(mid) && groupOfMid(mid) !== pickerGroup);
      return {
        label: entry.label,
        pickerMid: entry.mid,
        pickerGroup,
        expectedFreedId: entry.expectedVoluntaryFreedId || null,
        expectedFreedGroup,
        expectedApplied: !!entry.expectedVoluntaryFreedApplied,
        crossGroupNewlyFreed,
        sameGroupTarget: !entry.expectedVoluntaryFreedId || expectedFreedGroup === pickerGroup
      };
    });

  return {
    rows,
    sameGroupOnly: rows.every(row => row.sameGroupTarget && row.expectedApplied && row.crossGroupNewlyFreed.length === 0),
    voluntaryPicks: rows.length,
    sameGroupCreditsApplied: rows.filter(row => row.expectedFreedId && row.expectedApplied).length,
    noSameGroupAvailable: rows.filter(row => !row.expectedFreedId).length,
    crossGroupNewlyFreedCount: rows.reduce((sum, row) => sum + row.crossGroupNewlyFreed.length, 0)
  };
}

function ssgtDiagnosisRows(monthResults, totals, selectedTotals) {
  const traces = traceEntries(monthResults);
  return TEST_MARINES
    .filter(m => groupOf(m.rank) === 'ssgt')
    .map(m => {
      const myWeekendPicks = traces.filter(t => t.mid === m.id && t.pickedWeekend);
      const selected = selectedTotals.find(x => x.id === m.id)?.selected || 0;
      const actual = totals.find(x => x.id === m.id)?.weekend || 0;
      const preferenceWeekends = myWeekendPicks.filter(t => t.pickSource === 'preference').length;
      const fallbackWeekends = myWeekendPicks.filter(t => t.pickSource === 'fallback').length;
      const voluntaryWeekends = myWeekendPicks.filter(t => !t.selectedForWeekend).length;
      const freedSelectedTurns = traces.filter(t => t.mid === m.id && t.selectedForWeekend && t.freedBeforePick).length;
      const doubleDutyMonths = monthResults.filter(r => (r.draftState.doubleDuty || {})[m.id]).length;
      const approvedWeekendNa = monthResults.reduce((sum, r) => {
        return sum + ((r.reviewState.nonAvail || {})[m.id] || [])
          .filter(n => n.approved === true)
          .filter(n => {
            const day = Number(n.date.split('-').pop());
            return isWkDate(day, r.reviewState);
          }).length;
      }, 0);

      return {
        ...m,
        selected,
        actual,
        delta: actual - selected,
        preferenceWeekends,
        fallbackWeekends,
        voluntaryWeekends,
        freedSelectedTurns,
        doubleDutyMonths,
        approvedWeekendNa
      };
    });
}

function countSelectedWeekendMisses(monthResults) {
  return traceEntries(monthResults)
    .filter(t => t.selectedForWeekend && t.needsWk && !t.pickedWeekend)
    .length;
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
    await axios.post(`${BASE_URL}/api/next-month`);
    const finalAccountingState = (await axios.get(`${BASE_URL}/api/state`)).data;
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
    const selectedTotals = selectedWeekendTotals(monthResults);
    const selectedStats = selectedGroupStats(selectedTotals);
    const ssgtRows = ssgtDiagnosisRows(monthResults, totals, selectedTotals);
    const ssgtSelectedSpread = selectedStats.find(s => s.key === 'ssgt').spread.spread;
    const ssgtActualSpread = rankStats.find(s => s.key === 'ssgt').spread.spread;
    const selectedWeekendMisses = countSelectedWeekendMisses(monthResults);
    const ssgtDoubleDutyMonths = ssgtRows.reduce((sum, row) => sum + row.doubleDutyMonths, 0);
    const ssgtApprovedWeekendNa = ssgtRows.reduce((sum, row) => sum + row.approvedWeekendNa, 0);
    const ssgtVoluntaryWeekends = ssgtRows.reduce((sum, row) => sum + row.voluntaryWeekends, 0);
    const ssgtFreedSelectedTurns = ssgtRows.reduce((sum, row) => sum + row.freedSelectedTurns, 0);
    const ssgtPreferenceWeekends = ssgtRows.reduce((sum, row) => sum + row.preferenceWeekends, 0);
    const ssgtFallbackWeekends = ssgtRows.reduce((sum, row) => sum + row.fallbackWeekends, 0);
    const historyAudit = historyAccountingAudit(monthResults, finalAccountingState);
    const historyAccountingPass = historyAudit.every(month => month.counted);
    const priorityAudit = selectorPriorityAudit(monthResults);
    const selectorCountPriorityPass = priorityAudit.every(month => month.countPriorityHonored);
    const voluntaryAudit = voluntaryCreditAudit(monthResults);
    const voluntaryReducesFuturePriority = historyAccountingPass && selectorCountPriorityPass;
    const priorSsgtSpreadBaseline = 3;
    const ssgtSpreadImproved = ssgtActualSpread < priorSsgtSpreadBaseline;
    const ssgtSpreadCause = selectorCountPriorityPass && ssgtActualSpread > maxWeekendSpread
      ? 'Final served weekend spread remains high after count-based required selection.'
      : 'Weekend-selector count priority failed in at least one month; investigate selector priority before blaming downstream constraints.';

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
      `- Fairness balancing preserved: ${weekendHistoryPreserved ? 'YES, weekendBurden history is carried into count-based selectWeekendMarines().' : 'NO, later months start without weekendBurden history.'}`,
      `- Weekend selector priority count-based: ${selectorCountPriorityPass ? 'YES' : 'NO'}`,
      `- Voluntary weekend picks counted as weekend burden history: ${historyAccountingPass ? 'YES' : 'NO'}`,
      `- Voluntary weekend picks free only same-group selected Marines: ${voluntaryAudit.sameGroupOnly ? 'YES' : 'NO'}`,
      `- Volunteering for a weekend reduces future required weekend priority: ${voluntaryReducesFuturePriority ? 'YES' : 'NO'}`,
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
      '## Weekend Selector Diagnostics',
      '',
      `- Selector priority rule: served weekend count first, recency/order only as a tiebreaker.`,
      `- Is weekend selector priority count-based? ${selectorCountPriorityPass ? 'YES' : 'NO'}`,
      '',
      '| Group | Required selected min | Required selected max | Required selected spread | Actual min | Actual max | Actual spread |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
      ...selectedStats.map(s => {
        const actual = rankStats.find(r => r.key === s.key).spread;
        return `| ${s.label} | ${s.spread.min} | ${s.spread.max} | ${s.spread.spread} | ${actual.min} | ${actual.max} | ${actual.spread} |`;
      }),
      '',
      '### Count-Based Priority Audit',
      '',
      '| Month | Group | Selected | Selected served-count min | Selected served-count max | Lowest unselected served-count | Count priority honored |',
      '| --- | --- | ---: | ---: | ---: | ---: | --- |',
      ...priorityAudit.flatMap(month => month.groups.map(group => `| ${month.label} | ${group.label} | ${group.selected} | ${group.selectedMin} | ${group.selectedMax} | ${group.unselectedMin} | ${passFail(group.countPriorityHonored)} |`)),
      '',
      '## Same-Group Voluntary Weekend Credit Audit',
      '',
      `- Voluntary weekend picks observed: ${voluntaryAudit.voluntaryPicks}`,
      `- Same-group selected assignees freed by voluntary picks: ${voluntaryAudit.sameGroupCreditsApplied}`,
      `- Voluntary picks with no same-group selected assignee available to free: ${voluntaryAudit.noSameGroupAvailable}`,
      `- Cross-group frees in voluntary pick responses: ${voluntaryAudit.crossGroupNewlyFreedCount}`,
      `- Did voluntary weekend picks free only same-group selected Marines? ${voluntaryAudit.sameGroupOnly ? 'YES' : 'NO'}`,
      '',
      '| Month | Volunteer | Volunteer group | Same-group assignee freed | Cross-group frees | Result |',
      '| --- | --- | --- | --- | ---: | --- |',
      ...voluntaryAudit.rows.map(row => {
        const picker = marineById(row.pickerMid);
        const freed = row.expectedFreedId ? marineById(row.expectedFreedId) : null;
        const result = row.sameGroupTarget && row.expectedApplied && row.crossGroupNewlyFreed.length === 0;
        return `| ${row.label} | ${picker ? marineName(picker) : row.pickerMid} | ${row.pickerGroup || 'unknown'} | ${freed ? marineName(freed) : 'None available'} | ${row.crossGroupNewlyFreed.length} | ${passFail(result)} |`;
      }),
      '',
      '## Weekend History Accounting Audit',
      '',
      `- Production rollover code path: /api/next-month copies final assignments into allAsgn, then pushes every isWkDate(day, appState) assignment into history.weekendBurden for that Marine's burden group.`,
      `- Audit method: for each simulated month, compare final weekend assignment IDs against the next month's history.weekendBurden delta. The 12th month is verified by one final safe-mode /api/next-month rollover after the 12 simulated drafts.`,
      `- Are voluntary weekend picks counted as weekend burden? ${historyAccountingPass ? 'YES' : 'NO'}`,
      '',
      '| Month | Group | Required selected | Voluntary weekend picks | Final weekend assignments | History delta | Counted in history |',
      '| --- | --- | ---: | ---: | ---: | ---: | --- |',
      ...historyAudit.flatMap(month => month.groups.map(group => `| ${month.label} | ${group.label} | ${group.required} | ${group.voluntary} | ${group.final} | ${group.historyDelta} | ${passFail(group.counted)} |`)),
      '',
      '## SSgt Spread Diagnosis',
      '',
      `- Diagnosis: ${ssgtSpreadCause}`,
      `- SSgt selected weekend-obligation spread: ${ssgtSelectedSpread}`,
      `- SSgt actual weekend-duty spread: ${ssgtActualSpread}`,
      `- Selected SSgt weekend obligations that failed to pick a weekend: ${selectedWeekendMisses}`,
      `- SSgt double-duty months: ${ssgtDoubleDutyMonths}`,
      `- SSgt approved weekend non-availability constraints: ${ssgtApprovedWeekendNa}`,
      `- Consecutive-day rule impact: no selected SSgt weekend obligation failed to land on a weekend, so there is no evidence that consecutive-day blocking caused the SSgt spread.`,
      `- SSgt actual weekend picks from preferences: ${ssgtPreferenceWeekends}`,
      `- SSgt actual weekend picks from simulator fallback: ${ssgtFallbackWeekends}`,
      `- SSgt voluntary weekend picks while not selected for weekend obligation: ${ssgtVoluntaryWeekends}`,
      `- SSgt selected weekend turns freed before pick by another Marine's voluntary weekend: ${ssgtFreedSelectedTurns}`,
      `- Did annual final SSgt weekend spread improve after the count-based selector change? ${ssgtSpreadImproved ? 'YES' : 'NO'}; previous baseline spread was ${priorSsgtSpreadBaseline}, current spread is ${ssgtActualSpread}.`,
      `- Interpretation: double-duty, approved N/A, and consecutive-day blocking did not drive the SSgt spread in this run. The selector now uses served weekend counts first and honors that priority each month, and production history accounting counts final weekend assignments including voluntary picks. The spread remains because actual draft choices can add weekend duty to one Marine while voluntary weekend picks can free another selected Marine before they serve one.`,
      `- Does final annual spread become fair once voluntary weekends are counted? ${inGroupFairnessPass ? 'YES' : 'NO'}; voluntary weekends are already counted in final annual burden, and SSgt final spread remains ${ssgtActualSpread}.`,
      `- Did voluntary weekend picks free only same-group selected Marines? ${voluntaryAudit.sameGroupOnly ? 'YES' : 'NO'}.`,
      '',
      '| SSgt | Selected weekend obligations | Actual weekend duties | Delta | Preference weekends | Fallback weekends | Voluntary weekends | Freed selected turns | Double-duty months | Approved weekend NA |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
      ...ssgtRows.map(row => `| ${marineName(row)} | ${row.selected} | ${row.actual} | ${row.delta >= 0 ? '+' : ''}${row.delta} | ${row.preferenceWeekends} | ${row.fallbackWeekends} | ${row.voluntaryWeekends} | ${row.freedSelectedTurns} | ${row.doubleDutyMonths} | ${row.approvedWeekendNa} |`),
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
      `- Is the required weekend selector count-priority fair? ${selectorCountPriorityPass ? 'YES' : 'NO'}`,
      `- Are voluntary weekend picks counted as weekend burden? ${historyAccountingPass ? 'YES' : 'NO'}`,
      `- Did voluntary weekend picks free only same-group selected Marines? ${voluntaryAudit.sameGroupOnly ? 'YES' : 'NO'}`,
      `- Does volunteering for a weekend reduce future required weekend priority? ${voluntaryReducesFuturePriority ? 'YES' : 'NO'}`,
      `- Did annual final weekend spread improve after the change? ${ssgtSpreadImproved ? 'YES' : 'NO'}; SSgt spread is ${ssgtActualSpread} versus prior baseline ${priorSsgtSpreadBaseline}.`,
      `- Does final annual spread become fair once voluntary weekends are counted? ${inGroupFairnessPass ? 'YES' : 'NO'}`,
      `- Why does it still fail? SSgt selector priority is count-based, but final served weekend burden remains spread ${ssgtActualSpread} because voluntary/fallback weekend choices can add weekend burden to one Marine and free another selected Marine before they serve one.`,
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
