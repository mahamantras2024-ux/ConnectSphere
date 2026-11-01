// Reconsider AC2–AC4: policy boundaries and transactional failures; PostgreSQL suite verifies the real SQL and concurrency.
const { test, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('../../backend/src/config/db');
const notifications = require('../../backend/src/services/notificationService');
const { blocker, reconsiderEvent } = require('../../backend/src/services/eventReconsideration');
afterEach(() => mock.restoreAll());
const rejection = {id:1,kind:'review',outcome:'rejected',occurred_at:'2030-01-01T00:00:00Z',details:{}};
const correction = {id:2,kind:'correction',occurred_at:'2030-01-02T00:00:00Z',details:{changes:[{field:'purpose',before:'',after:'Corrected'}]}};
const event = {id:7,name:'Community workshop',organiser_id:1,coordinator_id:2,status:'rejected',is_draft:false};
for (const [label, current, history, pending, code] of [
  ['cancelled',{...event,status:'cancelled'},[],false,'CANCELLED_FINAL'],
  ['draft',{...event,is_draft:true},[],false,'NOT_REJECTED'],
  ['already reopened',{...event,status:'under_review'},[],false,'NOT_REJECTED'],
  ['missing rejection',event,[],false,'CORRECTION_REQUIRED'],
  ['missing correction',event,[rejection],false,'CORRECTION_REQUIRED'],
  ['correction before rejection',event,[{...correction,occurred_at:'2029-12-31'},rejection],false,'CORRECTION_REQUIRED'],
  ['correction at the same displayed millisecond',event,[rejection,{...correction,occurred_at:rejection.occurred_at}],false,null],
  ['empty correction',event,[rejection,{...correction,details:{changes:[]}}],false,'CORRECTION_REQUIRED'],
  ['invalid correction',event,[rejection,{...correction,details:{changes:null}}],false,'CORRECTION_REQUIRED'],
  ['pending work',event,[rejection,correction],true,'REVIEW_WORK_PENDING'],
  ['corrected',event,[rejection,correction],false,null],
  ['waiting transaction timestamp cannot reuse old corrections',event,[rejection,correction,{...rejection,id:3,occurred_at:'2029-12-31'}],false,'CORRECTION_REQUIRED'],
  ['fresh rejection after an old correction',event,[rejection,correction,{...rejection,id:3,occurred_at:'2030-01-03'}],false,'CORRECTION_REQUIRED'],
]) test(`Reconsider AC2 AC4 - ${label} is evaluated against the current review`, () => {
  const result = blocker(current,history,pending);
  assert.equal(result?.code || null,code);
});

/** Only the database and email boundaries are replaced; the service still performs validation and controls the transaction. */
function transaction({found=true,history=[rejection,correction],pending=false,failNotice=false}={}) {
  const queries = []; let released=false;
  mock.method(pool,'connect',async()=>({query:async(sql,values)=>{
    queries.push({sql,values});
    if(sql.startsWith('SELECT * FROM events'))return {rows:found?[event]:[]};
    if(sql.includes('SELECT h.*'))return {rows:history};
    if(sql.includes(' AS pending'))return {rows:[{pending}]};
    if(sql.startsWith('UPDATE events'))return {rows:[{...event,status:'under_review'}]};
    return {rows:[]};
  },release(){released=true;}}));
  const insert=mock.method(notifications,'insertNotifications',async(_,notes)=>{if(failNotice)throw new Error('Notice unavailable');return notes;});
  const mail=mock.method(notifications,'emailNotifications',async()=>{});
  return {queries,insert,mail,released:()=>released};
}
test('Reconsider AC2 AC3 - successful transaction commits the correct version before emailing',async()=>{
  const tx=transaction();
  assert.equal((await reconsiderEvent(7,2,1)).status,'under_review');
  assert.equal(tx.queries.at(-1).sql,'COMMIT');
  assert.deepEqual(tx.queries[1].values,[7,2]);
  const note=tx.insert.mock.calls[0].arguments[1][0];
  assert.equal(note.eventId,7);assert.equal(note.userId,1);assert.equal(note.details.rejectionId,1);
  assert.equal(tx.mail.mock.callCount(),1);assert.equal(tx.released(),true);
});
for(const [label,options,version,status] of [
  ['unrelated coordinator',{found:false},1,404],
  ['missing correction',{history:[rejection]},1,409],
  ['stale rejection',{},99,409],
  ['notice failure',{failNotice:true},1,undefined],
])test(`Reconsider AC2 AC3 - ${label} rolls back and never emails`,async()=>{
  const tx=transaction(options);
  await assert.rejects(reconsiderEvent(7,9,version),error=>status?error.status===status:error.message==='Notice unavailable');
  assert.equal(tx.queries.at(-1).sql,'ROLLBACK');assert.equal(tx.mail.mock.callCount(),0);assert.equal(tx.released(),true);
});
