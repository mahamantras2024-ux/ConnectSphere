// SCRUM-107: real transactions/services and conflict rules; only PostgreSQL transport is replaced.
const { test, beforeEach, afterEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('../../backend/src/config/db');
const { approveTentativeHold, updateHoldExpiry, confirmVenueHold, expireVenueHolds, startHoldExpiryScheduler } = require('../../backend/src/services/venueHolds');
const { blocksTime } = require('../../backend/src/services/venueAvailability');
const { REQUIREMENTS } = require('../../backend/src/services/eventDecisionPolicy');
const now = Date.parse('2030-10-09T10:00:00Z');
const future = '2030-10-09T11:00:00Z';
let state;

/** Returns raw rows and records actual transaction/write parameters without calculating availability. */
async function query(sql, args = []) {
  state.calls.push({ sql, args });
  if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql.trim())) return { rows: [] };
  if (sql.includes('WITH due_holds')) {
    const rows = state.due;
    state.due = [];
    return { rows };
  }
  if (sql.includes('FROM venues') && sql.includes('FOR UPDATE')) {
    if (state.onLock) await state.onLock();
    return { rows: [{ id: 7, name: 'Garden Hall', is_active: true, setup_minutes: 0, turnaround_minutes: 0 }] };
  }
  if (sql.includes('FROM venue_bookings') && sql.includes('UNION')) {
    if (state.onPeriods) await state.onPeriods();
    return { rows: state.blockers };
  }
  if (sql.includes('AS pending_clarifications')) return { rows: [] };
  if (sql.includes('FROM venue_bookings') && sql.includes('FOR UPDATE')) return { rows: state.booking ? [structuredClone(state.booking)] : [] };
  if (sql.includes('FROM events')) return { rows: [{ id: 3, name: state.eventName, coordinator_id: state.coordinator }] };
  if (sql.includes('WITH inserted')) {
    if (state.notificationError) throw new Error('Notification write failed');
    state.notifications.push(args);
    return { rows: [] };
  }
  if (sql.startsWith('UPDATE venue_bookings')) {
    if (state.writeError) throw state.writeError;
    state.writes.push({ sql, args });
    // Persist the exact fields requested by production, never manufacture a conflict/expiry decision here.
    state.booking = { ...state.booking, status: args[0], hold_expires_at: args[1], updated_at: args[2], decision_notes: args[6] };
    return { rows: [structuredClone(state.booking)] };
  }
  throw new Error(`Unexpected hold SQL: ${sql}`);
}

beforeEach(() => {
  mock.timers.enable({ apis: ['Date'], now });
  state = { eventName: 'Workshop', coordinator: 4, calls: [], writes: [], notifications: [], blockers: [], due: [],
    booking: { id: 20, venue_id: 7, event_id: 3, requested_by: 4, status: 'pending',
      start_datetime: '2030-10-10T10:00:00Z', end_datetime: '2030-10-10T11:00:00Z', hold_expires_at: future } };
  mock.method(pool, 'connect', async () => ({ query, release() {} }));
});

test('SCRUM-107 AC1 AC2 - deadline expiry during an availability read prevents a stale approval or extension', async () => {
  // Arrange: crossing the deadline while awaiting recorded periods must be checked before persistence.
  state.onPeriods = async () => mock.timers.setTime(Date.parse(future));
  // Act / Assert: neither a stale new approval nor an elapsed extension can reach the write.
  await assert.rejects(approveTentativeHold(7,20,9,future), error=>error.status===400);
  mock.timers.setTime(now);state.booking.status='tentative';
  await assert.rejects(updateHoldExpiry(7,20,9,'2030-10-09T12:00:00Z'), error=>error.status===409);
  assert.equal(state.writes.length,0);
});

