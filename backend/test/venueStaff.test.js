const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-only-signing-secret';
const { pool } = require('../src/config/db');
const { login } = require('../src/controllers/authController');
const { requireAuth } = require('../src/middleware/auth');
const { provisionVenueStaff } = require('../src/db/provisionVenueStaff');
const app = require('../src/index');

const roles = ['venue_staff', 'event_coordinator', 'technical_support', 'event_organiser', 'attendee'];
let user;
let server;
let base;
function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
function token(claims = {}, options = {}) {
  return jwt.sign({ sub: 1, email: 'venue@example.com', role: 'venue_staff', ...claims }, process.env.JWT_SECRET, { expiresIn: '1h', ...options });
}
async function request(path, { method = 'GET', body, authorization } = {}) {
  const result = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: result.status, body: await result.json() };
}
before(async () => {
  user = { id: 1, email: 'venue@example.com', full_name: 'Venue Staff', role: 'venue_staff', password_hash: await bcrypt.hash('password123', 10) };
  await new Promise((resolve, reject) => { server = app.listen(0, '127.0.0.1', resolve); server.on('error', reject); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() => mock.restoreAll());
after(async () => { if (server?.listening) await new Promise((resolve) => server.close(resolve)); await pool.end(); });

for (const role of roles) {
  test(`login preserves ${role} and signs a token without exposing the password hash`, async () => {
    mock.method(pool, 'query', async (_sql, values) => { assert.equal(values[0], 'venue@example.com'); return { rows: [{ ...user, role }] }; });
    const res = response();
    await login({ body: { email: ' VENUE@EXAMPLE.COM ', password: 'password123', role: 'attacker_role' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.user.role, role);
    assert.equal(res.body.user.password_hash, undefined);
    const claims = jwt.verify(res.body.token, process.env.JWT_SECRET);
    assert.equal(claims.role, role);
    assert.equal(claims.sub, 1);
    assert.equal(claims.exp - claims.iat, 8 * 60 * 60);
  });
}
for (const body of [undefined, {}, { email: '', password: 'x' }, { email: '  ', password: 'x' }, { email: [], password: 'x' }, { email: 'a@b.com', password: {} }, { email: 'a@b.com', password: '' }, { email: 'a@b.com', password: '   ' }]) {
  test(`malformed credentials are rejected before a database lookup: ${JSON.stringify(body)}`, async () => {
    const query = mock.method(pool, 'query', async () => { throw new Error('Unexpected database query'); });
    const res = response(); await login({ body }, res);
    assert.equal(res.statusCode, 400); assert.equal(query.mock.callCount(), 0);
  });
}
for (const exists of [true, false]) {
  test(`invalid credentials use a clear generic error (account exists: ${exists})`, async () => {
    mock.method(pool, 'query', async () => ({ rows: exists ? [user] : [] }));
    const res = response(); await login({ body: { email: user.email, password: 'wrong-password' } }, res);
    assert.equal(res.statusCode, 401); assert.deepEqual(res.body, { message: 'Invalid email or password.' });
  });
}
test('password whitespace is preserved rather than silently trimmed', async () => {
  mock.method(pool, 'query', async () => ({ rows: [user] }));
  const res = response(); await login({ body: { email: user.email, password: ' password123 ' } }, res);
  assert.equal(res.statusCode, 401);
});
test('database failure returns a controlled login error', async () => {
  mock.method(pool, 'query', async () => { throw new Error('database unavailable'); });
  mock.method(console, 'error', () => {});
  const res = response(); await login({ body: { email: user.email, password: 'password123' } }, res);
  assert.equal(res.statusCode, 500); assert.equal(res.body.token, undefined);
});
test('internal provisioning hashes the password and fixes the role', async () => {
  mock.method(pool, 'query', async (sql, values) => {
    assert.match(sql, /INSERT INTO users/);
    assert.equal(values[0], 'new@example.com'); assert.equal(values[2], 'New Staff'); assert.equal(values[3], 'venue_staff');
    assert.notEqual(values[1], 'password123'); assert.equal(await bcrypt.compare('password123', values[1]), true);
    return { rows: [{ id: 2, email: values[0], full_name: values[2], role: values[3] }] };
  });
  const result = await provisionVenueStaff({ email: ' NEW@EXAMPLE.COM ', fullName: ' New Staff ', password: 'password123', role: 'event_coordinator' });
  assert.equal(result.role, 'venue_staff'); assert.equal(result.password_hash, undefined);
});
test('duplicate provisioning does not overwrite an existing account', async () => {
  const query = mock.method(pool, 'query', async () => { throw Object.assign(new Error('duplicate'), { code: '23505' }); });
  await assert.rejects(provisionVenueStaff({ email: user.email, fullName: 'Staff', password: 'password123' }), /No account was changed/);
  assert.equal(query.mock.callCount(), 1);
});
for (const fields of [{ email: 'bad' }, { fullName: '' }, { password: '1234567' }, { password: 'a'.repeat(73) }, { password: 'é'.repeat(37) }]) {
  test(`provisioning rejects invalid input ${JSON.stringify(fields)}`, async () => {
    const query = mock.method(pool, 'query', async () => { throw new Error('Unexpected query'); });
    await assert.rejects(provisionVenueStaff({ email: user.email, fullName: 'Staff', password: 'password123', ...fields }), /Provide a valid email/);
    assert.equal(query.mock.callCount(), 0);
  });
}
for (const password of ['12345678', 'a'.repeat(72)]) {
  test(`provisioning accepts password length boundary ${password.length}`, async () => {
    mock.method(pool, 'query', async () => ({ rows: [{ role: 'venue_staff' }] }));
    assert.equal((await provisionVenueStaff({ email: user.email, fullName: 'Staff', password })).role, 'venue_staff');
  });
}
test('staff self-registration is not exposed over HTTP', async () => {
  const query = mock.method(pool, 'query', async () => { throw new Error('Unexpected query'); });
  const res = await request('/api/auth/register', { method: 'POST', body: { email: user.email, password: 'password123', role: 'venue_staff' } });
  assert.equal(res.status, 404); assert.equal(query.mock.callCount(), 0);
});
for (const header of [undefined, 'Bearer ', 'Basic abc', 'Bearer invalid', `Bearer ${token({}, { expiresIn: -1 })}`, `Bearer ${jwt.sign({ sub: 1 }, 'wrong-secret')}`]) {
  test(`authentication rejects missing, malformed, expired or forged tokens: ${header?.slice(0, 25)}`, async () => {
    const query = mock.method(pool, 'query', async () => { throw new Error('Unexpected query'); });
    const res = response(); let called = false;
    await requireAuth({ headers: { authorization: header } }, res, () => { called = true; });
    assert.equal(res.statusCode, 401); assert.equal(called, false); assert.equal(query.mock.callCount(), 0);
  });
}
test('deleted provisioned account loses access', async () => {
  mock.method(pool, 'query', async () => ({ rows: [] }));
  assert.equal((await request('/api/auth/me', { authorization: `Bearer ${token()}` })).status, 401);
});
test('session restoration returns current staff profile without password hash', async () => {
  mock.method(pool, 'query', async () => ({ rows: [user] }));
  const res = await request('/api/auth/me', { authorization: `Bearer ${token()}` });
  assert.equal(res.status, 200); assert.equal(res.body.user.role, 'venue_staff'); assert.equal(res.body.user.password_hash, undefined);
});
for (const path of ['/api/events', '/api/events/1', '/api/events/999']) {
  test(`Venue Staff cannot read general event/client data at ${path}`, async () => {
    const query = mock.method(pool, 'query', async (sql) => { assert.match(sql, /FROM users/); return { rows: [user] }; });
    const res = await request(path, { authorization: `Bearer ${token({ role: 'event_coordinator' })}` });
    assert.equal(res.status, 403); assert.equal(query.mock.callCount(), 1);
  });
}
const venue = { name: 'Hall', location: 'Level 1', capacity: 40, supportedLayouts: ['classroom'], accessibilityFeatures: ['wheelchair'], facilities: ['Wi-Fi'], operatingHours: '08:00 - 22:00' };
test('Venue Staff can create venue records using the existing endpoint', async () => {
  mock.method(pool, 'query', async (sql) => ({ rows: sql.includes('FROM users') ? [user] : [{ id: 10, name: venue.name }] }));
  const res = await request('/api/venues', { method: 'POST', body: venue, authorization: `Bearer ${token()}` });
  assert.equal(res.status, 201); assert.equal(res.body.venue.name, 'Hall');
});
test('unauthenticated venue creation is denied', async () => {
  const query = mock.method(pool, 'query', async () => { throw new Error('Unexpected query'); });
  assert.equal((await request('/api/venues', { method: 'POST', body: venue })).status, 401);
  assert.equal(query.mock.callCount(), 0);
});
for (const role of roles.filter((value) => value !== 'venue_staff')) {
  test(`${role} cannot create venues even with a token claiming Venue Staff`, async () => {
    const query = mock.method(pool, 'query', async (sql) => { assert.match(sql, /FROM users/); return { rows: [{ ...user, role }] }; });
    assert.equal((await request('/api/venues', { method: 'POST', body: venue, authorization: `Bearer ${token()}` })).status, 403);
    assert.equal(query.mock.callCount(), 1);
  });
}
