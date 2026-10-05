// File: Verifies Sprint 1 credential errors, provisioned role switching, revoked access, and personal registrations.
// Test scope: Uses real handlers/services with controlled database/email/provider boundaries where configured.
const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('../../backend/node_modules/bcryptjs');
const jwt = require('../../backend/node_modules/jsonwebtoken');
process.env.JWT_SECRET = 'sprint-one-test-secret';
const { pool } = require('../../backend/src/config/db');
const app = require('../../backend/src/index');
let server, base, account;
before(async () => {
  // Starts the HTTP fixture with a multi-role, hashed-password account.
  account = { id: 81, email: 'staff@example.test', full_name: 'Test Staff', password_hash: await bcrypt.hash('password123', 10), role: 'venue_staff', roles: ['venue_staff', 'event_coordinator', 'attendee'], auth_version: 2 };
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve =>
      // Handles this operation using the surrounding screen or request state.
      server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() =>
      // Handles this operation using the surrounding screen or request state.
      mock.restoreAll());
after(async () => {
      // Handles this operation using the surrounding screen or request state.
       await new Promise(resolve =>
      // Handles this operation using the surrounding screen or request state.
      server.close(resolve)); await pool.end(); });
// Calls the test API with optional credentials and returns the status and decoded response.
async function request(path, body, token) {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
// Signs a session using one provisioned active role and the current revocation version.
function token(role = 'venue_staff', authVersion = 2) { return jwt.sign({ sub: 81, email: account.email, activeRole: role, authVersion }, process.env.JWT_SECRET); }
// Test case: Logs in with different audiences/grants and checks the selected role belongs to the account and requested audience.
test('login verifies credentials and selects a provisioned role in the requested audience', async () => {
  // Verifies staff/external separation for a multi-role account and avoids credential disclosure.
  mock.method(pool, 'query', async () => (
      // Handles this operation using the surrounding screen or request state.
      { rows: [account] }));
  for (const [audience, expected] of [['internal','venue_staff'],['external','attendee']]) {
    const result = await request('/api/auth/login', { email: ' STAFF@example.test ', password: 'password123', audience });
    assert.equal(result.status, 200); assert.equal(result.body.user.role, expected);
    assert.equal(jwt.verify(result.body.token, process.env.JWT_SECRET).activeRole, expected);
    assert.equal(result.body.user.password_hash, undefined);
  }
  assert.equal((await request('/api/auth/login', { email: account.email, password: 'wrong-password' })).status, 401);
  assert.equal((await request('/api/auth/login', { email: '', password: 'password123' })).status, 400);
  assert.equal((await request('/api/auth/login', { email: account.email, password: 'password123', audience: 'admin' })).status, 400);
});
// Test case: Tries bad credentials, database failure and absent audience grants and checks clear error responses.
test('invalid credentials, unavailable database, and accounts without audience roles produce clear errors', async () => {
  // Exercises missing-account, wrong-audience, and persistence failure responses.
  mock.method(pool, 'query', async () => (
      // Handles this operation using the surrounding screen or request state.
      { rows: [] }));
  assert.equal((await request('/api/auth/login', { email: 'missing@example.test', password: 'password123' })).status, 401);
  pool.query.mock.restore(); mock.method(pool, 'query', async () => (
      // Handles this operation using the surrounding screen or request state.
      { rows: [{ ...account, roles: [] }] }));
  assert.equal((await request('/api/auth/login', { email: account.email, password: 'password123', audience: 'external' })).status, 401);
  pool.query.mock.restore(); mock.method(console, 'error', () => {
      // Handles this operation using the surrounding screen or request state.
      }); mock.method(pool, 'query', async () => {
      // Handles this operation using the surrounding screen or request state.
       throw new Error('Unavailable'); });
  assert.equal((await request('/api/auth/login', { email: account.email, password: 'password123' })).status, 500);
});
// Test case: Tries an unassigned role switch then restores a valid switched session and checks its active role is retained.
test('role switching cannot grant an unprovisioned role and session restoration retains the selected role', async () => {
  // Checks database-backed switching and confirms client claims cannot grant additional access.
  mock.method(pool, 'query', async () => (
      // Handles this operation using the surrounding screen or request state.
      { rows: [account] }));
  const changed = await request('/api/auth/switch-role', { role: 'event_coordinator' }, token());
  assert.equal(changed.status, 200); assert.equal(changed.body.user.role, 'event_coordinator');
  const me = await request('/api/auth/me', null, changed.body.token);
  assert.equal(me.status, 200); assert.equal(me.body.user.role, 'event_coordinator');
  assert.equal((await request('/api/auth/switch-role', { role: 'safety_officer' }, token())).status, 403);
  assert.equal((await request('/api/auth/switch-role', { role: '__proto__' }, token())).status, 403);
  assert.equal((await request('/api/auth/switch-role', { role: 'attendee' })).status, 401);
});
// Test case: Presents revoked roles, deleted accounts, malformed JWTs and obsolete session versions and checks API access is denied.
test('revoked roles, deleted accounts, malformed JWTs, and old session versions cannot access protected APIs', async () => {
  // Validates that authorisation uses current account state rather than stale JWT grants.
  mock.method(pool, 'query', async () => (
      // Handles this operation using the surrounding screen or request state.
      { rows: [account] }));
  assert.equal((await request('/api/events', null, token('safety_officer'))).status, 401);
  assert.equal((await request('/api/events', null, token('event_coordinator', 1))).status, 401);
  assert.equal((await request('/api/events', null, 'not-a-token')).status, 401);
  pool.query.mock.restore(); mock.method(pool, 'query', async () => (
      // Handles this operation using the surrounding screen or request state.
      { rows: [] }));
  assert.equal((await request('/api/events', null, token())).status, 401);
});
// Test case: Lists attendee registrations with forged identity input and checks owner scoping and unavailable write endpoints.
test('attendee summaries query only the session owner and do not enable registration writes', async () => {
  // Ensures caller-supplied attendee IDs cannot expose another person's registrations.
  mock.method(pool, 'query', async (sql, values) => {
      // Handles this operation using the surrounding screen or request state.

    if (sql.includes('FROM users')) return { rows: [account] };
    assert.match(sql, /WHERE r.attendee_id = \$1/); assert.deepEqual(values, [81]);
    return { rows: [{ id: 3, event_name: 'Workshop', status: 'registered' }] };
  });
  const result = await request('/api/registrations/mine?attendee_id=99', null, token('attendee'));
  assert.equal(result.status, 200); assert.equal(result.body.registrations[0].event_name, 'Workshop');
  assert.equal((await request('/api/registrations/mine', null, token())).status, 403);
  assert.equal((await request('/api/registrations', { eventId: 1 }, token('attendee'))).status, 404);
});
