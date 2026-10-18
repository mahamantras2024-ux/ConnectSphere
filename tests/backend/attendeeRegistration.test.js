const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
process.env.JWT_SECRET = 'attendee-registration-test-secret';
process.env.NODE_ENV = 'test';
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { pool } = require('../../backend/src/config/db');
const app = require('../../backend/src/index');
const service = require('../../backend/src/services/attendeeRegistration');
const event = { id: 44, name: 'Arts Day', status: 'approved', is_draft: false, registration_required: true,
  starts_at: '2031-06-12T01:30:00Z', registration_capacity: 2, venue_capacity: 3 };
let server, base;

/** Simulates only PostgreSQL, retaining the actual HTTP, authentication, policy and transaction code. */
function database({ context = event, occupied = 1, registration = null, failWrite = false, failRollback = false, userRole = 'attendee' } = {}) {
  // Freeze only the clock boundary so the API rules remain repeatable after the fixture's calendar date.
  mock.method(Date, 'now', () => Date.parse('2031-06-01T00:00:00Z'));
  let current = registration;
  const statements = [];
  const execute = async (sql, values = []) => {
    statements.push({ sql, values });
    if (sql === 'ROLLBACK' && failRollback) throw new Error('Rollback unavailable');
    if (sql.includes('FROM users WHERE')) return { rows: [{ id: 8, role: userRole, auth_version: 0 }] };
    if (sql.includes('FROM events e')) return { rows: context ? [context] : [] };
    if (sql.includes('AS occupied')) return { rows: [{ registration: current, occupied, waitlist_position: current?.status === 'waitlisted' ? 1 : null }] };
    if (sql.startsWith('INSERT INTO registrations')) {
      if (failWrite) throw new Error('registration store unavailable');
      current = { id: 7, event_id: values[0], attendee_id: values[1], status: values[2] };
    }
    return { rows: [] };
  };
  const release = mock.fn();
  mock.method(pool, 'query', execute);
  mock.method(pool, 'connect', async () => ({ query: execute, release }));
  return { statements, release };
}

