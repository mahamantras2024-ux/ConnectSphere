// Session ACs exercise real authorization/transactions; only database transport is controlled.
const {test,beforeEach,afterEach,after,mock}=require('node:test');
const assert=require('node:assert/strict');
const {pool}=require('../../backend/src/config/db');
const {changeSessionRequest}=require('../../backend/src/services/sessionVenueRequests');
const {changeSession}=require('../../backend/src/controllers/venueRequestController');
let state;
const body={capacity:30,layout:'Seminar',startDatetime:'2030-11-01T10:00:00Z',endDatetime:'2030-11-01T11:00:00Z'};
/** Supplies raw rows and records the actual update target, without reimplementing conflict or suitability rules. */
async function query(sql,args=[]){
  state.calls.push({sql,args});
  if(/^(BEGIN|COMMIT|ROLLBACK)/.test(sql))return {rows:[]};
  if(sql.includes('FROM venues'))return {rows:[{id:7,is_active:true,capacity:40,supported_layouts:['Seminar'],setup_minutes:0,turnaround_minutes:0}]};
  if(sql.includes('UNION'))return {rows:state.blockers};
  if(sql.includes('FROM venue_bookings'))return {rows:state.booking?[structuredClone(state.booking)]:[]};
  if(sql.includes('FROM events'))return {rows:[{id:3,coordinator_id:state.coordinator}]};
  if(sql.startsWith('UPDATE venue_bookings')){
    const cancelling=sql.includes("status='cancelled'");
    state.writes.push(args.at(-1));
    const status=cancelling?'cancelled':sql.includes("status='pending'")?'pending':state.booking.status;
    return {rows:[{...state.booking,status,requirements:cancelling?state.booking.requirements:JSON.parse(args[2])}]};
  }
  throw Error(`Unexpected SQL: ${sql}`);
}
beforeEach(()=>{
  state={calls:[],writes:[],blockers:[],coordinator:4,booking:{id:20,event_id:3,venue_id:7,status:'approved',requirements:{sessionName:'Track A',capacity:20}}};
  mock.method(pool,'connect',async()=>({query,release(){}}));
});
afterEach(()=>mock.restoreAll());after(()=>pool.end());
test('Session venues AC4 - controller passes authenticated identity and returns the saved session',async()=>{
  // Arrange: retain real controller/service interaction and mock only PostgreSQL transport.
  let response;const res={json(value){response=value;}};
  // Act / Assert: resource IDs and actor come from the route/session, not caller-supplied body fields.
  await changeSession({params:{id:'7',requestId:'20'},body:{cancel:true,userId:999},user:{id:4}},res);
  assert.equal(response.request.id,20);assert.equal(response.request.status,'cancelled');
});
test('Session venues AC2 AC3 AC4 - revising one session resets only its request for staff approval',async()=>{
  // Arrange / Act: update timing and attendance for the selected Track A request.
  const saved=await changeSessionRequest(7,20,body,4);
  // Assert: only its ID is targeted; no statement may select siblings for cancellation.
  assert.equal(saved.status,'pending');assert.equal(saved.requirements.capacity,30);assert.equal(saved.requirements.sessionName,'Track A');
  assert.deepEqual(state.writes,[20]);assert.match(state.calls.find(call=>call.sql.startsWith('UPDATE')).sql,/WHERE id=\$5/);
});
test('Session venues AC4 - cancellation retains history and targets only one session',async()=>{
  // Arrange / Act / Assert: cancellation is a status transition, never deletion or event-wide cancellation.
  assert.equal((await changeSessionRequest(7,20,{cancel:true},4)).status,'cancelled');
  assert.deepEqual(state.writes,[20]);assert.equal(state.calls.some(call=>call.sql.includes('DELETE')),false);
});
test('Session venues AC1 AC4 - another coordinator cannot edit or cancel the session',async()=>{
  // Arrange / Act / Assert: event assignment remains authoritative even when the requester is known.
  await assert.rejects(changeSessionRequest(7,20,{cancel:true},8),error=>error.status===403);
  assert.deepEqual(state.writes,[]);
});
test('Session venues AC3 - another session booking blocks conflicting timing',async()=>{
  // Arrange: a different session owns this venue/time; only the current booking ID is excluded.
  state.blockers=[{id:21,kind:'booking',status:'approved',start_datetime:body.startDatetime,end_datetime:body.endDatetime}];
  // Act / Assert: no overwrite, cancellation or reopened approval occurs on conflict.
  await assert.rejects(changeSessionRequest(7,20,body,4),error=>error.status===409);
  assert.deepEqual(state.writes,[]);
});
for(const scenario of ['invalid ID','missing','legacy','cancelled','expired','invalid period','unsuitable'])test(`Session venues AC2 AC3 AC4 - rejects ${scenario} revision`,async()=>{
  // Arrange: each malformed/stale target must fail before mutating any session.
  let venueId=7,requestBody=body;
  if(scenario==='invalid ID')venueId='bad';
  if(scenario==='missing')state.booking=null;
  if(scenario==='legacy')state.booking.requirements={};
  if(scenario==='cancelled')state.booking.status='cancelled';
  if(scenario==='expired'){state.booking.status='tentative';state.booking.hold_expires_at='2000-01-01T00:00:00Z';}
  if(scenario==='invalid period')requestBody={...body,endDatetime:body.startDatetime};
  if(scenario==='unsuitable')requestBody={...body,capacity:41};
  // Act / Assert: a plausible implementation skipping any guard would unexpectedly write the request.
  const expectedStatus={'invalid ID':400,missing:404,legacy:409,cancelled:409,expired:409,'invalid period':400,unsuitable:400}[scenario];
  await assert.rejects(changeSessionRequest(venueId,20,requestBody,4),error=>error.status===expectedStatus);assert.deepEqual(state.writes,[]);
});
