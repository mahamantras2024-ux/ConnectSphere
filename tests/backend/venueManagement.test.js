// File: Exercises venue update confirmation, permission checks, deactivation blocking and automatic MRT through HTTP.
require('../../backend/node_modules/dotenv').config();
const {test,before,after,beforeEach,afterEach,mock}=require('node:test');
const assert=require('node:assert/strict');
const jwt=require('../../backend/node_modules/jsonwebtoken');
const {EventEmitter}=require('node:events');
const {pool}=require('../../backend/src/config/db');
const app=require('../../backend/src/index');
const {nearestMrt}=require('../../backend/src/services/venueLocation');
let server,base,venue,bookings,writes,role,failCommit,token;
const payload={name:'Hall',location:'Stamford Road',capacity:100,supportedLayouts:['Theatre','Banquet'],accessibilityFeatures:['Ramp'],facilities:['Wi-Fi','Projector'],operatingHours:'08:00 - 22:00',setupMinutes:0,turnaroundMinutes:0,availabilityStatus:'Available',latitude:1.296,longitude:103.85,revision:0};
// Sends an authenticated update/delete request to an isolated mock-backed API server.
async function request(method,body=payload,credentials=token) {
 const response=await fetch(base+'/api/venues/1',{method,headers:{'Content-Type':'application/json',...(credentials?{Authorization:`Bearer ${credentials}`}:{})},body:method==='DELETE'?undefined:JSON.stringify(body)});
 return {status:response.status,body:await response.json()};
}
before(async()=> { // Starts the local test API and creates an expiring staff token.
 server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;
 token=jwt.sign({sub:1,role:'venue_staff'},process.env.JWT_SECRET,{expiresIn:'1h'});
});
beforeEach(()=> { // Resets venue, booking and transaction fixtures between cases.
 role='venue_staff';writes=[];failCommit=false;venue={id:1,is_active:true,revision:0,name:'Hall',location:'Stamford Road',capacity:100,supported_layouts:['Theatre','Banquet'],accessibility_features:['Ramp'],facilities:['Wi-Fi','Projector'],operating_hours:'08:00 - 22:00',setup_minutes:0,turnaround_minutes:0,availability_status:'Available',latitude:1.296,longitude:103.85};
 bookings=[{booking_id:10,event_id:5,event_name:'Future conference',status:'approved',expected_attendance:80,room_layout_preference:'Theatre',start_datetime:'2030-10-10T00:00:00.000Z',end_datetime:'2030-10-10T04:00:00.000Z'}];
 mock.method(pool,'query',async()=>({rows:[{id:1,role,roles:[role],auth_version:0}]}));
 const client={release(){},async query(sql,values){ // Simulates transaction reads and records mutations for assertions.
  if(sql.includes('FOR UPDATE'))return {rows:venue?[venue]:[]};
  if(sql.includes('FROM venue_bookings'))return {rows:bookings};
  if(sql.startsWith('UPDATE venues')) {writes.push({sql,values});return {rows:[{...venue,name:values[0],revision:venue.revision+1}]};}
  if(sql==='COMMIT' && failCommit)throw new Error('Commit unavailable');return {rows:[]};
 }};
 mock.method(pool,'connect',async()=>client);
});
afterEach(()=>mock.restoreAll()); // Restores pool methods after every test.
after(async()=> {await new Promise(resolve=>server.close(resolve));await pool.end();}); // Stops the server and database pool.
test('non-impacting edits save immediately and reject stale venue revisions',async()=> {
 let response=await request('PUT',{...payload,name:'New name'});assert.equal(response.status,200);assert.equal(writes.length,1);
 writes=[];venue.revision=2;response=await request('PUT');assert.equal(response.body.code,'STALE_VENUE');assert.equal(writes.length,0);
});
test('capacity impact lists bookings before any write and requires a valid exact-change confirmation',async()=> {
 const change={...payload,capacity:50};const warning=await request('PUT',change);
 assert.equal(warning.status,409);assert.equal(warning.body.code,'BOOKING_IMPACT');assert.equal(writes.length,0);assert.match(warning.body.affectedBookings[0].reasons[0],/80 expected guests/);
 const tampered=await request('PUT',{...change,confirmationToken:warning.body.confirmationToken,capacity:40});assert.equal(tampered.status,409);assert.equal(writes.length,0);
 const confirmed=await request('PUT',{...change,confirmationToken:warning.body.confirmationToken});assert.equal(confirmed.status,200);assert.equal(writes.length,1);
});
test('a newly confirmed booking invalidates a previous impact acknowledgement',async()=> {
 const change={...payload,facilities:['Wi-Fi']};const warning=await request('PUT',change);
 bookings.push({...bookings[0],booking_id:11});const response=await request('PUT',{...change,confirmationToken:warning.body.confirmationToken});
 assert.equal(response.status,409);assert.equal(response.body.affectedBookings.length,2);assert.equal(writes.length,0);
});
test('deactivation lists confirmed and pending blockers and performs no destructive delete',async()=> {
 bookings.push({...bookings[0],booking_id:11,status:'pending'});let response=await request('DELETE');
 assert.equal(response.status,409);assert.equal(response.body.affectedBookings.length,2);assert.equal(writes.length,0);
 bookings=[];response=await request('DELETE');assert.equal(response.status,200);assert.match(writes[0].sql,/is_active=false/);assert.doesNotMatch(writes[0].sql,/DELETE FROM/);
});
test('venue management rejects missing authentication, other roles, malformed data and missing records',async()=> {
 assert.equal((await request('PUT',payload,null)).status,401);role='event_coordinator';assert.equal((await request('DELETE')).status,403);
 role='venue_staff';assert.equal((await request('PUT',{...payload,capacity:0})).status,400);assert.equal((await request('PUT',{...payload,latitude:10})).status,400);
 venue=null;assert.equal((await request('DELETE')).status,404);assert.equal(writes.length,0);
});
test('MRT calculations choose a nearby real station and ignore client supplied MRT text',async()=> {
 const station=nearestMrt(1.296978,103.850715);assert.match(station.name,/Bras Basah/);assert.ok(station.distanceM<200);
 const response=await request('PUT',{...payload,mrt:'Invented station'});assert.equal(response.status,200);assert.notEqual(writes[0].values[9],'Invented station');
});
test('catalogue streams receive database invalidations without booking or client details',async()=> {
 const client=new EventEmitter();client.query=async()=>({rows:[]});client.release=()=>{};
 mock.method(pool,'connect',async()=>client);
 const abort=new AbortController();const response=await fetch(base+'/api/venues/stream',{signal:abort.signal});assert.match(response.headers.get('content-type'),/text\/event-stream/);
 const reader=response.body.getReader();let text='';
 while(!text.includes('connected'))text+=new TextDecoder().decode((await reader.read()).value);
 client.emit('notification',{channel:'venue_catalogue_changed',payload:'7'});
 const update=new TextDecoder().decode((await reader.read()).value);assert.equal(update,'data: changed\n\n');assert.doesNotMatch(update,/booking|event_name|email/);
 abort.abort();await reader.cancel().catch(()=>{});
});
