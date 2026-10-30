const { test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
process.env.JWT_SECRET = 'scrum-104-test';
process.env.NODE_ENV = 'test';
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { pool } = require('../../backend/src/config/db');
const app = require('../../backend/src/index');
let server, base, owner, role, bookingReads, expectedEventId;
const bookings = [{ id: 1, venue_name: 'North Hall', address: '12 North Road', capacity: 120,
  start_datetime: '2030-04-04T02:00:00Z', end_datetime: '2030-04-04T04:00:00Z', status: 'approved',
  updated_at: '2030-04-01T10:00:00Z' }];
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/events`;
});
beforeEach(() => {
  owner = 12; role = 'event_organiser'; bookingReads = 0; expectedEventId = '44';
  // Only PostgreSQL is replaced; JWT authentication and role/ownership guards run normally.
  mock.method(pool, 'query', async (sql, values) => {
    if (/FROM users/.test(sql)) return { rows: [{ id: 12, role, auth_version: 0 }] };
    if (/FROM events/.test(sql)) {
      assert.match(sql, /organiser_id=\$2/);
      assert.deepEqual(values, [expectedEventId, 12]);
      return { rows: owner === values[1] ? [{ id: 44 }] : [] };
    }
    assert.match(sql, /venue.location AS address, venue.capacity/);
    // The view needs the persisted decision timestamp to identify the latest approval.
    assert.match(sql, /booking.updated_at/);
    assert.match(sql, /WHERE booking.event_id=\$1/);
    assert.deepEqual(values, [expectedEventId]);
    bookingReads++;
    return { rows: bookings };
  });
});
afterEach(() => mock.restoreAll());
after(async () => { await new Promise(resolve => server.close(resolve)); await pool.end(); });

/** Sends real HTTP requests so access checks cannot be bypassed by testing a handler alone. */
async function request(id = '44', authenticated = true) {
  return fetch(`${base}/${id}/organiser-venue-bookings`, { headers: authenticated
    ? { Authorization: `Bearer ${jwt.sign({ sub: 12, activeRole: role }, process.env.JWT_SECRET)}` } : {} });
}

test('SCRUM-104 AC1 - owner receives venue facts and booking-specific periods', async () => {
  // Arrange / Act
  const response = await request();
  // Assert: missing or substituted venue capacity/address fails this complete contract check.
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { bookings });
});
test('SCRUM-104 AC5 - another organiser cannot read arrangements', async () => {
  // Arrange / Act
  owner = 99;
  const response = await request();
  // Assert: deny before reading any venue data.
  assert.equal(response.status, 404);
  assert.equal(bookingReads, 0);
});
test('SCRUM-104 AC5 - unsupported role is denied', async () => {
  // Arrange / Act / Assert
  role = 'attendee';
  assert.equal((await request()).status, 403);
  assert.equal(bookingReads, 0);
});
test('SCRUM-104 AC5 - unauthenticated access is denied', async () => {
  // Arrange / Act / Assert
  assert.equal((await request('44', false)).status, 401);
  assert.equal(bookingReads, 0);
});
for (const id of ['0', '2147483648', 'abc']) {
  test(`SCRUM-104 AC5 - invalid event ID ${id} cannot access arrangements`, async () => {
    // Arrange / Act / Assert: reject malformed or out-of-range database identifiers before lookup.
    assert.equal((await request(id)).status, 400);
    assert.equal(bookingReads, 0);
  });
}

for (const id of ['1', '2', '2147483646', '2147483647']) {
  test(`SCRUM-104 AC5 - valid event ID boundary ${id} retains ownership checks`, async () => {
    // Arrange: cover at/above the minimum and below/at the PostgreSQL integer maximum.
    expectedEventId = id;
    owner = 99;
    // Act / Assert: valid identifiers reach ownership checks without exposing another organiser's bookings.
    assert.equal((await request(id)).status, 404);
    assert.equal(bookingReads, 0);
  });
}
