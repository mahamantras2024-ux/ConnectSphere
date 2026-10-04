// File: Tests external signup permissions, hashed credentials and private multi-role provisioning.
const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('../../backend/node_modules/bcryptjs');
const { pool } = require('../../backend/src/config/db');
const { provisionAccount } = require('../../backend/src/db/provisionAccount');
const app = require('../../backend/src/index');
afterEach(() =>
      // Handles this operation using the surrounding screen or request state.
      mock.restoreAll());
test('public registration rejects internal roles without database writes', async () => {
  // Exercises the HTTP boundary rather than only inspecting a route declaration.
  const query = mock.method(pool, 'query', async () => {
      // Handles this operation using the surrounding screen or request state.
       throw new Error('Unexpected database access'); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve =>
      // Handles this operation using the surrounding screen or request state.
      server.once('listening', resolve));
  try {
    for (const role of ['venue_staff','event_coordinator_lead','safety_officer']) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) });
      assert.equal(response.status, 400); assert.match((await response.json()).message, /Staff accounts/);
    }
    assert.equal(query.mock.callCount(), 0);
  } finally { await new Promise(resolve =>
      // Handles this operation using the surrounding screen or request state.
      server.close(resolve)); }
});

test('external registration hashes credentials, ignores extra grants and preserves duplicate accounts', async () => {
  // Exercises successful registration and rejection of invalid/duplicate submissions through HTTP.
  let writes = 0;
  const query = mock.method(pool, 'query', async (sql, values) => {
    // Checks safe identity fields and hashes, while simulating the database uniqueness constraint.
    assert.match(sql, /INSERT INTO users/);
    assert.equal(values[0], 'new@example.com');
    assert.equal(await bcrypt.compare('password123', values[1]), true);
    assert.equal(values[3], 'attendee');
    if (++writes > 1) throw Object.assign(new Error('duplicate'), { code: '23505' });
    return { rows: [{ id: 92, email: values[0], full_name: values[2], role: values[3] }] };
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => { // Waits for the local API listener.
    server.once('listening', resolve);
  });
  try {
    const payload = { email: ' NEW@example.com ', fullName: 'New Person', password: 'password123', confirmation: 'password123', role: 'attendee', roles: ['safety_officer'] };
    const send = async body => { // Sends a registration request to the local test API.
      return fetch(`http://127.0.0.1:${server.address().port}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    };
    for (const invalid of [{ email: 'bad' }, { fullName: ' ' }, { password: 'short' }, { password: 'é'.repeat(37) }, { organisationName: 42 }, { confirmation: undefined }, { confirmation: 'different123' }]) assert.equal((await send({ ...payload, ...invalid })).status, 400);
    assert.equal(query.mock.callCount(), 0);
    const created = await send(payload); assert.equal(created.status, 201);
    const body = await created.json(); assert.equal(body.user.password_hash, undefined); assert.equal(body.user.role, 'attendee');
    assert.equal((await send(payload)).status, 409);
  } finally { await new Promise(resolve => { // Closes the test listener.
    server.close(resolve);
  }); }
});
test('private onboarding hashes passwords, normalises identity, and persists provisioned roles', async () => {
  // Verifies the credential and role values written to the database without returning a password hash.
  mock.method(pool, 'query', async (sql, values) => {
      // Handles this operation using the surrounding screen or request state.

    assert.match(sql, /INSERT INTO users/); assert.equal(values[0], 'new@example.com');
    assert.equal(await bcrypt.compare('password123', values[2]), true);
    assert.deepEqual(values[4], ['event_coordinator', 'venue_staff']);
    return { rows: [{ id: 42, role: values[3], roles: values[4] }] };
  });
  const user = await provisionAccount({ email: ' NEW@example.com ', fullName: 'New User', password: 'password123', roles: ['event_coordinator','venue_staff','venue_staff'] });
  assert.equal(user.id, 42); assert.equal(user.password_hash, undefined);
});
test('private onboarding rejects invalid identity, passwords, and unrecognised roles before persistence', async () => {
  // Checks important onboarding boundaries without duplicating successful insertion tests.
  const query = mock.method(pool, 'query', async () => {
      // Handles this operation using the surrounding screen or request state.
       throw new Error('Unexpected database write'); });
  for (const invalid of [{ email: 'bad' }, { fullName: ' ' }, { fullName: 'a'.repeat(256) }, { password: 'short' }, { password: 'é'.repeat(37) }, { roles: [] }, { roles: ['admin'] }, { organisationName: 42 }]) {
    await assert.rejects(provisionAccount({ email: 'a@example.com', fullName: 'Alice', password: 'password123', roles: ['attendee'], ...invalid }), /Provide a valid/);
  }
  assert.equal(query.mock.callCount(), 0);
});
test('duplicate onboarding preserves the existing account', async () => {
  // Ensures duplicate emails never overwrite an existing account or its role grants.
  mock.method(pool, 'query', async () => {
      // Handles this operation using the surrounding screen or request state.
       throw Object.assign(new Error('duplicate'), { code: '23505' }); });
  await assert.rejects(provisionAccount({ email: 'a@example.com', fullName: 'Alice', password: 'password123', roles: ['safety_officer'] }), { code: '23505' });
});