test('SCRUM-107 AC3 AC6 - a database expiry guard rejection rolls back and requires fresh approval', async () => {
  // Arrange: PostgreSQL can detect expiry after its own trigger lock wait even after the service checked it.
  state.booking.status='tentative';
  state.writeError=Object.assign(new Error('database guard'),{code:'23514',constraint:'venue_hold_expiry_guard'});
  // Act / Assert: expose a recoverable conflict instead of a generic failure or a fabricated final booking.
  await assert.rejects(confirmVenueHold(7,20,4),error=>error.status===409 && /fresh approval/.test(error.message));
  assert.ok(state.calls.some(call=>call.sql==='ROLLBACK'));
  assert.equal(state.calls.some(call=>call.sql==='COMMIT'),false);
});

test('SCRUM-85 AC2 - staff approval of an unassigned event does not notify its former requester', async () => {
  // The agreed recipient is the current coordinator; a historical requester must not receive a new decision.
  state.coordinator=null;
  await approveTentativeHold(7,20,9,future);
  assert.deepEqual(state.notifications,[]);
});
afterEach(() => { mock.restoreAll(); mock.timers.reset(); });
after(() => pool.end());

test('SCRUM-107 AC1 - staff approval creates a tentative hold with the explicit deadline', async () => {
  // Arrange / Act: approval cannot become a final booking before coordinator confirmation.
  const saved = await approveTentativeHold(7, 20, 9, future);
  // Assert: both status and exact deadline must reach the actual write.
  assert.equal(saved.status, 'tentative');
  assert.equal(Date.parse(saved.hold_expires_at), Date.parse(future));
  assert.equal(state.writes.length, 1);
  assert.equal(state.notifications[0][0][0], 4);
});

for (const deadline of [undefined, '', 'invalid', '2030-02-30T10:00:00Z', '2030-10-09T11:00:00',
  '2030-10-09T09:59:59.999Z', '2030-10-09T10:00:00.000Z']) {
  test(`SCRUM-107 AC1 - rejects missing, invalid or elapsed expiry ${String(deadline)}`, async () => {
    // Arrange / Act / Assert: the future date must be explicit and timezone-aware, regardless of client validation.
    await assert.rejects(approveTentativeHold(7, 20, 9, deadline), error => error.status === 400);
    assert.equal(state.writes.length, 0);
  });
}

test('SCRUM-107 AC1 - a deadline one millisecond in the future is valid', async () => {
  // Arrange / Act / Assert: completes the before/at/after current-time validation boundary.
  assert.equal((await approveTentativeHold(7, 20, 9, new Date(now + 1).toISOString())).status, 'tentative');
});

for (const deadline of ['2030-10-09T10:30:00Z', '2030-10-09T12:00:00Z']) {
  test(`SCRUM-107 AC2 - a live hold adopts its shortened or extended deadline ${deadline}`, async () => {
    // Arrange: an existing tentative approval can be rescheduled while still live.
    state.booking.status = 'tentative';
    // Act / Assert: the new stored instant replaces the old deadline; no second booking is created.
    assert.equal(Date.parse((await updateHoldExpiry(7, 20, 9, deadline)).hold_expires_at), Date.parse(deadline));
    assert.equal(state.writes.length, 1);
  });
}

for (const offset of [-1, 0, 1]) {
  test(`SCRUM-107 AC3 AC5 - confirmation at expiry offset ${offset}ms only succeeds before expiry`, async () => {
    // Arrange: the clock is fixed and only the stored expiry moves around it.
    state.booking.status = 'tentative';
    state.booking.hold_expires_at = new Date(now - offset).toISOString();
    // Act / Assert: equality is already expired; a late hold never becomes final even on an otherwise empty schedule.
    if (offset < 0) assert.equal((await confirmVenueHold(7, 20, 4)).status, 'approved');
    else await assert.rejects(confirmVenueHold(7, 20, 4), error => error.status === 409 && /new.*request|fresh/i.test(error.message));
    assert.equal(state.writes.length, offset < 0 ? 1 : 0);
  });
}

