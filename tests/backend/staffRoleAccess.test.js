// File: Verifies the Internal Staff login and role-based access story (Safety Officer login and RBAC).
// Test scope: Real Express routes, bcrypt and JWT handling with a mocked PostgreSQL boundary. Expected outcomes come
// from the story's ACs: one internal role per staff account, credential checks, one dashboard per role, no access to
// another role's endpoints or client data, and a clear failed-login message.
const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('../../backend/node_modules/bcryptjs');
const jwt = require('../../backend/node_modules/jsonwebtoken');
process.env.JWT_SECRET = 'staff-role-access-test-secret';
const { pool } = require('../../backend/src/config/db');
const app = require('../../backend/src/index');
const { roleSetError, internalRoles } = require('../../backend/src/auth/roles');
const { provisionAccount } = require('../../backend/src/db/provisionAccount');

const PASSWORD = 'Safe1234';
const SINGLE_ROLE = 'Internal staff accounts must have exactly one internal role.';
const UNRECOGNISED = 'Provide a valid set of recognised roles.';
let server, base, passwordHash;
// One provisioned account per internal role, as stored by provisionAccount (role and roles hold the same single role).
const staff = Object.fromEntries(internalRoles.map((role, index) => [role, {
  id: 300 + index, email: `${role}@example.test`, full_name: `Test ${role}`, role, roles: [role], auth_version: 0,
}]));

