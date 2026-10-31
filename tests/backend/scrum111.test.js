// SCRUM-111: acceptance-derived gates for explicit coordinator resubmission and fresh final clearance.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const policy=require('../../backend/src/services/eventDecisionPolicy');
const {evaluateTransition}=require('../../backend/src/services/eventLifecyclePolicy');
const context={id:1,status:'planning',is_draft:false,safety_resubmission_required:true,pending_clarifications:0,
 equipment_items:[],safety_changes_open:[],bookings:[{status:'approved'}],latest_safety_check:{outcome:'rejected',notes:'Blocked exit',checked_at:'2031-01-01T00:00:00Z'},now:Date.parse('2031-01-02T00:00:00Z')};
test('SCRUM-111 AC2 - corrected arrangements require explicit coordinator resubmission before the safety queue',()=>{
 assert.equal(policy.evaluateSafetyReview(context).code,'SAFETY_RESUBMISSION_REQUIRED');
 assert.equal(policy.evaluateSafetyResubmission(context),null);
});
for(const [changes,code]of [[{bookings:[]},'VENUE_NOT_CONFIRMED'],[{equipment_items:[{item:'Projector',quantity:1}]},'TECHNICAL_NOT_CONFIRMED'],[{safety_changes_open:['venue']},'SAFETY_CHANGES_OUTSTANDING'],[{safety_resubmission_required:false},'SAFETY_RESUBMISSION_NOT_REQUIRED']])test(`SCRUM-111 AC2 - resubmission refuses ${code}`,()=>{
 // Expectations follow readiness rules, not the implementation's returned label.
 assert.equal(policy.evaluateSafetyResubmission({...context,...changes}).code,code);
});
test('SCRUM-111 AC3 - confirmation waits for resubmission then a fresh passed review',()=>{
 assert.equal(evaluateTransition('confirmed',context).code,'SAFETY_RESUBMISSION_REQUIRED');
 const submitted={...context,safety_resubmission_required:false,safety_recheck_required_at:'2031-01-02T00:00:00Z'};
 assert.equal(evaluateTransition('confirmed',submitted).code,'SAFETY_NOT_COMPLETED');
 assert.equal(evaluateTransition('confirmed',{...submitted,latest_safety_check:{outcome:'approved',checked_at:'2031-01-02T00:00:01Z'}}),null);
});

