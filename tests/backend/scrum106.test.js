// SCRUM-106: real closure/recovery service; only PostgreSQL I/O is substituted.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { affectedByClosure, closureInput } = require('../../backend/src/services/venueDisruptions');
const { evaluateSafetyReview } = require('../../backend/src/services/eventDecisionPolicy');
const { evaluateTransition } = require('../../backend/src/services/eventLifecyclePolicy');
const start = Date.parse('2031-10-20T02:00:00Z');
const booking = { id: 5, start_datetime: new Date(start).toISOString(), end_datetime: new Date(start+3600000).toISOString(), setup_minutes: 30, turnaround_minutes: 30 };
// AC1: occupied interval is 09:30–11:30 Singapore; adjacency must remain bookable.
for (const [offset, expected] of [[-1,true],[0,false],[1,false]]) {
  test(`SCRUM-106 AC1 AC3 - closure starts ${offset}ms from turnaround end: affected=${expected}`, () => {
    // Arrange / Act: move the closure start across the occupied endpoint.
    const found = affectedByClosure([booking], start+5400000+offset, start+7200000);
    // Assert: an implementation using <= instead of < fails exactly at the boundary.
    assert.equal(found.length, expected ? 1 : 0);
  });
}
for (const [offset, expected] of [[-1,false],[0,false],[1,true]]) {
  test(`SCRUM-106 AC1 - closure ends ${offset}ms from setup start: affected=${expected}`, () => {
    assert.equal(affectedByClosure([booking], start-3600000, start-1800000+offset).length, expected ? 1 : 0);
  });
}
test('SCRUM-106 AC1 - validates reason and positive timezone-qualified closure interval', () => {
  const input = { reason: '  Emergency repairs ', startDatetime:'2031-10-20T01:00:00Z', endDatetime:'2031-10-20T02:00:00Z' };
  assert.equal(closureInput(input).reason, 'Emergency repairs');
  for (const invalid of [null,[],{...input,reason:' '},{...input,startDatetime:'2031-10-20T01:00:00'},{...input,startDatetime:'2031-02-30T01:00:00Z'}]) assert.throws(()=>closureInput(invalid), /closure|reason/i);
});
const context = { status:'planning', is_draft:false, pending_clarifications:0, equipment_items:[], safety_changes_open:[], now:start,
 bookings:[{status:'approved',disrupted:true}], latest_safety_check:{outcome:'approved'} };
test('SCRUM-106 AC4 AC5 - an unresolved disruption blocks final confirmation even with an old passed safety check', () => {
  assert.equal(evaluateTransition('confirmed',context).code,'VENUE_DISRUPTED');
});
test('SCRUM-106 AC5 - a replacement needs a fresh safety pass before final confirmation', () => {
  const replaced = {...context,bookings:[{status:'approved'}],latest_safety_check:null};
  assert.equal(evaluateTransition('confirmed',replaced).code,'SAFETY_NOT_COMPLETED');
  assert.equal(evaluateSafetyReview(replaced),null);
  assert.equal(evaluateTransition('confirmed',{...replaced,latest_safety_check:{outcome:'approved'}}),null);
});

