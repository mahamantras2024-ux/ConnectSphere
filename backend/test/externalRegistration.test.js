const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
process.env.JWT_SECRET = 'event-tests-secret';
process.env.NODE_ENV = 'test';
const { pool } = require('../src/config/db');
const app = require('../src/index');

let server, base;

async function request(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

before(async () => {
  await new Promise((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', resolve);
    server.on('error', reject);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() => mock.restoreAll());
after(async () => {
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

for (const role of ['event_organiser', 'attendee']) {
  test(`external self-registration supports ${role} with a hashed password`, async () => {
    mock.method(pool, 'query', async (sql, values) => {
      assert.match(sql, /INSERT INTO users/);
      assert.equal(values[0], 'new@example.com');
      assert.equal(await bcrypt.compare('password123', values[1]), true);
      assert.equal(values[3], role);
      return { rows: [{ id: 31, email: values[0], full_name: values[2], role }] };
    });

    const result = await request('/api/auth/register', {
      email: ' NEW@example.com ', fullName: 'New User', password: 'password123', role,
    });
    assert.equal(result.status, 201);
    assert.equal(result.body.user.password_hash, undefined);
  });
}

for (const role of ['venue_staff', 'event_coordinator', 'technical_support', 'admin']) {
  test(`self-registration rejects internal role ${role}`, async () => {
    const query = mock.method(pool, 'query', async () => { throw new Error('Unexpected query'); });
    const result = await request('/api/auth/register', { role });
    assert.equal(result.status, 403);
    assert.equal(query.mock.callCount(), 0);
  });
}

for (const [description, invalid] of [
  ['malformed email', { email: 'not-an-email' }],
  ['short password', { password: 'short' }],
  ['password over 72 UTF-8 bytes', { password: 'é'.repeat(37) }],
  ['non-string name', { fullName: 42 }],
  ['blank name', { fullName: '  ' }],
  ['overlong name', { fullName: 'x'.repeat(256) }],
  ['non-string organisation name', { organisationName: 42 }],
  ['overlong organisation name', { organisationName: 'x'.repeat(256) }],
]) {
  test(`external self-registration rejects ${description} before database access`, async () => {
    const query = mock.method(pool, 'query', async () => { throw new Error('Unexpected query'); });
    const result = await request('/api/auth/register', {
      email: 'alice@example.com', fullName: 'Alice', password: 'password123', role: 'event_organiser', ...invalid,
    });
    assert.equal(result.status, 400);
    assert.equal(query.mock.callCount(), 0);
  });
}

test('duplicate external registration returns a conflict without overwriting an account', async () => {
  mock.method(pool, 'query', async () => {
    throw Object.assign(new Error('duplicate'), { code: '23505' });
  });
  const result = await request('/api/auth/register', {
    role: 'event_organiser', email: 'a@example.com', fullName: 'Alice', password: 'password123',
  });
  assert.equal(result.status, 409);
});

test('unexpected persistence errors are forwarded to the API error handler', async () => {
  mock.method(console, 'error', () => {});
  const query = mock.method(pool, 'query', async () => { throw new Error('database unavailable'); });
  const result = await request('/api/auth/register', {
    email: 'alice@example.com', fullName: 'Alice', password: 'password123', role: 'event_organiser',
  });
  assert.equal(result.status, 500);
  assert.equal(query.mock.callCount(), 1);
});
