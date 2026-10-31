// Lead ACs: real route/auth/controller/summary; only PostgreSQL transport is replaced.
const {test,before,beforeEach,afterEach,after,mock}=require('node:test');
const assert=require('node:assert/strict');
process.env.JWT_SECRET='lead-registration-test';process.env.NODE_ENV='test';
const jwt=require('../../backend/node_modules/jsonwebtoken');
const {pool}=require('../../backend/src/config/db');
const app=require('../../backend/src/index');
let server,base,state;
before(async()=>{server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}/api/events`;});
beforeEach(()=>{
  state={role:'event_coordinator_lead',calls:[],event:{id:7,name:'Workshop',venue_capacity:2},rows:[
    {id:1,attendee_name:'Alice',status:'registered',registered_at:'2030-11-01T00:00:00Z'},
    {id:2,attendee_name:'Bob',status:'waitlisted',registered_at:'2030-11-01T01:00:00Z'},
    {id:3,attendee_name:'Cara',status:'withdrawn',registered_at:'2030-11-01T02:00:00Z'}]};
  mock.method(pool,'query',async(sql,args)=>{
    state.calls.push({sql,args});
    if(sql.includes('FROM users'))return {rows:[{id:4,role:state.role}]};
    if(sql.includes('FROM registrations r'))return {rows:state.rows};
    if(sql.includes('FROM events e'))return {rows:state.event?[state.event]:[]};
    throw Error(`Unexpected lead SQL: ${sql}`);
  });
});
afterEach(()=>mock.restoreAll());after(async()=>{await new Promise(resolve=>server.close(resolve));await pool.end();});
/** Calls the actual Lead-only endpoint; role is reloaded by authentication rather than trusted from token claims. */
async function request(id='7',authenticated=true){
  const response=await fetch(`${base}/${id}/lead-registrations`,{headers:authenticated?{Authorization:`Bearer ${jwt.sign({sub:4},process.env.JWT_SECRET)}`}:{}});
  return {status:response.status,body:await response.json()};
}
test('Lead registrations AC1 AC2 AC3 - authorised report returns attendee statuses counts capacity and remaining spots',async()=>{
  // Arrange / Act: no browser-calculated participant data should be needed to render this report.
  const result=await request();
  // Assert: all three stored states survive and both private queries carry the agreed active-event oversight scope.
  assert.equal(result.status,200);assert.deepEqual(result.body.attendees.map(row=>row.status),['registered','waitlisted','withdrawn']);
  assert.equal(result.body.headcount,1);assert.equal(result.body.waitlist_count,1);assert.equal(result.body.withdrawal_count,1);
  assert.equal(result.body.venue_capacity,2);assert.equal(result.body.remaining_spots,1);
  const scoped=state.calls.filter(call=>call.sql.includes('FROM events e'));
  assert.equal(scoped.length,2);for(const call of scoped){assert.match(call.sql,/e.is_draft=false/);assert.match(call.sql,/cancelled.*completed/);assert.deepEqual(call.args,['7']);}
});
test('Lead registrations AC5 - outside-scope events are denied before any attendee identities are read',async()=>{
  // Arrange / Act / Assert: a missing/unauthorised event never reaches the private registrations query.
  state.event=null;assert.equal((await request()).status,404);
  assert.equal(state.calls.some(call=>call.sql.includes('FROM registrations r')),false);
});
for(const role of ['event_coordinator','event_organiser','attendee','venue_staff','technical_support','safety_officer'])test(`Lead registrations AC5 - ${role} cannot use the Lead report`,async()=>{
  // Arrange / Act / Assert: changing an URL cannot confer Lead oversight.
  state.role=role;assert.equal((await request()).status,403);
  assert.equal(state.calls.some(call=>call.sql.includes('FROM registrations r')),false);
});
test('Lead registrations AC5 - authentication is required',async()=>{
  // Arrange / Act / Assert: no identity means no database or attendee access.
  assert.equal((await request('7',false)).status,401);assert.equal(state.calls.length,0);
});
for(const id of ['0','bad','2147483646','2147483647','2147483648'])test(`Lead registrations AC5 - invalid or missing event boundary ${id}`,async()=>{
  // Arrange: valid missing IDs and out-of-range IDs remain distinguishable without exposing attendees.
  state.event=null;
  // Act / Assert: the integer limit is tested below/at/above; malformed identifiers fail before the event read.
  const expected=['2147483646','2147483647'].includes(id)?404:400;
  assert.equal((await request(id)).status,expected);assert.equal(state.calls.some(call=>call.sql.includes('FROM registrations r')),false);
});
