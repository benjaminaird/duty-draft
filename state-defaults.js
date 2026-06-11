// Default app-state template, extracted from server.js so that scripts
// (e.g. scripts/seed-v1.js) can build a fresh state without importing the
// server (which would start listening). Behavior is identical to the original
// inline definitions — this is a verbatim move, not a logic change.

function getTargetMonth(){const m=new Date().getMonth();return m===11?0:m+1;}
function getTargetYear(){const now=new Date();return now.getMonth()===11?now.getFullYear()+1:now.getFullYear();}

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
    // ── Funeral roster state ─────────────────────────────────────────────────
    funeralPhase:'idle',
    funeralMarines:[],
    funeralBlackouts:[],
    funeralExtraWk:[],
    funeralWorkdays:[],
    funeralAssignments:{},
    funeralConflictDays:[],
    funeralBurdenCounts:{},
    notifications:[{id:1,title:'DUTYDRAFT READY',body:'Roster loaded. NCOIC: begin setup for next month.',icon:'🛡',unread:true,targetMid:null,ts:Date.now()}]
  };
}

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

module.exports = { getInitialState, getDefaultMarines, getTargetMonth, getTargetYear };
