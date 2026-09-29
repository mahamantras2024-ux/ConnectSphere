const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'event-tests-secret';
process.env.NODE_ENV = 'test';
const { pool } = require('../src/config/db');
const app = require('../src/index');
let server, base;
const organiser = { id: 12, email: 'alice@example.com', full_name: 'Alice', role: 'event_organiser', auth_version: 0 };
const details = { id: 101, organiser_id: 12, name: 'Workshop', purpose: 'Community learning', description: 'Learn together',
  proposed_date: '2026-10-15', proposed_start_time: '09:00:00', proposed_end_time: '12:00:00', expected_attendance: 40,
  programme_details: '09:00 Welcome\n10:00 Workshop', room_layout_preference: 'classroom', accessibility_requirements: ['wheelchair access'],
  equipment_notes: 'Two microphones', registration_required: true, registration_capacity: 40,
  special_arrangements: 'Vegetarian lunch', organiser_name: 'Alice', status: 'submitted' };
function token(user = organiser) { return jwt.sign({ sub: user.id, role: user.role, email: user.email, authVersion: user.auth_version }, process.env.JWT_SECRET); }
async function request(path, { user = organiser, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${token(user)}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
}
before(async () => {
  await new Promise((resolve, reject) => { server = app.listen(0, '127.0.0.1', resolve); server.on('error', reject); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() => mock.restoreAll());
after(async () => { if (server?.listening) await new Promise((resolve) => server.close(resolve)); await pool.end(); });

test('authorised organiser detail returns all submitted fields using a scoped SQL query', async () => {
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('FROM users WHERE')) return { rows: [organiser] };
    assert.match(sql, /e\.id = \$1 AND e\.organiser_id = \$2/);
    assert.deepEqual(values, ['101', 12]);
    assert.doesNotMatch(sql, /SELECT \*/);
    assert.match(sql, /programme_details/); assert.match(sql, /special_arrangements/);
    return { rows: [details] };
  });
  const result = await request('/api/events/101');
  assert.equal(result.status, 200); assert.deepEqual(result.body.event, details);
});
test('My Events filters by authenticated organiser, ignoring supplied owner query parameters', async () => {
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('FROM users WHERE')) return { rows: [organiser] };
    assert.match(sql, /WHERE organiser_id = \$1/); assert.deepEqual(values, [12]);
    return { rows: [details] };
  });
  const result = await request('/api/events?organiser_id=27');
  assert.equal(result.status, 200); assert.deepEqual(result.body.events, [details]);
});
for (const id of ['102', '999']) {
  test(`another organiser's event and missing events are unavailable: ${id}`, async () => {
    mock.method(pool, 'query', async (sql, values) => {
      if (sql.includes('FROM users WHERE')) return { rows: [organiser] };
      assert.match(sql, /AND e\.organiser_id = \$2/); assert.equal(values[1], 12);
      return { rows: [] };
    });
    assert.deepEqual(await request(`/api/events/${id}`), { status: 404, body: { message: 'Event not found.' } });
  });
}
for (const path of ['/api/events', '/api/events/101']) {
  test(`unauthenticated read is denied: ${path}`, async () => {
    const query = mock.method(pool, 'query', async () => { throw new Error('Unexpected query'); });
    assert.equal((await request(path, { user: null })).status, 401); assert.equal(query.mock.callCount(), 0);
  });
}
for (const id of ['0', '-1', 'abc', '1.5', '2147483648', '1%20OR%201=1']) {
  test(`invalid event ID is rejected: ${id}`, async () => {
    const query = mock.method(pool, 'query', async () => ({ rows: [organiser] }));
    assert.equal((await request(`/api/events/${id}`)).status, 400); assert.equal(query.mock.callCount(), 1);
  });
}
for (const role of ['attendee', 'venue_staff', 'technical_support']) {
  test(`${role} cannot read organiser event details`, async () => {
    const user = { ...organiser, role };
    const query = mock.method(pool, 'query', async () => ({ rows: [user] }));
    assert.equal((await request('/api/events/101', { user })).status, 403); assert.equal(query.mock.callCount(), 1);
  });
}
test('coordinator retains access to assigned events with the same response fields', async () => {
  const user = { ...organiser, id: 30, role: 'event_coordinator' };
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('FROM users WHERE')) return { rows: [user] };
    assert.match(sql, /AND e\.coordinator_id = \$2/); assert.equal(values[1], 30); return { rows: [details] };
  });
  assert.deepEqual((await request('/api/events/101', { user })).body.event, details);
});
const submission = { name: 'Workshop', purpose: details.purpose, proposedDate: '2026-10-15', proposedStartTime: '09:00', proposedEndTime: '12:00',
  expectedAttendance: 0, programmeDetails: details.programme_details, roomLayoutPreference: 'classroom', accessibilityRequirements: details.accessibility_requirements,
  equipmentNotes: details.equipment_notes, registrationRequired: false, registrationCapacity: 0, specialArrangements: details.special_arrangements, isDraft: false };
for (const isDraft of [true, false]) {
  test(`creation saves fields and server-assigned owner (draft: ${isDraft})`, async () => {
    mock.method(pool, 'query', async (sql, values) => {
      if (sql.includes('FROM users WHERE')) return { rows: [organiser] };
      assert.match(sql, /INSERT INTO events/);
      assert.equal(values[0], 12); assert.equal(values[8], 0); assert.equal(values[9], submission.programmeDetails);
      assert.equal(values[11], JSON.stringify(submission.accessibilityRequirements)); assert.equal(values[12], submission.equipmentNotes);
      assert.equal(values[13], false); assert.equal(values[14], 0); assert.equal(values[15], submission.specialArrangements);
      assert.equal(values[16], isDraft); assert.equal(values[17], isDraft ? 'draft' : 'submitted');
      return { rows: [{ ...details, is_draft: isDraft }] };
    });
    assert.equal((await request('/api/events', { method: 'POST', body: { ...submission, isDraft, organiserId: 27, organiser_id: 27, status: 'approved' } })).status, 201);
  });
}
for (const invalid of [{ name: '' }, { programmeDetails: {} }, { specialArrangements: 'x'.repeat(10001) }, { expectedAttendance: -1 }, { proposedDate: '2026-02-30' }, { proposedStartTime: '26:00' }, { accessibilityRequirements: [{}] }, { registrationRequired: 'false' }]) {
  test(`invalid submission ${Object.keys(invalid)[0]} is rejected without an insert`, async () => {
    const query = mock.method(pool, 'query', async () => ({ rows: [organiser] }));
    assert.equal((await request('/api/events', { method: 'POST', body: { ...submission, ...invalid } })).status, 400);
    assert.equal(query.mock.callCount(), 1);
  });
}
test('attendees cannot create organiser requests', async () => {
  const user = { ...organiser, role: 'attendee' };
  mock.method(pool, 'query', async () => ({ rows: [user] }));
  assert.equal((await request('/api/events', { user, method: 'POST', body: submission })).status, 403);
});
test('external login rejects staff without returning a session', async () => {
  mock.method(pool, 'query', async () => ({ rows: [{ ...organiser, role: 'venue_staff' }] }));
  const result = await request('/api/auth/login', { user: null, method: 'POST', body: { audience: 'external', email: organiser.email, password: 'password123' } });
  assert.equal(result.status, 401); assert.equal(result.body.token, undefined);
});
