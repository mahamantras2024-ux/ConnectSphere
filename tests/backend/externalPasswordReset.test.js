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
  // Records the email instead of asserting inside the mock, so a request that never sends mail fails below.
  const send = mock.method(emailService, 'sendPasswordReset', async () => {});

  const result = await request('/api/auth/forgot-password', { body: { email: organiser.email } });
  assert.equal(result.status, 200);
  assert.deepEqual(Object.keys(result.body), ['message']);
  assert.equal(send.mock.callCount(), 1);
  const [address, rawToken] = send.mock.calls[0].arguments;
  assert.equal(address, organiser.email);
  assert.match(rawToken, /^[a-f0-9]{64}$/);
  // Only the SHA-256 hash of the emailed token is stored, never the token itself.
  assert.notEqual(storedHash, rawToken);
  assert.equal(storedHash, crypto.createHash('sha256').update(rawToken).digest('hex'));
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
  assert.equal(first.status,404);assert.equal(first.body.message,'Account not found. Try again.');
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
  mock.method(emailService, 'sendPasswordChanged', async () => {});

  mock.method(pool, 'query', async (sql, values) => {
    // Supplies controlled query behavior for this regression case, including its expected result or failure.

    assert.match(sql, /password_reset_expires_at > now\(\)/);
    assert.match(sql, /auth_version = auth_version \+ 1/);
    assert.match(sql, /password_reset_hash = NULL/);
    assert.equal(await bcrypt.compare('new-password123', values[1]), true);
    return { rows: [{ id: 12, email: organiser.email }] };
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
  const sent = [];
  mock.method(nodemailer, 'createTransport', (config) => {
    // Supplies controlled createTransport behavior for this regression case, including its expected result or failure.

    assert.equal(config.host, 'smtp.gmail.com');
    assert.equal(config.port, 465);
    assert.equal(config.secure, true);
    assert.equal(config.auth.user, 'sender@gmail.com');
    assert.equal(config.auth.pass, 'abcdefghijklmnop');
    return {
      // Records the message; assertions run after the call so a missing sendMail fails the test.
      sendMail: async (message) => { sent.push(message); },
      close: () => {
        // Provides the controlled return value or asynchronous action needed by this test.
         closed = true; },
    };
  });

  await emailService.sendPasswordReset(organiser.email, 'a'.repeat(64));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, organiser.email);
  assert.equal(sent[0].from, 'Event Portal <sender@gmail.com>');
  assert.ok(sent[0].text.includes(`https://events.example.test/external/reset-password#token=${'a'.repeat(64)}`));
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

// Internal recovery AC1 AC2: every provisioned staff role receives a hashed one-time link at its stored email.
for (const role of ['event_coordinator','event_coordinator_lead','venue_staff','technical_support','safety_officer']) {
  test(`Internal recovery AC1 AC2 - ${role} receives recovery at stored work email`, async () => {
    let storedHash;
    mock.method(pool,'query',async(sql,values)=>{
      if(sql.includes('SELECT')) { assert.deepEqual(values,['work@example.test']); return {rows:[{...organiser,email:'work@example.test',role}]}; }
      assert.match(sql,/event_coordinator_lead/); assert.match(sql,/ARRAY\['event_coordinator'/); assert.match(sql,/15 minutes/); storedHash=values[1]; return {rows:[{id:12}]};
    });
    const send=mock.method(emailService,'sendPasswordReset',async(address,raw,internal)=>{
      assert.equal(address,'work@example.test'); assert.equal(internal,true);
      assert.equal(storedHash,crypto.createHash('sha256').update(raw).digest('hex'));
    });
    const result=await request('/api/auth/internal/forgot-password',{body:{email:' WORK@example.test '}});
    assert.equal(result.status,200); assert.equal(send.mock.callCount(),1);
  });
}
// Internal recovery AC2: unknown or external-only identities receive the requested correction message.
test('Internal recovery AC2 - unknown and external-only accounts receive identical responses without mail',async()=>{
  const query=mock.method(pool,'query',async()=>({rows:[]}));
  const send=mock.method(emailService,'sendPasswordReset',async()=>assert.fail('No eligible account'));
  const missing=await request('/api/auth/internal/forgot-password',{body:{email:'missing@example.test'}});
  query.mock.mockImplementation(async()=>({rows:[organiser]}));
  const external=await request('/api/auth/internal/forgot-password',{body:{email:organiser.email}});
  assert.deepEqual(missing,external); assert.equal(missing.status,404);assert.equal(missing.body.message,'Account not found. Try again.'); assert.equal(send.mock.callCount(),0);
});
// Internal recovery AC3: token consumption retains expiry, one-use and session invalidation guards.
test('Internal recovery AC3 - staff reset hashes password and consumes token with session revocation',async()=>{
  mock.method(emailService, 'sendPasswordChanged', async () => {});
  mock.method(pool,'query',async(sql,values)=>{
    assert.match(sql,/event_coordinator_lead/); assert.match(sql,/password_reset_expires_at > now/);
    assert.match(sql,/auth_version = auth_version \+ 1/); assert.match(sql,/password_reset_hash = NULL/);
    assert.equal(await bcrypt.compare('new-password123',values[1]),true); return {rows:[{id:12,email:'staff@example.test'}]};
  });
  assert.equal((await request('/api/auth/internal/reset-password',{body:{token:'a'.repeat(64),password:'new-password123'}})).status,200);
});
// Internal recovery AC2: emailed staff links must reach the staff recovery page, with secret in fragment.
test('Internal recovery AC2 - staff link targets internal reset page',()=>{
  const url=new URL(emailService.resetUrl('a'.repeat(64),true));
  assert.equal(url.pathname,'/reset-password'); assert.equal(url.search,''); assert.equal(url.hash,'#token='+ 'a'.repeat(64),true);
});

// Internal recovery AC2: secondary provisioned staff roles are eligible without changing the primary role.
test('Internal recovery AC2 - secondary staff role receives reset link',async()=>{
  mock.method(pool,'query',async sql=>({rows:sql.includes('SELECT')?[{...organiser,roles:['event_coordinator']}]:[{id:12}]}));
  const send=mock.method(emailService,'sendPasswordReset',async()=>{});
  assert.equal((await request('/api/auth/internal/forgot-password',{body:{email:organiser.email}})).status,200);
  assert.equal(send.mock.callCount(),1);
});
// Internal recovery AC3: invalid/expired tokens remain errors on the staff endpoint.
test('Internal recovery AC3 - unavailable staff reset token cannot change password',async()=>{
  const query=mock.method(pool,'query',async()=>({rows:[]}));
  assert.equal((await request('/api/auth/internal/reset-password',{body:{token:'a'.repeat(64),password:'new-password123'}})).status,400);
  assert.equal(query.mock.callCount(),1);
});

// Internal recovery AC2: keep real message construction; mock only the SMTP transport boundary.
test('Internal recovery AC2 - SMTP message delivers internal link to recorded work email and closes transport',async()=>{
  let delivered,closed=false;
  mock.method(nodemailer,'createTransport',()=>({sendMail:async message=>{delivered=message;},close:()=>{closed=true;}}));
  await emailService.sendPasswordReset('staff@example.test','a'.repeat(64),true);
  assert.equal(delivered.to,'staff@example.test');
  assert.ok(delivered.text.includes('https://events.example.test/reset-password#token='+ 'a'.repeat(64)));
  assert.equal(delivered.text.includes('/external/'),false); assert.equal(closed,true);
});

// Internal recovery AC2: staff reset links respect the existing URL transport rules.
for(const [appUrl,environment,allowed] of [['ftp://events.example.test','test',false],['http://events.example.test','production',false],['https://events.example.test','production',true],['http://localhost:5173','test',true]]) {
  test(`Internal recovery AC2 - ${environment} link transport ${appUrl}`,()=>{
    const previousUrl=process.env.PUBLIC_APP_URL,previousEnvironment=process.env.NODE_ENV;
    try {
      process.env.PUBLIC_APP_URL=appUrl;process.env.NODE_ENV=environment;
      if(allowed) assert.equal(new URL(emailService.resetUrl('token',true)).pathname,'/reset-password');
      else assert.throws(()=>emailService.resetUrl('token',true),/HTTPS/);
    } finally {process.env.PUBLIC_APP_URL=previousUrl;process.env.NODE_ENV=previousEnvironment;}
  });
}
