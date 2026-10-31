// SCRUM-106 AC1/AC4: real HTTP routing, JWT identity and service calls; only PostgreSQL and email are external fixtures.
process.env.JWT_SECRET='scrum106-route-test-only';
const {test,before,after,beforeEach,afterEach,mock}=require('node:test');
const assert=require('node:assert/strict');
const jwt=require('../../backend/node_modules/jsonwebtoken');
const {pool}=require('../../backend/src/config/db');
const app=require('../../backend/src/index');
let server,base,role,queries;
before(async()=>{server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}/api`;});
after(async()=>{await new Promise(resolve=>server.close(resolve));await pool.end();});
beforeEach(()=>{role='event_coordinator';queries=[];mock.method(pool,'query',async(sql,values)=>{queries.push({sql,values});if(sql.includes('FROM users'))return {rows:[{id:8,role}]};if(sql.startsWith('SELECT id FROM events'))return {rows:[{id:3}]};return {rows:[]};});});
afterEach(()=>mock.restoreAll());
/** Makes an authenticated request with a test-only JWT; request-body identities never substitute for current database role. */
async function request(path,method='GET',body,authenticated=true){return fetch(base+path,{method,headers:{'Content-Type':'application/json',...(authenticated?{Authorization:`Bearer ${jwt.sign({sub:8},process.env.JWT_SECRET)}`}:{})},...(body?{body:JSON.stringify(body)}:{})});}
test('SCRUM-106 AC1 - non-Venue Staff cannot record closures',async()=>{assert.equal((await request('/venues/7/closures','POST',{reason:'Repairs'})).status,403);});
test('SCRUM-106 AC4 - only a signed-in coordinator can read event recovery information',async()=>{
 assert.equal((await request('/events/3/venue-disruptions','GET',undefined,false)).status,401);
 role='venue_staff';assert.equal((await request('/events/3/venue-disruptions')).status,403);
 role='event_coordinator';const response=await request('/events/3/venue-disruptions');assert.equal(response.status,200);assert.deepEqual(await response.json(),{issues:[]});
 assert.deepEqual(queries.find(q=>q.sql.startsWith('SELECT id FROM events')).values,['3',8]);
});
for(const id of ['0','-1','abc','2147483648'])test(`SCRUM-106 AC1 AC4 - invalid resource ID ${id} is rejected`,async()=>{assert.equal((await request(`/events/${id}/venue-disruptions`)).status,400);});
for(const replacementBookingId of [0,-1,2147483648,'8',1.5])test(`SCRUM-106 AC4 - replacement ID ${JSON.stringify(replacementBookingId)} is rejected before writes`,async()=>{assert.equal((await request('/events/3/venue-disruptions/2/resolve','POST',{replacementBookingId})).status,400);assert.equal(queries.some(q=>q.sql.startsWith('UPDATE')),false);});
test('SCRUM-106 AC1 - invalid closure interval produces an actionable validation error',async()=>{role='venue_staff';const response=await request('/venues/7/closures','POST',{reason:'Repairs'});assert.equal(response.status,400);assert.match((await response.json()).message,/closure period/);});
test('SCRUM-106 AC1 AC2 - authorised staff closure endpoint returns its saved closure and affected booking list',async()=>{
 role='venue_staff';mock.method(pool,'connect',async()=>({release(){},query:async sql=>({rows:sql.includes('SELECT * FROM venues')?[{id:7}]:sql.includes('INSERT INTO venue_unavailability')?[{id:2}]:[]})}));
 const response=await request('/venues/7/closures','POST',{startDatetime:'2031-10-20T01:00:00Z',endDatetime:'2031-10-20T02:00:00Z',reason:'Repairs'});
 assert.equal(response.status,201);assert.deepEqual(await response.json(),{closure:{id:2},affectedBookings:[]});
});
for(const replacementBookingId of [null,8])test(`SCRUM-106 AC4 - assigned coordinator endpoint processes ${replacementBookingId===null?'booking cancellation':'replacement'}`,async()=>{
 mock.method(pool,'connect',async()=>({release(){},query:async sql=>({rows:sql.includes('SELECT b.venue_id')?[{venue_id:7}]:sql.includes('SELECT d.*,b.event_id')?[{id:2,booking_id:5}]:sql.includes('SELECT b.id FROM venue_bookings')?[{id:8}]:[]})}));
 const response=await request('/events/3/venue-disruptions/2/resolve','POST',{replacementBookingId});
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{resolution:replacementBookingId===null?'cancelled':'replaced'});
});

for(const id of ['1','2','2147483646','2147483647'])test(`SCRUM-106 AC1 AC4 - valid resource boundary ID ${id} reaches the assignment-scoped query`,async()=>{
 const response=await request(`/events/${id}/venue-disruptions`);assert.equal(response.status,200);
 assert.deepEqual(queries.find(q=>q.sql.startsWith('SELECT id FROM events')).values,[id,8]);
});
for(const replacementBookingId of [1,2,2147483646,2147483647])test(`SCRUM-106 AC4 - valid replacement boundary ID ${replacementBookingId} reaches recovery`,async()=>{
 mock.method(pool,'connect',async()=>({release(){},query:async(sql,values)=>({rows:sql.includes('SELECT b.venue_id')?[{venue_id:7}]:sql.includes('SELECT d.*,b.event_id')?[{id:2,booking_id:5}]:sql.includes('SELECT b.id FROM venue_bookings')?[{id:values[0]}]:[]})}));
 const response=await request('/events/3/venue-disruptions/2/resolve','POST',{replacementBookingId});assert.equal(response.status,200);assert.deepEqual(await response.json(),{resolution:'replaced'});
});
