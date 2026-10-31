// Real settings services/controllers and deadline rules; only PostgreSQL transport is replaced.
const {test,beforeEach,afterEach,after,mock}=require('node:test');
const assert=require('node:assert/strict');
const {pool}=require('../../backend/src/config/db');
const {saveDeadlines,setRegistrationOpen}=require('../../backend/src/services/registrationSettings');
const controller=require('../../backend/src/controllers/registrationSettingsController');
let state;
const deadlines={registrationDeadline:'2030-11-01T09:00:00Z',withdrawalDeadline:'2030-11-01T08:30:00Z'};
/** Returns raw records and captures SQL parameters; no mock computes approval or eligibility decisions. */
async function query(sql,args=[]){
  state.calls.push({sql,args});
  if(/^(BEGIN|COMMIT|ROLLBACK)/.test(sql))return {rows:[]};
  if(sql.includes('FROM events e'))return {rows:state.event?[structuredClone(state.event)]:[]};
  if(sql.startsWith('UPDATE events SET registration_deadline')){
    state.writes.push(args);return {rows:[{...state.event,registration_deadline:args[0],withdrawal_deadline:args[1]}]};
  }
  if(sql.startsWith('UPDATE events SET registration_open')){
    state.writes.push(args);return {rows:[{...state.event,registration_open:args[0]}]};
  }
  if(sql.startsWith('INSERT INTO event_change_requests')){
    state.requests.push(args);return {rows:[{id:10,status:'pending',requested_changes:JSON.parse(args[3])}]};
  }
  if(sql.includes('WITH inserted')){
    if(state.failNotice)throw Error('Notice failed');state.notices.push(args);return {rows:[]};
  }
  throw Error(`Unexpected settings SQL: ${sql}`);
}
beforeEach(()=>{
  mock.timers.enable({apis:['Date'],now:Date.parse('2030-11-01T08:00:00Z')});
  state={calls:[],writes:[],requests:[],notices:[],released:0,event:{id:7,name:'Workshop',organiser_id:3,coordinator_id:4,
    is_draft:true,status:'draft',registration_required:true,registration_open:false,registration_capacity:40,
    proposed_date:'2030-11-01',proposed_start_time:'18:00:00',starts_at:'2030-11-01T10:00:00Z',
    registration_deadline:null,withdrawal_deadline:null}};
  mock.method(pool,'connect',async()=>({query,release(){state.released++;}}));
});
afterEach(()=>{mock.restoreAll();mock.timers.reset();});after(()=>pool.end());
test('Registration settings AC1 - draft owner saves two independent accepted cutoffs',async()=>{
  // Arrange / Act: exercise the real controller's draft response as well as service persistence.
  let response,status;const res={status(value){status=value;return this;},json(value){response=value;}};
  await controller.save({params:{id:'7'},user:{id:3},body:deadlines},res);
  // Assert: only draft settings change directly; both independently normalized instants are stored.
  assert.equal(status,200);assert.equal(response.event.registration_deadline,'2030-11-01T09:00:00.000Z');
  assert.equal(response.event.withdrawal_deadline,'2030-11-01T08:30:00.000Z');assert.equal(state.requests.length,0);
  assert.deepEqual(state.calls.find(call=>call.sql.includes('FROM events e')).args,['7',3]);
});
test('Registration settings AC1 AC7 - clearing one cutoff retains the other accepted deadline',async()=>{
  // Arrange: partial changes must never clear an independent accepted cutoff by omission.
  state.event.registration_deadline=deadlines.registrationDeadline;state.event.withdrawal_deadline=deadlines.withdrawalDeadline;
  // Act / Assert: a null withdrawal cutoff restores start fallback while registration stays unchanged.
  const result=await saveDeadlines(7,3,{withdrawalDeadline:null});
  assert.equal(result.event.withdrawal_deadline,null);assert.equal(result.event.registration_deadline,deadlines.registrationDeadline);
  state.event.registration_deadline=null;state.event.withdrawal_deadline=null;
  assert.equal((await saveDeadlines(7,3,{withdrawalDeadline:null})).event.registration_deadline,null);
});
for(const eventId of [2147483646,2147483647,2147483648])test(`Registration settings AC1 AC8 - PostgreSQL ID upper boundary ${eventId}`,async()=>{
  // Arrange / Act / Assert: valid-but-missing IDs produce 404; an out-of-range integer is rejected before SQL.
  state.event=null;
  await assert.rejects(saveDeadlines(eventId,3,deadlines),error=>error.status===(eventId<=2147483647?404:400));
  assert.equal(state.writes.length,0);
});
test('Registration settings AC2 - submitted deadline edits become requests without replacing accepted values',async()=>{
  // Arrange: submission is sufficient to require review even before any venue has been confirmed.
  state.event.is_draft=false;state.event.status='submitted';
  let result,status;const res={status(value){status=value;return this;},json(value){result=value;}};
  // Act / Assert: 202/pending and a durable notification preserve the accepted event fields.
  await controller.save({params:{id:'7'},user:{id:3},body:deadlines},res);
  assert.equal(status,202);assert.equal(result.changeRequest.status,'pending');assert.equal(state.writes.length,0);
  assert.deepEqual(state.notices[0][0],[4]);assert.equal(state.requests[0][2],4);
});
test('Registration settings AC2 - no assigned Coordinator prevents a submitted deadline request',async()=>{
  // Arrange / Act / Assert: a submitted request must have an actual reviewer, not change deadlines silently.
  state.event.is_draft=false;state.event.coordinator_id=null;
  await assert.rejects(saveDeadlines(7,3,deadlines),error=>error.status===409);
  assert.equal(state.writes.length,0);assert.equal(state.requests.length,0);
});
test('Registration settings AC2 - notification failure rolls back the pending deadline request',async()=>{
  // Arrange / Act / Assert: the request cannot commit while its assigned Coordinator remains unnotified.
  state.event.is_draft=false;state.failNotice=true;
  await assert.rejects(saveDeadlines(7,3,deadlines),/Notice failed/);
  assert.ok(state.calls.some(call=>call.sql==='ROLLBACK'));assert.equal(state.calls.some(call=>call.sql==='COMMIT'),false);
  assert.equal(state.released,1);
});
test('Registration settings AC3 - a deadline after start prevents both draft saving and submitted requests',async()=>{
  // Arrange / Act / Assert: the same rule applies independently of the event's submission state.
  for(const draft of [true,false]){
    state.event.is_draft=draft;
    await assert.rejects(saveDeadlines(7,3,{registrationDeadline:'2030-11-01T10:00:00.001Z'}),error=>error.status===400);
  }
  assert.equal(state.writes.length,0);assert.equal(state.requests.length,0);
});
test('Registration settings AC1 AC8 - invalid or inaccessible event IDs cannot mutate settings',async()=>{
  // Arrange / Act / Assert: validate route identity and fail closed before any settings write.
  await assert.rejects(saveDeadlines('bad',3,deadlines),error=>error.status===400);
  state.event=null;
  await assert.rejects(saveDeadlines(7,8,deadlines),error=>error.status===404);
  assert.equal(state.writes.length,0);
});
test('Registration settings AC8 AC9 - owner opens a Confirmed event then can explicitly close it',async()=>{
  // Arrange: capacity and accepted cutoffs are valid, but registration initially remains closed.
  state.event.is_draft=false;state.event.status='confirmed';
  let result;const res={json(value){result=value;}};
  // Act / Assert: real controller passes the authenticated owner and opening uses the accepted server values.
  await controller.setOpen({params:{id:'7'},user:{id:3},body:{open:true}},res);
  assert.equal(result.event.registration_open,true);
  assert.equal((await setRegistrationOpen(7,3,{open:false})).event.registration_open,false);
});
for(const status of ['draft','submitted','approved'])test(`Registration settings AC8 - ${status} event cannot open registration`,async()=>{
  // Arrange / Act / Assert: only final Confirmed, never an earlier approval, can be manually opened.
  state.event.status=status;state.event.is_draft=status==='draft';
  await assert.rejects(setRegistrationOpen(7,3,{open:true}),error=>error.status===409);
  assert.equal(state.writes.length,0);
});
test('Registration settings AC4 AC8 - manual opening cannot bypass a passed cutoff',async()=>{
  // Arrange: event is Confirmed but its accepted registration deadline is exactly now.
  state.event.is_draft=false;state.event.status='confirmed';state.event.registration_deadline='2030-11-01T08:00:00Z';
  // Act / Assert: opening cannot reopen an expired registration window.
  await assert.rejects(setRegistrationOpen(7,3,{open:true}),error=>error.status===409 && /closed/i.test(error.message));
  assert.equal(state.writes.length,0);
});
for(const body of [null,{}, {open:'yes'},{open:true,organiserId:999}])test(`Registration settings AC8 AC9 - invalid availability payload ${JSON.stringify(body)}`,async()=>{
  // Arrange / Act / Assert: a control accepts one explicit boolean and cannot smuggle owner/deadline changes.
  await assert.rejects(setRegistrationOpen(7,3,body),error=>error.status===400);
  assert.equal(state.calls.length,0);
});

