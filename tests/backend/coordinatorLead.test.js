const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('../../backend/src/config/db');
const lead = require('../../backend/src/controllers/coordinatorLeadController');
afterEach(() => mock.restoreAll());
/** Captures handler responses while preserving asyncHandler's real error propagation. */
async function invoke(handler, body = {}, id = '7', role = 'event_coordinator_lead') {
  const output = { status: 200 };
  const res = { status(value) { output.status = value; return this; }, json(value) { output.body = value; } };
  await new Promise((resolve, reject) => {
    // Express wrappers finish through json/next, rather than returning the underlying handler promise.
    res.json = value => { output.body = value; resolve(); };
    handler({ body, params: { id }, user: { id: 1, role } }, res, reject);
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
      if (sql.startsWith('INSERT INTO event_coordinator_history')) { assert.deepEqual(values, [7, previous, 3, 1, 'confirmed']); return { rows: [] }; }
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
    const client = { release() { calls.push('release'); }, async query(sql) {
      calls.push(sql);
      if (sql.includes('FROM events')) return { rows: scenario === 'missing' ? [] : [{ id: 7, coordinator_id: scenario === 'stale' ? 4 : null, is_draft: scenario === 'draft', status: scenario === 'draft' ? 'draft' : ['cancelled', 'completed'].includes(scenario) ? scenario : 'submitted' }] };
      if (sql.includes('FROM users')) { if (scenario === 'database error') throw new Error('offline'); return { rows: [] }; }
      return { rows: [] };
    } };
    mock.method(pool, 'connect', async () => client);
    if (scenario === 'database error') await assert.rejects(invoke(lead.assign, { coordinatorId: 3, expectedCoordinatorId: null }), /offline/);
    else assert.equal((await invoke(lead.assign, { coordinatorId: 3, expectedCoordinatorId: null })).status, scenario === 'stale' ? 409 : scenario === 'invalid coordinator' ? 400 : 404);
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

// Handover AC3: reading an old assignment must never bypass the event's current permissions.
for(const id of ['0','abc','2147483648']) test(`Handover AC3 - history rejects invalid event ${id}`,async()=>{
  assert.equal((await invoke(lead.assignmentHistory,{},id)).status,400);
});
test('Handover AC1 AC3 - an unrelated viewer cannot retrieve assignment history',async()=>{
  const model=require('../../backend/src/models/eventModel');
  mock.method(model,'findAccessibleById',async()=>null);
  assert.equal((await invoke(lead.assignmentHistory)).status,404);
});
for(const role of ['event_coordinator_lead','event_coordinator','event_organiser']) test(`Handover AC1 AC3 - ${role} history read repeats current access inside the data query`,async()=>{
  const model=require('../../backend/src/models/eventModel');
  mock.method(model,'findAccessibleById',async()=>({id:7}));
  const history=[{id:1,event_id:7,previous_coordinator_id:2,new_coordinator_id:3,changed_by:1}];
  const query=mock.method(pool,'query',async()=>({rows:history}));
  assert.deepEqual((await invoke(lead.assignmentHistory,{},'7',role)).body,{history});
  const [sql,values]=query.mock.calls[0].arguments;
  assert.match(sql,/EXISTS\(SELECT 1 FROM events/);
  assert.match(sql,role==='event_coordinator_lead'?/e\.is_draft=false/:role==='event_organiser'?/e\.organiser_id=\$2/:/e\.coordinator_id=\$2/);
  assert.deepEqual(values,role==='event_coordinator_lead'?['7']:['7',1]);
});
test('Handover AC3 - saving the same coordinator creates neither a history entry nor a new notice',async()=>{
  const calls=[];
  mock.method(pool,'connect',async()=>({release(){},async query(sql){calls.push(sql);
    if(sql.includes('FROM events'))return {rows:[{id:7,name:'Confirmed event',status:'confirmed',coordinator_id:3}]};
    if(sql.includes('FROM users'))return {rows:[{id:3}]};
    if(sql.startsWith('UPDATE events'))return {rows:[{id:7,coordinator_id:3,status:'confirmed'}]};
    return {rows:[]};
  }}));
  assert.equal((await invoke(lead.assign,{coordinatorId:3,expectedCoordinatorId:3})).status,200);
  assert.equal(calls.some(sql=>sql.includes('INSERT INTO event_coordinator_history')),false);
  assert.equal(calls.some(sql=>sql.includes('INSERT INTO notifications')),false);
});
test('Handover AC2 AC3 - an audit failure rolls back the reassignment and does not commit',async()=>{
  const calls=[];let released=false;
  mock.method(pool,'connect',async()=>({release(){released=true;},async query(sql){calls.push(sql);
    if(sql.startsWith('INSERT INTO event_coordinator_history'))throw new Error('Audit unavailable');
    if(sql.includes('FROM events'))return {rows:[{id:7,name:'Confirmed event',status:'confirmed',coordinator_id:2}]};
    if(sql.includes('FROM users'))return {rows:[{id:3}]};
    if(sql.startsWith('UPDATE events'))return {rows:[{id:7,coordinator_id:3,status:'confirmed'}]};
    return {rows:[]};
  }}));
  await assert.rejects(invoke(lead.assign,{coordinatorId:3,expectedCoordinatorId:2}),/Audit unavailable/);
  assert.equal(calls.at(-1),'ROLLBACK');assert.equal(calls.includes('COMMIT'),false);assert.equal(released,true);
});
