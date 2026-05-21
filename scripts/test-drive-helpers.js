const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const RANK_TO_GRADE = { PVT:'E1', PFC:'E2', LCPL:'E3', CPL:'E4', SGT:'E5', SSGT:'E6', GYSGT:'E7' };
const GRADE_NUM = { E1:1, E2:2, E3:3, E4:4, E5:5, E6:6, E7:7 };
const BURDEN_GROUP = { E1:'junior', E2:'junior', E3:'junior', E4:'junior', E5:'junior', E6:'ssgt', E7:'gysgt' };
const GROUP_QUOTA = { junior:0.60, ssgt:0.25, gysgt:0.15 };

const gradeOf = rank => RANK_TO_GRADE[rank] || 'E1';
const groupOf = rank => BURDEN_GROUP[gradeOf(rank)] || 'junior';
const gradeNum = rank => GRADE_NUM[gradeOf(rank)] || 1;

const dk = (y,m,d) => `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
const getDIM = (y,m) => new Date(y,m+1,0).getDate();
const isNatWk = (y,m,d) => {
  const w = new Date(y,m,d).getDay();
  return w === 0 || w === 6;
};

module.exports = { MONTHS, GROUP_QUOTA, gradeOf, groupOf, gradeNum, dk, getDIM, isNatWk };
