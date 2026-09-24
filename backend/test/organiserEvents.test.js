const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'event-tests-secret';
process.env.MAIL_PROVIDER = 'mailpit';
process.env.NODE_ENV = 'test';
const { pool } = require('../src/config/db');
const app = require('../src/index');
const emailService = require('../src/services/emailService');
const nodemailer = require('nodemailer');
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
for (const role of ['event_organiser', 'attendee']) {
  test(`external self-registration supports ${role} with a hashed password`, async () => {
    mock.method(pool, 'query', async (sql, values) => {
      assert.match(sql, /INSERT INTO users/); assert.equal(values[0], 'new@example.com');
      assert.equal(await bcrypt.compare('password123', values[1]), true); assert.equal(values[3], role);
      return { rows: [{ id: 31, email: values[0], full_name: values[2], role }] };
    });
    const result = await request('/api/auth/register', { user: null, method: 'POST', body: { email: ' NEW@example.com ', fullName: 'New User', password: 'password123', role } });
    assert.equal(result.status, 201); assert.equal(result.body.user.password_hash, undefined);
  });
}
for (const role of ['venue_staff', 'event_coordinator', 'technical_support', 'admin']) {
  test(`self-registration cannot select internal role ${role}`, async () => {
    const query = mock.method(pool, 'query', async () => { throw new Error('Unexpected query'); });
    assert.equal((await request('/api/auth/register', { user: null, method: 'POST', body: { role } })).status, 403);
    assert.equal(query.mock.callCount(), 0);
  });
}
test('duplicate external registration does not overwrite an account', async () => {
  mock.method(pool, 'query', async () => { throw Object.assign(new Error('duplicate'), { code: '23505' }); });
  assert.equal((await request('/api/auth/register', { user: null, method: 'POST', body: { role: 'event_organiser', email: 'a@example.com', fullName: 'Alice', password: 'password123' } })).status, 409);
});
test('external login rejects staff without returning a session', async () => {
  mock.method(pool, 'query', async () => ({ rows: [{ ...organiser, role: 'venue_staff' }] }));
  const result = await request('/api/auth/login', { user: null, method: 'POST', body: { audience: 'external', email: organiser.email, password: 'password123' } });
  assert.equal(result.status, 401); assert.equal(result.body.token, undefined);
});

