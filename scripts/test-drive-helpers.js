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

function getWeekendDates(state){ const total=getDIM(state.year,state.month); return Array.from({length:total},(_,i)=>i+1).filter(d=>{ const key=dk(state.year,state.month,d); if((state.blackouts||[]).includes(key)) return false; if((state.workdays||[]).includes(key)) return false; return isNatWk(state.year,state.month,d)||(state.extraWk||[]).includes(key); }); }

function weekendQuota(wkCount){ const q={ junior:Math.round(GROUP_QUOTA.junior*wkCount), ssgt:Math.round(GROUP_QUOTA.ssgt*wkCount), gysgt:0 }; q.gysgt=Math.max(0,wkCount-q.junior-q.ssgt); if(q.junior+q.ssgt+q.gysgt!==wkCount) q.junior+=wkCount-(q.junior+q.ssgt+q.gysgt); return q; }

function selectWeekendMarines(marines,wkCount,history={weekendBurden:{junior:[],ssgt:[],gysgt:[]}}){ const q=weekendQuota(wkCount); const grouped={ junior:[], ssgt:[], gysgt:[] }; marines.forEach(m=>grouped[groupOf(m.rank)].push(m)); const pick=g=>{ const hist=(history.weekendBurden||{})[g]||[]; return [...grouped[g]].sort((a,b)=>{ const ai=hist.lastIndexOf(a.id); const bi=hist.lastIndexOf(b.id); return ai!==bi ? ai-bi : gradeNum(a.rank)-gradeNum(b.rank); }).slice(0,q[g]); }; return { junior:pick('junior'), ssgt:pick('ssgt'), gysgt:pick('gysgt') }; }

module.exports = { MONTHS, GROUP_QUOTA, gradeOf, groupOf, gradeNum, dk, getDIM, isNatWk, getWeekendDates, weekendQuota, selectWeekendMarines };