test('SCRUM-107 AC2 AC3 - an expired hold cannot be extended or revived', async () => {
  // Arrange: stored expiry is exactly now, although the cleanup worker has not run yet.
  state.booking.status = 'tentative'; state.booking.hold_expires_at = new Date(now).toISOString();
  // Act / Assert: a future replacement deadline must not bypass expiry or obtain a new approval implicitly.
  await assert.rejects(updateHoldExpiry(7, 20, 9, future), error => error.status === 409);
  assert.equal(state.writes.length, 0);
});

test('SCRUM-107 AC3 - live and expired holds release availability independently of the worker', () => {
  // Arrange / Act / Assert: occupancy must change at the deadline even with no browser open or cleanup execution.
  for (const [remaining, expected] of [[-1, false], [0, false], [1, true]]) {
    assert.equal(blocksTime({ status: 'tentative', hold_expires_at: new Date(now + remaining).toISOString() }, now), expected);
  }
  assert.equal(blocksTime({ status: 'approved', hold_expires_at: new Date(now - 1).toISOString() }, now), true);
});

test('SCRUM-107 AC3 AC5 - tentative approval cannot satisfy final event-arrangement readiness', () => {
  // Arrange: an event has one already confirmed venue and a second staff-approved tentative hold.
  const context={now,bookings:[{status:'approved'},{status:'tentative',hold_expires_at:future}]};
  // Act / Assert: the live tentative hold must still be confirmed, while an elapsed hold cannot block other final bookings.
  assert.equal(REQUIREMENTS.venueConfirmed(context).code,'VENUE_PENDING');
  context.bookings[1].hold_expires_at=new Date(now).toISOString();
  assert.equal(REQUIREMENTS.venueConfirmed(context).met,true);
});

test('SCRUM-107 AC5 AC6 - a newer booking survives attempted confirmation of the expired arrangement', async () => {
  // Arrange: another coordinator has obtained a final valid booking after this hold expired.
  state.booking.status = 'expired';
  const newer = { id: 21, kind: 'booking', status: 'approved', start_datetime: state.booking.start_datetime, end_datetime: state.booking.end_datetime };
  state.blockers = [newer];
  // Act / Assert: neither revival nor replacement of the newer booking is permitted.
  await assert.rejects(confirmVenueHold(7, 20, 4), error => error.status === 409);
  assert.deepEqual(state.blockers, [newer]);
  assert.equal(state.writes.length, 0);
});

test('SCRUM-107 AC6 - even a still-live hold must recheck newly recorded unavailable periods', async () => {
  // Arrange: maintenance was recorded after staff granted the hold.
  state.booking.status = 'tentative';
  state.blockers = [{ id: 20, kind: 'unavailability', start_datetime: state.booking.start_datetime, end_datetime: state.booking.end_datetime }];
  // Act / Assert: a maintenance ID equal to the hold ID must not be excluded as the booking itself.
  await assert.rejects(confirmVenueHold(7, 20, 4), error => error.status === 409);
  assert.equal(state.writes.length, 0);
});

test('SCRUM-107 AC3 AC6 - expiry is sampled after waiting for the venue lock', async () => {
  // Arrange: the deadline is live before contention but expires while another transaction owns the venue.
  state.booking.status = 'tentative'; state.booking.hold_expires_at = new Date(now + 1).toISOString();
  state.onLock = async () => mock.timers.setTime(now + 1);
  // Act / Assert: sampling time before acquiring the lock would wrongly finalize the expired arrangement.
  await assert.rejects(confirmVenueHold(7, 20, 4), error => error.status === 409);
  assert.equal(state.writes.length, 0);
});

test('SCRUM-107 AC5 - only the event’s currently assigned coordinator can confirm', async () => {
  // Arrange: the original requester is no longer the assigned coordinator.
  state.booking.status = 'tentative'; state.coordinator = 8;
  // Act / Assert: the saved requester's identity must not grant authority after reassignment.
  await assert.rejects(confirmVenueHold(7, 20, 4), error => error.status === 403);
  assert.equal(state.writes.length, 0);
});

