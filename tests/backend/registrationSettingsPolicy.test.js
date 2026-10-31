// Registration settings ACs use fixed instants so neither the machine time zone nor wall clock changes the oracle.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeDeadlines,assertDeadlines}=require('../../backend/src/services/registrationSettingsPolicy');
const {registrationBlocker}=require('../../backend/src/services/attendeeRegistrationPolicy');
const {withdrawalBlocker,withdrawalDeadline}=require('../../backend/src/services/attendeeWithdrawalPolicy');
const start=Date.parse('2030-11-01T10:00:00Z');
const event={status:'confirmed',registration_required:true,registration_open:true,registration_capacity:40,
  proposed_date:'2030-11-01',proposed_start_time:'18:00:00',starts_at:new Date(start).toISOString()};
for(const offset of [-1,0,1])test(`Registration settings AC3 - deadline relative to start ${offset}ms`,()=>{
  // Arrange: equality with event start is valid; a later deadline must be refused.
  const deadline=new Date(start+offset).toISOString();
  // Act / Assert: validate each cutoff independently, never infer withdrawal from registration.
  for(const key of ['registration_deadline','withdrawal_deadline']){
    if(offset<=0)assert.doesNotThrow(()=>assertDeadlines({...event,[key]:deadline}));
    else assert.throws(()=>assertDeadlines({...event,[key]:deadline}),error=>error.status===400 && /start/i.test(error.message));
  }
});
test('Registration settings AC1 AC3 - separate explicit deadlines normalize without device-local time assumptions',()=>{
  // Arrange / Act: 17:00 Singapore is 09:00 UTC; withdrawal can have a different cutoff.
  const result=normalizeDeadlines({registrationDeadline:'2030-11-01T17:00:00+08:00',withdrawalDeadline:'2030-11-01T08:00:00Z'});
  // Assert: each independently supplied instant survives normalization.
  assert.equal(result.registrationDeadline,'2030-11-01T09:00:00.000Z');assert.equal(result.withdrawalDeadline,'2030-11-01T08:00:00.000Z');
});
for(const value of ['not a date','2030-02-30T10:00:00Z','2030-11-01T09:00:00',7])test(`Registration settings AC3 - invalid deadline ${value} cannot be saved`,()=>{
  // Arrange / Act / Assert: clients must send a real calendar instant with an explicit time zone.
  assert.throws(()=>normalizeDeadlines({registrationDeadline:value,withdrawalDeadline:null}),error=>error.status===400);
});
for(const offset of [-1,0,1])test(`Registration settings AC4 AC5 - actions at cutoff offset ${offset}ms`,()=>{
  // Arrange: each cutoff precedes event start; equality is already closed.
  const cutoff=start-3600000;const settings={...event,registration_deadline:new Date(cutoff).toISOString(),withdrawal_deadline:new Date(cutoff).toISOString()};
  // Act / Assert: neither registration/waitlisting nor withdrawal can race past the deadline.
  assert.equal(Boolean(registrationBlocker(settings,cutoff+offset)),offset>=0);
  assert.equal(Boolean(withdrawalBlocker(settings,cutoff+offset)),offset>=0);
});
test('Registration settings AC7 - absent withdrawal deadline keeps event start as the cutoff',()=>{
  // Arrange / Act / Assert: clearing a custom withdrawal deadline must preserve the historical event-start rule.
  assert.equal(withdrawalDeadline(event),event.starts_at);
  assert.equal(withdrawalBlocker(event,start-1),null);assert.ok(withdrawalBlocker(event,start));assert.ok(withdrawalBlocker(event,start+1));
});
test('Registration settings AC8 AC9 - only an explicitly opened Confirmed event accepts new registrations',()=>{
  // Arrange / Act / Assert: manual closing and non-final approval both prevent registration and waitlisting.
  assert.equal(registrationBlocker(event,start-1),null);
  assert.match(registrationBlocker({...event,registration_open:false},start-1),/closed/i);
  assert.match(registrationBlocker({...event,status:'approved'},start-1),/confirm/i);
});
test('Registration settings AC1 AC3 AC7 - empty cutoff restores fallback but malformed payloads cannot save',()=>{
  // Arrange / Act / Assert: explicit clearing differs from forgetting to send any supported setting.
  assert.deepEqual(normalizeDeadlines({registrationDeadline:'',withdrawalDeadline:null}),{registrationDeadline:null,withdrawalDeadline:null});
  for(const body of [null,{}, {other:'value'}])assert.throws(()=>normalizeDeadlines(body),error=>error.status===400);
  assert.throws(()=>normalizeDeadlines({registrationDeadline:'2030-99-99T09:00:00Z'}));
  assert.throws(()=>normalizeDeadlines({registrationDeadline:'2030-11-01T09:99:00Z'}));
});
test('Registration settings AC3 - deadlines require a known schedule and are checked against Singapore event start',()=>{
  // Arrange: Coordinator approval sees stored date/time fields rather than a synthetic starts_at column.
  const local={...event,starts_at:undefined,registration_deadline:'2030-11-01T10:00:00Z'};
  // Act / Assert: 18:00 Singapore equals 10:00 UTC; missing schedule or malformed stored deadlines fail closed.
  assert.doesNotThrow(()=>assertDeadlines(local));
  assert.throws(()=>assertDeadlines({...local,proposed_date:null}));
  assert.throws(()=>assertDeadlines({...local,proposed_start_time:null}));
  assert.throws(()=>assertDeadlines({...local,registration_deadline:'invalid'}));
});