for (const titleLength of [254, 255, 256, 255 + 'Registration deadline change: '.length]) {
  test(`Registration settings AC2 - a ${titleLength}-character notice title cannot prevent a submitted deadline request`, async () => {
    // Arrange: PostgreSQL permits 255 Unicode characters in an event name, even when they use surrogate pairs in JavaScript.
    const prefix = 'Registration deadline change: ';
    const eventName = '🎉'.repeat(titleLength - prefix.length);
    state.event = { ...state.event, name: eventName, is_draft: false, status: 'submitted', registration_deadline: '2030-11-01T08:15:00Z' };
    // Act: execute real amendment and notification logic; only database transport is mocked.
    const result = await saveDeadlines(7, 3, deadlines);
    // Assert: the title fits the database, while the full name and requested cutoffs remain available for review.
    assert.equal(state.notices[0][4][0], prefix + '🎉'.repeat(Math.min(titleLength, 255) - prefix.length));
    assert.ok(state.notices[0][5][0].includes(eventName));
    assert.deepEqual(JSON.parse(state.notices[0][6][0]).changes, { registrationDeadline: '2030-11-01T09:00:00.000Z', withdrawalDeadline: '2030-11-01T08:30:00.000Z' });
    assert.equal(result.changeRequest.status, 'pending');
    assert.equal(state.requests.length, 1);
    assert.equal(state.writes.length, 0);
    assert.equal(state.event.registration_deadline, '2030-11-01T08:15:00Z');
    assert.ok(state.calls.some(call => call.sql === 'COMMIT'));
    assert.equal(state.calls.some(call => call.sql === 'ROLLBACK'), false);
  });
}