const {mock,afterEach}=require('node:test');
const {pool}=require('../../backend/src/config/db');
const notices=require('../../backend/src/services/notificationService');
const service=require('../../backend/src/services/venueDisruptions');
afterEach(()=>mock.restoreAll());
/** Supplies database records only; transaction ordering, recipient selection and recovery rules remain real. */
function database({status='approved',issue={},replacement=true,failNotice=false,missing=false,assignmentMissing=false,eventName='Gala'}={}) {
 const calls=[],notes=[];
 const row={...booking,id:5,venue_id:7,event_id:3,event_name:eventName,coordinator_id:8,venue_name:'Hall A',status};
 const query=async(sql,values=[])=>{
  calls.push({sql,values});
  if(sql.includes('SELECT * FROM venues'))return {rows:missing?[]:[{id:7}]};
  if(sql.includes('INSERT INTO venue_unavailability'))return {rows:[{id:2}]};
  if(sql.includes('SELECT b.*,e.name'))return {rows:[row]};
  if(sql.includes('SELECT b.venue_id'))return {rows:missing?[]:[{venue_id:7}]};
  if(sql.includes('SELECT d.*,b.event_id'))return {rows:missing||assignmentMissing?[]:[{id:9,booking_id:5,event_id:3,start_datetime:booking.start_datetime,end_datetime:booking.end_datetime,...issue}]};
  if(sql.includes('SELECT b.id FROM venue_bookings'))return {rows:replacement?[{id:10}]:[]};
  if(sql.startsWith('SELECT id FROM events'))return {rows:missing?[]:[{id:3}]};
  if(sql.includes('SELECT d.id,d.booking_id'))return {rows:[{id:9,booking_id:5}]};
  return {rows:[]};
 };
 mock.method(pool,'connect',async()=>({query,release(){calls.push({sql:'release'});}}));
 mock.method(pool,'query',query);
 // Mail and PostgreSQL are the only external boundaries. Keep actual notification construction observable.
 mock.method(notices,'emailNotifications',async()=>0);
 // insertNotifications was destructured by the service; intercept the underlying SQL instead.
 const original=query;
 const clientQuery=async(sql,values)=>{if(sql.includes('WITH inserted')){if(failNotice)throw new Error('Storage failed');notes.push(values);}return original(sql,values);};
 pool.connect.mock.mockImplementation(async()=>({query:clientQuery,release(){calls.push({sql:'release'});}}));
 return {calls,notes};
}
test('SCRUM-106 AC1 AC2 AC4 - closure identifies the buffered booking and notifies its current coordinator before commit',async()=>{
 const db=database();
 const result=await service.recordClosure(7,{startDatetime:'2031-10-20T01:45:00Z',endDatetime:'2031-10-20T02:00:00Z',reason:'Repairs'},1);
 assert.equal(result.affectedBookings[0].id,5);
 assert.deepEqual(db.notes[0][0],[8]);assert.match(db.notes[0][5][0],/Hall A.*Repairs.*alternative/);
 const reopen=db.calls.find(c=>c.sql.startsWith('UPDATE events'));
 assert.deepEqual(reopen.values,[[3]]);assert.match(reopen.sql,/THEN 'planning'/);assert.doesNotMatch(reopen.sql,/THEN 'cancelled'/);
 assert.ok(db.calls.findIndex(c=>c.sql.includes('WITH inserted'))<db.calls.findIndex(c=>c.sql==='COMMIT'));
});
for (const status of ['pending','tentative']) test(`SCRUM-106 AC1 AC2 - ${status} bookings are identified without a confirmed-event disruption or notification`,async()=>{
 const db=database({status});
 const result=await service.recordClosure(7,{startDatetime:'2031-10-20T01:45:00Z',endDatetime:'2031-10-20T02:00:00Z',reason:'Repairs'},1);
 assert.equal(result.affectedBookings.length,1);assert.equal(db.notes.length,0);assert.equal(db.calls.some(c=>c.sql.startsWith('UPDATE events')),false);
});
test('SCRUM-106 AC2 - failed notification rolls back closure and planning changes',async()=>{
 const db=database({failNotice:true});
 await assert.rejects(()=>service.recordClosure(7,{startDatetime:'2031-10-20T01:45:00Z',endDatetime:'2031-10-20T02:00:00Z',reason:'Repairs'},1),/Storage failed/);
 assert.ok(db.calls.some(c=>c.sql==='ROLLBACK'));assert.equal(db.calls.some(c=>c.sql==='COMMIT'),false);
});
for(const replacementBookingId of [null,10])test(`SCRUM-106 AC4 AC5 - ${replacementBookingId===null?'cancels':'replaces'} only the affected booking and resets review freshness`,async()=>{
 const db=database();await service.resolveDisruption(3,9,8,replacementBookingId);
 const cancelled=db.calls.find(c=>c.sql.startsWith('UPDATE venue_bookings'));
 assert.deepEqual(cancelled.values,[5]);assert.match(cancelled.sql,/WHERE id=\$1/);
 assert.equal(db.calls.some(c=>c.sql.includes('equipment')),false);
 assert.match(db.calls.find(c=>c.sql.startsWith('UPDATE events')).sql,/venue_revised_at=clock_timestamp/);
 assert.ok(db.calls.some(c=>c.sql==='COMMIT'));
});
for(const [options,pattern] of [[{replacement:false},/approved/],[{issue:{resolved_at:'2031-10-20'}},/already/],[{missing:true},/not found/]])test(`SCRUM-106 AC4 - rejects invalid recovery ${JSON.stringify(options)} without cancelling bookings`,async()=>{
 const db=database(options);await assert.rejects(()=>service.resolveDisruption(3,9,8,10),pattern);
 assert.equal(db.calls.some(c=>c.sql.startsWith('UPDATE venue_bookings')),false);assert.ok(db.calls.some(c=>c.sql==='ROLLBACK'));
});
test('SCRUM-106 AC4 - lists only assigned-event disruptions and rejects missing assignment',async()=>{
 let db=database();assert.deepEqual(await service.listDisruptions(3,8),[{id:9,booking_id:5}]);
 assert.deepEqual(db.calls[0].values,[3,8]);mock.restoreAll();database({missing:true});
 await assert.rejects(()=>service.listDisruptions(3,9),/Event not found/);
});
for(const [length,valid] of [[1999,true],[2000,true],[2001,false]])test(`SCRUM-106 AC1 - closure reason length ${length} is ${valid?'accepted':'rejected'}`,()=>{
 const body={startDatetime:'2031-10-20T01:00:00Z',endDatetime:'2031-10-20T02:00:00Z',reason:'x'.repeat(length)};
 if(valid)assert.equal(closureInput(body).reason.length,length);else assert.throws(()=>closureInput(body),/reason/);
});
test('SCRUM-106 AC1 - nonexistent venue rolls back without storing a closure',async()=>{
 const db=database({missing:true});await assert.rejects(()=>service.recordClosure(7,{startDatetime:'2031-10-20T01:00:00Z',endDatetime:'2031-10-20T02:00:00Z',reason:'Repairs'},1),/Venue not found/);
 assert.equal(db.calls.some(c=>c.sql.includes('INSERT INTO venue_unavailability')),false);
});
test('SCRUM-106 AC5 - database decision and safety queue both ignore safety checks predating the venue revision',async()=>{
 const model=require('../../backend/src/models/eventDecisionModel');const sql=[];
 const db={query:async query=>{sql.push(query);return {rows:[]};}};
 await model.loadDecisionContext(db,3,{coordinatorId:8,lock:true});await model.safetyCandidates(db);
 for(const query of sql){assert.match(query,/s.checked_at >= e.venue_revised_at/);assert.match(query,/d.resolved_at IS NULL/);}
});

