// SCRUM-105: real HTTP routing, authentication and buffer rules; only database I/O is replaced.
const { test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
process.env.JWT_SECRET = 'scrum-105-test-only';
process.env.NODE_ENV = 'test';
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { pool } = require('../../backend/src/config/db');
const app = require('../../backend/src/index');
const now = Date.parse('2030-10-09T00:00:00Z');
const at = time => `2030-10-10T${time}:00+08:00`;
const payload = { name: 'Hall', location: 'Stamford Road', capacity: 100, supportedLayouts: ['Theatre'],
  accessibilityFeatures: ['Ramp'], facilities: ['Wi-Fi'], operatingHours: '08:00 - 22:00',
  setupMinutes: 0, turnaroundMinutes: 0, availabilityStatus: 'Available', revision: 0 };
let server, base, fixture;

/** Calls the actual endpoint using a signed test account; assertions inspect stored values separately. */
async function request(path, body, method = 'PUT', authenticated = true) {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json',
    ...(authenticated ? { Authorization: `Bearer ${jwt.sign({ sub: 1 }, process.env.JWT_SECRET)}` } : {}) },
    body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

/** Returns raw persisted rows and captures writes without implementing any conflict or impact rule. */
async function databaseQuery(sql, values = []) {
  if (/FROM users\b/.test(sql)) return { rows: [{ id: 1, role: fixture.role, auth_version: 0 }] };
  if (/FROM venues\b/.test(sql)) return { rows: fixture.venue ? [structuredClone(fixture.venue)] : [] };
  if (/FROM events\b/.test(sql)) return { rows: [{ id: 3, coordinator_id: 1 }] };
  if (/FROM venue_bookings\b/.test(sql)) return { rows: structuredClone(/UNION/.test(sql)
    ? [...fixture.bookings, ...fixture.closures] : fixture.bookings) };
  if (/FROM venue_unavailability\b/.test(sql)) {
    if (fixture.failClosures) throw new Error('Closure read unavailable');
    return { rows: structuredClone(fixture.closures) };
  }
  if (/INSERT INTO venues/.test(sql)) {
    fixture.writes.push({ sql, values });
    fixture.venue = { ...fixture.venue, setup_minutes: values[11], turnaround_minutes: values[12] };
    return { rows: [structuredClone(fixture.venue)] };
  }
  if (/UPDATE venues SET/.test(sql)) {
    fixture.writes.push({ sql, values });
    fixture.venue = { ...fixture.venue, setup_minutes: values[11], turnaround_minutes: values[12], revision: fixture.venue.revision + 1 };
    return { rows: [structuredClone(fixture.venue)] };
  }
  if (/INSERT INTO venue_bookings/.test(sql)) {
    fixture.writes.push({ sql, values });
    return { rows: [{ id: 99, status: 'pending' }] };
  }
  if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql.trim())) return { rows: [] };
  throw new Error(`Unexpected SQL in SCRUM-105 fixture: ${sql}`);
}