test('SCRUM-107 AC4 - expiry records one assigned-coordinator notice with full hold context', async () => {
  // Arrange: PostgreSQL returns only rows transitioned atomically from tentative to expired.
  state.due = [{ ...state.booking, status: 'expired', coordinator_id: 8, event_name: 'Workshop', venue_name: 'Garden Hall' }];
  // Act: a second worker tick receives no newly expired rows.
  await expireVenueHolds(); await expireVenueHolds();
  // Assert: notify the current assignee exactly once with event, venue, booking and deadline details.
  assert.equal(state.notifications.length, 1);
  const note = state.notifications[0];
  assert.deepEqual(note[0], [8]);
  const details = JSON.parse(note[6][0]);
  assert.equal(details.bookingId, 20); assert.equal(details.venueId, 7);
  assert.equal(details.holdExpiresAt, future);
  assert.match(note[5][0], /Workshop.*Garden Hall.*20/s);
  assert.ok(state.calls.findIndex(call => call.sql.includes('WITH inserted')) < state.calls.findIndex(call => call.sql === 'COMMIT'));
});

test('SCRUM-107 AC4 - a failed notice rolls back expiration so the next worker can retry', async () => {
  // Arrange: the durable in-app notification is a required part of expiration, not a best-effort email.
  state.due = [{ ...state.booking, coordinator_id: 4, event_name: 'Workshop', venue_name: 'Garden Hall' }];
  state.notificationError = true;
  // Act / Assert: a failed notice must not commit an unnotified expiration.
  await assert.rejects(expireVenueHolds(), /Notification write failed/);
  assert.ok(state.calls.some(call => call.sql === 'ROLLBACK'));
  assert.equal(state.calls.some(call => call.sql === 'COMMIT'), false);
});

for(const status of ['approved','rejected','expired','tentative']) {
  test(`SCRUM-107 AC1 AC3 - staff approval cannot overwrite a ${status} decision`,async()=>{
    // Arrange / Act / Assert: a new approval is allowed only for an undecided pending request.
    state.booking.status=status;
    await assert.rejects(approveTentativeHold(7,20,9,future),error=>error.status===409);
    assert.equal(state.writes.length,0);
  });
}

test('SCRUM-107 AC1 AC2 AC5 - invalid and missing request targets cannot mutate another hold',async()=>{
  // Arrange / Act / Assert: validate both resource IDs before reads, then handle an absent row safely.
  await assert.rejects(approveTentativeHold('bad',20,9,future),error=>error.status===400);
  await assert.rejects(confirmVenueHold(7,'bad',4),error=>error.status===400);
  state.booking=null;
  await assert.rejects(updateHoldExpiry(7,20,9,future),error=>error.status===404);
  assert.equal(state.writes.length,0);
});

test('SCRUM-107 AC2 AC5 - an undecided request is not a staff-approved tentative hold',async()=>{
  // Arrange / Act / Assert: neither rescheduling nor coordinator confirmation may skip staff approval.
  await assert.rejects(updateHoldExpiry(7,20,9,future),error=>error.status===409);
  await assert.rejects(confirmVenueHold(7,20,4),error=>error.status===409);
  assert.equal(state.writes.length,0);
});

test('SCRUM-107 AC4 - a reassignment-less historical hold notifies its recorded requester',async()=>{
  // Arrange: historical data may have no current assignment, but the original coordinator must not lose the notice.
  state.due=[{...state.booking,coordinator_id:null,event_name:'Workshop',venue_name:'Garden Hall'}];
  // Act / Assert: the persisted requester is the only fallback recipient.
  await expireVenueHolds();assert.deepEqual(state.notifications[0][0],[4]);
});

