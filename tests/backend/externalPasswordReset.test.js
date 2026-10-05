// File: Tests reset-token lifecycle, session invalidation, and mocked Gmail app-password email configuration.
// Test scope: Uses real handlers/services with controlled database/email/provider boundaries where configured.
const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const bcrypt = require('../../backend/node_modules/bcryptjs');
const jwt = require('../../backend/node_modules/jsonwebtoken');
process.env.JWT_SECRET = 'event-tests-secret';
process.env.GMAIL_USER = 'sender@gmail.com';
process.env.GMAIL_APP_PASSWORD = 'abcdefghijklmnop';
process.env.PUBLIC_APP_URL = 'https://events.example.test';
process.env.NODE_ENV = 'test';
const { pool } = require('../../backend/src/config/db');
const app = require('../../backend/src/index');
const emailService = require('../../backend/src/services/emailService');
const nodemailer = require('../../backend/node_modules/nodemailer');

let server, base;
const organiser = { id: 12, email: 'alice@example.com', full_name: 'Alice', role: 'event_organiser', auth_version: 0 };

// Signs a test-only JWT for the supplied user and current session version.
function token(user = organiser) {
  return jwt.sign({ sub: user.id, role: user.role, email: user.email, authVersion: user.auth_version }, process.env.JWT_SECRET);
}