before(async () => {
  // Listen on an ephemeral local port; these tests never connect to the shared database.
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/venues`;
});
beforeEach(() => {
  mock.timers.enable({ apis: ['Date'], now });
  fixture = { role: 'venue_staff', bookings: [], closures: [], writes: [], venue: {
    id: 7, name: 'Hall', is_active: true, revision: 0, location: 'Stamford Road', capacity: 100,
    supported_layouts: ['Theatre'], accessibility_features: ['Ramp'], facilities: ['Wi-Fi'],
    operating_hours: '08:00 - 22:00', availability_status: 'Available', setup_minutes: 0, turnaround_minutes: 0,
    latitude: null, longitude: null,
  } };
  mock.method(pool, 'query', databaseQuery);
  mock.method(pool, 'connect', async () => {
    // Fail only the external connection boundary, keeping the controller's error handling real.
    if (fixture.failConnection) throw new Error('Database connection unavailable');
    return { query: databaseQuery, release() {} };
  });
});
afterEach(() => { mock.restoreAll(); mock.timers.reset(); });
after(async () => { await new Promise(resolve => server.close(resolve)); await pool.end(); });

for (const [field, closureStart, closureEnd] of [
  ['setupMinutes', '09:00', '09:31'], ['turnaroundMinutes', '11:14', '12:00'],
]) {
  test(`SCRUM-105 AC1 AC2 - created and updated ${field} values drive actual booking checks`, async () => {
    // Arrange / Act: a staff-created venue reserves preparation/reset time around a 10:00–11:00 event.
    const created = await request('', { ...payload, [field]: field === 'setupMinutes' ? 30 : 15 }, 'POST');
    assert.equal(created.status, 201);
    assert.equal(created.body.venue[field === 'setupMinutes' ? 'setup_minutes' : 'turnaround_minutes'], field === 'setupMinutes' ? 30 : 15);
    fixture.closures = [{ id: 40, kind: 'unavailability', start_datetime: at(closureStart), end_datetime: at(closureEnd) }];
    fixture.role = 'event_coordinator';
    const booking = { eventId: 3, startDatetime: at('10:00'), endDatetime: at('11:00') };
    const blocked = await request('/7/requests', booking, 'POST');
    // Assert: checking raw event times would allow a booking that must conflict with this buffer.
    assert.equal(blocked.status, 409);
    assert.equal(fixture.writes.filter(write => /INSERT INTO venue_bookings/.test(write.sql)).length, 0);
    // Act: staff explicitly remove the buffer, then the same event period becomes available.
    fixture.role = 'venue_staff';
    const saved = await request('/7', payload);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.venue[field === 'setupMinutes' ? 'setup_minutes' : 'turnaround_minutes'], 0);
    fixture.role = 'event_coordinator';
    assert.equal((await request('/7/requests', booking, 'POST')).status, 201);
  });
}

test('SCRUM-105 AC3 - warns about the exact conflicting bookings and saves without cancelling either', async () => {
  // Arrange: only bookings 1 and 2 gain a one-minute buffer overlap; booking 3 is unrelated.
  fixture.bookings = [
    { booking_id: 1, id: 1, event_name: 'Workshop', status: 'approved', start_datetime: at('10:00'), end_datetime: at('11:00') },
    { booking_id: 2, id: 2, event_name: 'Breakout', status: 'confirmed', start_datetime: at('12:00'), end_datetime: at('13:00') },
    { booking_id: 3, id: 3, event_name: 'Evening event', status: 'confirmed', start_datetime: at('18:00'), end_datetime: at('19:00') },
  ];
  const original = structuredClone(fixture.bookings);
  const change = { ...payload, setupMinutes: 31, turnaroundMinutes: 30 };
  // Act: the existing save flow requires review before accepting a timing change with impact.
  const warning = await request('/7', change);
  assert.equal(warning.status, 409);
  assert.deepEqual(warning.body.affectedBookings.map(row => row.booking_id), [1, 2]);
  assert.equal(fixture.writes.length, 0);
  const saved = await request('/7', { ...change, confirmationToken: warning.body.confirmationToken });
  // Assert: booking rows and statuses survive, and only the venue settings are written.
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.affectedBookings.map(row => row.booking_id), [1, 2]);
  assert.deepEqual(fixture.bookings, original);
  assert.equal(fixture.writes.length, 1);
  assert.match(fixture.writes[0].sql, /^UPDATE venues SET/);
  assert.deepEqual(fixture.writes[0].values.slice(11, 13), [31, 30]);
});

test('SCRUM-105 AC3 - a newly recorded closure invalidates an earlier timing confirmation', async () => {
  // Arrange: capacity reduction triggers an initial warning, with no timing conflict yet.
  fixture.bookings = [{ booking_id: 1, id: 1, event_name: 'Workshop', status: 'confirmed', expected_attendance: 80,
    start_datetime: at('10:00'), end_datetime: at('11:00') }];
  const change = { ...payload, capacity: 50, setupMinutes: 30 };
  const warning = await request('/7', change);
  fixture.closures.push({ id: 1, kind: 'unavailability', label: 'New floor closure', start_datetime: at('09:00'), end_datetime: at('09:45') });
  // Act: the token was issued before this closure existed.
  const response = await request('/7', { ...change, confirmationToken: warning.body.confirmationToken });
  // Assert: fingerprinting only bookings would incorrectly accept the obsolete acknowledgement.
  assert.equal(response.status, 409);
  assert.match(response.body.affectedBookings[0].reasons.join(' '), /New floor closure/);
  assert.equal(fixture.writes.length, 0);
});

for (const field of ['setupMinutes', 'turnaroundMinutes']) {
  for (const value of [-1, 0, 1, 10079, 10080, 10081, 0.5, '', 'abc', true]) {
    test(`SCRUM-105 AC4 - ${field} validates ${JSON.stringify(value)} at the server boundary`, async () => {
      // Arrange: independent expected values reflect the agreed 0–10,080 whole-minute contract.
      const valid = [0, 1, 10079, 10080].includes(value);
      // Act
      const response = await request('/7', { ...payload, [field]: value });
      // Assert: invalid values cannot reach persistence even if client-side checks are bypassed.
      assert.equal(response.status, valid ? 200 : 400);
      assert.equal(fixture.writes.length, valid ? 1 : 0);
      if (!valid) assert.match(response.body.message, /whole minutes between 0 and 10080/);
    });
  }
}

for (const role of ['event_coordinator', 'event_coordinator_lead', 'event_organiser', 'technical_support', 'safety_officer', 'attendee']) {
  test(`SCRUM-105 AC1 - ${role} cannot create or update venue timing requirements`, async () => {
    // Arrange: a real authenticated account has an explicitly unauthorized role.
    fixture.role = role;
    // Act / Assert: both management entry points enforce authorization, regardless of the supplied durations.
    assert.equal((await request('', payload, 'POST')).status, 403);
    assert.equal((await request('/7', payload)).status, 403);
    assert.equal(fixture.writes.length, 0);
  });
}

test('SCRUM-105 AC1 - unauthenticated timing changes are rejected before database writes', async () => {
  // Arrange / Act / Assert: no signed session must mean no authority to alter either endpoint.
  assert.equal((await request('', payload, 'POST', false)).status, 401);
  assert.equal((await request('/7', payload, 'PUT', false)).status, 401);
  assert.equal(fixture.writes.length, 0);
});

test('SCRUM-105 AC1 - a legacy venue with missing buffers can save explicit zero requirements', async () => {
  // Arrange: a database upgrade may leave a legacy test row without timing metadata.
  fixture.venue.setup_minutes = null;
  fixture.venue.turnaround_minutes = null;
  // Act / Assert: explicitly saving zero must not manufacture a conflict or fail during the booking read.
  assert.equal((await request('/7', payload)).status, 200);
  assert.deepEqual(fixture.writes[0].values.slice(11, 13), [0, 0]);
});

test('SCRUM-105 AC3 - failure to read closures prevents the timing change and preserves bookings', async () => {
  // Arrange: a required external database read fails while the locked venue is being checked.
  fixture.bookings = [{ booking_id: 1, id: 1, status: 'confirmed', start_datetime: at('10:00'), end_datetime: at('11:00') }];
  const original = structuredClone(fixture.bookings);
  fixture.failClosures = true;
  // Act / Assert: losing unavailable periods must never be interpreted as an empty, conflict-free schedule.
  assert.equal((await request('/7', { ...payload, setupMinutes: 30 })).status, 500);
  assert.deepEqual(fixture.bookings, original);
  assert.equal(fixture.writes.length, 0);
});

test('SCRUM-105 AC1 AC4 - missing and invalid venue targets cannot save timing changes', async () => {
  // Arrange / Act / Assert: bad identifiers and deleted venues must not update another record by accident.
  assert.equal((await request('/abc', payload)).status, 400);
  fixture.venue = null;
  assert.equal((await request('/7', payload)).status, 404);
  assert.equal(fixture.writes.length, 0);
});

test('SCRUM-105 AC1 - a database connection failure cannot report a successful timing save', async () => {
  // Arrange: this failure happens before any transaction or connection exists.
  fixture.failConnection = true;
  // Act / Assert: staff receive a retryable error rather than a false success or a partial update.
  const response = await request('/7', { ...payload, setupMinutes: 30 });
  assert.equal(response.status, 500);
  assert.equal(response.body.message, 'Unable to update the venue. Please try again.');
  assert.equal(fixture.writes.length, 0);
});
