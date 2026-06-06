const axios = require('axios');
const TEST_MARINES = require('./data/test-marines.json');
const {
  getWeekendDates,
  weekendQuota,
  selectWeekendMarines,
  buildDraftOrder,
  getAllDates,
  groupOf,
  isDateValid,
  isWkDate
} = require('./test-drive-helpers');

module.exports = { TEST_MARINES };

async function seedMonth(baseUrl) {
  await axios.post(`${baseUrl}/api/state`, { marines: TEST_MARINES, turnMins: 1 });
  return (await axios.get(`${baseUrl}/api/state`)).data;
}

module.exports = { TEST_MARINES, seedMonth };

async function applyWeekendSetup(baseUrl, state) {
  const weekendDates = getWeekendDates(state);
  const weekendAssignments = selectWeekendMarines(TEST_MARINES, weekendDates.length, state.history || {});

  state.wkAssignees = weekendAssignments;
  state.wkAssigneeIds = [
    ...weekendAssignments.junior.map(m => m.id),
    ...weekendAssignments.ssgt.map(m => m.id),
    ...weekendAssignments.gysgt.map(m => m.id)
  ];
  state.weekendDates = weekendDates;
  state.phase = 'wkpreview';

  await axios.post(`${baseUrl}/api/state`, state);

  return {
    state: (await axios.get(`${baseUrl}/api/state`)).data,
    weekendDates,
    weekendAssignments,
    quota: weekendQuota(weekendDates.length)
  };
}

module.exports = { TEST_MARINES, seedMonth, applyWeekendSetup };

async function simulatePdNa(baseUrl, state) {
  state.prefs = {
    m16: [{day:6},{day:7},{day:13},{day:14},{day:20}],
    m4: [{day:6},{day:13},{day:20},{day:27},{day:28}],
    m1: [{day:7},{day:14},{day:21},{day:28},{day:6}],
    m10: [{day:2},{day:3},{day:4},{day:5},{day:8}],
    m11: [{day:9},{day:10},{day:11},{day:12},{day:15}]
  };

  state.nonAvail = {
    m16: [{date:`${state.year}-${String(state.month+1).padStart(2,'0')}-14`, reason:'Approved Leave', approved:true}],
    m4: [{date:`${state.year}-${String(state.month+1).padStart(2,'0')}-20`, reason:'TAD', approved:false}],
    m10: [{date:`${state.year}-${String(state.month+1).padStart(2,'0')}-03`, reason:'On the Roster for a Gig', approved:true}]
  };

  state.phase = 'review';
  await axios.post(`${baseUrl}/api/state`, state);
  return (await axios.get(`${baseUrl}/api/state`)).data;
}



function expectedVoluntaryFreedId(state, pickerMid, pickedDay, asgnAfterPick) {
  if (!isWkDate(pickedDay, state)) return null;
  if ((state.wkAssigneeIds || []).includes(pickerMid)) return null;

  const picker = (state.marines || []).find(m => m.id === pickerMid);
  if (!picker) return null;

  const pickerGroup = groupOf(picker.rank);
  const newFreed = [...(state.freedMarines || [])];
  const order = state.draftOrder || [];
  const searchFrom = (state.draftIdx || 0) + 1;

  for (let i = searchFrom; i < order.length; i++) {
    const mid = order[i].id;
    const candidate = (state.marines || []).find(m => m.id === mid);
    if (!candidate || groupOf(candidate.rank) !== pickerGroup) continue;
    if (!(state.wkAssigneeIds || []).includes(mid)) continue;
    if (newFreed.includes(mid)) continue;
    const theirDays = Object.entries(asgnAfterPick).filter(([, x]) => x === mid).map(([d]) => Number(d));
    if (!theirDays.some(d => isWkDate(d, state))) return mid;
  }

  return null;
}

