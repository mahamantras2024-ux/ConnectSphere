const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-only-signing-secret';
const { pool } = require('../src/config/db');
const app = require('../src/index');

let user;
let server;
let base;

const roles = ['venue_staff', 'event_coordinator', 'technical_support', 'event_organiser', 'attendee'];
const sampleVenue = {
  name: 'Hall A',
  location: 'Level 1',
  capacity: 40,
  supportedLayouts: ['classroom'],
  accessibilityFeatures: ['wheelchair'],
  facilities: ['Wi-Fi'],
  operatingHours: '08:00 - 22:00',
};

function generateToken(claims = {}, options = {}) {
  return jwt.sign(
    { sub: 1, email: 'venue@example.com', role: 'venue_staff', ...claims },
    process.env.JWT_SECRET,
    { expiresIn: '1h', ...options }
  );
}

async function apiRequest(path, { method = 'GET', body, authorization } = {}) {
  const result = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: result.status, body: await result.json() };
}

before(async () => {
  user = { id: 1, email: 'venue@example.com', full_name: 'Venue Staff', role: 'venue_staff' };
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

// =========================================================================
// USER STORY 1: Catalogue Creation Tests
// =========================================================================

test('US1 - [201 Created] Venue Staff can successfully create venue records', async () => {
  mock.method(pool, 'query', async (sql) => ({
    rows: sql.includes('FROM users') ? [user] : [{ id: 10, name: sampleVenue.name }],
  }));

  const res = await apiRequest('/api/venues', {
    method: 'POST',
    body: sampleVenue,
    authorization: `Bearer ${generateToken()}`,
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.venue.name, 'Hall A');
  assert.equal(res.body.message, 'Venue successfully created.');
});

test('US1 - [401 Unauthorized] Reject venue creation when authorization token is missing', async () => {
  const query = mock.method(pool, 'query', async () => {
    throw new Error('Unexpected query executed');
  });

  const res = await apiRequest('/api/venues', { method: 'POST', body: sampleVenue });

  assert.equal(res.status, 401);
  assert.equal(query.mock.callCount(), 0);
});

for (const role of roles.filter((r) => r !== 'venue_staff')) {
  test(`US1 - [403 Forbidden] Reject venue creation for unauthorized role: ${role}`, async () => {
    const query = mock.method(pool, 'query', async (sql) => {
      assert.match(sql, /FROM users/);
      return { rows: [{ ...user, role }] };
    });

    const res = await apiRequest('/api/venues', {
      method: 'POST',
      body: sampleVenue,
      authorization: `Bearer ${generateToken()}`,
    });

    assert.equal(res.status, 403);
    assert.equal(query.mock.callCount(), 1);
  });
}

test('US1 - [400 Bad Request] Reject venue creation when required fields are missing', async () => {
  mock.method(pool, 'query', async (sql) => ({
    rows: sql.includes('FROM users') ? [user] : [],
  }));

  const incompletePayload = { name: 'Incomplete Hall' };

  const res = await apiRequest('/api/venues', {
    method: 'POST',
    body: incompletePayload,
    authorization: `Bearer ${generateToken()}`,
  });

  assert.equal(res.status, 400);
  assert.match(res.body.message, /Validation Error/i);
});