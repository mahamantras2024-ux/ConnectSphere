// Agreed cross-feature matrix: genuine routes, role guards, migrations, transactions and independent persisted-state oracles.
const { describe, test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createWorkflowFixture } = require('./support/workflowFixture');

describe('Connected release workflows', { skip: process.env.RUN_DB_TESTS !== '1' }, () => {
  let fixture;
  before(async () => { fixture = await createWorkflowFixture(); });
  beforeEach(async () => {
    // Each case starts without events, reservations or notices; catalogue, roles and stock remain stable.
    await fixture.query('TRUNCATE events RESTART IDENTITY CASCADE');
    fixture.emails.length = 0;
  });
  after(async () => { if (fixture) await fixture.close(); });

  test('Workflow AC1 AC2 / Lead AC1 / SCRUM-107 AC1 AC2 / AR AC1 / SCRUM-92 AC1 - submission reaches confirmed with real arrangements', async () => {
    // Arrange: submission must be owned and initially unassigned, with a notice for the Lead.
    const event = await fixture.submit();
    assert.equal(event.status, 'submitted');
    assert.equal(event.coordinator_id, null);
    assert.equal((await fixture.request('otherCoordinator', 'GET', `/events/${event.id}`, undefined, 404)).message, 'Event not found.');
    const leadInbox = await fixture.request('lead', 'GET', '/notifications');
    assert.ok(leadInbox.notifications.some(note => note.event_id === event.id));
    // Act: initial approval alone must not bypass the final venue, equipment and safety gates.
    await fixture.assignAndApprove(event.id);
    await fixture.request('coordinator', 'POST', `/events/${event.id}/status`, { status: 'confirmed' }, 409);
    const bookingId = await fixture.book(event.id);
    await fixture.equip(event.id);
    await fixture.confirm(event.id);
    // Assert: query persisted records independently; successful HTTP responses alone cannot prove arrangements exist.
    const stored = (await fixture.query(`SELECT status,coordinator_id,equipment_confirmed_at IS NOT NULL AS technical,
      registration_open FROM events WHERE id=$1`, [event.id])).rows[0];
    assert.deepEqual(stored, { status: 'confirmed', coordinator_id: fixture.users.coordinator.id, technical: true, registration_open: true });
    const venue = (await fixture.query('SELECT event_id,venue_id,status,start_datetime,end_datetime FROM venue_bookings WHERE id=$1', [bookingId])).rows[0];
    assert.deepEqual({ ...venue, start_datetime: venue.start_datetime.toISOString(), end_datetime: venue.end_datetime.toISOString() }, {
      event_id: event.id, venue_id: fixture.venueId, status: 'approved',
      start_datetime: '2090-06-12T02:00:00.000Z', end_datetime: '2090-06-12T03:00:00.000Z',
    });
    // Venue timestamps are UTC instants; equipment slots are Singapore-local date/time. Both must represent this event.
    const allocations = (await fixture.query(`SELECT reservation.event_id,reservation.event_date::text,
      reservation.start_time::text,reservation.end_time::text,reservation.status,item.inventory_id,item.quantity
      FROM event_equipment_reservations reservation JOIN event_equipment_reservation_items item ON item.reservation_id=reservation.id
      WHERE reservation.event_id=$1`, [event.id])).rows;
    assert.deepEqual(allocations, [{ event_id: event.id, event_date: '2090-06-12', start_time: '10:00:00',
      end_time: '11:00:00', status: 'reserved', inventory_id: fixture.inventoryId, quantity: 1 }]);
    assert.equal((await fixture.request('organiser', 'GET', '/notifications')).notifications.filter(note => note.event_id === event.id && note.type === 'event_confirmed').length, 1);
  });

  test('SCRUM-61 AC1 AC5 / Availability AC6 AC7 - concurrent overlapping requests persist one hold and reject role/assignment forgery', async () => {
    // Arrange: two real events compete for the same buffered slot; neither owns an existing booking.
    const first = await fixture.submit();
    const second = await fixture.submit({ name: 'Competing workshop' });
    await fixture.assignAndApprove(first.id);
    await fixture.assignAndApprove(second.id);
    const payload = eventId => ({ eventId, startDatetime: '2090-06-12T10:00:00+08:00', endDatetime: '2090-06-12T11:00:00+08:00', capacity: 20, layout: 'Theatre' });
    await fixture.request('organiser', 'POST', `/venues/${fixture.venueId}/requests`, payload(first.id), 403);
    await fixture.request('otherCoordinator', 'POST', `/venues/${fixture.venueId}/requests`, payload(first.id), 403);
    // Act: do not serialize the two competitors or mock the database lock.
    const token = require('../../backend/node_modules/jsonwebtoken').sign({ sub: fixture.users.coordinator.id, authVersion: 0 }, process.env.JWT_SECRET);
    const outcomes = await Promise.all([first, second].map(event => fetch(`${fixture.apiUrl}/venues/${fixture.venueId}/requests`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(payload(event.id)),
    })));
    // Assert: the invariant survives actual contention, and the losing request leaves no phantom hold.
    assert.deepEqual(outcomes.map(response => response.status).sort(), [201, 409]);
    const bookings = (await fixture.query('SELECT event_id,status FROM venue_bookings')).rows;
    assert.equal(bookings.length, 1);
    assert.equal(bookings[0].status, 'pending');
    assert.ok([first.id, second.id].includes(bookings[0].event_id));
  });

  test('Amendment AC1 AC2 / Offline AC3 AC4 AC5 - approved attendance change reopens venue technical and safety then permits reconfirmation', async () => {
    // Arrange: real prior approvals and reservations make each reopened flag meaningful.
    const { event, bookingId } = await fixture.arrange();
    const before = (await fixture.query('SELECT equipment_requirements_version FROM events WHERE id=$1', [event.id])).rows[0];
    await fixture.request('organiser', 'PUT', `/events/${event.id}/non-critical`, { purpose: 'Bypass review' }, 409);
    // Act: accepted information stays unchanged until the assigned coordinator approves the request.
    const proposed = await fixture.request('organiser', 'POST', `/events/${event.id}/amendment-requests`, {
      changes: { expectedAttendance: 19 }, explanation: 'One guest can no longer attend.',
    }, 202);
    assert.equal((await fixture.query('SELECT expected_attendance FROM events WHERE id=$1', [event.id])).rows[0].expected_attendance, 20);
    await fixture.request('otherCoordinator', 'POST', `/events/change-requests/${proposed.amendmentRequest.id}/decision`, { decision: 'approved' }, 404);
    await fixture.request('coordinator', 'POST', `/events/change-requests/${proposed.amendmentRequest.id}/decision`, { decision: 'approved' });
    // Assert: attendance changes require all three affected checks, not merely a new status label.
    const changed = (await fixture.query(`SELECT expected_attendance,status,equipment_confirmed_at,
      equipment_requirements_version,safety_recheck_required_at IS NOT NULL AS safety FROM events WHERE id=$1`, [event.id])).rows[0];
    assert.deepEqual(changed, { expected_attendance: 19, status: 'planning', equipment_confirmed_at: null,
      equipment_requirements_version: before.equipment_requirements_version + 1, safety: true });
    assert.ok((await fixture.query('SELECT recheck_required_at FROM venue_bookings WHERE id=$1', [bookingId])).rows[0].recheck_required_at);
    await fixture.request('coordinator', 'POST', `/events/${event.id}/status`, { status: 'confirmed' }, 409);
    await fixture.request('venue', 'PUT', `/venues/${fixture.venueId}/requests/${bookingId}/recheck`, { decision: 'confirmed' });
    await fixture.request('support', 'POST', `/events/${event.id}/equipment-reviews`, { outcome: 'fully_fulfillable', requestVersion: changed.equipment_requirements_version }, 201);
    await fixture.confirm(event.id);
    assert.equal((await fixture.query('SELECT status FROM events WHERE id=$1', [event.id])).rows[0].status, 'confirmed');
    const notices = (await fixture.query('SELECT DISTINCT user_id FROM notifications WHERE change_request_id=$1', [proposed.amendmentRequest.id])).rows.map(row => row.user_id);
    for (const person of ['organiser', 'venue', 'support', 'safety']) assert.ok(notices.includes(fixture.users[person].id), `${person} needs a change notice`);
  });

  test('Register AC1 AC2 AC4 / Withdraw AC1 AC2 / SCRUM-87 AC1 - below at and above capacity preserve idempotency FIFO promotion and privacy', async () => {
    // Arrange: two places, three genuine attendees. Counts 1, 2 and attempted 3 straddle the capacity boundary.
    const { event } = await fixture.arrange();
    const route = `/registrations/events/${event.id}`;
    const first = await fixture.request('attendee', 'POST', route, {}, 201);
    assert.equal(first.remaining, 1);
    const second = await fixture.request('second', 'POST', route, {}, 201);
    assert.equal(second.remaining, 0);
    // Act: no implicit waitlist consent, no caller-selected identity, and duplicate requests cannot allocate twice.
    assert.equal((await fixture.request('third', 'POST', route, {}, 409)).full, true);
    await fixture.request('third', 'POST', route, { attendeeId: fixture.users.attendee.id }, 400);
    assert.equal((await fixture.request('attendee', 'POST', route, {})).registration.id, first.registration.id);
    const waiting = await fixture.request('third', 'POST', route, { joinWaitlist: true }, 201);
    assert.equal(waiting.registration.status, 'waitlisted');
    assert.equal(waiting.waitlistPosition, 1);
    await fixture.request('attendee', 'POST', `${route}/withdraw`, {});
    // Assert: persisted count never exceeds two; the queued person inherits exactly one place and one promotion notice.
    const states = (await fixture.query('SELECT attendee_id,status FROM registrations WHERE event_id=$1 ORDER BY attendee_id', [event.id])).rows;
    assert.deepEqual(states, [
      { attendee_id: fixture.users.attendee.id, status: 'withdrawn' },
      { attendee_id: fixture.users.second.id, status: 'registered' },
      { attendee_id: fixture.users.third.id, status: 'registered' },
    ]);
    const promoted = (await fixture.request('third', 'GET', '/notifications')).notifications.filter(note => note.type === 'waitlist_promoted' && note.event_id === event.id);
    assert.equal(promoted.length, 1);
    const mine = await fixture.request('second', 'GET', '/registrations/mine');
    assert.deepEqual(mine.registrations.map(row => row.id), [second.registration.id]);
  });

  test('SCRUM-90 AC4 / Equipment release AC1 AC2 / Session venues AC4 - cancellation notifies affected users and explicit staff release frees both resources', async () => {
    // Arrange: both resources really occupy the slot and two attendees hold active registrations.
    const { event, bookingId } = await fixture.arrange({}, { sessionName: 'Main session' });
    await fixture.request('attendee', 'POST', `/registrations/events/${event.id}`, {}, 201);
    await fixture.request('second', 'POST', `/registrations/events/${event.id}`, {}, 201);
    await fixture.request('outsider', 'POST', `/events/${event.id}/cancel`, {}, 404);
    // Act: agreed rule is explicit release, not automatic release on event cancellation.
    await fixture.request('organiser', 'POST', `/events/${event.id}/cancel`, {});
    // Assert: allocations persist until the responsible staff deliberately release them.
    assert.equal((await fixture.query('SELECT status FROM events WHERE id=$1', [event.id])).rows[0].status, 'cancelled');
    assert.equal((await fixture.query('SELECT status FROM venue_bookings WHERE id=$1', [bookingId])).rows[0].status, 'approved');
    const reservation = (await fixture.query('SELECT id,status FROM event_equipment_reservations WHERE event_id=$1', [event.id])).rows[0];
    assert.equal(reservation.status, 'reserved');
    await fixture.request('organiser', 'DELETE', `/events/equipment-reservations/${reservation.id}`, undefined, 403);
    await fixture.request('support', 'DELETE', `/events/equipment-reservations/${reservation.id}`);
    await fixture.request('coordinator', 'PUT', `/venues/${fixture.venueId}/requests/${bookingId}/session`, { cancel: true });
    assert.equal((await fixture.query('SELECT status FROM venue_bookings WHERE id=$1', [bookingId])).rows[0].status, 'cancelled');
    assert.equal((await fixture.query('SELECT status FROM event_equipment_reservations WHERE event_id=$1', [event.id])).rows[0].status, 'cancelled');
    const audit = (await fixture.query('SELECT released_by,released_at FROM event_equipment_reservations WHERE id=$1', [reservation.id])).rows[0];
    assert.equal(audit.released_by, fixture.users.support.id);
    assert.ok(audit.released_at);
    const recipients = (await fixture.query("SELECT user_id FROM notifications WHERE event_id=$1 AND type='event_cancelled' ORDER BY user_id", [event.id])).rows.map(row => row.user_id);
    assert.deepEqual(recipients, [fixture.users.attendee.id, fixture.users.second.id]);
    // Resource staff are affected too; attendee-only assertions would miss dropped staff cancellation guidance.
    assert.equal((await fixture.query(`SELECT count(*)::int AS n FROM notifications WHERE event_id=$1 AND user_id=$2
      AND type='tech_support_assignment_cancelled'`, [event.id, fixture.users.support.id])).rows[0].n, 1);
    assert.equal((await fixture.query(`SELECT count(*)::int AS n FROM notifications WHERE event_id=$1 AND user_id=$2
      AND type='venue_event_status_changed' AND details->>'status'='cancelled'`, [event.id, fixture.users.venue.id])).rows[0].n, 1);
    await fixture.request('third', 'POST', `/registrations/events/${event.id}`, {}, 409);
    const successor = await fixture.submit({ name: 'Replacement workshop' });
    await fixture.assignAndApprove(successor.id);
    await fixture.book(successor.id);
    await fixture.equip(successor.id);
    assert.equal((await fixture.request('outsider', 'GET', '/notifications')).notifications.length, 0);
    await fixture.request('organiser', 'POST', `/events/${event.id}/cancel`, {}, 409);
    assert.equal((await fixture.query("SELECT count(*)::int AS n FROM notifications WHERE event_id=$1 AND type='event_cancelled'", [event.id])).rows[0].n, 2);
  });

  test('S1 EVENT 2 AC3 AC4 / S1 AUTH 2 AC7 - SQL-like text remains data and injected identities cannot change ownership', async () => {
    // Arrange: valid free text intentionally contains SQL syntax; no real/public records are available to this test.
    const payload = "Workshop'); DROP TABLE events; --";
    const event = await fixture.submit({ name: payload, organiserId: fixture.users.outsider.id, coordinatorId: fixture.users.otherCoordinator.id });
    // Act: malicious identifiers and forged ownership fields must not turn into executable SQL or access grants.
    await fixture.request('outsider', 'GET', `/events/${event.id}?organiserId=${fixture.users.organiser.id}`, undefined, 404);
    await fixture.request('organiser', 'POST', '/events/1%20OR%201=1/cancel', {}, 400);
    await fixture.request(null, 'GET', `/events/${event.id}`, undefined, 401);
    // Assert: accepted text is preserved literally, the table survives, and identity comes from authentication.
    const stored = (await fixture.query('SELECT name,organiser_id,coordinator_id FROM events WHERE id=$1', [event.id])).rows[0];
    assert.deepEqual(stored, { name: payload, organiser_id: fixture.users.organiser.id, coordinator_id: null });
    assert.equal((await fixture.query('SELECT count(*)::int AS n FROM events')).rows[0].n, 1);
  });
});