/** Makes an authenticated request as attendee 8, never taking attendee IDs from request JSON. */
async function request(method = 'POST', body = {}, id = '44', role = 'attendee', authenticated = true) {
  const token = jwt.sign({ sub: 8, activeRole: role, authVersion: 0 }, process.env.JWT_SECRET);
  const response = await fetch(`${base}/events/${id}`, { method,
    headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/registrations`;
});
afterEach(() => mock.restoreAll());
after(async () => { await new Promise(resolve => server.close(resolve)); await pool.end(); });

for (const occupied of [1, 2, 3]) {
  test(`Register AC1/AC2 - ${occupied} occupied places against capacity 2 returns ${occupied < 2 ? 'Registered' : 'full'}`, async () => {
    // Arrange: below/exactly/above capacity checks the rule, not a particular implementation branch.
    const db = database({ occupied });
    // Act
    const result = await request();
    // Assert: a full response never writes or automatically opts the attendee into a waitlist.
    assert.equal(result.status, occupied < 2 ? 201 : 409);
    if (occupied < 2) {
      assert.equal(result.body.registration.status, 'registered');
      assert.match(result.body.message, /confirmed/);
      assert.deepEqual(db.statements.find(row => row.sql.startsWith('INSERT INTO registrations')).values, [44, 8, 'registered']);
      assert.ok(db.statements.find(row => row.sql.includes('FOR UPDATE OF e')));
    } else {
      assert.equal(result.body.full, true);
      assert.equal(db.statements.some(row => row.sql.startsWith('INSERT')), false);
    }
    assert.equal(db.release.mock.callCount(), 1);
  });
}
test('Register AC2 - explicit opt-in persists a waitlist entry and its queue position', async () => {
  database({ occupied: 2 });
  const result = await request('POST', { joinWaitlist: true });
  assert.equal(result.status, 201);
  assert.equal(result.body.registration.status, 'waitlisted');
  assert.equal(result.body.waitlistPosition, 1);
});
test('Register AC2 - a newly available place is registered even when the submitted choice was waitlist', async () => {
  database();
  const result = await request('POST', { joinWaitlist: true });
  assert.equal(result.body.registration.status, 'registered');
});
for (const status of ['registered', 'waitlisted']) {
  test(`Register AC4 - existing ${status} record is returned even when the event is closed and full`, async () => {
    const existing = { id: 19, status };
    const db = database({ context: { ...event, starts_at: '2020-01-01T00:00:00Z' }, occupied: 2, registration: existing });
    const result = await request();
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.registration, existing);
    assert.equal(db.statements.some(row => row.sql.startsWith('INSERT')), false);
  });
}
test('Register AC3/AC5 - disabled, unapproved, closed and missing events do not write registrations', async () => {
  for (const context of [{ ...event, registration_required: false }, { ...event, status: 'planning' }, { ...event, starts_at: '2020-01-01T00:00:00Z' }, null]) {
    const db = database({ context });
    const result = await request();
    assert.equal(result.status, context ? 409 : 404);
    assert.equal(db.statements.some(row => row.sql.startsWith('INSERT')), false);
    mock.restoreAll();
  }
});
test('Register AC1 - GET exposes own status and availability and reports missing or malformed events', async () => {
  database();
  const result = await request('GET');
  assert.equal(result.status, 200);
  assert.equal(result.body.remaining, 1);
  assert.equal(result.body.deadline, '2031-06-12T01:30:00.000Z');
  assert.equal((await request('GET', {}, 'bad')).status, 400);
  mock.restoreAll(); database({ context: null });
  assert.equal((await request('GET')).status, 404);
});
test('Register AC3 - missing or invalid schedule reports a blocker without a fabricated deadline', async () => {
  for (const starts_at of [null, 'invalid']) {
    database({ context: { ...event, starts_at } });
    const result = await request('GET');
    assert.equal(result.status, 200);
    assert.equal(result.body.deadline, null);
    assert.match(result.body.blocker, /schedule/);
    mock.restoreAll();
  }
});
test('Register AC2 - missing capacity fails closed and explicit zero capacity offers only a waitlist', async () => {
  for (const capacity of [null, 0]) {
    database({ context: { ...event, registration_capacity: capacity, venue_capacity: null }, occupied: 0 });
    const result = await request('GET');
    assert.equal(result.body.capacity, capacity);
    assert.equal(result.body.remaining, 0);
    if (capacity === null) assert.match(result.body.blocker, /capacity/);
    else assert.equal(result.body.blocker, null);
    mock.restoreAll();
  }
});
test('Register AC4 - rejoining uses the current time and restores a withdrawn row rather than duplicating it', async () => {
  const db = database({ registration: { id: 7, status: 'withdrawn' } });
  const result = await request();
  assert.equal(result.status, 201);
  assert.equal(result.body.registration.status, 'registered');
  const insert = db.statements.find(row => row.sql.startsWith('INSERT'));
  assert.match(insert.sql, /ON CONFLICT \(event_id, attendee_id\) DO UPDATE/);
  assert.match(insert.sql, /registered_at=clock_timestamp\(\), withdrawn_at=NULL/);
});
test('Register AC1 - write failures roll back and release the connection without returning confirmation', async () => {
  const db = database({ failWrite: true });
  await assert.rejects(service.register(44, 8, false), /store unavailable/);
  assert.ok(db.statements.some(row => row.sql === 'ROLLBACK'));
  assert.equal(db.statements.some(row => row.sql === 'COMMIT'), false);
  assert.equal(db.release.mock.callCount(), 1);
});
test('Register AC1 - the connection is released even when a failed write cannot be rolled back', async () => {
  const db = database({ failWrite: true, failRollback: true });
  await assert.rejects(service.register(44, 8, false), /Rollback unavailable/);
  assert.equal(db.release.mock.callCount(), 1);
});
test('Register AC5 - unauthenticated, non-attendee and identity-injection requests cannot register', async () => {
  const db = database();
  assert.equal((await request('POST', {}, '44', 'attendee', false)).status, 401);
  assert.equal((await request('POST', {}, '44', 'event_organiser')).status, 401);
  for (const body of [{ attendeeId: 99 }, { joinWaitlist: 'true' }, [], null]) assert.equal((await request('POST', body)).status, 400);
  for (const id of ['0', '-1', '2147483648', 'bad']) assert.equal((await request('POST', {}, id)).status, 400);
  assert.equal(db.statements.some(row => row.sql.startsWith('INSERT')), false);
});
test('Register AC5 - an authenticated organiser cannot use attendee registration endpoints', async () => {
  const db = database({ userRole: 'event_organiser' });
  assert.equal((await request('POST', {}, '44', 'event_organiser')).status, 403);
  assert.equal((await request('GET', {}, '44', 'event_organiser')).status, 403);
  assert.equal(db.statements.some(row => row.sql.includes('FROM events')), false);
});