test('reset request stores only a token hash and emails the one-time token', async () => {
  let storedHash;
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('SELECT')) return { rows: [organiser] };
    assert.match(sql, /interval '15 minutes'/); storedHash = values[1]; return { rows: [{ id: 12 }] };
  });
  mock.method(emailService, 'sendPasswordReset', async (address, rawToken) => {
    assert.equal(address, organiser.email); assert.match(rawToken, /^[a-f0-9]{64}$/);
    assert.notEqual(storedHash, rawToken); assert.equal(storedHash, crypto.createHash('sha256').update(rawToken).digest('hex'));
  });
  const result = await request('/api/auth/forgot-password', { user: null, method: 'POST', body: { email: organiser.email } });
  assert.equal(result.status, 200); assert.deepEqual(Object.keys(result.body), ['message']);
});
test('unknown emails and internal accounts receive the same reset response without mail', async () => {
  let rows = [];
  mock.method(pool, 'query', async () => ({ rows }));
  const send = mock.method(emailService, 'sendPasswordReset', async () => {});
  const first = await request('/api/auth/forgot-password', { user: null, method: 'POST', body: { email: 'missing@example.com' } });
  rows = [{ ...organiser, role: 'venue_staff' }];
  const second = await request('/api/auth/forgot-password', { user: null, method: 'POST', body: { email: organiser.email } });
  assert.deepEqual(first, second); assert.equal(send.mock.callCount(), 0);
});
test('delivery failure clears only its own reset token and does not expose account existence', async () => {
  const calls = [];
  mock.method(pool, 'query', async (sql, values) => { calls.push([sql, values]); return { rows: sql.includes('SELECT') ? [organiser] : [{ id: 12 }] }; });
  mock.method(emailService, 'sendPasswordReset', async () => { throw Object.assign(new Error('delivery failed'), { code: 'ECONNECTION' }); });
  mock.method(console, 'error', () => {});
  assert.equal((await request('/api/auth/forgot-password', { user: null, method: 'POST', body: { email: organiser.email } })).status, 200);
  assert.match(calls[2][0], /password_reset_hash = \$2/); assert.equal(calls[2][1][1], calls[1][1][1]);
});
test('reset atomically consumes an unexpired token, hashes the new password, and invalidates sessions', async () => {
  mock.method(pool, 'query', async (sql, values) => {
    assert.match(sql, /password_reset_expires_at > now\(\)/);
    assert.match(sql, /auth_version = auth_version \+ 1/); assert.match(sql, /password_reset_hash = NULL/);
    assert.equal(await bcrypt.compare('new-password123', values[1]), true); return { rows: [{ id: 12 }] };
  });
  assert.equal((await request('/api/auth/reset-password', { user: null, method: 'POST', body: { token: 'a'.repeat(64), password: 'new-password123' } })).status, 200);
});
test('expired, previously consumed and unknown reset tokens cannot update a password', async () => {
  mock.method(pool, 'query', async () => ({ rows: [] }));
  assert.equal((await request('/api/auth/reset-password', { user: null, method: 'POST', body: { token: 'b'.repeat(64), password: 'new-password123' } })).status, 400);
});
test('malformed reset tokens are rejected before database access', async () => {
  const query = mock.method(pool, 'query', async () => { throw new Error('Unexpected query'); });
  assert.equal((await request('/api/auth/reset-password', { user: null, method: 'POST', body: { token: 'bad', password: 'new-password123' } })).status, 400);
  assert.equal(query.mock.callCount(), 0);
});
test('a pre-reset JWT cannot restore a session after password reset', async () => {
  mock.method(pool, 'query', async () => ({ rows: [{ ...organiser, auth_version: 1 }] }));
  assert.equal((await request('/api/auth/me')).status, 401);
});
test('Mailpit transport captures email locally and reset URLs keep tokens in the fragment', async () => {
  const oldProvider = process.env.MAIL_PROVIDER;
  process.env.MAIL_PROVIDER = 'mailpit';
  try {
    let closed = false;
    mock.method(nodemailer, 'createTransport', (config) => {
      assert.equal(config.port, 1025); assert.equal(config.secure, false);
      return { sendMail: async (message) => {
        assert.equal(message.to, organiser.email); assert.match(message.text, /reset-password#token=/);
      }, close: () => { closed = true; } };
    });
    await emailService.sendPasswordReset(organiser.email, 'a'.repeat(64)); assert.equal(closed, true);
  } finally { if (oldProvider === undefined) delete process.env.MAIL_PROVIDER; else process.env.MAIL_PROVIDER = oldProvider; }
});
test('Resend uses encrypted SMTP and requires a private key and verified sender configuration', () => {
  const keys = ['MAIL_PROVIDER', 'RESEND_API_KEY', 'MAIL_FROM', 'PUBLIC_APP_URL'];
  const old = keys.map((key) => process.env[key]);
  try {
    process.env.MAIL_PROVIDER = 'resend'; delete process.env.RESEND_API_KEY;
    assert.throws(() => emailService.emailConfig(), /Resend requires/);
    process.env.RESEND_API_KEY = 'test-key'; process.env.MAIL_FROM = 'sender@example.com'; process.env.PUBLIC_APP_URL = 'https://events.example.com';
    const config = emailService.emailConfig();
    assert.equal(config.transport.host, 'smtp.resend.com'); assert.equal(config.transport.secure, true);
    assert.equal(config.transport.auth.user, 'resend'); assert.equal(config.from, 'sender@example.com');
  } finally { keys.forEach((key, index) => { if (old[index] === undefined) delete process.env[key]; else process.env[key] = old[index]; }); }
});
