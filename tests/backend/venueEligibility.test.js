// Approved coordinator batch / VS AC2 AC3: exercise eligibility and booking through real HTTP; mock only PostgreSQL.
const { test, before, beforeEach, afterEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
process.env.JWT_SECRET = 'eligibility-test-only';
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
  state = { role: 'event_coordinator', calls: [], venue: { id: 8, name: 'Hall', is_active: true, capacity: 100,
    facilities: ['Projector'], supported_layouts: ['Conference hall'], accessibility_features: ['Wheelchair ramps'],
    setup_minutes: 0, turnaround_minutes: 0, operating_hours: '08:00 - 22:00' },
  events: [{ id: 3, name: 'Gala', coordinator_id: 12, expected_attendance: 100,
    room_layout_preference: 'Hall', accessibility_requirements: ['Wheelchair ramp'], required_facilities: ['Projector'] }] };
  mock.method(pool, 'query', query);
  mock.method(pool, 'connect', async () => ({ query, release() {} }));
});
afterEach(() => mock.restoreAll());
after(async () => { await new Promise(resolve => server.close(resolve)); await pool.end(); });
/** Supplies records rather than eligibility decisions, leaving matching, authorization and transactions real. */
async function query(sql, values = []) {
  state.calls.push(sql);
  if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
  if (sql.includes('SELECT DISTINCT staff')) return { rows: [] };
  if (sql.includes('FROM users')) return { rows: [{ id: 12, role: state.role }] };
  if (sql.includes('FROM venues')) return { rows: state.venue ? [state.venue] : [] };
  if (sql.includes('FROM events')) return { rows: sql.includes('coordinator_id=$1')
    ? state.events.filter(event => event.coordinator_id === values[0]) : state.events.filter(event => event.id === values[0]) };
  if (sql.includes('INSERT INTO venue_bookings')) return { rows: [{ id: 70, event_id: values[1], requirements: JSON.parse(values[8]) }] };
  if (sql.includes('FROM venue_bookings')) return { rows: [] };
  throw new Error(`Unexpected SQL: ${sql}`);
}
/** Uses a real signed session so UI filtering cannot substitute for server enforcement. */
async function request(path = '/8/eligible-events', body) {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: {
    Authorization: `Bearer ${jwt.sign({ sub: 12 }, process.env.JWT_SECRET)}`, 'Content-Type': 'application/json',
  }, ...(body ? { body: JSON.stringify({ eventId: 3, startDatetime: '2031-10-20T10:00:00+08:00', endDatetime: '2031-10-20T11:00:00+08:00', ...body }) } : {}) });
  return { status: response.status, body: await response.json() };
}

test('VS AC2 AC3 / UI batch 3 - lists only assigned events whose saved requirements fit the venue', async () => {
  // Arrange: another coordinator and an oversized event must never become selectable options.
  state.events.push({ ...state.events[0], id: 4, expected_attendance: 101 }, { ...state.events[0], id: 5, coordinator_id: 99 });
  const result = await request();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.events.map(event => event.id), [3]);
});
for (const attendance of [99, 100, 101]) test(`VS AC2 / UI batch 3 - validates capacity ${attendance} against venue capacity 100`, async () => {
  state.events[0].expected_attendance = attendance;
  const result = await request('/8/requests', { capacity: attendance });
  assert.equal(result.status, attendance <= 100 ? 201 : 400);
  assert.equal(state.calls.some(sql => sql.includes('INSERT INTO venue_bookings')), attendance <= 100);
});
for (const [field, value] of [['expected_attendance', 101], ['room_layout_preference', 'Theatre'],
  ['accessibility_requirements', ['Lift']], ['required_facilities', ['TV']]]) {
  test(`VS AC2 AC3 / UI batch 3 - cannot bypass saved ${field} by weakening submitted fields`, async () => {
    state.events[0][field] = value;
    const result = await request('/8/requests', { capacity: 1 });
    assert.equal(result.status, 400);
    assert.equal(state.calls.some(sql => sql.includes('INSERT INTO venue_bookings')), false);
  });
}
test('VS AC3 / UI batch 3 - rejects stricter submitted requirements and keeps named sessions independent', async () => {
  // Act / Assert: request-specific requirements cannot exceed the venue even when the parent event fits.
  assert.equal((await request('/8/requests', { requiredFacilities: ['TV'] })).status, 400);
  state.events[0].expected_attendance = 200;
  assert.equal((await request('/8/requests', { sessionName: 'Track A', capacity: 50 })).status, 201);
});
test('VS AC1 AC3 / UI batch 3 - protects eligibility roles identifiers and unavailable venues', async () => {
  assert.equal((await request('/bad/eligible-events')).status, 400);
  state.venue = null;
  assert.equal((await request()).status, 404);
  state.role = 'venue_staff';
  assert.equal((await request()).status, 403);
});

test('VS AC2 AC3 / UI batch 3 - rejects unrecorded venue capacity and stricter request attendance', async () => {
  // Arrange / Act: fitting saved attendance cannot authorize a larger submitted attendance.
  assert.equal((await request('/8/requests', { capacity: 101 })).status, 400);
  state.venue.capacity = null;
  assert.deepEqual((await request()).body.events, []);
  assert.equal((await request('/8/requests', {})).status, 400);
});

test('VS AC1 AC3 / UI batch 3 - treats unspecified and placeholder requirements as no restriction', async () => {
  // Placeholder semantics come from the existing suitability AC, rather than treating “None” as a facility name.
  state.events = [{ id: 3, name: 'Simple meeting', coordinator_id: 12, room_layout_preference: 'NA',
    accessibility_requirements: ['None'], required_facilities: ['N/A'] }];
  assert.deepEqual((await request()).body.events.map(event => event.id), [3]);
  assert.equal((await request('/8/requests', { layout: 'NA', accessibility: ['None'], requiredFacilities: ['None'] })).status, 201);
});
