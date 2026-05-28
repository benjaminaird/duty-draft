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
