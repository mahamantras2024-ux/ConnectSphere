// Session venue ACs: requirements are local to one request; no event-wide capacity pooling is allowed.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {requirements}=require('../../backend/src/services/venueRequestRequirements');
const {assertSessionSuitability}=require('../../backend/src/services/sessionVenueRequests');
const venue={capacity:40,supported_layouts:['Seminar'],accessibility_features:['Ramp'],facilities:['Projector']};

for(const capacity of [39,40,41])test(`Session venues AC3 AC5 - individual venue capacity boundary ${capacity}`,()=>{
  // Arrange: the event may have other venues, but only this venue's forty places count for this session.
  const details=requirements({sessionName:'Track A',capacity,layout:'Seminar'}).requirements;
  // Act / Assert: equal capacity fits; one attendee over must be refused regardless of other venue capacities.
  if(capacity<=40)assert.doesNotThrow(()=>assertSessionSuitability(details,venue));
  else assert.throws(()=>assertSessionSuitability(details,venue),error=>error.status===400 && /capacity/i.test(error.message));
});
test('Session venues AC1 AC2 - named sessions preserve independent requirements and disable event-wide cancellation',()=>{
  // Arrange / Act: two sessions deliberately have different attendance and room requirements.
  const first=requirements({sessionName:' Track A ',capacity:20,layout:'Seminar',cancelOtherPending:true});
  const second=requirements({sessionName:'Track B',capacity:35,layout:'Theatre'});
  // Assert: snapshots identify each session; one session must never cancel the other implicitly.
  assert.equal(first.requirements.sessionName,'Track A');assert.equal(first.requirements.capacity,20);
  assert.equal(second.requirements.capacity,35);assert.equal(second.requirements.layout,'Theatre');
  assert.equal(first.cancelOtherPending,false);
});
for(const body of [{sessionName:4,capacity:10},{sessionName:'Track A'}]){
  test(`Session venues AC2 AC5 - invalid session requirements ${JSON.stringify(body)} are rejected`,()=>{
    // Arrange / Act / Assert: a named session must have a valid name and its own positive attendance.
    assert.throws(()=>requirements(body),error=>error.status===400);
  });
}
test('Session venues AC3 - each session is checked for layout accessibility and facilities',()=>{
  // Arrange / Act / Assert: an independently unsuitable session cannot borrow another venue's facilities.
  for(const extra of [{layout:'Theatre'},{accessibility:['Lift']},{requiredFacilities:['Piano']}]){
    const details=requirements({sessionName:'Breakout',capacity:10,...extra}).requirements;
    assert.throws(()=>assertSessionSuitability(details,venue),error=>error.status===400);
  }
  assert.doesNotThrow(()=>assertSessionSuitability(requirements({capacity:200}).requirements,venue));
  assert.throws(()=>assertSessionSuitability(requirements({sessionName:'Track A',capacity:10}).requirements,{...venue,capacity:null}),/capacity/);
});
for(const length of [119,120,121])test(`Session venues AC2 - session name length boundary ${length}`,()=>{
  // Arrange / Act / Assert: names may contain at most 120 characters; test both sides of the exact limit.
  const body={sessionName:'x'.repeat(length),capacity:10};
  if(length<=120)assert.equal(requirements(body).requirements.sessionName.length,length);
  else assert.throws(()=>requirements(body));
});
test('Session venues AC1 AC2 - a blank session name preserves legacy event-wide request behavior',()=>{
  // Arrange / Act / Assert: an optional blank name must not create a new session or alter the legacy cancellation choice.
  const result=requirements({sessionName:' ',capacity:10,cancelOtherPending:true});
  assert.equal(result.requirements.sessionName,undefined);assert.equal(result.cancelOtherPending,true);
});
