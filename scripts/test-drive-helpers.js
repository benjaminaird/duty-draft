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

function getAllDates(state){ const total=getDIM(state.year,state.month); return Array.from({length:total},(_,i)=>i+1).filter(d=>!(state.blackouts||[]).includes(dk(state.year,state.month,d))); }

function getWeekendDates(state){ const total=getDIM(state.year,state.month); return Array.from({length:total},(_,i)=>i+1).filter(d=>{ const key=dk(state.year,state.month,d); if((state.blackouts||[]).includes(key)) return false; if((state.workdays||[]).includes(key)) return false; return isNatWk(state.year,state.month,d)||(state.extraWk||[]).includes(key); }); }

function isConsec(d,arr){ return arr.some(x=>Math.abs(x-d)===1); }

function consecPrev(d,lastDay,year,month){ if(lastDay==null)return false; const lm=month===0?getDIM(year-1,11):getDIM(year,month-1); return lastDay===lm&&d===1; }

function isWkDate(d,state){ const k=dk(state.year,state.month,d); if((state.workdays||[]).includes(k))return false; return isNatWk(state.year,state.month,d)||(state.extraWk||[]).includes(k); }

function isDateValid(mid,d,asgn,state,needsWk){ const k=dk(state.year,state.month,d); if((state.blackouts||[]).includes(k))return false; const pa=state.preAssigned||{}; if(pa[d]&&pa[d]!==mid)return false; const approvedNA=new Set(((state.nonAvail||{})[mid]||[]).filter(n=>n.approved===true).map(n=>n.date)); if(approvedNA.has(k))return false; if(asgn[d]&&asgn[d]!==mid)return false; if(asgn[d]===mid)return false; const myDays=Object.entries(asgn).filter(([,x])=>x===mid).map(([d])=>Number(d)); if(isConsec(d,myDays))return false; const lastDay=(state.history?.lastDutyDay||{})[mid]??null; if(consecPrev(d,lastDay,state.year,state.month))return false; if(needsWk&&!isWkDate(d,state))return false; return true; }

function weekendQuota(wkCount){ const q={ junior:Math.round(GROUP_QUOTA.junior*wkCount), ssgt:Math.round(GROUP_QUOTA.ssgt*wkCount), gysgt:0 }; q.gysgt=Math.max(0,wkCount-q.junior-q.ssgt); if(q.junior+q.ssgt+q.gysgt!==wkCount) q.junior+=wkCount-(q.junior+q.ssgt+q.gysgt); return q; }

function countIn(arr,id){ return arr.filter(x=>x===id).length; }

function selectWeekendMarines(marines,wkCount,history={weekendBurden:{junior:[],ssgt:[],gysgt:[]}}){ const q=weekendQuota(wkCount); const grouped={ junior:[], ssgt:[], gysgt:[] }; marines.forEach(m=>grouped[groupOf(m.rank)].push(m)); const pick=g=>{ const hist=(history.weekendBurden||{})[g]||[]; return [...grouped[g]].sort((a,b)=>{ const ac=countIn(hist,a.id),bc=countIn(hist,b.id); if(ac!==bc)return ac-bc; const ai=hist.lastIndexOf(a.id),bi=hist.lastIndexOf(b.id); return ai!==bi ? ai-bi : gradeNum(a.rank)-gradeNum(b.rank); }).slice(0,q[g]); }; return { junior:pick('junior'), ssgt:pick('ssgt'), gysgt:pick('gysgt') }; }

function buildDraftOrder(marines,doubleDuty={},preAssigned={}){ const preIds=new Set(Object.values(preAssigned)); const elig=marines.filter(m=>!preIds.has(m.id)); const ddGy=elig.filter(m=>m.rank==='GYSGT'&&doubleDuty[m.id]); const normGy=elig.filter(m=>m.rank==='GYSGT'&&!doubleDuty[m.id]); const ddNon=elig.filter(m=>m.rank!=='GYSGT'&&doubleDuty[m.id]); const rest=elig.filter(m=>m.rank!=='GYSGT'&&!doubleDuty[m.id]); const order=[]; ddGy.forEach(m=>{order.push({id:m.id,turn:1});order.push({id:m.id,turn:2});}); normGy.forEach(m=>order.push({id:m.id,turn:1})); ddNon.forEach(m=>{order.push({id:m.id,turn:1});order.push({id:m.id,turn:2});}); rest.forEach(m=>order.push({id:m.id,turn:1})); return order; }

module.exports = { MONTHS, GROUP_QUOTA, gradeOf, groupOf, gradeNum, dk, getDIM, isNatWk, isWkDate, isDateValid, getAllDates, getWeekendDates, weekendQuota, selectWeekendMarines, buildDraftOrder };
