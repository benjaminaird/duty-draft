require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const { getState, saveState } = db;
const auth = require('./auth');
const csps = require('csps');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Populate req.user from the bearer token on every /api request (no-op bypass
// to a synthetic admin when DUTYDRAFT_TEST_MODE=1). Guards enforce; this only reads.
app.use('/api', auth.makeAuthMiddleware(db));

app.get('/favicon.png',(req,res)=>{
  res.setHeader('Content-Type','image/png');
  res.sendFile(path.join(__dirname,'public','favicon.png'));
});
app.get('/apple-touch-icon.png',(req,res)=>{
  res.setHeader('Content-Type','image/png');
  res.sendFile(path.join(__dirname,'public','apple-touch-icon.png'));
});

// Serve the draft-order engine + burden fixture to the browser from their single
// source at the repo root / scripts dir (no duplication; Node tests require the same
// files). These are plain dependency-free JS that attach a window global.
app.get('/draft-order-engine.js',(req,res)=>{res.type('application/javascript');res.sendFile(path.join(__dirname,'draft-order-engine.js'));});
app.get('/burden-2026-q2.js',(req,res)=>{res.type('application/javascript');res.sendFile(path.join(__dirname,'scripts','data','burden-2026-q2.js'));});

app.use(express.static(path.join(__dirname,'public')));

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const RANK_TO_GRADE={PVT:'E1',PFC:'E2',LCPL:'E3',CPL:'E4',SGT:'E5',SSGT:'E6',GYSGT:'E7'};
const GRADE_NUM={E1:1,E2:2,E3:3,E4:4,E5:5,E6:6,E7:7};
const BURDEN_GROUP={E1:'junior',E2:'junior',E3:'junior',E4:'junior',E5:'junior',E6:'ssgt',E7:'gysgt'};
// DEPRECATED / UNUSED: rank-based weekend quota (E1–E5 60% / E6 25% / E7 15%).
// Weekend burden is now distributed EQUALLY across all Marines (client-side equal
// selection). weekendBurden is still stored grouped by rank for history continuity,
// but rank no longer governs weekend obligation. Kept only as documentation.
// const GROUP_QUOTA={junior:0.60,ssgt:0.25,gysgt:0.15};
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

// ─── IN-MEMORY STATE ──────────────────────────────────────────────────────────
let appState = null;
const draftTimer={running:false,paused:false,turnEndsAt:null,pausedRemaining:null,interval:null};

const { getInitialState } = require('./state-defaults');

// ─── PERSIST HELPER ───────────────────────────────────────────────────────────
async function persist(){
  try{ await saveState(appState); }
  catch(err){ console.error('persist error:',err.message); }
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

function autoFreeBlockedMarines(asgn,state){
  const order=state.draftOrder||[];
  const currentIdx=state.draftIdx||0;
  const newFreed=[...(state.freedMarines||[])];
  let anyFreed=false;
  const allDates=getAllDates(state);
  const availableWkDates=allDates.filter(d=>isWkDate(d,state)&&!asgn[d]);
  for(let i=currentIdx;i<order.length;i++){
    const mid=order[i].id;
    if(!(state.wkAssigneeIds||[]).includes(mid))continue;
    if(newFreed.includes(mid))continue;
    const myDays=Object.entries(asgn).filter(([,x])=>x===mid).map(([d])=>Number(d));
    if(myDays.some(d=>isWkDate(d,state)))continue;
    const canPickWk=availableWkDates.some(d=>isDateValid(mid,d,asgn,state,false));
    if(!canPickWk){
      newFreed.push(mid);
      const m=(state.marines||[]).find(x=>x.id===mid);
      if(m)addNotif('WEEKEND OBLIGATION WAIVED',`${dName(m)}: no weekend dates remain available. Weekend obligation waived -- all remaining dates are open on your turn.`,'🟡',mid);
      anyFreed=true;
    }
  }
  if(!anyFreed)return state;
  return{...state,freedMarines:newFreed};
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

function checkVoluntaryWk(pickerMid,day,asgn,state){
  if(!isWkDate(day,state))return state;
  if((state.wkAssigneeIds||[]).includes(pickerMid))return state;
  const pickerM=(state.marines||[]).find(m=>m.id===pickerMid);
  if(!pickerM)return state;
  const pickerGroup=groupOf(pickerM.rank);
  const newVol=[...(state.voluntaryWkTakers||[])];
  if(!newVol.includes(pickerMid))newVol.push(pickerMid);
  const newFreed=[...(state.freedMarines||[])];
  const order=state.draftOrder||[];
  const searchFrom=(state.draftIdx||0)+1;
  for(let i=searchFrom;i<order.length;i++){
    const mid=order[i].id;
    const isSlotted=(state.wkAssigneeIds||[]).includes(mid);
    const alreadyFreed=newFreed.includes(mid);
    const candidateM=(state.marines||[]).find(m=>m.id===mid);
    if(!candidateM||groupOf(candidateM.rank)!==pickerGroup)continue;
    const theirDays=Object.entries({...asgn,[day]:pickerMid}).filter(([,x])=>x===mid).map(([d])=>Number(d));
    const alreadyHasWk=theirDays.some(d=>isWkDate(d,state));
    if(!isSlotted)continue;
    if(alreadyFreed)continue;
    if(!alreadyHasWk){
      newFreed.push(mid);
      const freedM=candidateM;
      if(freedM&&pickerM)addNotif('WEEKEND OBLIGATION COVERED',`${dName(pickerM)} has voluntarily taken a weekend duty day. Your weekend obligation for ${MONTHS[state.month]} is fulfilled -- all dates are open on your turn.`,'🟢',mid);
      break;
    }
  }
  return{...state,voluntaryWkTakers:newVol,freedMarines:newFreed};
}

function advanceDraft(pickedDay,state){
  const e=(state.draftOrder||[])[state.draftIdx||0];
  if(!e)return finishDraft(state);
  const mid=e.id;
  const asgn={...(state.assignments||{})};
  if(pickedDay!==null)asgn[pickedDay]=mid;
  let next=pickedDay!==null?checkVoluntaryWk(mid,pickedDay,asgn,state):state;
  next={...next,assignments:asgn};
  next=autoFreeBlockedMarines(asgn,next);
  const nextIdx=(state.draftIdx||0)+1;
  if(nextIdx>=(state.draftOrder||[]).length)return finishDraft(next);
  next={...next,draftIdx:nextIdx};
  const threeEntry=(state.draftOrder||[])[nextIdx+2];
  if(threeEntry){
    const m3=(state.marines||[]).find(m=>m.id===threeEntry.id);
    if(m3)addNotif('STAND BY',`${dName(m3)}: 3 picks away — prepare to select your duty date.`,'⏱',m3.id);
  }
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
  const asgn={...state.assignments};
  const totalDays=getDIM(state.year,state.month);
  const unassigned=[];
  for(let d=1;d<=totalDays;d++){
    const k=dk(state.year,state.month,d);
    if((state.blackouts||[]).includes(k))continue;
    if(asgn[d])continue;
    unassigned.push(d);
  }
  if(unassigned.length>0){
    const activeMarines=(state.marines||[]).filter(m=>m.active);
    for(const d of unassigned){
      const counts={};
      activeMarines.forEach(m=>{counts[m.id]=0;});
      Object.values(asgn).forEach(mid=>{if(counts[mid]!==undefined)counts[mid]++;});
      const eligible=activeMarines
        .filter(m=>isDateValid(m.id,d,asgn,state,false))
        .sort((a,b)=>counts[a.id]-counts[b.id]);
      if(eligible.length>0){
        asgn[d]=eligible[0].id;
        const m=eligible[0];
        addNotif('AUTO-ASSIGNED',`${dName(m)}: ${MONTHS[state.month]} ${d} was unassigned after the draft and has been auto-assigned to you. Contact NCOIC if you have a conflict.`,'📋',m.id);
      } else {
        addNotif('UNASSIGNED DAY',`${MONTHS[state.month]} ${d} could not be auto-assigned. Manual assignment required in post-draft.`,'⚠️',null);
      }
    }
    addNotif('DRAFT COMPLETE',`All picks complete. ${unassigned.length} day(s) were auto-assigned after the draft. NCOIC: review and publish the roster.`,'✅');
  } else {
    addNotif('DRAFT COMPLETE','All duty dates assigned. NCOIC: review and publish the roster.','✅');
  }
  return{...state,assignments:asgn,draftLive:false,draftDone:true};
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
  draftTimer.interval=setInterval(async()=>{
    if(!appState.draftLive||appState.draftDone||appState.draftPaused)return;
    const remaining=draftTimer.turnEndsAt-Date.now();
    appState.turnSecsRemaining=Math.max(0,Math.round(remaining/1000));
    if(remaining<=0){
      const e=(appState.draftOrder||[])[appState.draftIdx||0];
      if(!e){appState=finishDraft(appState);await persist();stopTimer();return;}
      const mid=e.id;
      const m=(appState.marines||[]).find(x=>x.id===mid);
      const day=doAutoPick(mid,appState,appState.assignments||{});
      if(day!==null&&m)addNotif('DUTY DATE ASSIGNED',`${dName(m)}: time expired — assigned ${MONTHS[appState.month]} ${day}.`,'⏱',mid);
      appState=advanceDraft(day,appState);
      await persist();
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

// ─── FUNERAL CSP SOLVER ───────────────────────────────────────────────────────
function greedyFuneralFallback(availableDays,funeralMarines,funeralBurdenCounts,isEligibleFn){
  const assignment={};
  for(let i=0;i<availableDays.length;i++){
    const d=availableDays[i];
    const prevDay=i>0?availableDays[i-1]:null;
    const prevAssigned=(prevDay!==null&&d-prevDay===1)?assignment[String(prevDay)]:null;
    const eligible=funeralMarines
      .filter(fm=>isEligibleFn(fm.id,d)&&fm.id!==prevAssigned)
      .sort((a,b)=>(funeralBurdenCounts[a.id]||0)-(funeralBurdenCounts[b.id]||0));
    if(eligible.length>0) assignment[String(d)]=eligible[0].id;
  }
  return assignment;
}

function solveFuneralRoster(state){
  const {year,month,funeralMarines=[],funeralBlackouts=[],funeralExtraWk=[],funeralWorkdays=[],assignments:dutyAssignments={},nonAvail={}} = state;
  const funeralBurdenCounts=state.funeralBurdenCounts||{};
  const totalDays=getDIM(year,month);

  // Build weekend/blackout sets
  const wkSet=new Set();
  for(let d=1;d<=totalDays;d++){if(isNatWk(year,month,d))wkSet.add(d);}
  for(const dkey of funeralExtraWk){const d=parseInt(dkey.split('-').pop());if(!isNaN(d))wkSet.add(d);}
  for(const dkey of funeralWorkdays){const d=parseInt(dkey.split('-').pop());if(!isNaN(d))wkSet.delete(d);}
  const blackoutSet=new Set();
  for(const dkey of funeralBlackouts){const d=parseInt(dkey.split('-').pop());if(!isNaN(d))blackoutSet.add(d);}

  // Map funeral marines to duty marine IDs for hard-block checks
  const funeralToDutyId={};
  for(const fm of funeralMarines){
    const match=(state.marines||[]).find(m=>m.lastName&&fm.lastName&&m.lastName.toUpperCase()===fm.lastName.toUpperCase());
    if(match) funeralToDutyId[fm.id]=match.id;
  }

  // Approved N/A sets per duty marine
  const naByDutyId={};
  for(const [mid,naList] of Object.entries(nonAvail)){
    naByDutyId[mid]=new Set();
    for(const entry of naList){
      if(entry.approved===true){const d=parseInt(entry.date.split('-').pop());if(!isNaN(d))naByDutyId[mid].add(d);}
    }
  }

  // Duty day map: day -> duty marine id
  const dutyDayMap={};
  for(const [dayStr,mid] of Object.entries(dutyAssignments)) dutyDayMap[parseInt(dayStr)]=mid;

  // Available days: not weekend, not blackout
  const availableDays=[];
  for(let d=1;d<=totalDays;d++){if(!wkSet.has(d)&&!blackoutSet.has(d))availableDays.push(d);}

  // Hard-block eligibility (baked into domains)
  const isEligible=(fmId,day)=>{
    const dutyId=funeralToDutyId[fmId]||fmId;
    if(dutyDayMap[day]===dutyId) return false;
    if(naByDutyId[dutyId]?.has(day)) return false;
    return true;
  };

  let bestAssignment=null;
  let bestSpread=Infinity;

  if(funeralMarines.length>0&&availableDays.length>0){
    // Build CSP: domains sorted by burden ascending (fairness bias)
    const variables=availableDays.map(String);
    const domains={};
    let hasEmptyDomain=false;
    for(const d of availableDays){
      const eligible=funeralMarines
        .filter(fm=>isEligible(fm.id,d))
        .sort((a,b)=>(funeralBurdenCounts[a.id]||0)-(funeralBurdenCounts[b.id]||0))
        .map(fm=>fm.id);
      if(eligible.length===0) hasEmptyDomain=true;
      domains[String(d)]=eligible;
    }
    // Neighbors: consecutive calendar-day pairs only
    const neighbors={};
    for(const d of availableDays) neighbors[String(d)]=[];
    for(let i=0;i<availableDays.length-1;i++){
      const a=availableDays[i],b=availableDays[i+1];
      if(b-a===1){neighbors[String(a)].push(String(b));neighbors[String(b)].push(String(a));}
    }
    // Constraint: no same marine on consecutive days
    const constraint=(A,a,B,b)=>Math.abs(parseInt(A)-parseInt(B))!==1||a!==b;

    if(!hasEmptyDomain){
      for(let attempt=0;attempt<5;attempt++){
        try{
          const cspInst=new csps.CSP(variables,domains,neighbors,constraint);
          const result=csps.min_conflicts(cspInst,1000);
          if(!result) continue;
          // Validate: no consecutive same-marine violations remain
          let valid=true;
          for(let i=0;i<availableDays.length-1;i++){
            const a=availableDays[i],b=availableDays[i+1];
            if(b-a===1&&result[String(a)]&&result[String(a)]===result[String(b)]){valid=false;break;}
          }
          if(!valid) continue;
          // Pick result with smallest (max-min) spread in cumulative burden
          const counts={...funeralBurdenCounts};
          for(const fmId of Object.values(result)){if(fmId) counts[fmId]=(counts[fmId]||0)+1;}
          const vals=funeralMarines.map(fm=>counts[fm.id]||0);
          const spread=Math.max(...vals)-Math.min(...vals);
          if(spread<bestSpread){bestSpread=spread;bestAssignment=result;}
        }catch(e){/* attempt failed, continue */}
      }
    }
  }

  // Greedy fallback if all CSP attempts returned null/invalid
  if(!bestAssignment){
    bestAssignment=greedyFuneralFallback(availableDays,funeralMarines,funeralBurdenCounts,isEligible);
  }

  // Build full-month assignment map
  const funeralAssignments={};
  const conflictDays=[];
  for(let d=1;d<=totalDays;d++){
    if(wkSet.has(d)||blackoutSet.has(d)){funeralAssignments[d]='SNCOIC';continue;}
    const assigned=bestAssignment[String(d)]||null;
    funeralAssignments[d]=assigned;
    if(!assigned) conflictDays.push(d);
  }

  // Update cumulative burden counts for assigned days
  const updatedBurdenCounts={...funeralBurdenCounts};
  for(const fmId of Object.values(bestAssignment)){
    if(fmId) updatedBurdenCounts[fmId]=(updatedBurdenCounts[fmId]||0)+1;
  }

  return {assignments:funeralAssignments,conflictDays,updatedBurdenCounts};
}

// ─── API ROUTES ───────────────────────────────────────────────────────────────
app.get('/api/state',auth.requireAuth,(req,res)=>{
  if(appState.draftLive&&!appState.draftDone&&!appState.draftPaused&&draftTimer.turnEndsAt){
    appState.turnSecsRemaining=Math.max(0,Math.round((draftTimer.turnEndsAt-Date.now())/1000));
  }
  res.json(appState);
});

app.get('/api/backup',auth.requireAdmin,(req,res)=>{
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const filename=`dutydraft-backup-${stamp}.json`;
  res.setHeader('Content-Type','application/json');
  res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
  res.send(JSON.stringify({
    exportedAt:new Date().toISOString(),
    app:'DutyDraft',
    state:appState
  },null,2));
});

app.post('/api/state',auth.requireAuth,async(req,res)=>{
  if(!req.body||typeof req.body!=='object')return res.status(400).json({error:'Invalid state'});

  // Admins (SNCOIC / Master) drive the whole workflow — full state write.
  if(auth.isAdmin(req.user)){
    appState={...appState,...req.body};
    await persist();
    return res.json({ok:true});
  }

  // Linked Marines may ONLY update their own preferences and non-availability.
  // The client posts whole prefs/nonAvail maps; the server extracts only the
  // caller's slot and ignores everything else. Marines cannot self-approve N/A.
  const mid=req.user.marineId;
  if(!mid)return res.status(403).json({error:'Your account is not linked to a roster Marine.'});
  let changed=false;

  if(req.body.prefs&&typeof req.body.prefs==='object'){
    const mine=req.body.prefs[mid];
    appState.prefs={...(appState.prefs||{})};
    appState.prefs[mid]=Array.isArray(mine)?mine:[];
    changed=true;
  }

  if(req.body.nonAvail&&typeof req.body.nonAvail==='object'){
    const mineRaw=Array.isArray(req.body.nonAvail[mid])?req.body.nonAvail[mid]:[];
    const existing=((appState.nonAvail||{})[mid])||[];
    const priorByDate={};existing.forEach(n=>{priorByDate[n.date]=n;});
    const sanitized=mineRaw.map(n=>{
      const prev=priorByDate[n.date];
      // Preserve the admin's prior approve/deny decision; new entries are pending.
      const approved=prev?prev.approved:null;
      return{date:n.date,reason:String(n.reason||''),approved,needsDiscussion:!!n.needsDiscussion};
    });
    appState.nonAvail={...(appState.nonAvail||{})};
    appState.nonAvail[mid]=sanitized;
    changed=true;
  }

  if(!changed)return res.status(403).json({error:'Marines may only submit their own preferences and non-availability.'});
  await persist();
  res.json({ok:true});
});

app.post('/api/draft/start',auth.requireAdmin,async(req,res)=>{
  const{draftOrder,assignments,draftOrderAudit,draftOrderMode}=req.body;
  appState.draftOrder=draftOrder;
  appState.assignments=assignments||{};
  // Persist the locked audit + selected COA alongside the order, for the record.
  if(draftOrderAudit!==undefined)appState.draftOrderAudit=draftOrderAudit;
  if(draftOrderMode!==undefined)appState.draftOrderMode=draftOrderMode;
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
  await persist();
  res.json({ok:true,state:appState});
});

app.post('/api/draft/pick',auth.requireAuth,async(req,res)=>{
  if(!appState.draftLive||appState.draftDone)return res.status(400).json({error:'Draft not live'});
  if(appState.draftPaused)return res.status(400).json({error:'Draft is paused'});
  const{day,mid}=req.body;
  // A Marine may only pick for their own linked Marine. Admins running the
  // draft may submit for the Marine whose turn it is.
  if(!auth.isAdmin(req.user)&&req.user.marineId!==mid){
    return res.status(403).json({error:'You can only pick on your own turn.'});
  }
  const e=(appState.draftOrder||[])[appState.draftIdx||0];
  if(!e||e.id!==mid)return res.status(400).json({error:'Not your turn'});

  const pickedDay=Number(day);
  const allDates=getAllDates(appState);
  if(!Number.isInteger(pickedDay)||!allDates.includes(pickedDay)){
    return res.status(400).json({error:'Invalid duty date'});
  }

  const asgn=appState.assignments||{};
  const needsWk=currentNeedsWk(mid,e.turn||1,asgn,appState);
  if(!isDateValid(mid,pickedDay,asgn,appState,needsWk)){
    return res.status(400).json({error:'That date is not available for this Marine'});
  }

  const m=(appState.marines||[]).find(x=>x.id===mid);
  const isDD=!!(appState.doubleDuty||{})[mid];
  const lbl=isDD?(e.turn===2?' (Day 2)':' (Day 1)'):''
  if(m)addNotif('SELECTION CONFIRMED',`${dName(m)}${lbl}: ${MONTHS[appState.month]} ${pickedDay} confirmed.`,'✅',mid);
  appState=advanceDraft(pickedDay,appState);
  await persist();
  if(appState.draftLive&&!appState.draftDone)startTurnTimer();
  res.json({ok:true,state:appState});
});

app.post('/api/draft/pause',auth.requireAdmin,async(req,res)=>{
  pauseTimer();
  addNotif('DRAFT PAUSED','The draft has been paused by the NCOIC.','⏸');
  await persist();
  res.json({ok:true});
});

app.post('/api/draft/resume',auth.requireAdmin,async(req,res)=>{
  resumeTimer();
  addNotif('DRAFT RESUMED','The draft has resumed.','▶️');
  await persist();
  res.json({ok:true});
});

app.post('/api/draft/restart',auth.requireAdmin,async(req,res)=>{
  stopTimer();
  appState={...appState,draftIdx:0,draftLive:false,draftDone:false,draftPaused:false,assignments:{},voluntaryWkTakers:[],freedMarines:[],turnSecsRemaining:0};
  addNotif('DRAFT RESTARTED','The draft has been restarted. All picks cleared.','↺');
  await persist();
  res.json({ok:true});
});

app.post('/api/notif',auth.requireAdmin,async(req,res)=>{
  const{title,body,icon,targetMid}=req.body;
  const n=addNotif(title,body,icon||'🔔',targetMid||null);
  await persist();
  res.json({ok:true,notif:n});
});

app.post('/api/notif/read',auth.requireAuth,async(req,res)=>{
  const{mid}=req.body;
  appState.notifications=appState.notifications.map(n=>{
    if(mid==='all'||!n.targetMid||n.targetMid===mid)return{...n,unread:false};
    return n;
  });
  await persist();
  res.json({ok:true});
});

app.post('/api/reset',auth.requireAdmin,async(req,res)=>{
  stopTimer();
  // Full Reset clears the current cycle and ALL fairness history, but KEEPS the
  // roster, funeral buglers, and turn timer (do not restore the demo roster).
  const fresh=getInitialState();
  if(Array.isArray(appState.marines)&&appState.marines.length)fresh.marines=appState.marines;
  fresh.funeralMarines=appState.funeralMarines||[];
  if(appState.turnMins)fresh.turnMins=appState.turnMins;
  if(appState.draftOrderMode)fresh.draftOrderMode=appState.draftOrderMode; // keep the master's COA choice
  appState=fresh;
  await persist();
  res.json({ok:true});
});

app.get('/api/health',(req,res)=>{
  res.json({ok:true,phase:appState.phase,draftLive:appState.draftLive,ts:Date.now()});
});

// ─── AUTH & ACCOUNTS ───────────────────────────────────────────────────────────
const VALID_RANKS=new Set(['PVT','PFC','LCPL','CPL','SGT','SSGT','GYSGT']);

function normRank(r){return String(r||'').trim().toUpperCase();}

// Human-readable name for a user: linked Marine's roster name if linked,
// otherwise the rank/name captured at signup, else the username.
function userDisplayName(u){
  if(!u)return '';
  if(u.marineId){
    const m=(appState.marines||[]).find(x=>x.id===u.marineId);
    if(m)return dName(m);
  }
  if(u.role==='master')return 'MASTER ADMIN';
  const r=normRank(u.rank),ln=(u.lastName||'').trim(),fn=(u.firstName||'').trim();
  const built=`${r} ${ln}${fn?' '+fn:''}`.trim().toUpperCase();
  return built||u.username;
}

// Public-safe view of a user (never includes the password hash).
function publicUser(u){
  if(!u)return null;
  return {
    id:u.id,username:u.username,role:u.role,marineId:u.marineId||null,
    rank:u.rank||null,firstName:u.firstName||null,lastName:u.lastName||null,
    displayName:userDisplayName(u),pending:u.role==='pending'
  };
}

// Sign up -> always creates a PENDING account. Returns a token so the client
// can show the "waiting for admin assignment" screen with a live session.
app.post('/api/auth/signup',async(req,res)=>{
  const{username,password,rank,firstName,lastName}=req.body||{};
  const uname=String(username||'').trim();
  const pw=String(password||'');
  const rk=normRank(rank);
  const fn=String(firstName||'').trim();
  const ln=String(lastName||'').trim();
  if(uname.length<3)return res.status(400).json({error:'Username must be at least 3 characters.'});
  if(pw.length<4)return res.status(400).json({error:'Password must be at least 4 characters.'});
  if(!VALID_RANKS.has(rk))return res.status(400).json({error:'Please choose a valid rank.'});
  if(!fn||!ln)return res.status(400).json({error:'First and last name are required.'});
  try{
    if(await db.getUserByUsername(uname))return res.status(409).json({error:'That username is already taken.'});
    const user=await db.createUser({username:uname,passwordHash:auth.hashPassword(pw),role:'pending',marineId:null,rank:rk,firstName:fn,lastName:ln});
    const token=auth.signToken(user);
    res.json({ok:true,token,user:publicUser(user)});
  }catch(err){
    console.error('signup error:',err.message);
    res.status(500).json({error:'Could not create account.'});
  }
});

app.post('/api/auth/login',async(req,res)=>{
  const{username,password}=req.body||{};
  const uname=String(username||'').trim();
  if(!uname||!password)return res.status(400).json({error:'Username and password are required.'});
  try{
    const user=await db.getUserByUsername(uname);
    if(!user||!auth.verifyPassword(String(password),user.passwordHash)){
      return res.status(401).json({error:'Invalid username or password.'});
    }
    const token=auth.signToken(user);
    res.json({ok:true,token,user:publicUser(user)});
  }catch(err){
    console.error('login error:',err.message);
    res.status(500).json({error:'Login failed.'});
  }
});

// Current session. 401 if no/invalid token. Pending users get a 200 with their
// pending flag so the client can show the waiting screen.
app.get('/api/auth/me',async(req,res)=>{
  if(!req.user)return res.status(401).json({error:'Not authenticated'});
  try{
    const u=req.user.testMode?req.user:(await db.getUserById(req.user.id));
    if(!u)return res.status(401).json({error:'Not authenticated'});
    res.json({user:publicUser(u)});
  }catch(err){
    res.status(401).json({error:'Not authenticated'});
  }
});

app.post('/api/auth/change-password',async(req,res)=>{
  if(!req.user)return res.status(401).json({error:'Not authenticated'});
  const{currentPassword,newPassword}=req.body||{};
  const np=String(newPassword||'');
  if(np.length<4)return res.status(400).json({error:'New password must be at least 4 characters.'});
  try{
    const u=await db.getUserById(req.user.id);
    if(!u)return res.status(401).json({error:'Not authenticated'});
    if(!auth.verifyPassword(String(currentPassword||''),u.passwordHash)){
      return res.status(400).json({error:'Current password is incorrect.'});
    }
    await db.updateUser(u.id,{passwordHash:auth.hashPassword(np)});
    res.json({ok:true});
  }catch(err){
    console.error('change-password error:',err.message);
    res.status(500).json({error:'Could not change password.'});
  }
});

// Next free roster-Marine id (m1, m2, ...).
function nextMarineId(){
  let max=0;
  for(const m of (appState.marines||[])){
    const mt=/^m(\d+)$/.exec(m.id||'');
    if(mt)max=Math.max(max,Number(mt[1]));
  }
  return 'm'+(max+1);
}

// List all accounts (admin account-management view).
app.get('/api/admin/users',auth.requireAdmin,async(req,res)=>{
  try{
    const users=await db.getUsers();
    res.json({users:users.map(publicUser)});
  }catch(err){
    console.error('list users error:',err.message);
    res.status(500).json({error:'Could not load accounts.'});
  }
});

// Create a new roster Marine (no account link).
app.post('/api/admin/marines',auth.requireAdmin,async(req,res)=>{
  const rank=normRank(req.body&&req.body.rank);
  const lastName=String((req.body&&req.body.lastName)||'').trim();
  const firstName=String((req.body&&req.body.firstName)||'').trim();
  if(!VALID_RANKS.has(rank))return res.status(400).json({error:'Valid rank required.'});
  if(!lastName)return res.status(400).json({error:'Last name required.'});
  const marine={id:nextMarineId(),rank,lastName,firstName,active:true};
  appState.marines=[...(appState.marines||[]),marine];
  await persist();
  res.json({ok:true,marine});
});

// Edit an existing roster Marine's rank / name (fix spelling, matching).
app.post('/api/admin/marines/:mid',auth.requireAdmin,async(req,res)=>{
  const mid=req.params.mid;
  const marines=appState.marines||[];
  const idx=marines.findIndex(m=>m.id===mid);
  if(idx===-1)return res.status(404).json({error:'Marine not found.'});
  const patch={};
  if(req.body.rank!==undefined){
    const rank=normRank(req.body.rank);
    if(!VALID_RANKS.has(rank))return res.status(400).json({error:'Valid rank required.'});
    patch.rank=rank;
  }
  if(req.body.lastName!==undefined){
    const ln=String(req.body.lastName).trim();
    if(!ln)return res.status(400).json({error:'Last name required.'});
    patch.lastName=ln;
  }
  if(req.body.firstName!==undefined)patch.firstName=String(req.body.firstName).trim();
  appState.marines=marines.map(m=>m.id===mid?{...m,...patch}:m);
  await persist();
  res.json({ok:true,marine:appState.marines[idx]});
});

// Link a pending account to a roster Marine — existing one, or create+link.
app.post('/api/admin/users/:id/link',auth.requireAdmin,async(req,res)=>{
  try{
    const target=await db.getUserById(req.params.id);
    if(!target)return res.status(404).json({error:'Account not found.'});
    if(target.role==='master')return res.status(400).json({error:'The master admin is not a roster Marine.'});

    let marineId=req.body&&req.body.marineId;
    if(!marineId&&req.body&&req.body.newMarine){
      const nm=req.body.newMarine;
      const rank=normRank(nm.rank);
      const lastName=String(nm.lastName||'').trim();
      const firstName=String(nm.firstName||'').trim();
      if(!VALID_RANKS.has(rank))return res.status(400).json({error:'Valid rank required for the new Marine.'});
      if(!lastName)return res.status(400).json({error:'Last name required for the new Marine.'});
      const marine={id:nextMarineId(),rank,lastName,firstName,active:true};
      appState.marines=[...(appState.marines||[]),marine];
      await persist();
      marineId=marine.id;
    }
    if(!marineId)return res.status(400).json({error:'Provide a marineId or a newMarine to link.'});
    if(!(appState.marines||[]).some(m=>m.id===marineId))return res.status(400).json({error:'That roster Marine does not exist.'});

    const other=await db.getUserByMarineId(marineId);
    if(other&&String(other.id)!==String(target.id))return res.status(409).json({error:'That Marine is already linked to another account.'});

    const newRole=target.role==='pending'?'marine':target.role;
    const updated=await db.updateUser(target.id,{marineId,role:newRole});
    res.json({ok:true,user:publicUser(updated)});
  }catch(err){
    console.error('link error:',err.message);
    res.status(500).json({error:'Could not link account.'});
  }
});

// Unlink an account (revert to pending, drop SNCOIC/marine role).
app.post('/api/admin/users/:id/unlink',auth.requireAdmin,async(req,res)=>{
  try{
    const target=await db.getUserById(req.params.id);
    if(!target)return res.status(404).json({error:'Account not found.'});
    if(target.role==='master')return res.status(400).json({error:'Cannot unlink the master admin.'});
    const updated=await db.updateUser(target.id,{marineId:null,role:'pending'});
    res.json({ok:true,user:publicUser(updated)});
  }catch(err){
    console.error('unlink error:',err.message);
    res.status(500).json({error:'Could not unlink account.'});
  }
});

// Assign / transfer the single SNCOIC Admin role to a linked Marine account.
app.post('/api/admin/sncoic',auth.requireAdmin,async(req,res)=>{
  try{
    const target=await db.getUserById(req.body&&req.body.userId);
    if(!target)return res.status(404).json({error:'Account not found.'});
    if(!target.marineId)return res.status(400).json({error:'SNCOIC must be a linked Marine account.'});
    if(target.role==='master')return res.status(400).json({error:'The master admin cannot also hold the SNCOIC role.'});
    // Demote any current SNCOIC(s) back to marine — only one active at a time.
    const users=await db.getUsers();
    for(const u of users){
      if(u.role==='sncoic'&&String(u.id)!==String(target.id))await db.updateUser(u.id,{role:'marine'});
    }
    const updated=await db.updateUser(target.id,{role:'sncoic'});
    res.json({ok:true,user:publicUser(updated)});
  }catch(err){
    console.error('sncoic assign error:',err.message);
    res.status(500).json({error:'Could not assign SNCOIC.'});
  }
});

// Delete an account (master only) — e.g. removing a stale signup.
app.delete('/api/admin/users/:id',auth.requireMaster,async(req,res)=>{
  try{
    const target=await db.getUserById(req.params.id);
    if(!target)return res.status(404).json({error:'Account not found.'});
    if(target.role==='master')return res.status(400).json({error:'Cannot delete the master admin here.'});
    await db.deleteUser(target.id);
    res.json({ok:true});
  }catch(err){
    console.error('delete user error:',err.message);
    res.status(500).json({error:'Could not delete account.'});
  }
});

// ─── FUNERAL ROSTER API ───────────────────────────────────────────────────────

// GET funeral state subset
app.get('/api/funeral/state',auth.requireAuth,(req,res)=>{
  res.json({
    funeralPhase: appState.funeralPhase||'idle',
    funeralMarines: appState.funeralMarines||[],
    funeralBlackouts: appState.funeralBlackouts||[],
    funeralExtraWk: appState.funeralExtraWk||[],
    funeralWorkdays: appState.funeralWorkdays||[],
    funeralAssignments: appState.funeralAssignments||{},
    funeralConflictDays: appState.funeralConflictDays||[],
    funeralBurdenCounts: appState.funeralBurdenCounts||{},
    // Pass duty calendar for pre-population
    blackouts: appState.blackouts||[],
    extraWk: appState.extraWk||[],
    workdays: appState.workdays||[],
    year: appState.year,
    month: appState.month,
    phase: appState.phase,
  });
});

// PATCH funeral state
app.post('/api/funeral/state',auth.requireAdmin,async(req,res)=>{
  const allowed=['funeralPhase','funeralMarines','funeralBlackouts','funeralExtraWk','funeralWorkdays','funeralAssignments','funeralConflictDays','funeralBurdenCounts'];
  for(const key of allowed){
    if(req.body[key]!==undefined) appState[key]=req.body[key];
  }
  await persist();
  res.json({ok:true});
});

// POST auto-assign funeral roster
app.post('/api/funeral/auto-assign',auth.requireAdmin,async(req,res)=>{
  const result=solveFuneralRoster(appState);
  appState.funeralAssignments=result.assignments;
  appState.funeralConflictDays=result.conflictDays;
  appState.funeralBurdenCounts=result.updatedBurdenCounts;
  appState.funeralPhase='assigned';
  await persist();
  res.json({assignments:result.assignments,conflictDays:result.conflictDays});
});

// POST manually assign a conflict day
app.post('/api/funeral/manual-assign',auth.requireAdmin,async(req,res)=>{
  const{day,marineId}=req.body;
  if(!day||!marineId)return res.status(400).json({error:'day and marineId required'});
  appState.funeralAssignments[day]=marineId;
  appState.funeralConflictDays=(appState.funeralConflictDays||[]).filter(d=>d!==day);
  await persist();
  res.json({ok:true});
});

// POST publish funeral roster + notify Marines
app.post('/api/funeral/publish',auth.requireAdmin,async(req,res)=>{
  appState.funeralPhase='published';
  const monthUpper=MONTHS[appState.month].toUpperCase();
  const year=appState.year;

  for(const [dayStr,mid] of Object.entries(appState.funeralAssignments||{})){
    if(!mid||mid==='SNCOIC') continue;
    const fm=(appState.funeralMarines||[]).find(m=>m.id===mid);
    if(!fm) continue;
    // Find the duty marine id for notification routing
    const dutyMarine=(appState.marines||[]).find(m=>m.lastName&&fm.lastName&&m.lastName.toUpperCase()===fm.lastName.toUpperCase());
    const targetId=dutyMarine?dutyMarine.id:null;
    if(targetId){
      addNotif('FUNERAL BUGLER ASSIGNED',`${fm.rank} ${fm.lastName}: you are assigned as Funeral Bugler on ${monthUpper} ${dayStr}, ${year}.`,'🎺',targetId);
    }
  }

  await persist();
  res.json({ok:true});
});

// POST export funeral roster PDF
app.post('/api/export-funeral-roster',auth.requireAdmin,async(req,res)=>{
  const {execFile}=require('child_process');
  const os=require('os');
  const fs=require('fs');

  const {left_rows,right_rows}=req.body;
  const year=appState.year;
  const month=appState.month;
  const monthName=MONTHS[month];
  const monthUpper=monthName.toUpperCase();
  const MON_ABBR=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const now=new Date();
  const pubDate=`${now.getDate()} ${MON_ABBR[now.getMonth()]} ${String(now.getFullYear()).slice(2)}`;

  const payload={
    roster_type:'funeral',
    year,
    month_name:monthName,
    month_upper:monthUpper,
    pub_date:pubDate,
    left_rows,
    right_rows,
    co_name:req.body.co_name||'N. D. MORRIS'
  };

  const tmpFile=path.join(os.tmpdir(),`funeral_roster_${Date.now()}.pdf`);
  const jsonInput=JSON.stringify(payload);

  execFile('python3',['generate_roster.py',jsonInput,tmpFile],(err,stdout,stderr)=>{
    if(err){
      console.error('Funeral roster generation failed:',stderr);
      return res.status(500).send('PDF generation failed: '+stderr);
    }
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`attachment; filename="FuneralRoster_${monthUpper}_${year}.pdf"`);
    const stream=fs.createReadStream(tmpFile);
    stream.pipe(res);
    stream.on('close',()=>fs.unlink(tmpFile,()=>{}));
  });
});

// ─── NEXT MONTH ───────────────────────────────────────────────────────────────
app.post('/api/next-month',auth.requireAdmin,async(req,res)=>{
  stopTimer();
  const nextMonth=appState.month===11?0:appState.month+1;
  const nextYear=appState.month===11?appState.year+1:appState.year;

  const prevHistory=appState.history||{};
  const newWb={
    junior:[...(prevHistory.weekendBurden?.junior||[])],
    ssgt:[...(prevHistory.weekendBurden?.ssgt||[])],
    gysgt:[...(prevHistory.weekendBurden?.gysgt||[])],
  };
  const newEd=[...(prevHistory.extraDuty||[])];
  const newDh={
    junior:[...(prevHistory.dutyHistory?.junior||[])],
    ssgt:[...(prevHistory.dutyHistory?.ssgt||[])],
    gysgt:[...(prevHistory.dutyHistory?.gysgt||[])],
  };

  const allAsgn={...appState.assignments};
  Object.entries(appState.preAssigned||{}).forEach(([d,mid])=>{
    if(!allAsgn[Number(d)])allAsgn[Number(d)]=mid;
  });
  Object.entries(allAsgn).forEach(([day,mid])=>{
    if(isWkDate(Number(day),appState)){
      const m=(appState.marines||[]).find(x=>x.id===mid);
      if(!m)return;
      const g=groupOf(m.rank);
      newWb[g].push(mid);
    }
  });
  Object.entries(appState.doubleDuty||{}).forEach(([mid,count])=>{
    if(count>=2)newEd.push(mid);
  });
  Object.values(allAsgn).forEach(mid=>{
    const m=(appState.marines||[]).find(x=>x.id===mid);
    if(!m)return;
    const g=groupOf(m.rank);
    if(!newDh[g].includes(mid))newDh[g].push(mid);
  });
  const lastDutyDay={...((prevHistory.lastDutyDay)||{})};
  Object.entries(allAsgn).forEach(([day,mid])=>{
    const d=Number(day);
    if(!lastDutyDay[mid]||d>lastDutyDay[mid])lastDutyDay[mid]=d;
  });

  // Carry forward funeral burden counts
  const prevFuneralBurdenCounts=appState.funeralBurdenCounts||{};

  appState={
    phase:'setup',
    year:nextYear,
    month:nextMonth,
    marines:appState.marines,
    history:{weekendBurden:newWb,extraDuty:newEd,dutyHistory:newDh,lastDutyDay},
    turnMins:appState.turnMins||3,
    blackouts:[],extraWk:[],workdays:[],
    preAssigned:{},preAssignReasons:{},pendingPreAssignNotifs:[],
    weekendDates:[],wkAssigneeIds:[],wkAssignees:[],
    doubleDuty:{},shortMonth:false,shortRoster:null,
    prefs:{},nonAvail:{},assignments:{},
    draftOrder:[],draftIdx:0,draftLive:false,draftPaused:false,draftDone:false,
    draftScheduled:null,turnSecsRemaining:0,
    draftOrderMode:appState.draftOrderMode||'weighted_seniority',draftOrderAudit:null,
    voluntaryWkTakers:[],freedMarines:[],
    // Funeral: carry burden counts, reset everything else
    funeralPhase:'idle',
    funeralMarines:[],
    funeralBlackouts:[],
    funeralExtraWk:[],
    funeralWorkdays:[],
    funeralAssignments:{},
    funeralConflictDays:[],
    funeralBurdenCounts:prevFuneralBurdenCounts,
    notifications:[{id:Date.now(),title:'NEW MONTH',body:`${MONTHS[nextMonth]} ${nextYear} cycle started. Fairness history carried forward.`,icon:'📅',unread:true,targetMid:null,ts:Date.now()}]
  };
  await persist();
  res.json({ok:true});
});

// ─── DUTY ROSTER PDF EXPORT ───────────────────────────────────────────────────
app.post('/api/export-roster',auth.requireAdmin,async(req,res)=>{
  const {execFile}=require('child_process');
  const os=require('os');
  const fs=require('fs');
  // Add roster_type: 'duty' to the payload passed from the frontend
  const payload={...req.body,roster_type:'duty'};
  const tmpFile=path.join(os.tmpdir(),`roster_${Date.now()}.pdf`);
  const jsonInput=JSON.stringify(payload);
  execFile('python3',['generate_roster.py',jsonInput,tmpFile],(err,stdout,stderr)=>{
    if(err){
      console.error('Roster generation failed:',stderr);
      return res.status(500).send('PDF generation failed: '+stderr);
    }
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition','attachment; filename="DutyRoster.pdf"');
    const stream=fs.createReadStream(tmpFile);
    stream.pipe(res);
    stream.on('close',()=>fs.unlink(tmpFile,()=>{}));
  });
});

app.get('*',(req,res)=>{
  res.sendFile(path.join(__dirname,'public','index.html'));
});

// ─── STARTUP ──────────────────────────────────────────────────────────────────
const PORT=process.env.PORT||3000;

async function start(){
  try {
    const saved=await getState();
    if(saved){
      appState=saved;
      // Ensure funeral fields exist on older saved states
      if(appState.funeralPhase===undefined) appState.funeralPhase='idle';
      if(appState.funeralMarines===undefined) appState.funeralMarines=[];
      if(appState.funeralBlackouts===undefined) appState.funeralBlackouts=[];
      if(appState.funeralExtraWk===undefined) appState.funeralExtraWk=[];
      if(appState.funeralWorkdays===undefined) appState.funeralWorkdays=[];
      if(appState.funeralAssignments===undefined) appState.funeralAssignments={};
      if(appState.funeralConflictDays===undefined) appState.funeralConflictDays=[];
      // Migrate funeralHistory -> funeralBurdenCounts
      if(appState.funeralBurdenCounts===undefined){
        const counts={};
        for(const[,mid] of Object.entries(appState.funeralAssignments||{})){
          if(mid&&mid!=='SNCOIC') counts[mid]=(counts[mid]||0)+1;
        }
        appState.funeralBurdenCounts=counts;
        delete appState.funeralHistory;
      }
      console.log('State loaded from database. Phase:',appState.phase);
      if(appState.draftLive&&!appState.draftDone){
        appState.draftPaused=true;
        appState.turnSecsRemaining=(appState.turnMins||3)*60;
        await persist();
        console.log('Draft was live on restart — marked paused. NCOIC must resume.');
      }
    } else {
      appState=getInitialState();
      await persist();
      console.log('No saved state found — initialized fresh.');
    }
  } catch(err){
    console.error('Failed to load state from DB, using initial state:',err.message);
    appState=getInitialState();
  }
  await auth.initAuth(db);
  app.listen(PORT,()=>console.log(`DutyDraft running on port ${PORT}`));
}

start();