async function simulateDraft(baseUrl, state) {
  const draftOrder = buildDraftOrder(state.marines || [], state.doubleDuty || {}, state.preAssigned || {});
  const startDraftResult = await axios.post(`${baseUrl}/api/draft/start`, { draftOrder, assignments: state.preAssigned || {} });
  let draftState = startDraftResult.data.state;
  let simulatedPicks = 0;
  const pickTrace = [];

  while (draftState.draftLive && !draftState.draftDone) {
    const entry = draftState.draftOrder[draftState.draftIdx];
    if (!entry) break;

    const mid = entry.id;
    const prefs = (draftState.prefs[mid] || []).map(p => p.day);
    const asgn = draftState.assignments || {};
    const myDays = Object.entries(asgn).filter(([, x]) => x === mid).map(([d]) => Number(d));
    const selectedForWeekend = (draftState.wkAssigneeIds || []).includes(mid);
    const needsWk = selectedForWeekend
      && !(draftState.freedMarines || []).includes(mid)
      && !myDays.some(d => isWkDate(d, draftState));
    const validDays = getAllDates(draftState).filter(day => isDateValid(mid, day, asgn, draftState, needsWk));
    const prefPick = prefs.find(day => validDays.includes(day));
    const pick = prefPick || validDays[0];

    if (!pick) throw new Error(`No valid pick found for ${mid}`);

    const asgnAfterPick = { ...asgn, [pick]: mid };
    const freedBeforeIds = [...(draftState.freedMarines || [])];
    const expectedFreedId = expectedVoluntaryFreedId(draftState, mid, pick, asgnAfterPick);
    const traceEntry = {
      mid,
      turn: entry.turn || 1,
      day: pick,
      selectedForWeekend,
      needsWk,
      pickedWeekend: isWkDate(pick, draftState),
      pickSource: prefPick ? 'preference' : 'fallback',
      validWeekendDays: validDays.filter(day => isWkDate(day, draftState)),
      validDayCount: validDays.length,
      freedBeforePick: (draftState.freedMarines || []).includes(mid),
      expectedVoluntaryFreedId: expectedFreedId,
      freedBeforeIds,
      month: draftState.month,
      year: draftState.year
    };

    const result = await axios.post(`${baseUrl}/api/draft/pick`, { day: pick, mid });
    draftState = result.data.state;
    traceEntry.freedAfterIds = [...(draftState.freedMarines || [])];
    traceEntry.newlyFreedIds = traceEntry.freedAfterIds.filter(id => !freedBeforeIds.includes(id));
    traceEntry.expectedVoluntaryFreedApplied = expectedFreedId
      ? traceEntry.freedAfterIds.includes(expectedFreedId)
      : true;
    pickTrace.push(traceEntry);
    simulatedPicks++;
    if (simulatedPicks > 80) throw new Error("Draft simulation exceeded safety limit");
  }

  return { draftOrder, draftState, simulatedPicks, pickTrace };
}


async function advanceToNextMonth(baseUrl) {
  await axios.post(`${baseUrl}/api/next-month`);
  return (await axios.get(`${baseUrl}/api/state`)).data;
}

async function runOneMonth(baseUrl, options = {}){
  const seededState = options.seed === false
    ? (await axios.get(`${baseUrl}/api/state`)).data
    : await seedMonth(baseUrl);
  const weekendSetup = await applyWeekendSetup(baseUrl, seededState);
  const reviewState = await simulatePdNa(baseUrl, weekendSetup.state);
  const draftResult = await simulateDraft(baseUrl, reviewState);
  return { seededState, weekendSetup, reviewState, ...draftResult };
}


async function runMultipleMonths(baseUrl, count = 12){
  const results = [];
  for(let i = 0; i < count; i++){
    if(i > 0) await advanceToNextMonth(baseUrl);
    results.push(await runOneMonth(baseUrl, { seed: i === 0 }));
  }
  return results;
}

module.exports={TEST_MARINES,seedMonth,applyWeekendSetup,simulatePdNa,simulateDraft,advanceToNextMonth,runOneMonth,runMultipleMonths};
