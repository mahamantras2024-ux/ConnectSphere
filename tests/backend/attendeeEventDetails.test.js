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
    registration: { attendee_id: 8, status: 'registered' },
    published: [{ id: 44, name: 'Community Arts Day', status: 'confirmed', registration_required: true }],
    details: {
      id: 44, name: 'Community Arts Day', status: 'confirmed', proposed_date: '2031-06-12', proposed_start_time: '09:30:00',
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
    assert.match(sql, /CASE WHEN e\.status = 'approved' THEN 'confirmed' ELSE e\.status END AS status/);
    assert.match(sql, /registration_required\s*=\s*true/);
    assert.match(sql, /is_draft\s*=\s*false/);
    if (/WHERE/.test(sql) && values.length) {
      assert.equal(String(values[0]), '44');
      assert.equal(Number(values[1]), fixture.user.id);
      const publicActive = ['approved', 'confirmed'].includes(fixture.event?.status);
      const registeredTerminal = ['completed', 'cancelled'].includes(fixture.event?.status)
        && fixture.registration?.attendee_id === Number(values[1])
        && ['registered', 'waitlisted'].includes(fixture.registration?.status);
      const available = fixture.event?.registration_required && !fixture.event.is_draft && (publicActive || registeredTerminal);
      return available ? { rows: [{ ...fixture.details, status: fixture.event.status === 'approved' ? 'confirmed' : fixture.event.status }] } : { rows: [] };
    }
    assert.match(sql, /e\.status IN \('approved', 'confirmed'\)/);
    return fixture.event?.registration_required && !fixture.event.is_draft && ['approved', 'confirmed'].includes(fixture.event.status)
      ? { rows: fixture.published } : { rows: [] };
  }
  throw new Error(`Unexpected database query: ${sql}`);
}

/** Sends an authenticated attendee request through the real role middleware and event routes. */
async function request(path, role = 'attendee') {
  const token = jwt.sign({ sub: 8, activeRole: role }, process.env.JWT_SECRET);
  const response = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: response.status, body: await response.json() };
}

test('AC1 AC2 AC3 - published event list includes only attendee-visible events with their public status', async () => {
  // Arrange: fixture represents the source query result after the publication filters.
  // Act
  const response = await request('/published');
  // Assert: the endpoint contract cannot offer drafts or events that do not accept attendee registration.
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.events, fixture.published);
  assert.equal(response.body.events[0].status, 'confirmed');
});

for (const id of ['abc', '2147483648']) {
  test(`AC1 - invalid published event id ${id} is rejected without exposing event data`, async () => {
    // Arrange: the route receives an identifier that cannot represent a valid event key.
    // Act
    const response = await request(`/published/${id}`);
    // Assert: invalid identifiers fail validation before any event lookup.
    assert.equal(response.status, 400);
  });
}

test('AC1 AC3 - attendee event details return core fields and attendee-facing source information', async () => {
  // Arrange: the published event has its approved venue, organiser, accessibility notes and special arrangements.
  // Act
  const response = await request('/published/44');
  // Assert: planning information comes from the current source record, not the registration summary.
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.event, fixture.details);
});

for (const status of ['completed', 'cancelled']) {
  test(`AC2 AC5 - a registrant sees the latest ${status} status on event details`, async () => {
    // Arrange: the event is terminal but remains linked to the signed-in attendee's active registration.
    fixture.event.status = status;
    fixture.details.status = status;
    // Act
    const response = await request('/published/44');
    // Assert: the public status is current and the backend checks the caller's own registration.
    assert.equal(response.status, 200);
    assert.equal(response.body.event.status, status);
  });
}

test('AC1 AC4 AC6 - a non-registrant cannot open completed or cancelled event details', async () => {
  // Arrange: the event is cancelled, but the attendee has no active registration.
  fixture.event.status = 'cancelled';
  fixture.registration = null;
  // Act
  const response = await request('/published/44');
  // Assert: a known id does not bypass the attendee-specific terminal-event access check.
  assert.equal(response.status, 404);
});

for (const status of ['draft', 'submitted', 'under_review', 'planning', 'rejected']) {
  test(`AC1 AC3 AC6 - the public catalogue omits the internal ${status} status`, async () => {
    // Arrange: even a non-draft event is not public while it remains in an internal lifecycle state.
    fixture.event.status = status;
    // Act
    const response = await request('/published');
    // Assert: neither the event record nor its internal status is exposed through the catalogue.
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.events, []);
  });
}

for (const [condition, update] of [
  ['not published', event => { event.status = 'submitted'; }],
  ['in planning', event => { event.status = 'planning'; }],
  ['rejected', event => { event.status = 'rejected'; }],
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
