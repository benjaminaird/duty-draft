const axios = require('axios');
const TEST_MARINES = require('./data/test-marines.json');
const {
  getWeekendDates,
  weekendQuota,
  selectWeekendMarines,
  buildDraftOrder,
  getAllDates,
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

module.exports = { TEST_MARINES, seedMonth, applyWeekendSetup, simulatePdNa };