// Calls the local test HTTP server with the requested payload/session and returns status plus JSON.
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
  // Initializes clean test state, fixtures, mocks, or a local HTTP server before the test cases.

  await new Promise((resolve, reject) => {
    // Starts a local test HTTP server and resolves/rejects on startup.

    server = app.listen(0, '127.0.0.1', resolve);
    server.on('error', reject);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() => // Cleans up test state, mocks, mounted components, or local server/database resources.

      // Handles this operation using the surrounding screen or request state.
      mock.restoreAll());
after(async () => {
  // Cleans up test state, mocks, mounted components, or local server/database resources.

  if (server?.listening) await new Promise((resolve) => // Resolves when the test HTTP server finishes closing.

      // Handles this operation using the surrounding screen or request state.
      server.close(resolve));
  await pool.end();
});

// Test case: Requests recovery and checks only a token hash is stored while the simulated email receives the usable token.
test('reset request stores only a token hash and emails the one-time token', async () => {

  let storedHash;
  mock.method(pool, 'query', async (sql, values) => {
    // Supplies controlled query behavior for this regression case, including its expected result or failure.

    if (sql.includes('SELECT')) return { rows: [organiser] };
    assert.match(sql, /interval '15 minutes'/);
    storedHash = values[1];
    return { rows: [{ id: 12 }] };
  });
  mock.method(emailService, 'sendPasswordReset', async (address, rawToken) => {
    // Supplies controlled sendPasswordReset behavior for this regression case, including its expected result or failure.

    assert.equal(address, organiser.email);
    assert.match(rawToken, /^[a-f0-9]{64}$/);
    assert.notEqual(storedHash, rawToken);
    assert.equal(storedHash, crypto.createHash('sha256').update(rawToken).digest('hex'));
  });

  const result = await request('/api/auth/forgot-password', { body: { email: organiser.email } });
  assert.equal(result.status, 200);
  assert.deepEqual(Object.keys(result.body), ['message']);
});

// Test case: Requests recovery for unknown and internal-only accounts and checks identical public responses without mail.
test('unknown emails and internal accounts receive the same reset response without mail', async () => {

  let rows = [];
  mock.method(pool, 'query', async () => (// Supplies controlled query behavior for this regression case, including its expected result or failure.

      // Handles this operation using the surrounding screen or request state.
      { rows }));
  const send = mock.method(emailService, 'sendPasswordReset', async () => {
    // Supplies controlled sendPasswordReset behavior for this regression case, including its expected result or failure.
    });

  const first = await request('/api/auth/forgot-password', { body: { email: 'missing@example.com' } });
  rows = [{ ...organiser, role: 'venue_staff' }];
  const second = await request('/api/auth/forgot-password', { body: { email: organiser.email } });

  assert.deepEqual(first, second);
  assert.equal(send.mock.callCount(), 0);
});

// Test case: Simulates email delivery failure and checks token cleanup without disclosing account existence.
test('delivery failure clears its reset token and does not expose account existence', async () => {

  const calls = [];
  mock.method(pool, 'query', async (sql, values) => {
    // Supplies controlled query behavior for this regression case, including its expected result or failure.

    calls.push([sql, values]);
    return { rows: sql.includes('SELECT') ? [organiser] : [{ id: 12 }] };
  });
  mock.method(emailService, 'sendPasswordReset', async () => {
    // Supplies controlled sendPasswordReset behavior for this regression case, including its expected result or failure.

    throw Object.assign(new Error('delivery failed'), { code: 'ECONNECTION' });
  });
  mock.method(console, 'error', () => {
    // Supplies controlled error behavior for this regression case, including its expected result or failure.
    });

  const result = await request('/api/auth/forgot-password', { body: { email: organiser.email } });
  assert.equal(result.status, 200);
  assert.match(calls[2][0], /password_reset_hash = \$2/);
  assert.equal(calls[2][1][1], calls[1][1][1]);
});

// Test case: Uses a valid reset token and checks password hashing, token consumption and session-version advancement.
test('reset atomically consumes an unexpired token, hashes the new password, and invalidates sessions', async () => {

  mock.method(pool, 'query', async (sql, values) => {
    // Supplies controlled query behavior for this regression case, including its expected result or failure.

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

// Test case: Tries expired, used and unknown reset tokens and checks none can change the password.
test('expired, consumed, and unknown reset tokens cannot update a password', async () => {

  mock.method(pool, 'query', async () => (// Supplies controlled query behavior for this regression case, including its expected result or failure.

      // Handles this operation using the surrounding screen or request state.
      { rows: [] }));
  const result = await request('/api/auth/reset-password', {
    body: { token: 'b'.repeat(64), password: 'new-password123' },
  });
  assert.equal(result.status, 400);
});

// Test case: Submits malformed tokens and checks rejection before database queries.
test('malformed reset tokens are rejected before database access', async () => {

  const query = mock.method(pool, 'query', async () => {
    // Supplies controlled query behavior for this regression case, including its expected result or failure.
     throw new Error('Unexpected query'); });
  const result = await request('/api/auth/reset-password', {
    body: { token: 'bad', password: 'new-password123' },
  });
  assert.equal(result.status, 400);
  assert.equal(query.mock.callCount(), 0);
});

// Test case: Presents a JWT from before password reset and checks its old version cannot restore access.
test('a pre-reset JWT cannot restore a session after password reset', async () => {

  mock.method(pool, 'query', async () => (// Supplies controlled query behavior for this regression case, including its expected result or failure.

      // Handles this operation using the surrounding screen or request state.
      { rows: [{ ...organiser, auth_version: 1 }] }));
  const result = await request('/api/auth/me', { method: 'GET', user: organiser });
  assert.equal(result.status, 401);
});

// Test case: Removes Gmail configuration and checks a recovery service error before account lookup.
test('missing Gmail configuration returns a service error without querying accounts', async () => {
  // Verifies that missing email configuration fails independently of account existence.
  mock.method(emailService, 'emailConfig', () => {
    // Simulates missing Gmail credentials without contacting the email provider.
    throw new Error('Gmail requires configuration.');
  });
  const query = mock.method(pool, 'query', async () => {
    // Rejects any unexpected account query when email configuration is unavailable.
    throw new Error('Unexpected query');
  });
  const result = await request('/api/auth/forgot-password', { body: { email: organiser.email } });
  assert.equal(result.status, 503);
  assert.equal(query.mock.callCount(), 0);
  assert.equal(result.body.message, 'Password-reset email is not configured. Please contact support.');
});

// Test case: Captures simulated SMTP mail and checks the token is in the URL fragment and transport closes.
test('Gmail reset emails keep tokens in the URL fragment and close the transport', async () => {

  let closed = false;
  mock.method(nodemailer, 'createTransport', (config) => {
    // Supplies controlled createTransport behavior for this regression case, including its expected result or failure.

    assert.equal(config.host, 'smtp.gmail.com');
    assert.equal(config.port, 465);
    assert.equal(config.secure, true);
    assert.equal(config.auth.user, 'sender@gmail.com');
    assert.equal(config.auth.pass, 'abcdefghijklmnop');
    return {
      sendMail: async (message) => {
        // Checks the expected state or returned value within this regression case.

        assert.equal(message.to, organiser.email);
        assert.equal(message.from, 'Event Portal <sender@gmail.com>');
        assert.match(message.text, /reset-password#token=/);
        assert.ok(message.text.includes('https://events.example.test/external/reset-password#token='));
      },
      close: () => {
        // Provides the controlled return value or asynchronous action needed by this test.
         closed = true; },
    };
  });

  await emailService.sendPasswordReset(organiser.email, 'a'.repeat(64));
  assert.equal(closed, true);
});

// Test case: Checks Gmail configuration requires an app password and encrypted SMTP.
test('Gmail requires app-password configuration and uses encrypted SMTP', () => {
  // Verifies Gmail configuration validation, app-password normalization, and authenticated sender identity.

  const keys = ['GMAIL_USER', 'GMAIL_APP_PASSWORD', 'PUBLIC_APP_URL'];
  const old = keys.map((key) => // Reads each environment value so the test can restore it later.

      // Converts each record into its displayed or submitted representation.
      process.env[key]);
  try {
    for (const key of keys) {
      const value = process.env[key];
      delete process.env[key];
      assert.throws(() => // Verifies that missing Gmail configuration is rejected before sending.

      // Handles this operation using the surrounding screen or request state.
      emailService.emailConfig(), /Gmail requires/);
      process.env[key] = ' ';
      assert.throws(() => // Verifies that blank Gmail configuration is rejected before sending.

      // Handles this operation using the surrounding screen or request state.
      emailService.emailConfig(), /Gmail requires/);
      process.env[key] = value;
    }

    process.env.GMAIL_USER = 'sender@gmail.com';
    process.env.GMAIL_APP_PASSWORD = 'regular-password';
    assert.throws(() => // Rejects ordinary-password shapes instead of attempting SMTP authentication.

      // Handles this operation using the surrounding screen or request state.
      emailService.emailConfig(), /16-character Google app password/);
    process.env.GMAIL_APP_PASSWORD = 'abcd efgh ijkl mnop';
    process.env.PUBLIC_APP_URL = 'https://events.example.com';
    const config = emailService.emailConfig();
    assert.equal(config.transport.host, 'smtp.gmail.com');
    assert.equal(config.transport.secure, true);
    assert.equal(config.transport.auth.user, 'sender@gmail.com');
    assert.equal(config.transport.auth.pass, 'abcdefghijklmnop');
    assert.equal(config.from, 'Event Portal <sender@gmail.com>');
  } finally {
    keys.forEach((key, index) => {
      // Restores each environment variable to its previous test value.

      if (old[index] === undefined) delete process.env[key];
      else process.env[key] = old[index];
    });
  }
});
