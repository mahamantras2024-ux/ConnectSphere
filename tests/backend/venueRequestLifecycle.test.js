const { test, before, beforeEach, afterEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');

// Use a test-only signing secret before loading authentication; no live database is contacted.
process.env.JWT_SECRET = 'venue-request-red-phase-only';
process.env.NODE_ENV = 'test';
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { pool } = require('../../backend/src/config/db');
const app = require('../../backend/src/index');

const now = Date.parse('2030-10-09T12:00:00+08:00');
const day = '2030-10-10';
const at = time => `${day}T${time}+08:00`;
const requestBody = { eventId: 3, startDatetime: at('10:00:00'), endDatetime: at('11:00:00') };
const venue = { id: 7, is_active: true, setup_minutes: 30, turnaround_minutes: 15 };
const hold = {
  id: 20, venue_id: 7, event_id: 3, requested_by: 1, kind: 'booking', label: 'Workshop',
  status: 'pending', start_datetime: at('10:00:00'), end_datetime: at('11:00:00'),
  created_at: '2030-10-08T12:00:00+08:00', hold_expires_at: '2030-10-09T12:00:00+08:00',
};
let server, base, fixture;

before(async () => {
  // Real HTTP routing, JWT verification, controllers and business logic execute in these tests.
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/venues`;
});

beforeEach(() => {
  mock.timers.enable({ apis: ['Date'], now });
  fixture = { role: 'event_coordinator', venue: { ...venue }, event: { id: 3, coordinator_id: 1 }, bookings: [], maintenance: [], writes: [] };
  // This stub controls database I/O only. It deliberately does not calculate conflicts or expiry.
  mock.method(pool, 'query', databaseQuery);
  mock.method(pool, 'connect', async () => ({ query: databaseQuery, release() {} }));
});

afterEach(() => { mock.restoreAll(); mock.timers.reset(); });
after(async () => { await new Promise(resolve => server.close(resolve)); await pool.end(); });

/** Resolves SQL parameters/literals for write assertions without implementing business rules in the mock. */
function storedValue(expression, parameters) {
  const value = expression.trim();
  const parameter = /^\$(\d+)(?:::\w+)?$/.exec(value);
  if (parameter) return parameters[Number(parameter[1]) - 1];
  if (/^null$/i.test(value)) return null;
  if (/^(now\(\)|CURRENT_TIMESTAMP)$/i.test(value)) return new Date(now).toISOString();
  if (/^'[^']*'$/.test(value)) return value.slice(1, -1);
  throw new Error(`Unsupported database-fixture expression: ${value}`);
}

/** Records parameterized writes and supplies raw rows; SQL locking and execution need separate PostgreSQL integration tests. */
async function databaseQuery(sql, parameters = []) {
  const query = sql.trim();
  if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(query)) return { rows: [] };
  if (/FROM users\b/i.test(query)) return { rows: [{ id: 1, role: fixture.role }] };
  if (/^SELECT/i.test(query)) {
    if (/FROM venues\b/i.test(query)) return { rows: fixture.venue ? [fixture.venue] : [] };
    if (/FROM events\b/i.test(query)) return { rows: fixture.event ? [fixture.event] : [] };
    if (/FROM venue_bookings\b/i.test(query)) {
      // Return raw candidates: approval and expiry decisions belong to production code, not this fixture.
      const rows = /UNION/i.test(query) ? [...fixture.bookings, ...fixture.maintenance] : fixture.bookings;
      return { rows: structuredClone(rows) };
    }
    if (/FROM venue_unavailability\b/i.test(query)) return { rows: structuredClone(fixture.maintenance) };
  }
  const insertion = /^INSERT INTO venue_bookings\s*\(([^)]+)\)\s*VALUES\s*\(([\s\S]+)\)\s*RETURNING/i.exec(query);
  if (insertion) {
    const columns = insertion[1].split(',').map(column => column.trim());
    const values = insertion[2].split(',').map(expression => storedValue(expression, parameters));
    const row = { id: 21, created_at: new Date(now).toISOString(), ...Object.fromEntries(columns.map((column, index) => [column, values[index]])) };
    fixture.writes.push({ operation: 'insert', row });
    return { rows: [row], rowCount: 1 };
  }
  const update = /^UPDATE venue_bookings\s+SET\s+([\s\S]+?)\s+WHERE/i.exec(query);
  if (update) {
    const changes = Object.fromEntries(update[1].split(',').map(assignment => {
      const [column, expression] = assignment.split('=');
      return [column.trim(), storedValue(expression, parameters)];
    }));
    fixture.writes.push({ operation: 'update', changes });
    return { rows: [{ ...fixture.bookings[0], ...changes }], rowCount: 1 };
  }
  throw new Error(`Unexpected database operation in venue request test: ${query}`);
}

/** Calls the proposed request API with a genuine token; omitting credentials exercises real auth middleware. */
async function request(path, body, method = 'POST', authenticated = true) {
  const token = jwt.sign({ sub: 1 }, process.env.JWT_SECRET);
  const response = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

test('AC1 - the Event Coordinator can read the selected venue schedule', async () => {
  // Arrange / Act: coordinator is the fixture's real authenticated role.
  const response = await request('/7/schedule?date=2030-10-10', undefined, 'GET');
  // Assert: the current staff-only endpoint incorrectly returns 403.
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, []);
});

test('AC7 - submission immediately persists a pending request with a 24-hour hold', async () => {
  // Arrange: no recorded blockers exist and event 3 is assigned to this coordinator.
  // Act
  const response = await request('/7/requests', requestBody);
  // Assert: inspect the actual write arguments as well as the API response, avoiding a canned-response oracle.
  assert.equal(response.status, 201);
  assert.equal(fixture.writes.length, 1);
  const saved = fixture.writes[0].row;
  assert.equal(saved.status, 'pending');
  assert.equal(Number(saved.venue_id), 7);
  assert.equal(Number(saved.event_id), 3);
  assert.equal(Number(saved.requested_by), 1);
  assert.equal(Date.parse(saved.hold_expires_at), Date.parse('2030-10-10T12:00:00+08:00'));
  assert.equal(Date.parse(saved.start_datetime), Date.parse(requestBody.startDatetime));
  assert.equal(Date.parse(saved.end_datetime), Date.parse(requestBody.endDatetime));
  assert.equal(response.body.request.status, 'pending');
  assert.equal(Date.parse(response.body.request.hold_expires_at), Date.parse(saved.hold_expires_at));
});

for (const [name, body, authenticated, role, status] of [
  ['missing authentication', requestBody, false, 'event_coordinator', 401],
  ['wrong requesting role', requestBody, true, 'attendee', 403],
  ['invalid event ID', { ...requestBody, eventId: 'invalid' }, true, 'event_coordinator', 400],
  ['invalid timestamp', { ...requestBody, startDatetime: 'invalid' }, true, 'event_coordinator', 400],
  ['negative duration', { ...requestBody, endDatetime: at('09:59:59.999') }, true, 'event_coordinator', 400],
  ['zero duration', { ...requestBody, endDatetime: at('10:00:00') }, true, 'event_coordinator', 400],
]) {
  test(`AC7 - ${name} cannot create a temporary hold`, async () => {
    // Arrange: each row changes one input or authorization boundary.
    fixture.role = role;
    // Act
    const response = await request('/7/requests', body, 'POST', authenticated);
    // Assert: a failed submission cannot reserve any slot as a side effect.
    assert.equal(response.status, status);
    assert.deepEqual(fixture.writes, []);
  });
}

test('AC7 - a positive one-millisecond request passes the zero-duration boundary', async () => {
  // Arrange / Act: the AC does not impose a minimum event length greater than zero.
  const response = await request('/7/requests', { ...requestBody, endDatetime: at('10:00:00.001') });
  // Assert: closes the just-below / exactly-at / just-above duration boundary matrix.
  assert.equal(response.status, 201);
  assert.equal(fixture.writes.length, 1);
});

test('AC7 - a coordinator cannot reserve a venue for another coordinator\'s event', async () => {
  // Arrange: preserve the repository's existing assignment-scoped event access rule.
  fixture.event.coordinator_id = 99;
  // Act
  const response = await request('/7/requests', requestBody);
  // Assert: guessing a valid event ID must not grant authority to create its hold.
  assert.equal(response.status, 403);
  assert.deepEqual(fixture.writes, []);
});

for (const [time, expected] of [ ['11:14:59.999', 409], ['11:15:00.000', 201], ['11:15:00.001', 201] ]) {
  test(`AC6 AC7 - maintenance starting at ${time} is checked against candidate turnaround ending at 11:15`, async () => {
    // Arrange: with 15-minute turnaround the event ends at 11:00, so occupied end is 11:15.
    // Moving maintenance around that fixed endpoint avoids implementing the production calculation in the test.
    fixture.maintenance = [{ id: 30, kind: 'unavailability', start_datetime: at(time), end_datetime: at('12:00:00') }];
    // Act
    const response = await request('/7/requests', requestBody);
    // Assert: equality permits adjacency; one millisecond of turnaround overlap rejects it.
    assert.equal(response.status, expected);
    assert.equal(fixture.writes.length, expected === 201 ? 1 : 0);
  });
}

for (const [end, expected] of [ ['09:29:59.999', 201], ['09:30:00.000', 201], ['09:30:00.001', 409] ]) {
  test(`AC6 AC7 - maintenance ending at ${end} is checked against candidate setup at 09:30`, async () => {
    // Arrange: a 10:00 event independently needs setup beginning at 09:30.
    fixture.maintenance = [{ id: 30, kind: 'unavailability', start_datetime: at('09:00:00'), end_datetime: at(end) }];
    // Act
    const response = await request('/7/requests', requestBody);
    // Assert: catches checking only raw event times or borrowing turnaround as setup duration.
    assert.equal(response.status, expected);
    assert.equal(fixture.writes.length, expected === 201 ? 1 : 0);
  });
}

test('AC6 - a recorded booking\'s turnaround conflicts even when raw event and candidate setup do not overlap', async () => {
  // Arrange: existing event ends 09:20; its turnaround ends 09:35, overlapping candidate setup at 09:30.
  fixture.bookings = [{ ...hold, status: 'approved', start_datetime: at('08:00:00'), end_datetime: at('09:20:00') }];
  // Act
  const response = await request('/7/requests', requestBody);
  // Assert: expanding only the candidate would incorrectly permit this request.
  assert.equal(response.status, 409);
  assert.deepEqual(fixture.writes, []);
});

test('AC6 - a recorded booking\'s setup conflicts even when raw event and candidate turnaround do not overlap', async () => {
  // Arrange: next event starts 11:40; its setup begins 11:10, overlapping candidate turnaround until 11:15.
  fixture.bookings = [{ ...hold, status: 'approved', start_datetime: at('11:40:00'), end_datetime: at('12:40:00') }];
  // Act
  const response = await request('/7/requests', requestBody);
  // Assert: catches expanding only existing turnaround, or expanding only the candidate.
  assert.equal(response.status, 409);
  assert.deepEqual(fixture.writes, []);
});

for (const [name, expires, expected] of [
  ['one millisecond before expiration', now + 1, 409],
  ['exactly at expiration', now, 201],
  ['one millisecond after expiration', now - 1, 201],
]) {
  test(`AC7 AC8 AC9 - another request ${name} observes the recorded hold correctly`, async () => {
    // Arrange: only the stored deadline changes; the authoritative checking clock stays fixed.
    fixture.bookings = [{ ...hold, hold_expires_at: new Date(expires).toISOString() }];
    // Act
    const response = await request('/7/requests', requestBody);
    // Assert: expiration frees a slot on the server without waiting for a browser or cleanup job.
    assert.equal(response.status, expected);
    assert.equal(fixture.writes.filter(write => write.operation === 'insert').length, expected === 201 ? 1 : 0);
    assert.equal(fixture.writes.some(write => write.changes?.status === 'approved'), false);
  });
}

for (const [decision, persisted] of [['approved', 'approved'], ['rejected', 'rejected']]) {
  test(`AC7 - Venue Staff can mark an active request ${decision}`, async () => {
    // Arrange: this live hold is the request being decided, not a conflicting second request.
    fixture.role = 'venue_staff';
    fixture.bookings = [{ ...hold, hold_expires_at: new Date(now + 1).toISOString() }];
    // Act
    const response = await request('/7/requests/20/decision', { decision }, 'PUT');
    // Assert: approval must ignore its own hold; rejection must persist a nonblocking status.
    assert.equal(response.status, 200);
    assert.equal(response.body.request.status, persisted);
    assert.equal(fixture.writes.at(-1).changes.status, persisted);
  });
}

for (const blocker of ['confirmed booking', 'maintenance', 'another active hold']) {
  test(`AC3 AC8 - expiration does not permit a conflicting request over ${blocker}`, async () => {
    // Arrange: one expired hold and one independently valid blocker cover the same slot.
    fixture.bookings = [hold];
    if (blocker === 'maintenance') fixture.maintenance = [{ ...hold, id: 30, kind: 'unavailability' }];
    else fixture.bookings.push({
      ...hold, id: 30, status: blocker === 'confirmed booking' ? 'approved' : 'pending',
      hold_expires_at: new Date(now + 1000).toISOString(),
    });
    // Act
    const response = await request('/7/requests', requestBody);
    // Assert: filtering out the expired record must not short-circuit checking the other blocker.
    assert.equal(response.status, 409);
    assert.equal(fixture.writes.filter(write => write.operation === 'insert').length, 0);
  });
}

test('AC7 - Event Coordinators cannot approve their own venue request', async () => {
  // Arrange
  fixture.bookings = [{ ...hold, hold_expires_at: new Date(now + 1000).toISOString() }];
  // Act
  const response = await request('/7/requests/20/decision', { decision: 'approved' }, 'PUT');
  // Assert: a valid coordinator token must still fail the staff-only operation.
  assert.equal(response.status, 403);
  assert.deepEqual(fixture.writes, []);
});

for (const [name, expires] of [['at expiration', now], ['after expiration', now - 1]]) {
  test(`AC8 AC9 - approval ${name} cannot revive an expired hold over a new confirmed booking`, async () => {
    // Arrange: the expired reservation grants no priority over a new confirmed booking of the same slot.
    fixture.role = 'venue_staff';
    fixture.bookings = [{ ...hold, hold_expires_at: new Date(expires).toISOString() }, { ...hold, id: 21, status: 'approved' }];
    // Act
    const response = await request('/7/requests/20/decision', { decision: 'approved' }, 'PUT');
    // Assert: catches late approval that relies on the old hold instead of validating current conflicts.
    assert.equal(response.status, 409);
    assert.equal(fixture.writes.some(write => write.changes?.status === 'approved'), false);
  });
}

test('AC3 AC5 AC7 - approval rechecks maintenance recorded since the hold was created', async () => {
  // Arrange: the hold was valid, but maintenance now intersects the occupied period.
  fixture.role = 'venue_staff';
  fixture.bookings = [{ ...hold, hold_expires_at: new Date(now + 1000).toISOString() }];
  fixture.maintenance = [{ id: 30, kind: 'unavailability', start_datetime: at('10:30:00'), end_datetime: at('11:00:00') }];
  // Act
  const response = await request('/7/requests/20/decision', { decision: 'approved' }, 'PUT');
  // Assert: approval must not trust the historical conflict check at request creation.
  assert.equal(response.status, 409);
  assert.equal(fixture.writes.some(write => write.changes?.status === 'approved'), false);
});