const {mock,afterEach,before,after}=require('node:test');
const {pool}=require('../../backend/src/config/db');
const service=require('../../backend/src/services/safetyRereviewService');
const decisions=require('../../backend/src/services/eventDecisionService');
const email=require('../../backend/src/services/emailService');
process.env.JWT_SECRET='scrum111-test';process.env.NODE_ENV='test';
const jwt=require('../../backend/node_modules/jsonwebtoken');
let server,base;
before(async()=>{server=require('../../backend/src/index').listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}/api/events`;});
afterEach(()=>mock.restoreAll());after(async()=>{await new Promise(resolve=>server.close(resolve));await pool.end();});
/** Supplies database rows only: real policy, scope parameters, route middleware and notification SQL remain in use. */
function fixture({required=true,missingReview=false,fail=false,role='event_coordinator',latest=context.latest_safety_check}={}){
 const event={...context,name:'Workshop',coordinator_id:8,organiser_id:2,safety_resubmission_required:required,latest_safety_check:latest};
 const calls=[],notes=[];let releases=0;
 const query=async(sql,args=[])=>{
  calls.push({sql,args});
  if(/FROM users\s+WHERE role/.test(sql))return{rows:[{id:4}]};
  if(sql.includes('FROM users WHERE'))return{rows:[{id:Number(args[0]),role,auth_version:0}]};
  if(sql.includes('AS pending_clarifications'))return{rows:Number(args[0])===1&&(args[1]===undefined||Number(args[1])===8)?[structuredClone(event)]:[]};
  if(sql.includes('INSERT INTO event_safety_resubmissions')){
   if(fail)throw new Error('Submission storage unavailable');
   return{rows:missingReview?[]:[{id:9,safety_check_id:7,coordinator_id:args[1],submitted_at:'2031-01-02T00:00:00Z'}]};
  }
  if(sql.includes('safety_resubmission_required=false')){event.safety_resubmission_required=false;event.safety_recheck_required_at='2031-01-02T00:00:00Z';}
  if(sql.includes("status='planning',safety_resubmission_required=true")){event.status='planning';event.safety_resubmission_required=true;}
  if(sql.includes('INSERT INTO event_safety_checks')){event.latest_safety_check={id:7,outcome:args[2],notes:args[3],checked_at:'2031-01-01T00:00:00Z'};return{rows:[event.latest_safety_check]};}
  if(sql.includes("SELECT 'review' AS kind"))return{rows:[{id:7,kind:'review',outcome:'rejected',notes:'Blocked exit',actor:'Safety Officer',recorded_at:'2031-01-01T00:00:00Z'}]};
  if(sql.includes('WITH inserted')){notes.push(args);return{rows:[{id:1,email:'safety@example.test',title:args[4][0],message:args[5][0]}]};}
  return{rows:[]};
 };
 mock.method(pool,'query',query);mock.method(pool,'connect',async()=>({query,release(){releases++;}}));
 const mailed=mock.method(email,'sendNotificationEmail',async()=>{});
 return{calls,notes,event,mailed,released:()=>releases};
}
/** Session identity is authoritative even when request JSON attempts to choose another coordinator. */
async function request(path='/1/safety-resubmissions',{id=8,method='POST',body={}}={}){
 const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${jwt.sign({sub:id,authVersion:0},process.env.JWT_SECRET)}`},...(method==='POST'?{body:JSON.stringify(body)}:{})});
 return{status:response.status,body:await response.json()};
}
test('SCRUM-111 AC1 - a rejected safety outcome reopens Planning and retains its reason before notifying the coordinator',async()=>{
 const db=fixture({required:false,latest:null});db.event.status='approved';
 await decisions.recordSafetyCheck(1,4,'rejected','Blocked exit');
 assert.equal(db.event.status,'planning');assert.equal(db.event.safety_resubmission_required,true);
 assert.deepEqual(db.notes[0][0],[8]);assert.match(db.notes[0][5][0],/Blocked exit/);
 assert.ok(db.calls.findIndex(c=>c.sql.includes("status='planning',safety_resubmission_required=true"))<db.calls.findIndex(c=>c.sql==='COMMIT'));
});
test('SCRUM-111 AC2 AC4 - explicit submission uses the current session and sends one safety re-review notification',async()=>{
 const db=fixture();const response=await request(undefined,{body:{coordinatorId:999}});
 assert.equal(response.status,201);assert.equal(db.event.safety_resubmission_required,false);
 assert.deepEqual(db.calls.find(c=>c.sql.includes('INSERT INTO event_safety_resubmissions')).args,['1',8]);
 assert.equal(db.notes.length,1);assert.deepEqual(db.notes[0][0],[4]);assert.match(db.notes[0][4][0],/re-review/);
 assert.equal((await request()).status,409);assert.equal(db.notes.length,1);assert.equal(db.released(),2);
});
test('SCRUM-111 AC4 - current coordinator history includes reasons and readiness',async()=>{
 fixture();const response=await request('/1/safety-review-history',{method:'GET'});
 assert.equal(response.status,200);assert.equal(response.body.required,true);assert.equal(response.body.canResubmit,true);
 assert.equal(response.body.history[0].notes,'Blocked exit');
});
for(const path of ['/1/safety-resubmissions','/1/safety-review-history'])test(`SCRUM-111 AC2 AC4 - a former coordinator cannot access ${path}`,async()=>{
 const db=fixture();assert.equal((await request(path,{id:9,method:path.endsWith('history')?'GET':'POST'})).status,404);
 assert.equal(db.notes.length,0);
});
for(const role of ['attendee','event_organiser','safety_officer'])test(`SCRUM-111 AC2 - ${role} cannot submit on behalf of the coordinator`,async()=>{
 fixture({role});assert.equal((await request()).status,403);
});
for(const id of ['0','-1','abc','2147483648'])test(`SCRUM-111 AC2 - malformed event ${id} is rejected before writing`,async()=>{
 const db=fixture();assert.equal((await request(`/${id}/safety-resubmissions`)).status,400);assert.equal(db.calls.some(c=>c.sql==='BEGIN'),false);
});
for(const id of ['2','2147483646','2147483647'])test(`SCRUM-111 AC2 - valid integer event ${id} reaches assignment-scoped lookup`,async()=>{
 fixture();assert.equal((await request(`/${id}/safety-resubmissions`)).status,404);
});
test('SCRUM-111 AC2 - missing rejection cannot create a fabricated resubmission',async()=>{
 const db=fixture({missingReview:true});assert.equal((await request()).status,409);assert.equal(db.event.safety_resubmission_required,true);
});
test('SCRUM-111 AC2 - database failure rolls back submission and suppresses email',async()=>{
 const db=fixture({fail:true});assert.equal((await request()).status,500);
 assert.ok(db.calls.some(c=>c.sql==='ROLLBACK'));assert.equal(db.calls.some(c=>c.sql==='COMMIT'),false);assert.equal(db.mailed.mock.callCount(),0);
});

test('SCRUM-111 AC4 - a completed submission leaves its history viewable without enabling another submission',async()=>{
 fixture({required:false});const response=await request('/1/safety-review-history',{method:'GET'});
 assert.equal(response.status,200);assert.equal(response.body.required,false);assert.equal(response.body.canResubmit,false);
 assert.match(response.body.blocked,/No safety resubmission/);assert.equal(response.body.history[0].notes,'Blocked exit');
});

for(const offset of [-1,0,1])test(`SCRUM-111 AC3 - passed safety check ${offset}ms from resubmission must be newer`,()=>{
 const submittedAt=Date.parse('2031-01-02T00:00:00Z');
 const blocked=evaluateTransition('confirmed',{...context,safety_resubmission_required:false,safety_recheck_required_at:new Date(submittedAt).toISOString(),latest_safety_check:{outcome:'approved',checked_at:new Date(submittedAt+offset).toISOString()}});
 assert.equal(blocked?.code??null,offset<=0?'SAFETY_NOT_COMPLETED':null);
});
test('SCRUM-111 AC2 - no session cannot submit corrected arrangements',async()=>{
 const db=fixture();const result=await fetch(base+'/1/safety-resubmissions',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 assert.equal(result.status,401);assert.equal(db.calls.some(c=>c.sql==='BEGIN'),false);
});
