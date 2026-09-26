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

function token(user = organiser) {
  return jwt.sign({ sub: user.id, role: user.role, email: user.email, authVersion: user.auth_version }, process.env.JWT_SECRET);
}

async function request(path, { user = null, method = 'POST', body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(user ? { Authorization: `Bearer ${token(user)}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
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

test('reset request stores only a token hash and emails the one-time token', async () => {
  let storedHash;
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('SELECT')) return { rows: [organiser] };
    assert.match(sql, /interval '15 minutes'/);
    storedHash = values[1];
    return { rows: [{ id: 12 }] };
  });
  mock.method(emailService, 'sendPasswordReset', async (address, rawToken) => {
    assert.equal(address, organiser.email);
    assert.match(rawToken, /^[a-f0-9]{64}$/);
    assert.notEqual(storedHash, rawToken);
    assert.equal(storedHash, crypto.createHash('sha256').update(rawToken).digest('hex'));
  });

  const result = await request('/api/auth/forgot-password', { body: { email: organiser.email } });
  assert.equal(result.status, 200);
  assert.deepEqual(Object.keys(result.body), ['message']);
});

test('unknown emails and internal accounts receive the same reset response without mail', async () => {
  let rows = [];
  mock.method(pool, 'query', async () => ({ rows }));
  const send = mock.method(emailService, 'sendPasswordReset', async () => {});

  const first = await request('/api/auth/forgot-password', { body: { email: 'missing@example.com' } });
  rows = [{ ...organiser, role: 'venue_staff' }];
  const second = await request('/api/auth/forgot-password', { body: { email: organiser.email } });

  assert.deepEqual(first, second);
  assert.equal(send.mock.callCount(), 0);
});

test('delivery failure clears its reset token and does not expose account existence', async () => {
  const calls = [];
  mock.method(pool, 'query', async (sql, values) => {
    calls.push([sql, values]);
    return { rows: sql.includes('SELECT') ? [organiser] : [{ id: 12 }] };
  });
  mock.method(emailService, 'sendPasswordReset', async () => {
    throw Object.assign(new Error('delivery failed'), { code: 'ECONNECTION' });
  });
  mock.method(console, 'error', () => {});

  const result = await request('/api/auth/forgot-password', { body: { email: organiser.email } });
  assert.equal(result.status, 200);
  assert.match(calls[2][0], /password_reset_hash = \$2/);
  assert.equal(calls[2][1][1], calls[1][1][1]);
});

test('reset atomically consumes an unexpired token, hashes the new password, and invalidates sessions', async () => {
  mock.method(pool, 'query', async (sql, values) => {
    assert.match(sql, /password_reset_expires_at > now\(\)/);
    assert.match(sql, /auth_version = auth_version \+ 1/);
    assert.match(sql, /password_reset_hash = NULL/);
    assert.equal(await bcrypt.compare('new-password123', values[1]), true);
    return { rows: [{ id: 12 }] };
  });

  const result = await request('/api/auth/reset-password', {
    body: { token: 'a'.repeat(64), password: 'new-password123' },
  });
  assert.equal(result.status, 200);
});

test('expired, consumed, and unknown reset tokens cannot update a password', async () => {
  mock.method(pool, 'query', async () => ({ rows: [] }));
  const result = await request('/api/auth/reset-password', {
    body: { token: 'b'.repeat(64), password: 'new-password123' },
  });
  assert.equal(result.status, 400);
});

test('malformed reset tokens are rejected before database access', async () => {
  const query = mock.method(pool, 'query', async () => { throw new Error('Unexpected query'); });
  const result = await request('/api/auth/reset-password', {
    body: { token: 'bad', password: 'new-password123' },
  });
  assert.equal(result.status, 400);
  assert.equal(query.mock.callCount(), 0);
});

test('a pre-reset JWT cannot restore a session after password reset', async () => {
  mock.method(pool, 'query', async () => ({ rows: [{ ...organiser, auth_version: 1 }] }));
  const result = await request('/api/auth/me', { method: 'GET', user: organiser });
  assert.equal(result.status, 401);
});

test('Mailpit reset emails keep tokens in the URL fragment and close the transport', async () => {
  let closed = false;
  mock.method(nodemailer, 'createTransport', (config) => {
    assert.equal(config.port, 1025);
    assert.equal(config.secure, false);
    return {
      sendMail: async (message) => {
        assert.equal(message.to, organiser.email);
        assert.match(message.text, /reset-password#token=/);
      },
      close: () => { closed = true; },
    };
  });

  await emailService.sendPasswordReset(organiser.email, 'a'.repeat(64));
  assert.equal(closed, true);
});

test('Resend requires verified sender configuration and uses encrypted SMTP', () => {
  const keys = ['MAIL_PROVIDER', 'RESEND_API_KEY', 'MAIL_FROM', 'PUBLIC_APP_URL'];
  const old = keys.map((key) => process.env[key]);
  try {
    process.env.MAIL_PROVIDER = 'resend';
    delete process.env.RESEND_API_KEY;
    assert.throws(() => emailService.emailConfig(), /Resend requires/);

    process.env.RESEND_API_KEY = 'test-key';
    process.env.MAIL_FROM = 'sender@example.com';
    process.env.PUBLIC_APP_URL = 'https://events.example.com';
    const config = emailService.emailConfig();
    assert.equal(config.transport.host, 'smtp.resend.com');
    assert.equal(config.transport.secure, true);
    assert.equal(config.transport.auth.user, 'resend');
    assert.equal(config.from, 'sender@example.com');
  } finally {
    keys.forEach((key, index) => {
      if (old[index] === undefined) delete process.env[key];
      else process.env[key] = old[index];
    });
  }
});