before(async () => {
  passwordHash = await bcrypt.hash(PASSWORD, 10);
  for (const account of Object.values(staff)) account.password_hash = passwordHash;
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() => mock.restoreAll());
after(async () => { await new Promise((resolve) => server.close(resolve)); await pool.end(); });

// Calls the API and returns the status and decoded body.
async function request(method, path, { body, token } = {}) {
  const response = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
// Signs a session the way login does for this account's only role.
function tokenFor(account) {
  return jwt.sign({ sub: account.id, email: account.email, activeRole: account.role, authVersion: 0 }, process.env.JWT_SECRET);
}
// Answers account lookups from the fixtures; any other query is recorded so refused requests can prove they read nothing.
function mockDatabase(other = () => { throw new Error('Unexpected query for a refused request'); }) {
  const otherQueries = [];
  mock.method(pool, 'query', async (sql, values) => {
    if (/FROM users\s+WHERE id = \$1/.test(sql)) return { rows: Object.values(staff).filter((account) => account.id === values[0]) };
    if (/FROM users\s+WHERE email = \$1/.test(sql)) return { rows: Object.values(staff).filter((account) => account.email === values[0]) };
    otherQueries.push(sql);
    return other(sql, values);
  });
  return otherQueries;
}

// AC1 role rules: [requested roles, expected message or null when the account may be provisioned].
const roleCases = [
  ['a Safety Officer alone', ['safety_officer'], null],
  ['each other internal role alone', ['venue_staff'], null],
  ['the same internal role listed twice', ['safety_officer', 'safety_officer'], null],
  ['two internal roles', ['safety_officer', 'event_coordinator'], SINGLE_ROLE],
  ['an internal and an external role', ['venue_staff', 'attendee'], SINGLE_ROLE],
  ['an external role listed before an internal role', ['event_organiser', 'technical_support'], SINGLE_ROLE],
  ['the Coordinator Lead with the Coordinator role', ['event_coordinator_lead', 'event_coordinator'], SINGLE_ROLE],
  ['Event Organiser and Attendee (external accounts unchanged)', ['event_organiser', 'attendee'], null],
  ['no roles', [], UNRECOGNISED],
  ['an unrecognised role', ['admin'], UNRECOGNISED],
  ['a role list that is not an array', 'safety_officer', UNRECOGNISED],
];
for (const [label, roles, expected] of roleCases) {
  // Test case: Applies the single-internal-role rule to one requested role set.
  test(`Staff AC1 - ${label} ${expected ? 'is refused' : 'is accepted'} by the role rule`, () => {
    assert.equal(roleSetError(roles), expected);
  });
}
// Test case: Every internal role on its own is a valid staff account.
test('Staff AC1 - every internal role can be provisioned on its own', () => {
  for (const role of internalRoles) assert.equal(roleSetError([role]), null, role);
});

for (const [label, roles, expected] of roleCases.filter(([, , message]) => message)) {
  // Test case: A refused role set never reaches the users table.
  test(`Staff AC1 - provisioning ${label} is refused before any account is written`, async () => {
    const queries = mockDatabase();
    await assert.rejects(provisionAccount({ email: 'new.staff@example.test', fullName: 'New Staff', password: PASSWORD, roles }),
      { message: expected });
    assert.deepEqual(queries, []);
  });
}
// Test case: An accepted Safety Officer is stored with exactly one role and a hashed password.
test('Staff AC1/AC2 - a provisioned Safety Officer is stored with one role and a bcrypt password hash', async () => {
  let inserted;
  mockDatabase((sql, values) => { inserted = values; return { rows: [{ id: 9, email: values[0], full_name: values[1], role: values[3], roles: values[4] }] }; });
  const account = await provisionAccount({ email: ' Safety@Example.TEST ', fullName: ' Sam Safety ', password: PASSWORD, roles: ['safety_officer', 'safety_officer'] });
  assert.deepEqual([inserted[0], inserted[1], inserted[3], inserted[4]], ['safety@example.test', 'Sam Safety', 'safety_officer', ['safety_officer']]);
  assert.notEqual(inserted[2], PASSWORD);
  assert.equal(await bcrypt.compare(PASSWORD, inserted[2]), true);
  assert.deepEqual([account.role, account.roles], ['safety_officer', ['safety_officer']]);
});

// Test case: Correct staff credentials sign in to the Safety Officer role and the session resolves to that role.
test('Staff AC2/AC3 - a Safety Officer with correct credentials is signed in to the Safety Officer role', async () => {
  mockDatabase();
  const result = await request('POST', '/api/auth/login', { body: { email: ' SAFETY_OFFICER@example.test ', password: PASSWORD, audience: 'internal' } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.user, { id: staff.safety_officer.id, email: staff.safety_officer.email, full_name: staff.safety_officer.full_name, role: 'safety_officer', roles: ['safety_officer'] });
  assert.equal(jwt.verify(result.body.token, process.env.JWT_SECRET).activeRole, 'safety_officer');
  const me = await request('GET', '/api/auth/me', { token: result.body.token });
  assert.deepEqual([me.status, me.body.user.role], [200, 'safety_officer']);
});
// Test case: Each internal role signs in to its own role, never another one.
test('Staff AC2/AC3 - every internal staff account is signed in to its own provisioned role', async () => {
  mockDatabase();
  for (const account of Object.values(staff)) {
    const result = await request('POST', '/api/auth/login', { body: { email: account.email, password: PASSWORD, audience: 'internal' } });
    assert.deepEqual([result.status, result.body.user.role], [200, account.role], account.role);
  }
});

// AC2/AC5: every credential failure gets the same clear message, so the response never reveals which part was wrong.
for (const [label, body] of [
  ['a wrong password', { email: 'safety_officer@example.test', password: 'Safe12345', audience: 'internal' }],
  ['an unknown email', { email: 'nobody@example.test', password: PASSWORD, audience: 'internal' }],
  ['a staff account using the external sign-in', { email: 'safety_officer@example.test', password: PASSWORD, audience: 'external' }],
]) {
  // Test case: One failed sign-in gets 401 and no session.
  test(`Staff AC5 - ${label} is refused with "Invalid email or password."`, async () => {
    mockDatabase();
    const result = await request('POST', '/api/auth/login', { body });
    assert.deepEqual([result.status, result.body], [401, { message: 'Invalid email or password.' }]);
  });
}
for (const [label, body] of [['a missing password', { email: 'safety_officer@example.test' }], ['a blank email', { email: '  ', password: PASSWORD }]]) {
  // Test case: An incomplete form is rejected before the database is read.
  test(`Staff AC5 - ${label} is refused with "Email and password are required."`, async () => {
    const queries = mockDatabase();
    const result = await request('POST', '/api/auth/login', { body });
    assert.deepEqual([result.status, result.body], [400, { message: 'Email and password are required.' }]);
    assert.deepEqual(queries, []);
  });
}

// AC4: endpoints that belong to other roles' workspaces or expose event and client data.
const notForSafety = [
  ['GET', '/api/events'], ['GET', '/api/events/1'], ['GET', '/api/events/1/decision'], ['POST', '/api/events/1/decision', { decision: 'approved' }],
  ['GET', '/api/events/change-requests'], ['GET', '/api/events/assignments'], ['GET', '/api/events/equipment-requests'],
  ['POST', '/api/venues', { name: 'Hall' }], ['GET', '/api/venues/1/schedule'], ['GET', '/api/registrations/mine'],
];
for (const [method, path, body] of notForSafety) {
  // Test case: A Safety Officer session is refused before any event, venue or client data is read.
  test(`Staff AC4 - a Safety Officer is refused ${method} ${path}`, async () => {
    const queries = mockDatabase();
    const result = await request(method, path, { body, token: tokenFor(staff.safety_officer) });
    assert.equal(result.status, 403);
    assert.deepEqual(queries, []);
  });
}
for (const role of internalRoles.filter((name) => name !== 'safety_officer')) {
  // Test case: Other staff cannot open the Safety Officer's queue or record a safety check.
  test(`Staff AC4 - a ${role} cannot use the Safety Officer endpoints`, async () => {
    const queries = mockDatabase();
    assert.equal((await request('GET', '/api/safety/checks', { token: tokenFor(staff[role]) })).status, 403);
    assert.equal((await request('POST', '/api/events/1/safety-checks', { body: { outcome: 'approved' }, token: tokenFor(staff[role]) })).status, 403);
    assert.deepEqual(queries, []);
  });
}
// Test case: A session cannot claim a role the account was not provisioned with.
test('Staff AC1/AC4 - a Safety Officer cannot switch to, or forge a session for, another role', async () => {
  mockDatabase();
  const safety = staff.safety_officer;
  const switched = await request('POST', '/api/auth/switch-role', { body: { role: 'event_coordinator' }, token: tokenFor(safety) });
  assert.deepEqual([switched.status, switched.body], [403, { message: 'This role is not assigned to your account.' }]);
  const forged = jwt.sign({ sub: safety.id, email: safety.email, activeRole: 'event_coordinator', authVersion: 0 }, process.env.JWT_SECRET);
  assert.equal((await request('GET', '/api/events', { token: forged })).status, 401);
});

// Test case: The Safety Officer's own queue loads, and it is read without organiser or client identity.
test('Staff AC3/AC4 - the Safety Officer queue loads safety-ready events without organiser or client identity', async () => {
  const ready = {
    id: 7, name: 'Annual Gala', status: 'submitted', is_draft: false, proposed_date: '2030-02-01', proposed_start_time: '18:00',
    proposed_end_time: '22:00', expected_attendance: 120, room_layout_preference: 'Banquet', accessibility_requirements: null,
    equipment_items: [], technical_support_required: false, video_conferencing_required: false, equipment_notes: null,
    equipment_confirmed_at: null, bookings: [{ status: 'approved', hold_expires_at: null }], venues: [{ name: 'Hall A', capacity: 200 }],
    latest_safety_check: null,
  };
  const notReady = { ...ready, id: 8, name: 'Unconfirmed tech', technical_support_required: true };
  const queries = mockDatabase(() => ({ rows: [ready, notReady] }));
  const result = await request('GET', '/api/safety/checks', { token: tokenFor(staff.safety_officer) });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.events.map((event) => event.id), [7]);
  assert.equal(queries.length, 1);
  assert.doesNotMatch(queries[0], /organiser|users|email|full_name|organisation/i);
});
