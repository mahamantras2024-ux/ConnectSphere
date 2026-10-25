// File: SCRUM-43 HTTP tests execute real authorization, decisions and notification construction; only PostgreSQL I/O is replaced.
const { test, before, beforeEach, afterEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
process.env.JWT_SECRET = 'approval-test-only';
process.env.NODE_ENV = 'test';
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { pool } = require('../../backend/src/config/db');
const app = require('../../backend/src/index');
let server, base, state;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/venues`;
});
beforeEach(() => {
  state = { role: 'venue_staff', coordinator: 4, calls: [], notes: [], request: { id: 20, venue_id: 7, event_id: 3, requested_by: 5, status: 'pending',
    start_datetime: '2031-10-20T02:00:00Z', end_datetime: '2031-10-20T03:00:00Z' } };
  mock.method(pool, 'query', query);
  mock.method(pool, 'connect', async () => ({ query, release() {} }));
});
afterEach(() => mock.restoreAll());
after(async () => { await new Promise(resolve => server.close(resolve)); await pool.end(); });
/** Supplies raw records and captures transaction/notification parameters without implementing approval rules. */
async function query(sql, values = []) {
  state.calls.push(sql);
  if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
  if (sql.includes('WITH inserted')) {
    if (state.notificationFailure) throw new Error('Notification storage failed');
    state.notes.push(values);
    return { rows: [] };
  }
  // Safety-check readiness before and after the decision (parent notification system); none means "not ready".
  if (sql.includes('AS pending_clarifications')) return { rows: state.readiness?.length ? [state.readiness.shift()] : [] };
  if (sql.includes('FROM users')) return { rows: [{ id: 9, role: state.role }] };
  if (sql.includes('JOIN venues')) return { rows: [{ ...state.request, venue_name: 'Hall A', event_name: 'Gala', expected_attendance: 100, room_layout_preference: 'Seminar', accessibility_requirements: ['Ramp'] }] };
  if (sql.includes('FROM venues')) return { rows: [{ id: 7, name: 'Hall A', is_active: true, setup_minutes: 0, turnaround_minutes: 0 }] };
  if (sql.includes('FROM events')) return { rows: [{ id: 3, name: 'Gala', coordinator_id: state.coordinator }] };
  if (sql.includes('FROM venue_bookings')) return { rows: sql.includes('UNION') ? [] : [state.request] };
  // Re-confirmation after an applied amendment (Record Offline AC5): clearing the flag, or rejecting the booking.
  if (sql.includes('SET recheck_required_at=NULL')) return { rows: [{ ...state.request, recheck_required_at: null, decision_by: values[2] }] };
  if (sql.includes("SET status='rejected', recheck_required_at=NULL")) {
    return { rows: [{ ...state.request, status: 'rejected', recheck_required_at: null, decision_by: values[2], decision_notes: values[3] }] };
  }
  if (sql.startsWith('UPDATE venue_bookings')) return { rows: [{ ...state.request, status: values[0], decision_by: values[1], updated_at: values[2], decision_notes: values[3] }] };
  throw new Error(`Unexpected SQL: ${sql}`);
}
/** Calls the actual staff API using a signed session; identity supplied in JSON must never become the audit actor. */
async function request(path = '/7/requests/20/decision', body) {
  const response = await fetch(base + path, { method: body ? 'PUT' : 'GET', headers: {
    'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ sub: 9 }, process.env.JWT_SECRET)}`,
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
test('SCRUM-43 AC1 - staff pending list includes event requirements and requested venue/time', async () => {
  // Arrange/Act: the full HTTP route must read the pending queue, not the public catalogue.
  const response = await request('/requests/pending');
  assert.equal(response.status, 200);
  assert.equal(response.body.requests[0].venue_name, 'Hall A');
  assert.equal(response.body.requests[0].expected_attendance, 100);
  assert.equal(response.body.requests[0].room_layout_preference, 'Seminar');
  assert.match(state.calls.find(sql => sql.includes('JOIN venues')), /status\s*=\s*'pending'/);
});
test('SCRUM-43 AC1 / SCRUM-61 AC2 - staff review submitted requirements rather than later event changes', async () => {
  // The event currently says 100/Seminar/Ramp, but this particular venue request deliberately asks for different requirements.
  state.request.requirements = { capacity: 40, layout: 'Theatre', accessibility: [] };
  const response = await request('/requests/pending');
  assert.equal(response.status, 200);
  const saved = response.body.requests[0];
  assert.equal(saved.expected_attendance, 40); assert.equal(saved.room_layout_preference, 'Theatre');
  assert.deepEqual(saved.accessibility_requirements, []); // An explicitly empty requirement list must not gain event requirements.
});
test('SCRUM-43 AC1 - unspecified legacy request fields fall back to recorded event details', async () => {
  state.request.requirements = { capacity: null, layout: '' };
  const response = await request('/requests/pending');
  assert.equal(response.body.requests[0].expected_attendance, 100);
  assert.equal(response.body.requests[0].room_layout_preference, 'Seminar');
  assert.deepEqual(response.body.requests[0].accessibility_requirements, ['Ramp']);
});
for (const role of ['event_coordinator', 'event_organiser', 'attendee', 'technical_support']) {
  test(`SCRUM-43 AC1 AC2 AC3 - ${role} cannot read the staff queue or decide`, async () => {
    state.role = role;
    assert.equal((await request('/requests/pending')).status, 403);
    assert.equal((await request(undefined, { decision: 'approved' })).status, 403);
    assert.equal(state.calls.some(sql => sql.startsWith('UPDATE venue_bookings')), false);
  });
}
for (const decision of ['approved', 'rejected']) {
  test(`SCRUM-43 AC2 AC3 AC4 AC5 AC7 - ${decision} stores trusted audit and coordinator notification before commit`, async () => {
    const response = await request(undefined, { decision, reason: '  Maintenance; try Hall B at 2pm.  ', decision_by: 999 });
    assert.equal(response.status, 200);
    assert.equal(response.body.request.status, decision);
    assert.equal(response.body.request.decision_by, 9);
    assert.ok(Number.isFinite(Date.parse(response.body.request.updated_at)));
    assert.equal(response.body.request.decision_notes, decision === 'rejected' ? 'Maintenance; try Hall B at 2pm.' : null);
    const note = state.notes[0];
    assert.deepEqual(note[0], [4]);
    assert.match(note[5][0], new RegExp(`Gala.*${decision}`, 's'));
    if (decision === 'rejected') assert.match(note[5][0], /Maintenance; try Hall B at 2pm\./);
    const audit = JSON.parse(note[6][0]);
    assert.equal(audit.decisionBy, 9); assert.equal(audit.bookingId, 20);
    assert.equal(audit.decidedAt, response.body.request.updated_at);
    assert.ok(state.calls.findIndex(sql => sql.includes('WITH inserted')) < state.calls.indexOf('COMMIT'));
  });
}
// Parent notification system AC1 (reviewer regression): one booking is approved and another is still pending, so the event
// waits on Venue Staff. Rejecting the pending one leaves the approved booking as its only arrangement: the event is now ready
// for its safety check, and every Safety Officer must hear about it even though the decision was a rejection.
const context = (bookings) => ({ id: 3, name: 'Gala', status: 'submitted', is_draft: false, equipment_items: [], technical_support_required: false,
  video_conferencing_required: false, equipment_notes: null, equipment_confirmed_at: null, pending_clarifications: 0, bookings,
  safety_changes_open: [], latest_safety_check: null });
const approvedBooking = { status: 'approved', hold_expires_at: null };
const heldBooking = { status: 'pending', hold_expires_at: '2099-01-01T00:00:00Z' };
test('NT AC1 - rejecting the last pending booking beside an approved one tells Safety Officers the event is ready', async () => {
  // Arrange: waiting on the pending booking before; only the approved one remains after.
  state.readiness = [context([approvedBooking, heldBooking]), context([approvedBooking])];
  // Act
  const response = await request(undefined, { decision: 'rejected', reason: 'Hall closed' });
  // Assert: the coordinator's notice and the Safety Officer's ready notice are both stored before the commit.
  assert.equal(response.status, 200);
  const safety = state.notes.find((values) => values[3].includes('safety_check_ready'));
  assert.ok(safety, 'Safety Officers must be notified when a rejection makes the event ready.');
  assert.deepEqual([safety[0], safety[4]], [[9], ['Ready for safety check: Gala']]);
  assert.ok(state.calls.lastIndexOf(state.calls.find((sql) => sql.includes('WITH inserted'))) < state.calls.indexOf('COMMIT'));
});
// Test case: Decisions that leave the event waiting (another booking still pending) or that find it already ready send nothing.
for (const [label, decision, readiness] of [
  ['a rejection that leaves another booking pending', 'rejected', [context([approvedBooking, heldBooking, heldBooking]), context([approvedBooking, heldBooking])]],
  ['a rejection of the only booking', 'rejected', [context([heldBooking]), context([])]],
  ['an approval for an event already ready', 'approved', [context([approvedBooking]), context([approvedBooking, approvedBooking])]],
]) {
  test(`NT AC1 - ${label} sends no safety notification`, async () => {
    state.readiness = readiness;
    assert.equal((await request(undefined, { decision })).status, 200);
    assert.equal(state.notes.some((values) => values[3].includes('safety_check_ready')), false);
  });
}
test('SCRUM-43 AC3 AC4 - rejection without notes is allowed', async () => {
  const response = await request(undefined, { decision: 'rejected' });
  assert.equal(response.status, 200); assert.equal(response.body.request.decision_notes, null);
});
test('SCRUM-43 AC5 - notification persistence failure rolls the whole decision back', async () => {
  state.notificationFailure = true;
  assert.equal((await request(undefined, { decision: 'approved' })).status, 500);
  assert.ok(state.calls.includes('ROLLBACK')); assert.ok(!state.calls.includes('COMMIT'));
});
test('SCRUM-43 AC5 - unassigned event notifies the requesting coordinator rather than losing the decision', async () => {
  state.coordinator = null;
  assert.equal((await request(undefined, { decision: 'rejected' })).status, 200);
  assert.deepEqual(state.notes[0][0], [5]);
});
test('SCRUM-43 AC4 - structured rejection notes are rejected before any database mutation', async () => {
  assert.equal((await request(undefined, { decision: 'rejected', reason: { text: 'Try Hall B' } })).status, 400);
  assert.equal(state.calls.some(sql => sql.startsWith('UPDATE venue_bookings')), false);
});

// ---------- Record Offline Clarifications and Apply Agreed Amendments AC5: Venue Staff re-confirm a flagged booking ----------

/** A confirmed booking an applied amendment flagged for re-confirmation. */
const flagged = () => ({ ...state.request, status: 'approved', recheck_required_at: '2031-10-01T00:00:00Z', recheck_reason: 'Event details relevant to the venue changed: Expected attendance.' });
const recheck = (body) => request('/7/requests/20/recheck', body);

// Test case: Re-confirming clears the flag so the venue counts again; the coordinator is told before the commit.
test('OC AC5 - Venue Staff re-confirm a flagged booking and the coordinator is told', async () => {
  state.request = flagged();
  const response = await recheck({ decision: 'confirmed' });
  assert.equal(response.status, 200);
  assert.deepEqual([response.body.request.status, response.body.request.recheck_required_at, response.body.request.decision_by], ['approved', null, 9]);
  const update = state.calls.find((sql) => sql.includes('SET recheck_required_at=NULL'));
  assert.match(update, /decision_by=\$3, updated_at=now\(\)/);
  const [userIds, , , , titles, messages] = state.notes[0];
  assert.deepEqual([userIds, titles], [[4], ['Venue booking re-confirmed: Gala']]);
  assert.match(messages[0], /venue booking #20 at Hall A was re-confirmed\.$/);
  assert.ok(state.calls.findIndex((sql) => sql.includes('WITH inserted')) < state.calls.indexOf('COMMIT'));
});
// Test case: Rejecting ends the booking with the reason (the coordinator must find another arrangement).
test('OC AC5 - Venue Staff reject a flagged booking with a reason', async () => {
  state.request = flagged();
  const response = await recheck({ decision: 'rejected', reason: '  Too small for 150 guests.  ' });
  assert.equal(response.status, 200);
  assert.deepEqual([response.body.request.status, response.body.request.decision_notes], ['rejected', 'Too small for 150 guests.']);
  assert.match(state.notes[0][5][0], /was rejected after the event changed\.\nReason or alternative arrangement: Too small for 150 guests\.$/);
});
// Test case: A rejection without a reason stores none and the coordinator's message adds no reason line.
test('OC AC5 - Venue Staff reject a flagged booking without a reason', async () => {
  state.request = flagged();
  const response = await recheck({ decision: 'rejected' });
  assert.equal(response.body.request.decision_notes, null);
  assert.match(state.notes[0][5][0], /was rejected after the event changed\.$/);
});
// Test case: On an event without a coordinator, the coordinator who requested the booking hears about the re-check.
test('OC AC5 - a re-check on an unassigned event tells the requesting coordinator', async () => {
  state.request = flagged();
  state.coordinator = null;
  assert.equal((await recheck({ decision: 'confirmed' })).status, 200);
  assert.deepEqual(state.notes[0][0], [5]);
});
// Test case: Rejecting a flagged booking can leave the event ready for its safety check; Safety Officers then hear.
test('OC AC5 - a re-confirmation that makes the event ready tells Safety Officers', async () => {
  state.request = flagged();
  state.readiness = [context([{ ...approvedBooking, recheck_required_at: '2031-10-01T00:00:00Z' }]), context([approvedBooking])];
  assert.equal((await recheck({ decision: 'confirmed' })).status, 200);
  assert.ok(state.notes.some((values) => values[3].includes('safety_check_ready')));
});
// Test case: Only a flagged confirmed booking can be re-checked, with a valid decision and reason.
for (const [label, booking, body, status] of [
  ['a booking that is not flagged', () => ({ ...state.request, status: 'approved' }), { decision: 'confirmed' }, 409],
  ['a pending request', () => ({ ...state.request, recheck_required_at: '2031-10-01T00:00:00Z' }), { decision: 'confirmed' }, 409],
  ['an unknown decision', flagged, { decision: 'approved' }, 400],
  ['a reason that is not text', flagged, { decision: 'rejected', reason: 5 }, 400],
  ['a 4001-character reason', flagged, { decision: 'rejected', reason: 'x'.repeat(4001) }, 400],
  ['a 4000-character reason', flagged, { decision: 'rejected', reason: 'x'.repeat(4000) }, 200],
]) {
  test(`OC AC5 - re-checking ${label} returns ${status}`, async () => {
    state.request = booking();
    assert.equal((await recheck(body)).status, status);
  });
}
test('OC AC5 - re-checking a missing booking returns 404 and other roles 403', async () => {
  state.request = undefined;
  assert.equal((await recheck({ decision: 'confirmed' })).status, 404);
  state.role = 'event_coordinator';
  assert.equal((await recheck({ decision: 'confirmed' })).status, 403);
});
// Test case: Venue Staff's inbox includes flagged confirmed bookings alongside pending requests.
test('OC AC5 - the Venue Staff inbox lists flagged bookings with the reason', async () => {
  state.request = flagged();
  const response = await request('/requests/pending');
  assert.equal(response.status, 200);
  assert.match(state.calls.find((sql) => sql.includes('booking.recheck_reason')), /WHERE booking\.status='pending' OR \(booking\.status='approved' AND booking\.recheck_required_at IS NOT NULL\)/);
  assert.equal(response.body.requests[0].recheck_reason, 'Event details relevant to the venue changed: Expected attendance.');
});
