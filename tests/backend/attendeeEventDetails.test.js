const { test, before, beforeEach, afterEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');

// Runs attendee routes and authorization against real Express/JWT middleware with controlled database rows.
process.env.JWT_SECRET = 'attendee-event-details-test-secret';
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
    user: { id: 8, role: 'attendee', auth_version: 0 },
    event: { id: 44, status: 'approved', is_draft: false, registration_required: true },
    published: [{ id: 44, name: 'Community Arts Day', status: 'approved', registration_required: true }],
    details: {
      id: 44, name: 'Community Arts Day', proposed_date: '2031-06-12', proposed_start_time: '09:30:00',
      proposed_end_time: '16:00:00', venue_name: 'Riverside Hall', location: '18 River Road',
      description: 'A day of art workshops and performances.', organiser_name: 'Morgan Lee',
      accessibility_requirements: ['Step-free entrance'], special_arrangements: 'Wear comfortable clothes.',
    },
  };
  mock.method(pool, 'query', databaseQuery);
});

afterEach(() => mock.restoreAll());
after(async () => {
  await new Promise(resolve => server.close(resolve));
  await pool.end();
});

/** Emulates the supported publication filters and protects fixture behavior from drifting away from the API contract. */
async function databaseQuery(sql, values = []) {
  if (/FROM users\b/.test(sql)) return { rows: [fixture.user] };
  if (/FROM events\b/.test(sql)) {
    assert.match(sql, /status\s*=\s*'approved'/);
    assert.match(sql, /registration_required\s*=\s*true/);
    assert.match(sql, /is_draft\s*=\s*false/);
    if (/WHERE/.test(sql) && values.length) {
      assert.equal(String(values[0]), '44');
      return fixture.event?.status === 'approved' && fixture.event.registration_required && !fixture.event.is_draft
        ? { rows: [fixture.details] } : { rows: [] };
    }
    return { rows: fixture.published };
  }
  throw new Error(`Unexpected database query: ${sql}`);
}

/** Sends an authenticated attendee request through the real role middleware and event routes. */
async function request(path, role = 'attendee') {
  const token = jwt.sign({ sub: 8, activeRole: role }, process.env.JWT_SECRET);
  const response = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: response.status, body: await response.json() };
}

test('AC1 - published event list includes only approved events with registration enabled', async () => {
  // Arrange: fixture represents the source query result after the publication filters.
  // Act
  const response = await request('/published');
  // Assert: the endpoint contract cannot offer drafts or events that do not accept attendee registration.
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.events, fixture.published);
});

test('AC1 AC3 - attendee event details return core fields and attendee-facing source information', async () => {
  // Arrange: the published event has its approved venue, organiser, accessibility notes and special arrangements.
  // Act
  const response = await request('/published/44');
  // Assert: planning information comes from the current source record, not the registration summary.
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.event, fixture.details);
});

for (const [condition, update] of [
  ['not published', event => { event.status = 'submitted'; }],
  ['registration disabled', event => { event.registration_required = false; }],
]) {
  test(`AC1 - an event that is ${condition} is unavailable to attendees`, async () => {
    // Arrange: even a known event ID is not public unless both publication conditions hold.
    update(fixture.event);
    // Act
    const response = await request('/published/44');
    // Assert: the private/non-registration event is not exposed.
    assert.equal(response.status, 404);
  });
}

test('AC1 - other roles cannot read the published attendee event API', async () => {
  // Arrange: use a valid session token with a non-attendee role.
  fixture.user.role = 'event_organiser';
  // Act
  const response = await request('/published/44', 'event_organiser');
  // Assert: public event data is available to attendees through the attendee route only.
  assert.equal(response.status, 403);
});
