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
