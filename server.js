const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const RANK_TO_GRADE={PVT:'E1',PFC:'E2',LCPL:'E3',CPL:'E4',SGT:'E5',SSGT:'E6',GYSGT:'E7'};
const GRADE_NUM={E1:1,E2:2,E3:3,E4:4,E5:5,E6:6,E7:7};
const BURDEN_GROUP={E1:'junior',E2:'junior',E3:'junior',E4:'junior',E5:'junior',E6:'ssgt',E7:'gysgt'};
const GROUP_QUOTA={junior:0.60,ssgt:0.25,gysgt:0.15};
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];

const gradeOf=r=>RANK_TO_GRADE[r]||'E1';
const groupOf=r=>BURDEN_GROUP[gradeOf(r)]||'junior';
const gradeNum=r=>GRADE_NUM[gradeOf(r)]||1;
const dName=m=>m?`${m.rank} ${m.lastName}${m.firstName?' '+m.firstName:''}`.toUpperCase():'';
const dk=(y,m,d)=>`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
const getDIM=(y,m)=>new Date(y,m+1,0).getDate();
const isNatWk=(y,m,d)=>{const w=new Date(y,m,d).getDay();return w===0||w===6;};
const isConsec=(d,list)=>list.some(a=>Math.abs(d-a)===1);
const consecPrev=(d,last,y,m)=>{if(last==null)return false;const lm=m===0?getDIM(y-1,11):getDIM(y,m-1);return last===lm&&d===1;};

// ─── STATE ───────────────────────────────────────────────────────────────────
let appState=getInitialState();

// Server-side timer — lives entirely in Node, tamper-proof
const draftTimer={running:false,paused:false,turnEndsAt:null,pausedRemaining:null,interval:null};

function getInitialState(){
  return {
    phase:'setup',year:getTargetYear(),month:getTargetMonth(),
    marines:getDefaultMarines(),
    history:{weekendBurden:{junior:[],ssgt:[],gysgt:[]},extraDuty:[],dutyHistory:{junior:[],ssgt:[],gysgt:[]},lastDutyDay:{}},
    turnMins:3,
    blackouts:[],extraWk:[],workdays:[],
    preAssigned:{},preAssignReasons:{},pendingPreAssignNotifs:[],
    weekendDates:[],wkAssigneeIds:[],wkAssignees:{junior:[],ssgt:[],gysgt:[]},
    doubleDuty:{},shortMonth:false,shortRoster:null,
    prefs:{},nonAvail:{},assignments:{},
    draftOrder:[],draftIdx:0,draftLive:false,draftPaused:false,draftDone:false,
    draftScheduled:null,turnSecsRemaining:0,
    voluntaryWkTakers:[],freedMarines:[],
    notifications:[{id:1,title:'DUTYDRAFT READY',body:'Roster loaded. NCOIC: begin setup for next month.',icon:'🛡',unread:true,targetMid:null,ts:Date.now()}]
  };
}

function getTargetMonth(){const m=new Date().getMonth();return m===11?0:m+1;}
function getTargetYear(){const now=new Date();return now.getMonth()===11?now.getFullYear()+1:now.getFullYear();}

function getDefaultMarines(){
  return [
    {id:'m1', rank:'GYSGT',lastName:'CASPER THE FRIENDLY GHOST',     firstName:'',active:true},
    {id:'m2', rank:'GYSGT',lastName:'NEARLY HEADLESS NICK',           firstName:'',active:true},
    {id:'m3', rank:'GYSGT',lastName:'SLIMER',                         firstName:'',active:true},
    {id:'m4', rank:'GYSGT',lastName:'MOANING MYRTLE',                 firstName:'',active:true},
    {id:'m5', rank:'GYSGT',lastName:'THE FLYING DUTCHMAN',            firstName:'',active:true},
    {id:'m6', rank:'SSGT', lastName:'ZERO',                           firstName:'',active:true},
    {id:'m7', rank:'SSGT', lastName:'BEETLEJUICE',                    firstName:'',active:true},
    {id:'m8', rank:'SSGT', lastName:'THE HEADLESS HORSEMAN',          firstName:'',active:true},
    {id:'m9', rank:'SSGT', lastName:'BLACKBEARD',                     firstName:'',active:true},
    {id:'m10',rank:'SSGT', lastName:'ANNE BOLEYN',                    firstName:'',active:true},
    {id:'m11',rank:'SSGT', lastName:'JACOB MARLEY',                   firstName:'',active:true},
    {id:'m12',rank:'SSGT', lastName:'GHOST OF CHRISTMAS PAST',        firstName:'',active:true},
    {id:'m13',rank:'SSGT', lastName:'GHOST OF CHRISTMAS PRESENT',     firstName:'',active:true},
    {id:'m14',rank:'SSGT', lastName:'GHOST OF CHRISTMAS YET TO COME', firstName:'',active:true},
    {id:'m15',rank:'SGT',  lastName:'THE BLOODY BARON',               firstName:'',active:true},
    {id:'m16',rank:'SGT',  lastName:'PROFESSOR BINNS',                firstName:'',active:true},
    {id:'m17',rank:'SGT',  lastName:'THE GREY LADY',                  firstName:'',active:true},
    {id:'m18',rank:'SGT',  lastName:'STRETCHING ROOM GHOSTS',         firstName:'',active:true},
    {id:'m19',rank:'SGT',  lastName:'PATRICK SWAYZE',                 firstName:'',active:true},
    {id:'m20',rank:'CPL',  lastName:'BRUCE WILLIS',                   firstName:'',active:true},
    {id:'m21',rank:'CPL',  lastName:'ICHABOD CRANE',                  firstName:'',active:true},
    {id:'m22',rank:'CPL',  lastName:'THE GRADY TWINS',                firstName:'',active:true},
    {id:'m23',rank:'CPL',  lastName:'BANQUO',                         firstName:'',active:true},
    {id:'m24',rank:'CPL',  lastName:'THE LIBRARIAN GHOST',            firstName:'',active:true},
    {id:'m25',rank:'LCPL', lastName:'DANNY PHANTOM',                  firstName:'',active:true},
    {id:'m26',rank:'LCPL', lastName:'BLINKY',                         firstName:'',active:true},
    {id:'m27',rank:'LCPL', lastName:'INKY',                           firstName:'',active:true},
    {id:'m28',rank:'LCPL', lastName:'CLYDE',                          firstName:'',active:true},
    {id:'m29',rank:'LCPL', lastName:'KING HAMLET',                    firstName:'',active:true}
  ];
}

// ─── NOTIFICATION HELPER ──────────────────────────────────────────────────────
function addNotif(title,body,icon='🔔',targetMid=null){
  const n={id:Date.now()+Math.random(),title,body,icon,unread:true,targetMid,ts:Date.now()};
  appState.notifications=[n,...appState.notifications].slice(0,200);
  return n;
}

// ─── DRAFT HELPERS ────────────────────────────────────────────────────────────
function isWkDate(d,state){
  const k=dk(state.year,state.month,d);
  if((state.workdays||[]).includes(k))return false;
  return isNatWk(state.year,state.month,d)||(state.extraWk||[]).includes(k);
}

function getAllDates(state){
  const total=getDIM(state.year,state.month);
  return Array.from({length:total},(_,i)=>i+1).filter(d=>!(state.blackouts||[]).includes(dk(state.year,state.month,d)));
}

function isDateValid(mid,d,asgn,state,needsWk){
  const k=dk(state.year,state.month,d);
  if((state.blackouts||[]).includes(k))return false;
  const pa=state.preAssigned||{};
  if(pa[d]&&pa[d]!==mid)return false;
  const approvedNA=new Set(((state.nonAvail||{})[mid]||[]).filter(n=>n.approved===true).map(n=>n.date));
  if(approvedNA.has(k))return false;
  if(asgn[d]&&asgn[d]!==mid)return false;
  if(asgn[d]===mid)return false;
  const myDays=Object.entries(asgn).filter(([,x])=>x===mid).map(([d])=>Number(d));
  if(isConsec(d,myDays))return false;
  const lastDay=(state.history?.lastDutyDay||{})[mid]??null;
  if(consecPrev(d,lastDay,state.year,state.month))return false;
  if(needsWk&&!isWkDate(d,state))return false;
  return true;
}

function currentNeedsWk(mid,turn,asgn,state){
  const isDD=!!(state.doubleDuty||{})[mid];
  const isWkSlotted=(state.wkAssigneeIds||[]).includes(mid);
  const isFreed=(state.freedMarines||[]).includes(mid);
  if(!isWkSlotted||isFreed)return false;
  const myDays=Object.entries(asgn||{}).filter(([,x])=>x===mid).map(([d])=>Number(d));
  const hasWk=myDays.some(d=>isWkDate(d,state));
  if(hasWk)return false;
  return isDD?turn===1:true;
}

function doAutoPick(mid,state,asgn){
  const allDates=getAllDates(state);
  const e=(state.draftOrder||[])[state.draftIdx||0];
  const turn=e?.turn||1;
  const needsWk=currentNeedsWk(mid,turn,asgn,state);
  const valid=allDates.filter(d=>isDateValid(mid,d,asgn,state,needsWk));
  if(!valid.length)return null;
  const myPrefs=((state.prefs||{})[mid]||[]).map(p=>p.day);
  const isWkSlotted=(state.wkAssigneeIds||[]).includes(mid);
  const pool=isWkSlotted?valid:[...valid].sort((a,b)=>{
    const aw=isWkDate(a,state),bw=isWkDate(b,state);
    return aw&&!bw?1:!aw&&bw?-1:0;
  });
  for(const p of myPrefs){if(pool.includes(p))return p;}
  return pool[0];
}

// Handle voluntary weekend pick — free next slotted Marine in queue
function checkVoluntaryWk(pickerMid,day,asgn,state){
  if(!isWkDate(day,state))return state;
  if((state.wkAssigneeIds||[]).includes(pickerMid))return state;
  const newVol=[...(state.voluntaryWkTakers||[])];
  if(!newVol.includes(pickerMid))newVol.push(pickerMid);
  const newFreed=[...(state.freedMarines||[])];
  const order=state.draftOrder||[];
  const searchFrom=(state.draftIdx||0)+1;
  let freedSomeone=false;
  for(let i=searchFrom;i<order.length;i++){
    const mid=order[i].id;
    const isSlotted=(state.wkAssigneeIds||[]).includes(mid);
    const alreadyFreed=newFreed.includes(mid);
    const theirDays=Object.entries({...asgn,[day]:pickerMid}).filter(([,x])=>x===mid).map(([d])=>Number(d));
    const alreadyHasWk=theirDays.some(d=>isWkDate(d,state));
    if(!isSlotted)continue;
    if(alreadyFreed)continue;
    if(!alreadyHasWk){
      newFreed.push(mid);
      const pickerM=(state.marines||[]).find(m=>m.id===pickerMid);
      const freedM=(state.marines||[]).find(m=>m.id===mid);
      if(freedM&&pickerM){
        addNotif(
          'WEEKEND OBLIGATION COVERED',
          `${dName(pickerM)} has voluntarily taken a weekend duty day. Your weekend obligation for ${MONTHS[state.month]} is fulfilled -- all dates are open on your turn.`,
          '🟢',mid
        );
      }
      freedSomeone=true;
      break;
    }
  }
  return{...state,voluntaryWkTakers:newVol,freedMarines:newFreed};
}

// Advance draft after a pick (or auto-pick)
function advanceDraft(pickedDay,state){
  const e=(state.draftOrder||[])[state.draftIdx||0];
  if(!e)return finishDraft(state);
  const mid=e.id;
  const asgn={...(state.assignments||{})};
  if(pickedDay!==null)asgn[pickedDay]=mid;
  let next=pickedDay!==null?checkVoluntaryWk(mid,pickedDay,asgn,state):state;
  next={...next,assignments:asgn};
  const nextIdx=(state.draftIdx||0)+1;
  if(nextIdx>=(state.draftOrder||[]).length)return finishDraft(next);
  next={...next,draftIdx:nextIdx};
  // 3-picks-away
  const threeEntry=(state.draftOrder||[])[nextIdx+2];
  if(threeEntry){
    const m3=(state.marines||[]).find(m=>m.id===threeEntry.id);
    if(m3)addNotif('STAND BY',`${dName(m3)}: 3 picks away — prepare to select your duty date.`,'⏱',m3.id);
  }
  // Your turn
  const nextEntry=(state.draftOrder||[])[nextIdx];
  const nextM=(state.marines||[]).find(m=>m.id===nextEntry?.id);
  if(nextM){
    const isDD=!!(state.doubleDuty||{})[nextM.id];
    const lbl=isDD&&nextEntry.turn===2?' — Day 2 of 2':isDD?' — Day 1 of 2':'';
    addNotif('YOUR TURN',`${dName(nextM)}${lbl}: it is your turn. You have ${state.turnMins||3} minute(s).`,'⭐',nextM.id);
  }
  return next;
}

function finishDraft(state){
  stopTimer();
  addNotif('DRAFT COMPLETE','All duty dates assigned. NCOIC: review and publish the roster.','✅');
  return{...state,draftLive:false,draftDone:true};
}

// ─── SERVER-SIDE TIMER ────────────────────────────────────────────────────────
function stopTimer(){
  if(draftTimer.interval){clearInterval(draftTimer.interval);draftTimer.interval=null;}
  draftTimer.running=false;draftTimer.paused=false;draftTimer.turnEndsAt=null;draftTimer.pausedRemaining=null;
}

function startTurnTimer(){
  if(draftTimer.interval)clearInterval(draftTimer.interval);
  const turnMs=(appState.turnMins||3)*60*1000;
  draftTimer.turnEndsAt=Date.now()+turnMs;
  draftTimer.running=true;draftTimer.paused=false;draftTimer.pausedRemaining=null;
  appState.turnSecsRemaining=Math.round(turnMs/1000);
  appState.draftPaused=false;
  draftTimer.interval=setInterval(()=>{
    if(!appState.draftLive||appState.draftDone||appState.draftPaused)return;
    const remaining=draftTimer.turnEndsAt-Date.now();
    appState.turnSecsRemaining=Math.max(0,Math.round(remaining/1000));
    if(remaining<=0){
      const e=(appState.draftOrder||[])[appState.draftIdx||0];
      if(!e){appState=finishDraft(appState);stopTimer();return;}
      const mid=e.id;
      const m=(appState.marines||[]).find(x=>x.id===mid);
      const day=doAutoPick(mid,appState,appState.assignments||{});
      if(day!==null&&m)addNotif('DUTY DATE ASSIGNED',`${dName(m)}: time expired — assigned ${MONTHS[appState.month]} ${day}.`,'⏱',mid);
      appState=advanceDraft(day,appState);
      if(appState.draftLive&&!appState.draftDone)startTurnTimer();
    }
  },1000);
}

function pauseTimer(){
  if(!draftTimer.running||draftTimer.paused)return;
  draftTimer.paused=true;
  draftTimer.pausedRemaining=draftTimer.turnEndsAt-Date.now();
  appState.draftPaused=true;
}

function resumeTimer(){
  if(!draftTimer.paused)return;
  draftTimer.turnEndsAt=Date.now()+draftTimer.pausedRemaining;
  draftTimer.paused=false;draftTimer.pausedRemaining=null;
  appState.draftPaused=false;
}

// ─── API ROUTES ───────────────────────────────────────────────────────────────
app.get('/api/state',(req,res)=>{
  if(appState.draftLive&&!appState.draftDone&&!appState.draftPaused&&draftTimer.turnEndsAt){
    appState.turnSecsRemaining=Math.max(0,Math.round((draftTimer.turnEndsAt-Date.now())/1000));
  }
  res.json(appState);
});

app.post('/api/state',(req,res)=>{
  if(!req.body||typeof req.body!=='object')return res.status(400).json({error:'Invalid state'});
  appState={...appState,...req.body};
  res.json({ok:true});
});

// Launch draft
app.post('/api/draft/start',(req,res)=>{
  const{draftOrder,assignments}=req.body;
  appState.draftOrder=draftOrder;
  appState.assignments=assignments||{};
  appState.draftIdx=0;
  appState.draftLive=true;appState.draftDone=false;appState.draftPaused=false;
  appState.phase='draft';
  const first=(appState.marines||[]).find(m=>m.id===draftOrder[0]?.id);
  if(first){
    const isDD=!!(appState.doubleDuty||{})[first.id];
    const lbl=isDD?' — Day 1 of 2':'';
    addNotif('DRAFT STARTED',`The draft for ${MONTHS[appState.month]} ${appState.year} has begun. First up: ${dName(first)}${lbl}.`,'⭐');
    addNotif('YOUR TURN',`${dName(first)}${lbl}: it is your turn. You have ${appState.turnMins||3} minute(s).`,'⭐',first.id);
    const threeEntry=draftOrder[3];
    if(threeEntry){const m3=(appState.marines||[]).find(m=>m.id===threeEntry.id);if(m3)addNotif('STAND BY',`${dName(m3)}: 3 picks away.`,'⏱',m3.id);}
  }
  startTurnTimer();
  res.json({ok:true,state:appState});
});

// Submit pick
app.post('/api/draft/pick',(req,res)=>{
  if(!appState.draftLive||appState.draftDone)return res.status(400).json({error:'Draft not live'});
  if(appState.draftPaused)return res.status(400).json({error:'Draft is paused'});
  const{day,mid}=req.body;
  const e=(appState.draftOrder||[])[appState.draftIdx||0];
  if(!e||e.id!==mid)return res.status(400).json({error:'Not your turn'});
  const m=(appState.marines||[]).find(x=>x.id===mid);
  const isDD=!!(appState.doubleDuty||{})[mid];
  const lbl=isDD?(e.turn===2?' (Day 2)':' (Day 1)'):'';
  if(m)addNotif('SELECTION CONFIRMED',`${dName(m)}${lbl}: ${MONTHS[appState.month]} ${day} confirmed.`,'✅',mid);
  appState=advanceDraft(day,appState);
  if(appState.draftLive&&!appState.draftDone)startTurnTimer();
  res.json({ok:true,state:appState});
});

// Pause
app.post('/api/draft/pause',(req,res)=>{
  pauseTimer();
  addNotif('DRAFT PAUSED','The draft has been paused by the NCOIC.','⏸');
  res.json({ok:true});
});

// Resume
app.post('/api/draft/resume',(req,res)=>{
  resumeTimer();
  addNotif('DRAFT RESUMED','The draft has resumed.','▶️');
  res.json({ok:true});
});

// Restart draft
app.post('/api/draft/restart',(req,res)=>{
  stopTimer();
  appState={...appState,draftIdx:0,draftLive:false,draftDone:false,draftPaused:false,assignments:{},voluntaryWkTakers:[],freedMarines:[],turnSecsRemaining:0};
  addNotif('DRAFT RESTARTED','The draft has been restarted. All picks cleared.','↺');
  res.json({ok:true});
});

// Notifications
app.post('/api/notif',(req,res)=>{
  const{title,body,icon,targetMid}=req.body;
  const n=addNotif(title,body,icon||'🔔',targetMid||null);
  res.json({ok:true,notif:n});
});

app.post('/api/notif/read',(req,res)=>{
  const{mid}=req.body;
  appState.notifications=appState.notifications.map(n=>{
    if(mid==='all'||!n.targetMid||n.targetMid===mid)return{...n,unread:false};
    return n;
  });
  res.json({ok:true});
});

app.post('/api/reset',(req,res)=>{
  stopTimer();appState=getInitialState();
  res.json({ok:true});
});

app.get('/api/health',(req,res)=>{
  res.json({ok:true,phase:appState.phase,draftLive:appState.draftLive,ts:Date.now()});
});

app.get('*',(req,res)=>{
  res.sendFile(path.join(__dirname,'public','index.html'));
});

const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log(`DutyDraft running on port ${PORT}`));
