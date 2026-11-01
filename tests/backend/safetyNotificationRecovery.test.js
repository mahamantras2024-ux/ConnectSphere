// Safety recovery AC1–AC3: only transport is mocked; the real helper builds recipient/cycle-safe SQL and delivery metadata.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {storeSafetyReadyNotifications}=require('../../backend/src/services/safetyReadyNotifications');

test('Safety recovery AC1 - no recipients performs no database write',async()=>{
  assert.deepEqual(await storeSafetyReadyNotifications({query(){assert.fail('No recipient must mean no write');}}, {id:1},[]),[]);
});
for(const [check,cycle,requirement] of [
  [null,'initial','initial'],
  [{outcome:'changes_requested',checked_at:'2030-01-02T08:00:00+08:00'},'2030-01-02T00:00:00.000Z','reassessment'],
  [{outcome:'rejected',checked_at:'2030-01-03T00:00:00Z'},'2030-01-03T00:00:00.000Z','reassessment'],
  [{id:9,outcome:'changes_requested',checked_at:'2030-01-03T00:00:00Z'},'check:9','reassessment'],
])test(`Safety recovery AC1 AC2 - ${cycle} is scoped to the selected officer and exact review cycle`,async()=>{
  const records=[{id:9,email:'safety@example.test'}];
  const db={async query(sql,values){
    assert.deepEqual(values[0],[50]);assert.deepEqual(values[1],[101]);
    assert.deepEqual(JSON.parse(values[6][0]),{eventId:101,requirement,reviewCycle:cycle});
    assert.equal(values[7],check?.checked_at||null);
    assert.match(sql,/previous.user_id=note.user_id/);assert.match(sql,/previous.event_id=note.event_id/);
    assert.match(sql,/previous.created_at >= \$8/);assert.match(sql,/ON CONFLICT DO NOTHING/);
    assert.match(sql,/recipient.role='safety_officer'/);
    return {rows:records};
  }};
  assert.deepEqual(await storeSafetyReadyNotifications(db,{id:101,name:'Workshop',latest_safety_check:check},[50]),records);
});
for(const offset of [-1,0,1])test(`Safety recovery AC1 - notification title boundary ${offset}`,async()=>{
  const prefix='Ready for safety check: ';const name='x'.repeat(255-prefix.length+offset);
  const db={async query(sql,values){assert.equal(values[4][0],(prefix+name).slice(0,255));assert.ok(values[5][0].includes(name));return {rows:[]};}};
  assert.deepEqual(await storeSafetyReadyNotifications(db,{id:1,name},[50]),[]);
});
