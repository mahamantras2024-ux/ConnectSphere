const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('../../backend/src/config/db');
const lead = require('../../backend/src/controllers/coordinatorLeadController');
afterEach(() => mock.restoreAll());
/** Captures handler responses while preserving asyncHandler's real error propagation. */
async function invoke(handler, body = {}, id = '7') {
  const output = { status: 200 };
  const res = { status(value) { output.status = value; return this; }, json(value) { output.body = value; } };
  await new Promise((resolve, reject) => {
    // Express wrappers finish through json/next, rather than returning the underlying handler promise.
    res.json = value => { output.body = value; resolve(); };
    handler({ body, params: { id }, user: { id: 1 } }, res, reject);
  });
  return output;
}
// AC1/AC2: SQL must exclude drafts and terminal events, and list only eligible coordinator roles.
test('AC1 AC2 - queue selects active submitted events and provisioned coordinators', async () => {
  const query = mock.method(pool, 'query', async sql => {
    if (sql.includes('FROM events')) {
      assert.match(sql, /is_draft=false/); assert.match(sql, /NOT IN \('draft','cancelled','completed'\)/);
      return { rows: [{ id: 7, coordinator_id: null }] };
    }
    assert.match(sql, /role='event_coordinator'/); return { rows: [{ id: 3 }] };
  });
  const result = await invoke(lead.workspace);
  assert.equal(result.body.events[0].coordinator_id, null); assert.equal(result.body.coordinators[0].id, 3);
  assert.equal(query.mock.callCount(), 2);
});
for (const previous of [null, 4]) {
  // AC2/AC3/AC5: initial assignment and replacement use the same single foreign key under a lock.
  test(`AC2 AC3 AC5 - assignment replaces ${previous} with exactly one coordinator`, async () => {
    const calls = [];
    const client = { release() { calls.push('release'); }, async query(sql, values) {
      calls.push(sql);
      if (sql.includes('FROM events')) { assert.match(sql, /FOR UPDATE/); return { rows: [{ id: 7, coordinator_id: previous, is_draft: false, status: 'confirmed' }] }; }
      if (sql.includes('FROM users')) { assert.deepEqual(values, [3]); return { rows: [{ id: 3 }] }; }
      if (sql.startsWith('UPDATE')) { assert.deepEqual(values, [3, 7]); return { rows: [{ id: 7, coordinator_id: 3 }] }; }
      return { rows: [] };
    } };
    mock.method(pool, 'connect', async () => client);
    const result = await invoke(lead.assign, { coordinatorId: 3, expectedCoordinatorId: previous });
    assert.equal(result.status, 200); assert.equal(result.body.event.coordinator_id, 3);
    assert.ok(calls.includes('COMMIT')); assert.equal(calls.at(-1), 'release');
  });
}
for (const scenario of ['missing','draft','cancelled','completed','stale','invalid coordinator','database error']) {
  // Each rejection proves there is no persisted handover and the transaction releases its connection.
  test(`AC2 AC3 AC5 - ${scenario} cannot change assignment`, async () => {
    const calls = [];
    // Assignment AC4: rejected requests must not create or deliver an assignment notice.
    const email=mock.method(emailService,'sendNotificationEmail',async()=>{});
    const client = { release() { calls.push('release'); }, async query(sql) {
      calls.push(sql);
      if (sql.includes('FROM events')) return { rows: scenario === 'missing' ? [] : [{ id: 7, coordinator_id: scenario === 'stale' ? 4 : null, is_draft: scenario === 'draft', status: scenario === 'draft' ? 'draft' : ['cancelled', 'completed'].includes(scenario) ? scenario : 'submitted' }] };
      if (sql.includes('FROM users')) { if (scenario === 'database error') throw new Error('offline'); return { rows: [] }; }
      return { rows: [] };
    } };
    mock.method(pool, 'connect', async () => client);
    if (scenario === 'database error') await assert.rejects(invoke(lead.assign, { coordinatorId: 3, expectedCoordinatorId: null }), /offline/);
    else assert.equal((await invoke(lead.assign, { coordinatorId: 3, expectedCoordinatorId: null })).status, scenario === 'stale' ? 409 : scenario === 'invalid coordinator' ? 400 : 404);
    assert.equal(calls.some(sql => sql.includes('INSERT INTO notifications')),false);
    assert.equal(email.mock.callCount(),0);
    assert.equal(calls.some(sql => sql.startsWith('UPDATE')), false); assert.ok(calls.includes('ROLLBACK')); assert.equal(calls.at(-1), 'release');
  });
}
for (const coordinatorId of [0, 1, 2, 2147483646, 2147483647, 2147483648, '3', null]) {
  // AC2: the integer ID boundaries are literal PostgreSQL limits, not inferred from production code.
  test(`AC2 - coordinator identifier boundary ${coordinatorId}`, async () => {
    mock.method(pool, 'connect', async () => { throw new Error('valid boundary reached database'); });
    const operation = invoke(lead.assign, { coordinatorId, expectedCoordinatorId: null });
    if ([1,2,2147483646,2147483647].includes(coordinatorId)) await assert.rejects(operation, /valid boundary/);
    else assert.equal((await operation).status, 400);
  });
}

