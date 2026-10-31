const {test}=require('node:test');
const assert=require('node:assert/strict');
const {registrationSummary}=require('../../backend/src/services/leadRegistrationSummary');
const at='2030-11-01T00:00:00Z';
for(const count of [1,2,3])test(`Lead registrations AC2 AC3 AC4 - headcount boundary ${count} against capacity 2`,()=>{
  // Arrange: stored statuses remain authoritative even if historical registrations exceed today's venue capacity.
  const rows=Array.from({length:count},(_,i)=>({id:i+1,status:'registered',registered_at:at}));
  rows.push({id:8,status:'waitlisted',registered_at:at},{id:9,status:'withdrawn',registered_at:at});
  // Act / Assert: remaining spots cannot be negative and waitlist/withdrawal counts are never fabricated from overflow.
  const result=registrationSummary({id:7,venue_capacity:2},rows);
  assert.equal(result.headcount,count);assert.equal(result.remaining_spots,Math.max(0,2-count));
  assert.equal(result.waitlist_count,1);assert.equal(result.withdrawal_count,1);
});
test('Lead registrations AC1 AC4 - queue order uses registration instant then ID without changing statuses',()=>{
  // Arrange: transport order is intentionally scrambled, including a timestamp tie.
  const rows=[{id:9,status:'waitlisted',registered_at:'2030-11-01T01:00:00Z'},
    {id:8,status:'waitlisted',registered_at:at},{id:7,status:'waitlisted',registered_at:at},{id:6,status:'withdrawn',registered_at:at}];
  // Act / Assert: FIFO order is independent of insertion order and ties use the stable registration ID.
  const result=registrationSummary({id:7,venue_capacity:0},rows);
  assert.deepEqual(result.waitlist.map(row=>row.id),[7,8,9]);assert.equal(result.withdrawal_count,1);
  assert.equal(result.venue_capacity,0);assert.equal(result.remaining_spots,0);
  assert.equal(result.attendees.find(row=>row.id===6).status,'withdrawn');
});
for(const capacity of [null,undefined,'2',-1])test(`Lead registrations AC3 - unknown capacity ${capacity} remains unknown`,()=>{
  // Arrange / Act / Assert: missing venue capacity must never be presented as zero remaining places.
  const result=registrationSummary({id:7,venue_capacity:capacity},[]);
  assert.equal(result.venue_capacity,null);assert.equal(result.remaining_spots,null);assert.equal(result.headcount,0);
});
