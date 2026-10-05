// File: Tests event ownership, creation validation, role restrictions, and external audience login with mocked queries.
// Test scope: Uses real handlers/services with controlled database/email/provider boundaries where configured.
const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('../../backend/node_modules/jsonwebtoken');
process.env.JWT_SECRET = 'event-tests-secret';
process.env.NODE_ENV = 'test';
const { pool } = require('../../backend/src/config/db');
const app = require('../../backend/src/index');
let server, base;
const organiser = { id: 12, email: 'alice@example.com', full_name: 'Alice', role: 'event_organiser', auth_version: 0 };
const details = { id: 101, organiser_id: 12, name: 'Workshop', purpose: 'Community learning', description: 'Learn together',
  proposed_date: '2026-10-15', proposed_start_time: '09:00:00', proposed_end_time: '12:00:00', expected_attendance: 40,
  programme_details: '09:00 Welcome\n10:00 Workshop', room_layout_preference: 'classroom', accessibility_requirements: ['wheelchair access'],
  equipment_notes: 'Two microphones', registration_required: true, registration_capacity: 40,
  special_arrangements: 'Vegetarian lunch', organiser_name: 'Alice', status: 'submitted' };
// Signs a test-only JWT for the supplied user and current session version.
function token(user = organiser) { return jwt.sign({ sub: user.id, role: user.role, email: user.email, authVersion: user.auth_version }, process.env.JWT_SECRET); }
// Calls the local test HTTP server with the requested payload/session and returns status plus JSON.
async function request(path, { user = organiser, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${token(user)}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
}
before(async () => {
  // Initializes clean test state, fixtures, mocks, or a local HTTP server before the test cases.

  await new Promise((resolve, reject) => {
    // Starts a local test HTTP server and resolves/rejects on startup.
     server = app.listen(0, '127.0.0.1', resolve); server.on('error', reject); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() => // Cleans up test state, mocks, mounted components, or local server/database resources.

      // Handles this operation using the surrounding screen or request state.
      mock.restoreAll());
after(async () => {
  // Cleans up test state, mocks, mounted components, or local server/database resources.
   if (server?.listening) await new Promise((resolve) => // Resolves when the test HTTP server finishes closing.

      // Handles this operation using the surrounding screen or request state.
      server.close(resolve)); await pool.end(); });

// Test case: Reads an accessible event and checks submitted fields and a query restricted to the authenticated organiser.
test('authorised organiser detail returns all submitted fields using a scoped SQL query', async () => {

  mock.method(pool, 'query', async (sql, values) => {
    // Supplies controlled query behavior for this regression case, including its expected result or failure.

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
// Test case: Lists My Events with a forged owner parameter and checks the query still uses the session identity.
test('My Events filters by authenticated organiser, ignoring supplied owner query parameters', async () => {

  mock.method(pool, 'query', async (sql, values) => {
    // Supplies controlled query behavior for this regression case, including its expected result or failure.

    if (sql.includes('FROM users WHERE')) return { rows: [organiser] };
    assert.match(sql, /WHERE organiser_id = \$1/); assert.deepEqual(values, [12]);
    return { rows: [details] };
  });
  const result = await request('/api/events?organiser_id=27');
  assert.equal(result.status, 200); assert.deepEqual(result.body.events, [details]);
});
for (const id of ['102', '999']) {
  // Test case: Requests another organiser event or an absent ID and checks neither exposes a record.
  test(`another organiser's event and missing events are unavailable: ${id}`, async () => {

    mock.method(pool, 'query', async (sql, values) => {
      // Supplies controlled query behavior for this regression case, including its expected result or failure.

      if (sql.includes('FROM users WHERE')) return { rows: [organiser] };
      assert.match(sql, /AND e\.organiser_id = \$2/); assert.equal(values[1], 12);
      return { rows: [] };
    });
    assert.deepEqual(await request(`/api/events/${id}`), { status: 404, body: { message: 'Event not found.' } });
  });
}
for (const path of ['/api/events', '/api/events/101']) {
  // Test case: Calls each private event-read endpoint without authentication and checks access denial.
  test(`unauthenticated read is denied: ${path}`, async () => {

    const query = mock.method(pool, 'query', async () => {
      // Supplies controlled query behavior for this regression case, including its expected result or failure.
       throw new Error('Unexpected query'); });
    assert.equal((await request(path, { user: null })).status, 401); assert.equal(query.mock.callCount(), 0);
  });
}
for (const id of ['0', '-1', 'abc', '1.5', '2147483648', '1%20OR%201=1']) {
  // Test case: Supplies malformed event IDs and checks validation rejects them.
  test(`invalid event ID is rejected: ${id}`, async () => {

    const query = mock.method(pool, 'query', async () => (// Supplies controlled query behavior for this regression case, including its expected result or failure.

      // Handles this operation using the surrounding screen or request state.
      { rows: [organiser] }));
    assert.equal((await request(`/api/events/${id}`)).status, 400); assert.equal(query.mock.callCount(), 1);
  });
}
for (const role of ['attendee', 'venue_staff', 'technical_support']) {
  // Test case: Tries each unsupported role against organiser details and checks the role guard denies access.
  test(`${role} cannot read organiser event details`, async () => {

    const user = { ...organiser, role };
    const query = mock.method(pool, 'query', async () => (// Supplies controlled query behavior for this regression case, including its expected result or failure.

      // Handles this operation using the surrounding screen or request state.
      { rows: [user] }));
    assert.equal((await request('/api/events/101', { user })).status, 403); assert.equal(query.mock.callCount(), 1);
  });
}
// Test case: Reads an assigned event as coordinator and checks its complete submitted fields.
test('coordinator retains access to assigned events with the same response fields', async () => {

  const user = { ...organiser, id: 30, role: 'event_coordinator' };
  mock.method(pool, 'query', async (sql, values) => {
    // Supplies controlled query behavior for this regression case, including its expected result or failure.

    if (sql.includes('FROM users WHERE')) return { rows: [user] };
    assert.match(sql, /AND e\.coordinator_id = \$2/); assert.equal(values[1], 30); return { rows: [details] };
  });
  assert.deepEqual((await request('/api/events/101', { user })).body.event, details);
});
const submission = { name: 'Workshop', purpose: details.purpose, proposedDate: '2026-10-15', proposedStartTime: '09:00', proposedEndTime: '12:00',
  expectedAttendance: 0, programmeDetails: details.programme_details, roomLayoutPreference: 'classroom', accessibilityRequirements: details.accessibility_requirements,
  equipmentNotes: details.equipment_notes, registrationRequired: false, registrationCapacity: 0, specialArrangements: details.special_arrangements, isDraft: false };
for (const isDraft of [true, false]) {
  // Test case: Creates draft and submitted requests and checks fields, server-assigned ownership and their appropriate states.
  test(`creation saves fields and server-assigned owner (draft: ${isDraft})`, async () => {

    mock.method(pool, 'query', async (sql, values) => {
      // Supplies controlled query behavior for this regression case, including its expected result or failure.

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
  // Test case: Tries each invalid event payload and checks rejection without an insert.
  test(`invalid submission ${Object.keys(invalid)[0]} is rejected without an insert`, async () => {

    const query = mock.method(pool, 'query', async () => (// Supplies controlled query behavior for this regression case, including its expected result or failure.

      // Handles this operation using the surrounding screen or request state.
      { rows: [organiser] }));
    assert.equal((await request('/api/events', { method: 'POST', body: { ...submission, ...invalid } })).status, 400);
    assert.equal(query.mock.callCount(), 1);
  });
}
// Test case: Attempts organiser event creation as attendee and checks it is forbidden.
test('attendees cannot create organiser requests', async () => {

  const user = { ...organiser, role: 'attendee' };
  mock.method(pool, 'query', async () => (// Supplies controlled query behavior for this regression case, including its expected result or failure.

      // Handles this operation using the surrounding screen or request state.
      { rows: [user] }));
  assert.equal((await request('/api/events', { user, method: 'POST', body: submission })).status, 403);
});


// Test case: Returns no assigned record for a coordinator lookup and checks a scoped query plus a 404 with no event data.
test('Coordinator AC3 - missing or unassigned event details are unavailable',async()=>{
  const user={...organiser,id:30,role:'event_coordinator'};
  mock.method(pool,'query',async(sql,values)=>{if(sql.includes('FROM users WHERE'))return {rows:[user]};assert.match(sql,/AND e\.coordinator_id = \$2/);assert.deepEqual(values,['999',30]);return {rows:[]};});
  assert.deepEqual(await request('/api/events/999',{user}),{status:404,body:{message:'Event not found.'}});
});