test('SCRUM-106 AC4 - inherited notification does not let a former coordinator resolve a disruption',async()=>{
 const db=database({assignmentMissing:true});
 await assert.rejects(()=>service.resolveDisruption(3,9,99),/Disruption not found/);
 assert.equal(db.calls.some(c=>c.sql.startsWith('UPDATE venue_bookings')),false);
 assert.deepEqual(db.calls.find(c=>c.sql.includes('SELECT d.*,b.event_id')).values,[9,3,99]);
});
test('SCRUM-106 AC5 - review and confirmation timestamps record save time rather than transaction start before a lock wait',async()=>{
 // Arrange: SQL is the external database boundary. A transaction may begin before a venue revision and then wait on its lock.
 const model=require('../../backend/src/models/eventDecisionModel'),writes=[];
 const db={query:async(sql,values)=>{writes.push({sql,values});return{rows:[{}]};}};
 await model.insertSafetyCheck(db,3,7,'approved',null,[]);await model.recordDecision(db,3,'approved',null,8);
 // Assert: now() would preserve the pre-lock transaction time and falsely invalidate a fresh review.
 assert.match(writes[0].sql,/checked_at\) VALUES \(\$1, \$2, \$3, \$4, \$5, clock_timestamp\(\)\)/);
 assert.match(writes[1].sql,/decided_at = clock_timestamp\(\)/);
});
for(const [length,valid]of [[0,false],[1,true],[2,true]])test(`SCRUM-106 AC1 - closure reason minimum boundary length ${length} is ${valid?'accepted':'rejected'}`,()=>{
 const body={startDatetime:'2031-10-20T01:00:00Z',endDatetime:'2031-10-20T02:00:00Z',reason:'x'.repeat(length)};
 if(valid)assert.equal(closureInput(body).reason.length,length);else assert.throws(()=>closureInput(body),/reason/);
});
for(const duration of [-1,0,1])test(`SCRUM-106 AC1 - closure duration ${duration}ms is ${duration>0?'accepted':'rejected'}`,()=>{
 // The minimum positive interval changes behavior at zero; expected values follow AC1's affected period requirement.
 const start=Date.parse('2031-10-20T02:00:00Z');
 const body={reason:'Repairs',startDatetime:new Date(start).toISOString(),endDatetime:new Date(start+duration).toISOString()};
 if(duration>0)assert.equal(closureInput(body).end-closureInput(body).start,1);else assert.throws(()=>closureInput(body),/closure period/);
});

// AC1/AC2: PostgreSQL varchar counts Unicode characters, not UTF-16 code units.
for (const [name, expectedLength] of [['x'.repeat(235),254],['x'.repeat(236),255],['x'.repeat(237),255],['😀'.repeat(255),255]]) {
 test(`SCRUM-106 AC1 AC2 - closure title boundary for ${Array.from(name).length} event characters (${expectedLength} stored)`,async()=>{
  // Arrange: valid event names can exceed the remaining title space after the prefix.
  const db=database({eventName:name});
  // Act: keep the actual closure and notification construction in the transaction.
  await service.recordClosure(7,{startDatetime:'2031-10-20T01:45:00Z',endDatetime:'2031-10-20T02:00:00Z',reason:'Repairs'},1);
  // Assert: preserve the prefix and complete code points; an unlimited title fails above 255.
  const title=db.notes[0][4][0];
  assert.equal(title,'Venue unavailable: '+Array.from(name).slice(0,236).join(''));
  assert.equal(Array.from(title).length,expectedLength);
  assert.ok(db.calls.some(call=>call.sql==='COMMIT'));
 });
}