test('SCRUM-107 AC4 - scheduler checks missed deadlines at startup and does not overlap slow runs',async()=>{
  // Arrange: pause the first database connection while several one-second ticks pass.
  mock.timers.reset();mock.timers.enable({apis:['setInterval','Date'],now});
  let release;let connections=0;
  const db={connect:async()=>{connections++;await new Promise(resolve=>{release=resolve;});return {query,release(){}};}};
  // Act: startup initiates a check immediately; extra ticks cannot duplicate the in-flight operation.
  const timer=startHoldExpiryScheduler(db);
  mock.timers.tick(3000);assert.equal(connections,1);
  release();await new Promise(resolve=>setImmediate(resolve));
  mock.timers.tick(1000);assert.equal(connections,2);
  release();await new Promise(resolve=>setImmediate(resolve));clearInterval(timer);
});

test('SCRUM-107 AC4 - scheduler retries after a database outage without exposing private error details',async()=>{
  // Arrange: an unavailable database must not permanently stop the next expiry check.
  mock.timers.reset();mock.timers.enable({apis:['setInterval','Date'],now});
  let connections=0;const logged=mock.method(console,'error',()=>{});
  const db={connect:async()=>{connections++;throw new Error('private connection details');}};
  // Act / Assert: every completed failed attempt can be retried; logs contain only the generic operational message.
  const timer=startHoldExpiryScheduler(db);await new Promise(resolve=>setImmediate(resolve));
  mock.timers.tick(1000);await new Promise(resolve=>setImmediate(resolve));clearInterval(timer);
  assert.equal(connections,2);assert.equal(logged.mock.callCount(),2);
  assert.doesNotMatch(logged.mock.calls.map(call=>call.arguments.join(' ')).join(' '),/private connection/);
});

// Exercise the complete persisted title, since the event name alone may already fit VARCHAR(255).
for (const action of ['approved', 'updated', 'expired']) {
  for (const titleLength of [254, 255, 256, 255 + `Venue hold ${action}: `.length]) {
    test(`SCRUM-107 AC1 AC2 AC4 - ${action} preserves details and bounds a ${titleLength}-character title`, async () => {
      // Arrange: include astral Unicode so truncation must count PostgreSQL characters rather than split surrogate pairs.
      const prefix = `Venue hold ${action}: `;
      const eventName = '🎉'.repeat(titleLength - prefix.length);
      state.eventName = eventName;
      state.booking.status = action === 'updated' ? 'tentative' : 'pending';
      state.due = [{ ...state.booking, coordinator_id: 4, event_name: eventName, venue_name: 'Garden Hall' }];
      // Act: use the actual service and notification insertion with only database transport mocked.
      if (action === 'expired') assert.equal(await expireVenueHolds(), 1);
      else await (action === 'updated' ? updateHoldExpiry : approveTentativeHold)(7, 20, 9, future);
      // Assert: untouched short titles, a 255-character ceiling, and the full event and hold context in the message.
      const note = state.notifications[0];
      assert.equal(note[4][0], prefix + '🎉'.repeat(Math.min(titleLength, 255) - prefix.length));
      assert.ok(note[5][0].includes(eventName));
      assert.ok(note[5][0].includes('Garden Hall'));
      assert.equal(JSON.parse(note[6][0]).bookingId, 20);
      assert.ok(state.calls.some(call => call.sql === 'COMMIT'));
      assert.equal(state.calls.some(call => call.sql === 'ROLLBACK'), false);
    });
  }
}

// SCRUM-85 AC2: expiry changes must not erase why Venue Staff selected this arrangement.
test('SCRUM-85 AC2 - changing a finite hold deadline preserves its saved reason',async()=>{
  state.booking.status='tentative';state.booking.decision_notes='Use the side entrance.';
  const result=await updateHoldExpiry(7,20,9,future);
  assert.equal(result.decision_notes,'Use the side entrance.');
  assert.equal(JSON.parse(state.notifications[0][6][0]).notes,'Use the side entrance.');
});
test('SCRUM-85 AC2 - whitespace-only approval notes are stored as no explanation',async()=>{
  const result=await approveTentativeHold(7,20,9,future,'   ');
  assert.equal(result.decision_notes,null);
});
