const {test,before,beforeEach,afterEach,after,mock}=require('node:test');
const assert=require('node:assert/strict');
process.env.JWT_SECRET='planning-calendar-test';process.env.NODE_ENV='test';
const jwt=require('../../backend/node_modules/jsonwebtoken');
const {pool}=require('../../backend/src/config/db');
const app=require('../../backend/src/index');let server,base,state;
before(async()=>{server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}/api/events/planning-calendar`;});
beforeEach(()=>{
  state={role:'event_coordinator',calls:[]};
  // Only transport is replaced; authenticated identity and the actual handler's binding remain real.
  mock.method(pool,'query',async(sql,args)=>{
    state.calls.push({sql,args});
    if(sql.includes('FROM users'))return {rows:[{id:4,role:state.role}]};
    if(sql.includes('WITH assigned'))return {rows:[{id:7,name:'Workshop',status:'planning',starts_at:'2030-11-01T02:00:00Z',ends_at:'2030-11-01T03:00:00Z'}]};
    throw Error(`Unexpected calendar SQL: ${sql}`);
  });
});
afterEach(()=>mock.restoreAll());after(async()=>{await new Promise(resolve=>server.close(resolve));await pool.end();});
/** Calls real authentication and role middleware; caller-provided query IDs cannot become the assignment scope. */
async function get(query='?month=2030-11',authenticated=true){
  const result=await fetch(base+query,{headers:authenticated?{Authorization:`Bearer ${jwt.sign({sub:4},process.env.JWT_SECRET)}`}:{}});
  return {status:result.status,body:await result.json()};
}
test('Planning calendar AC1 AC2 AC3 - only the authenticated assignment scope is bound and no availability tables are queried',async()=>{
  // Arrange / Act: a tampered coordinator ID in the URL must have no effect on access.
  const result=await get('?month=2030-11&coordinatorId=999');
  // Assert: SQL reads only events assigned to user 4 with the literal Singapore month boundaries.
  assert.equal(result.status,200);assert.equal(result.body.events[0].id,7);
  const query=state.calls.find(call=>call.sql.includes('WITH assigned'));
  assert.deepEqual(query.args,[4,'2030-11-01T00:00:00+08:00','2030-12-01T00:00:00+08:00']);
  assert.match(query.sql,/e.coordinator_id=\$1/);assert.doesNotMatch(query.sql,/venue_bookings|equipment|venue_unavailability/);
});
for(const role of ['event_organiser','event_coordinator_lead','attendee','venue_staff','technical_support','safety_officer'])test(`Planning calendar AC2 - ${role} cannot read Coordinator schedules`,async()=>{
  // Arrange / Act / Assert: role-based route protection denies before any event schedule query.
  state.role=role;assert.equal((await get()).status,403);
  assert.equal(state.calls.some(call=>call.sql.includes('WITH assigned')),false);
});
test('Planning calendar AC2 - anonymous and malformed-month requests read no event data',async()=>{
  // Arrange / Act / Assert: authentication and validation are enforced before schedule SQL.
  assert.equal((await get('?month=2030-11',false)).status,401);
  assert.equal((await get('?month=bad')).status,400);assert.equal((await get('')).status,400);
  assert.equal(state.calls.some(call=>call.sql.includes('WITH assigned')),false);
});
