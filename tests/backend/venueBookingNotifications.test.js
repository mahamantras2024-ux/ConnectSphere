// Booking notice AC1–AC4: real validation, transaction orchestration and SQL; only database/SMTP transport is mocked.
const {test,mock,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const {pool}=require('../../backend/src/config/db');
const emailService=require('../../backend/src/services/emailService');
const {createVenueRequest}=require('../../backend/src/services/venueRequests');
afterEach(()=>mock.restoreAll());
const input={eventId:3,startDatetime:'2090-01-10T10:00:00+08:00',endDatetime:'2090-01-10T11:00:00+08:00'};
/** Supplies raw database rows and failures; authorization, conflict checks and transaction decisions stay real. */
function database({ids=[8,9],failure,name='Hall A'}={}){
 const calls=[];
 mock.method(pool,'connect',async()=>({release(){calls.push({sql:'release'});},async query(sql,values){
  calls.push({sql,values});
  if(sql==='COMMIT' && failure==='commit')throw new Error('commit failed');
  if(sql.includes('INSERT INTO notifications')){
   if(failure==='notification')throw new Error('notification failed');
   return {rows:values[0].map((id,i)=>({email:`staff${id}@example.test`,title:values[4][i],message:values[5][i]}))};
  }
  if(sql.includes('FROM users staff'))return {rows:ids.map(id=>({id}))};
  if(sql.includes('FROM venues'))return {rows:[{id:7,name,is_active:true,setup_minutes:0,turnaround_minutes:0}]};
  if(sql.includes('FROM events'))return {rows:[{id:3,name:'Workshop',coordinator_id:failure==='unauthorised'?2:1}]};
  if(sql.includes('INSERT INTO venue_bookings'))return {rows:[{id:21,event_id:3,venue_id:7,status:'pending'}]};
  return {rows:[]};
 }}));
 const email=mock.method(emailService,'sendNotificationEmail',async()=>{calls.push({sql:'email'});if(failure==='email')throw new Error('SMTP unavailable');});
 return {calls,email};
}
test('Booking notice AC1 AC2 - assigned Venue Staff are notified and emailed only after the booking commits',async()=>{
 const {calls,email}=database();
 assert.equal((await createVenueRequest(7,input,1)).id,21);
 const recipients=calls.find(call=>call.sql.includes('FROM users staff'));
 assert.deepEqual(recipients.values,[7]);assert.match(recipients.sql,/venue_staff_assignments/);assert.match(recipients.sql,/venue_staff/);
 const note=calls.find(call=>call.sql.includes('INSERT INTO notifications'));
 assert.ok(note);assert.deepEqual(note.values.slice(0,4),[[8,9],[3,3],[null,null],['venue_booking_requested','venue_booking_requested']]);
 assert.equal(note.values[4][0],'New venue booking request: Hall A');assert.match(note.values[5][0],/Workshop.*Hall A.*review/);
 assert.equal(JSON.parse(note.values[6][0]).requestId,21);
 assert.equal(email.mock.callCount(),2);
 assert.deepEqual(calls.filter(call=>['COMMIT','release','email'].includes(call.sql)).map(call=>call.sql),['COMMIT','release','email','email']);
});
test('Booking notice AC2 - an unassigned venue creates no broadcast notification',async()=>{
 const {calls,email}=database({ids:[]});
 assert.equal((await createVenueRequest(7,input,1)).status,'pending');
 assert.equal(calls.some(call=>call.sql.includes('INSERT INTO notifications')),false);assert.equal(email.mock.callCount(),0);
});
for(const failure of ['notification','commit','unauthorised'])test(`Booking notice AC3 - ${failure} request rolls back without emailing staff`,async()=>{
 const {calls,email}=database({failure});
 await assert.rejects(createVenueRequest(7,input,1));
 assert.equal(calls.at(-2).sql,'ROLLBACK');assert.equal(calls.at(-1).sql,'release');assert.equal(email.mock.callCount(),0);
});
test('Booking notice AC3 - SMTP failure preserves the booking and its in-app notices',async()=>{
 const {calls}=database({failure:'email'});mock.method(console,'error',()=>{});
 assert.equal((await createVenueRequest(7,input,1)).status,'pending');assert.ok(calls.some(call=>call.sql==='COMMIT'));assert.equal(calls.some(call=>call.sql==='ROLLBACK'),false);
});
for(const offset of [-1,0,1])test(`Booking notice AC1 - title boundary offset ${offset}`,async()=>{
 const prefix='New venue booking request: ';const name='x'.repeat(255-prefix.length+offset);
 const {calls}=database({name});await createVenueRequest(7,input,1);
 const note=calls.find(call=>call.sql.includes('INSERT INTO notifications'));
 assert.ok(note);assert.equal(note.values[4][0],(prefix+name).slice(0,255));assert.ok(note.values[5][0].includes(name));
});
