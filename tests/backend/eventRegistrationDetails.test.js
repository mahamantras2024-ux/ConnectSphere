const { test, before, beforeEach, afterEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');

// Exercises the organiser registration endpoint through real authentication and role middleware.
process.env.JWT_SECRET = 'event-registration-details-test-secret';
process.env.NODE_ENV = 'test';
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { pool } = require('../../backend/src/config/db');
const app = require('../../backend/src/index');

let server;
let base;
let fixture;
let authenticatedId;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/events`;
});

beforeEach(() => {
  fixture = {
    user: { id: 12, email: 'organiser@example.com', role: 'event_organiser', auth_version: 0 },
    event: { id: 101, organiser_id: 12, name: 'Community Workshop', venue_capacity: 3 },
    registrations: [
      { id: 1, attendee_id: 21, attendee_name: 'Ari Ng', status: 'registered', registered_at: '2031-01-01T09:00:00Z' },
      { id: 2, attendee_id: 22, attendee_name: 'Bea Lim', status: 'registered', registered_at: '2031-01-01T09:05:00Z' },
      { id: 3, attendee_id: 23, attendee_name: 'Chen Tan', status: 'registered', registered_at: '2031-01-01T09:10:00Z' },
      { id: 4, attendee_id: 24, attendee_name: 'Devi Koh', status: 'registered', registered_at: '2031-01-01T09:15:00Z' },
      { id: 5, attendee_id: 25, attendee_name: 'Eli Goh', status: 'waitlisted', registered_at: '2031-01-01T09:20:00Z' },
      { id: 6, attendee_id: 26, attendee_name: 'Fay Ong', status: 'withdrawn', registered_at: '2031-01-01T09:25:00Z' },
    ],
  };
  authenticatedId = fixture.user.id;
  mock.method(pool, 'query', databaseQuery);
});

afterEach(() => mock.restoreAll());
after(async () => {
  await new Promise(resolve => server.close(resolve));
  await pool.end();
});

/** Supplies source-owned event and registration rows while asserting ownership comes from the session. */
async function databaseQuery(sql, values = []) {
  if (/FROM users\s+WHERE id = \$1/.test(sql)) return { rows: [{ ...fixture.user, id: values[0] }] };
  if (/FROM events\s+e/.test(sql)) {
    assert.match(sql, /e\.organiser_id\s*=\s*\$2/);
    assert.deepEqual(values, ['101', authenticatedId]);
    return fixture.event && fixture.event.organiser_id === values[1]
      ? { rows: [{ id: fixture.event.id, name: fixture.event.name, venue_capacity: fixture.event.venue_capacity }] }
      : { rows: [] };
  }
  if (/FROM registrations\s+r/.test(sql)) {
    assert.match(sql, /ORDER BY r\.registered_at ASC, r\.id ASC/);
    assert.deepEqual(values, ['101']);
    return { rows: fixture.registrations };
  }
  throw new Error(`Unexpected database query: ${sql}`);
}

/** Sends a request with the requested active account role through the real server stack. */
async function request(path, user = fixture.user) {
  authenticatedId = user.id;
  const token = jwt.sign({ sub: user.id, activeRole: user.role }, process.env.JWT_SECRET);
  const response = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: response.status, body: await response.json() };
}

test('AC1 AC2 - summary counts stored waitlist entries and registrations over confirmed venue capacity', async () => {
  // Arrange: four active registrations exceed three venue places; one persisted waitlist and one withdrawal exist.
  fixture.registrations[4].registered_at = fixture.registrations[3].registered_at;
  // Act
  const response = await request('/101/registrations');
  // Assert: the status totals remain source-status counts while waitlist includes persisted and capacity overflow.
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.event, { id: 101, name: 'Community Workshop', venue_capacity: 3 });
  assert.deepEqual(response.body.summary, {
    headcount: 4,
    waitlist_count: 2,
    status_breakdown: { registered: 4, withdrawn: 1 },
    waitlist: [
      { registration_id: 4, attendee_name: 'Devi Koh', status: 'registered', registered_at: '2031-01-01T09:15:00Z', reason: 'Exceeds venue capacity' },
      { registration_id: 5, attendee_name: 'Eli Goh', status: 'waitlisted', registered_at: '2031-01-01T09:15:00Z', reason: 'Already waitlisted' },
    ],
  });
});

for (const id of ['not-an-id', '2147483648']) {
  test(`AC3 - rejects invalid event IDs before requesting registration records: ${id}`, async () => {
    // Arrange: route IDs must be positive 32-bit database integers before the owner-scoped event lookup runs.
    // Act
    const response = await request(`/${id}/registrations`);
    // Assert
    assert.equal(response.status, 400);
  });
}

for (const [capacity, expectedOverflow] of [[5, 0], [4, 0], [3, 1]]) {
  test(`AC2 - calculates ${expectedOverflow} overflow waitlist entries at venue capacity ${capacity}`, async () => {
    // Arrange: use four ordered registered attendees without any pre-existing waitlist rows.
    fixture.event.venue_capacity = capacity;
    fixture.registrations = fixture.registrations.filter(row => row.status === 'registered');
    // Act
    const response = await request('/101/registrations');
    // Assert: no one is overflowed below or exactly at capacity; one latest registration is overflowed above it.
    assert.equal(response.status, 200);
    assert.equal(response.body.summary.waitlist_count, expectedOverflow);
    assert.deepEqual(response.body.summary.waitlist.map(row => row.registration_id), expectedOverflow ? [4] : []);
  });
}

test('AC2 - keeps persisted waitlist entries visible when no confirmed venue capacity exists', async () => {
  // Arrange: capacity is unknown, so registered attendees cannot be classified as overflow but stored waitlist remains visible.
  fixture.event.venue_capacity = null;
  fixture.registrations = fixture.registrations.filter(row => row.status !== 'registered');
  // Act
  const response = await request('/101/registrations');
  // Assert
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.summary.waitlist.map(row => row.registration_id), [5]);
});

test('AC2 - does not calculate overflow from an invalid negative venue capacity', async () => {
  // Arrange: a malformed legacy value is treated as unknown rather than making every registered attendee waitlisted.
  fixture.event.venue_capacity = -1;
  fixture.registrations = fixture.registrations.filter(row => row.status === 'registered');
  // Act
  const response = await request('/101/registrations');
  // Assert
  assert.equal(response.status, 200);
  assert.equal(response.body.summary.waitlist_count, 0);
});

test('AC3 - another organiser cannot read the event registration data', async () => {
  // Arrange: the requested event belongs to the fixture organiser, not the authenticated organiser.
  const otherOrganiser = { ...fixture.user, id: 13 };
  // Act
  const response = await request('/101/registrations', otherOrganiser);
  // Assert: the owner-scoped lookup does not reveal that event registrations exist.
  assert.equal(response.status, 404);
});

test('AC3 - non-organiser roles are denied before registration data is queried', async () => {
  // Arrange: use a valid event_coordinator session, which is not permitted on this organiser-only endpoint.
  const coordinator = { ...fixture.user, role: 'event_coordinator' };
  fixture.user.role = 'event_coordinator';
  // Act
  const response = await request('/101/registrations', coordinator);
  // Assert
  assert.equal(response.status, 403);
});
