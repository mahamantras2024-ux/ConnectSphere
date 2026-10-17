const { test, before, beforeEach, afterEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');

// Runs the real route, authentication and handler while replacing only PostgreSQL I/O.
process.env.JWT_SECRET = 'venue-booking-decision-test-secret';
process.env.NODE_ENV = 'test';
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { pool } = require('../../backend/src/config/db');
const app = require('../../backend/src/index');

let server;
let base;
let fixture;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/events`;
});

beforeEach(() => {
  fixture = {
    user: { id: 12, role: 'event_coordinator', auth_version: 0 },
    event: { id: 44, coordinator_id: 12 },
    bookings: [
      { id: 8, event_id: 44, venue_id: 5, venue_name: 'Hall North', status: 'approved', decision_notes: null, created_at: '2030-04-02T10:00:00Z', updated_at: '2030-04-02T11:00:00Z' },
      { id: 9, event_id: 44, venue_id: 6, venue_name: 'Studio East', status: 'rejected', decision_notes: 'Capacity is too small.', created_at: '2030-04-03T10:00:00Z', updated_at: '2030-04-03T10:30:00Z' },
      { id: 10, event_id: 44, venue_id: 6, venue_name: 'Studio East', status: 'pending', decision_notes: null, created_at: '2030-04-04T10:00:00Z', updated_at: '2030-04-04T10:00:00Z' },
    ],
  };
  mock.method(pool, 'query', databaseQuery);
});

afterEach(() => mock.restoreAll());

after(async () => {
  await new Promise(resolve => server.close(resolve));
  await pool.end();
});

/** Supplies deterministic database rows so these tests exercise route authorization and response mapping. */
async function databaseQuery(sql, values = []) {
  if (/FROM users\b/.test(sql)) return { rows: [fixture.user] };
  if (/FROM events\b/.test(sql)) {
    assert.equal(String(values[0]), '44');
    assert.equal(String(values[1]), '12');
    return { rows: fixture.event && fixture.event.coordinator_id === Number(values[1]) ? [fixture.event] : [] };
  }
  if (/FROM venue_bookings\b/.test(sql)) {
    assert.match(sql, /JOIN venues/);
    assert.match(sql, /ORDER BY/);
    assert.equal(String(values[0]), '44');
    return { rows: structuredClone(fixture.bookings).sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || b.id - a.id) };
  }
  throw new Error(`Unexpected database query: ${sql}`);
}

/** Calls the protected endpoint with a real JWT; authentication remains part of the behavior under test. */
async function request(eventId = 44, role = 'event_coordinator') {
  const token = jwt.sign({ sub: 12, activeRole: role }, process.env.JWT_SECRET);
  const response = await fetch(`${base}/${eventId}/venue-bookings`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: response.status, body: await response.json() };
}

test('AC1 AC2 - assigned coordinator can view pending, approved and rejected request statuses', async () => {
  // Arrange: the event has one booking in each supported decision state.
  // Act
  const response = await request();
  // Assert: status values remain explicit so a UI can distinguish a decision from a pending request.
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.bookings.map(booking => booking.status), ['pending', 'rejected', 'approved']);
});

test('AC3 AC4 - response includes rejection reason and the venue linked to each event booking', async () => {
  // Arrange: the rejected booking carries staff feedback and each row has a joined venue identity.
  // Act
  const response = await request();
  // Assert: association fields prevent a reason or decision from appearing under another event or venue.
  assert.equal(response.body.bookings[1].decision_notes, 'Capacity is too small.');
  assert.deepEqual(response.body.bookings.map(({ event_id, venue_id, venue_name }) => [event_id, venue_id, venue_name]), [
    [44, 6, 'Studio East'], [44, 6, 'Studio East'], [44, 5, 'Hall North'],
  ]);
});

test('AC5 - latest booking record is returned first while earlier venue decisions remain available', async () => {
  // Arrange: fixture rows deliberately arrive oldest first so production ordering is observable.
  // Act
  const response = await request();
  // Assert: newest record is immediately visible without discarding historical booking requests.
  assert.deepEqual(response.body.bookings.map(booking => booking.id), [10, 9, 8]);
});

test('AC4 - event bookings are hidden from a coordinator who is not assigned to that event', async () => {
  // Arrange: a valid event ID is assigned to a different coordinator.
  fixture.event = { id: 44, coordinator_id: 99 };
  // Act
  const response = await request();
  // Assert: guessing the event ID cannot expose booking decisions or staff notes.
  assert.equal(response.status, 404);
});

test('AC1 - venue booking history requires an authenticated Event Coordinator', async () => {
  // Arrange: use a valid token for a user with a different active role.
  fixture.user.role = 'attendee';
  // Act
  const response = await request(44, 'attendee');
  // Assert: other roles cannot read private booking decisions.
  assert.equal(response.status, 403);
});
