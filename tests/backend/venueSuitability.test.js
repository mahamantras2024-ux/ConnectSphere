// File: Tests the Check Venue Suitability API through real routes, auth/role middleware, controller and rules.
// Test scope: Only pool.query is replaced; each test answers the event and venue reads.
const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('../../backend/node_modules/jsonwebtoken');
process.env.JWT_SECRET = 'venue-suitability-test-secret';
process.env.NODE_ENV = 'test';
const { pool } = require('../../backend/src/config/db');
const app = require('../../backend/src/index');
let server, base;

const coordinator = { id: 30, email: 'chris@example.com', role: 'event_coordinator', auth_version: 0 };
// Event 101 as the organiser submitted it: 100 guests, Banquet, a wheelchair ramp, plus an "NA" placeholder.
const event = { id: 101, expected_attendance: 100, room_layout_preference: 'Banquet', accessibility_requirements: ['Wheelchair ramps', 'NA'] };
// Active venues as the catalogue stores them: one matches everything, one is too small, one has no ramp.
const hall = { id: 1, name: 'Hall A', location: 'Level 1', capacity: 120, facilities: ['Wi-Fi'], supported_layouts: ['Banquet hall'], accessibility_features: ['Wheelchair ramp'] };
const room = { id: 2, name: 'Room B', location: 'Level 2', capacity: 60, facilities: [], supported_layouts: ['Banquet'], accessibility_features: ['Wheelchair ramp'] };
const loft = { id: 3, name: 'Loft C', location: 'Level 3', capacity: 150, facilities: [], supported_layouts: ['Banquet'], accessibility_features: ['Lift'] };

// Signs a test-only JWT for the supplied user.
function token(user) { return jwt.sign({ sub: user.id, email: user.email, authVersion: 0 }, process.env.JWT_SECRET); }
// Calls the local test HTTP server and returns status plus JSON.
async function request(path, user = coordinator) {
  const response = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token(user)}` } });
  return { status: response.status, body: await response.json() };
}
/** Answers authentication, the coordinator-scoped event read and the active-venue read; records every other query. */
function mockDb({ user = coordinator, found = event, venues = [hall, room, loft] } = {}) {
  const queries = [];
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('FROM users WHERE')) return { rows: [user] };
    queries.push({ sql, values });
    if (sql.includes('FROM events WHERE id = $1 AND coordinator_id = $2')) return { rows: found ? [found] : [] };
    if (sql.includes('FROM venues WHERE is_active = true')) return { rows: venues };
    throw new Error(`Unexpected query: ${sql}`);
  });
  return { queries, find: (text) => queries.filter((query) => query.sql.includes(text)) };
}

before(async () => {
  await new Promise((resolve, reject) => { server = app.listen(0, '127.0.0.1', resolve); server.on('error', reject); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() => mock.restoreAll());
after(async () => { if (server?.listening) await new Promise((resolve) => server.close(resolve)); await pool.end(); });

// Test case: The coordinator sees the organiser's requirements and every active venue checked against them.
test('VS AC1/AC4/AC5 - the assigned coordinator sees each active venue checked against the organiser\'s venue requirements', async () => {
  // Arrange
  const db = mockDb();
  // Act
  const result = await request('/api/events/101/venue-suitability');
  // Assert: the organiser's requirements (placeholder removed), and each venue's verdict with its unmet requirements.
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.requirements, { expectedAttendance: 100, layout: 'Banquet', accessibility: ['Wheelchair ramps'] });
  assert.deepEqual(result.body.venues.map((venue) => [venue.name, venue.suitable, venue.unmet.map((check) => check.message)]), [
    ['Hall A', true, []],
    ['Room B', false, ['Expected attendance 100 exceeds capacity 60.']],
    ['Loft C', false, ['Accessibility need "Wheelchair ramps" is not listed (venue lists: Lift).']],
  ]);
  // The matching venue shows which of its entries satisfied each requirement.
  assert.deepEqual(result.body.venues[0].checks.map((check) => check.message), [
    'Holds 100 expected guests (capacity 120).', 'Room layout "Banquet" is available as "Banquet hall".',
    'Accessibility need "Wheelchair ramps" is listed as "Wheelchair ramp".',
  ]);
  // The event read is scoped to this coordinator, and only active venues are read.
  assert.deepEqual(db.find('FROM events WHERE id = $1 AND coordinator_id = $2')[0].values, [101, 30]);
  assert.match(db.find('FROM venues')[0].sql, /WHERE is_active = true/);
});
// Test case: An older event row without an accessibility list still loads.
test('VS AC1 - an event without a recorded accessibility list is compared as having no accessibility needs', async () => {
  mockDb({ found: { ...event, accessibility_requirements: null } });
  const result = await request('/api/events/101/venue-suitability');
  assert.deepEqual(result.body.requirements.accessibility, []);
  assert.equal(result.body.venues.find((venue) => venue.name === 'Loft C').suitable, true);
});
// Test case: An event the coordinator is not assigned to is not revealed.
test('VS AC1 - a coordinator not assigned to the event gets "not found" and no venues are read', async () => {
  const db = mockDb({ found: null });
  const result = await request('/api/events/101/venue-suitability');
  assert.deepEqual([result.status, result.body.message], [404, 'Event not found.']);
  assert.equal(db.find('FROM venues').length, 0);
});
// Test case: Suitability belongs to the Event Coordinator workspace only.
for (const role of ['event_organiser', 'event_coordinator_lead', 'venue_staff', 'safety_officer', 'technical_support', 'attendee']) {
  test(`VS AC1 - a ${role} cannot view venue suitability`, async () => {
    const user = { id: 70, email: `${role}@example.com`, role, auth_version: 0 };
    const db = mockDb({ user });
    assert.equal((await request('/api/events/101/venue-suitability', user)).status, 403);
    assert.equal(db.queries.length, 0);
  });
}
// Test case: Malformed event ids are refused before any read.
test('VS AC1 - an invalid event id is refused', async () => {
  const db = mockDb();
  assert.equal((await request('/api/events/0/venue-suitability')).status, 400);
  assert.equal((await request('/api/events/abc/venue-suitability')).status, 400);
  assert.equal(db.queries.length, 0);
});
// Test case: Requirements come from the organiser only - the first version's coordinator-chosen facilities endpoint is gone.
test('VS AC1 - required facilities cannot be set by the coordinator', async () => {
  mockDb();
  const response = await fetch(`${base}/api/events/101/required-facilities`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(coordinator)}` }, body: '{"facilities":[]}' });
  assert.equal(response.status, 404);
});
