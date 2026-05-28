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