for (const [id, expectedCoordinatorId] of [['0',null],['2147483648',null],['abc',null],['7',undefined],['7',0],['7',2147483648],['7','3']]) {
  // AC2/AC5: malformed route identifiers and missing/stale-shape preconditions cannot reach persistence.
  test(`AC2 AC5 - rejects event ${id} with assignment precondition ${expectedCoordinatorId}`,async()=>{
    mock.method(pool,'connect',async()=>{assert.fail('Invalid requests must not open a transaction.');});
    assert.equal((await invoke(lead.assign,{coordinatorId:3,expectedCoordinatorId},id)).status,400);
  });
}

// AC2: a missing JSON body must be a validation error rather than an uncaught property access.
test('AC2 - missing assignment body is rejected without persistence',async()=>{
  const connect = mock.method(pool,'connect',async()=>{assert.fail('A missing body must not acquire a database connection.');});
  assert.equal((await invoke(lead.assign,null)).status,400);
  assert.equal(connect.mock.callCount(),0);
});

const emailService = require('../../backend/src/services/emailService');
/** Keeps assignment and notification SQL real while simulating only database and email transport. */
function assignmentDatabase(previous, failure, name = 'Workshop') {
  const calls = [];
  mock.method(pool,'connect',async()=>({
    release(){calls.push({sql:'release'});},
    async query(sql,values){
      calls.push({sql,values});
      if(sql==='COMMIT' && failure==='commit')throw new Error('commit failed');
      if(sql.includes('INSERT INTO notifications')){
        if(failure==='notification')throw new Error('notification failed');
        return {rows:[{email:'chris@example.test',title:values[4][0],message:values[5][0]}]};
      }
      if(sql.includes('FROM events'))return {rows:[{id:7,coordinator_id:previous,is_draft:false,status:'submitted'}]};
      if(sql.includes('FROM users'))return {rows:[{id:3}]};
      if(sql.startsWith('UPDATE'))return {rows:[{id:7,name,coordinator_id:3}]};
      return {rows:[]};
    },
  }));
  const email=mock.method(emailService,'sendNotificationEmail',async()=>{
    calls.push({sql:'email'});
    if(failure==='email')throw new Error('mail offline');
  });
  return {calls,email};
}
for(const previous of [null,4])test(`Assignment notification AC1 AC2 - assignment from ${previous} notifies only the new coordinator after commit`,async()=>{
  const {calls,email}=assignmentDatabase(previous);
  assert.equal((await invoke(lead.assign,{coordinatorId:3,expectedCoordinatorId:previous})).status,200);
  const note=calls.find(call=>call.sql.includes('INSERT INTO notifications'));
  assert.ok(note,'assignment must persist an owner-specific notification');
  assert.deepEqual(note.values.slice(0,4),[[3],[7],[null],['event_coordinator_assigned']]);
  assert.equal(note.values[4][0],'Event assigned: Workshop');
  assert.match(note.values[5][0],/assigned.*Workshop/);
  assert.equal(email.mock.callCount(),1);
  assert.deepEqual(calls.filter(call=>['BEGIN','COMMIT','release','email'].includes(call.sql)).map(call=>call.sql),['BEGIN','COMMIT','release','email']);
});
test('Assignment notification AC3 - saving the same coordinator sends no duplicate',async()=>{
  const {calls,email}=assignmentDatabase(3);
  assert.equal((await invoke(lead.assign,{coordinatorId:3,expectedCoordinatorId:3})).status,200);
  assert.equal(calls.some(call=>call.sql.includes('INSERT INTO notifications')),false);
  assert.equal(email.mock.callCount(),0);
});
for(const failure of ['notification','commit'])test(`Assignment notification AC4 - ${failure} failure rolls back and sends no email`,async()=>{
  const {calls,email}=assignmentDatabase(null,failure);
  await assert.rejects(invoke(lead.assign,{coordinatorId:3,expectedCoordinatorId:null}),new RegExp(`${failure} failed`));
  assert.equal(calls.at(-2).sql,'ROLLBACK');assert.equal(calls.at(-1).sql,'release');
  assert.equal(email.mock.callCount(),0);
});
test('Assignment notification AC4 - email failure preserves the committed assignment and in-app notice',async()=>{
  const {calls}=assignmentDatabase(null,'email');
  mock.method(console,'error',()=>{});
  assert.equal((await invoke(lead.assign,{coordinatorId:3,expectedCoordinatorId:null})).status,200);
  assert.ok(calls.some(call=>call.sql==='COMMIT'));
  assert.equal(calls.some(call=>call.sql==='ROLLBACK'),false);
});

// AC1 boundary: the event name stays complete in the message when the title reaches its storage limit.
for(const delta of [-1,0,1])test(`Assignment notification AC1 - title length boundary offset ${delta}`,async()=>{
  const prefix='Event assigned: ';
  const name='x'.repeat(255-prefix.length+delta);
  const {calls}=assignmentDatabase(null,undefined,name);
  assert.equal((await invoke(lead.assign,{coordinatorId:3,expectedCoordinatorId:null})).status,200);
  const note=calls.find(call=>call.sql.includes('INSERT INTO notifications'));
  assert.equal(note.values[4][0],(prefix+name).slice(0,255));
  assert.ok(note.values[5][0].includes(name));
});
