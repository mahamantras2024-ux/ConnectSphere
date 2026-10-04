// File: Runs opt-in real PostgreSQL event/migration/reset integration checks inside an isolated temporary schema.
// Opt-in integration test: all records live in a random temporary schema.
require('../../backend/node_modules/dotenv').config();
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pool } = require('../../backend/src/config/db');
const emailService = require('../../backend/src/services/emailService');
const { provisionAccount } = require('../../backend/src/db/provisionAccount');

test('PostgreSQL event ownership, additive migration and password reset', { skip: process.env.RUN_DB_TESTS !== '1' }, async (t) => {
  // Verifies: PostgreSQL event ownership, additive migration and password reset.

  const schema = `cs_event_test_${crypto.randomBytes(8).toString('hex')}`;
  const client = await pool.connect();
  let server;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    // Match the existing startup users table, which has no updated_at column.
    await client.query(`CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL, full_name VARCHAR(255) NOT NULL,
      role VARCHAR(50), roles TEXT[] NOT NULL DEFAULT '{}', organisation_name VARCHAR(255), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
    const migration = fs.readFileSync(path.join(__dirname, '../../backend/src/db/migrations/001-external-events.sql'), 'utf8');
    await client.query(migration);
    mock.method(pool, 'query', (sql, values) => // Supplies controlled query behavior for this regression case, including its expected result or failure.

      // Handles this operation using the surrounding screen or request state.
      client.query(sql, values));
    const app = require('../../backend/src/index');
    await new Promise((resolve, reject) => {
      // Starts a local test HTTP server and resolves/rejects on startup.
       server = app.listen(0, '127.0.0.1', resolve); server.on('error', reject); });
    const base = `http://127.0.0.1:${server.address().port}`;
    // Calls the local test HTTP server with the requested payload/session and returns status plus JSON.
    async function request(endpoint, { method = 'GET', body, token } = {}) {
      const res = await fetch(base + endpoint, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, body: await res.json() };
    }
    const credentials = (name) => (// Builds external organiser test credentials with a shared organisation label.

      // Runs credentials for this module.
      { email: `${name}@example.test`, password: 'password123', fullName: name, role: 'event_organiser', organisationName: 'Same organisation label' });
    let aliceToken, bobToken, eventId;
    await t.test('provision and log in two external organisers in the real database', async () => {
      // Verifies private onboarding and login of real isolated PostgreSQL accounts.

      for (const name of ['alice', 'bob']) {
        const user = await provisionAccount({ ...credentials(name), roles: ['event_organiser'] });
        assert.ok(user.id);
      }
      aliceToken = (await request('/api/auth/login', { method: 'POST', body: { ...credentials('alice'), audience: 'external' } })).body.token;
      bobToken = (await request('/api/auth/login', { method: 'POST', body: { ...credentials('bob'), audience: 'external' } })).body.token;
      assert.ok(aliceToken); assert.ok(bobToken);
    });
    await t.test('save and read all submitted fields without changing owner from request input', async () => {
      // Verifies: save and read all submitted fields without changing owner from request input.

      const created = await request('/api/events', { method: 'POST', token: aliceToken, body: { name: 'SQL round trip',
        purpose: 'Verify persistence', proposedDate: '2026-10-15', proposedStartTime: '09:00', proposedEndTime: '12:00',
        expectedAttendance: 0, programmeDetails: 'Welcome\nWorkshop', roomLayoutPreference: 'classroom', accessibilityRequirements: ['Hearing loop'],
        equipmentNotes: 'Microphone', registrationRequired: false, registrationCapacity: 0, specialArrangements: 'Vegetarian lunch', organiserId: 2 } });
      assert.equal(created.status, 201); eventId = created.body.event.id;
      assert.equal(created.body.event.organiser_id, 1); assert.equal(created.body.event.status, 'submitted');
      const viewed = await request(`/api/events/${eventId}`, { token: aliceToken });
      assert.equal(viewed.status, 200); assert.equal(viewed.body.event.programme_details, 'Welcome\nWorkshop');
      assert.equal(viewed.body.event.special_arrangements, 'Vegetarian lunch'); assert.equal(viewed.body.event.proposed_date, '2026-10-15');
      assert.deepEqual(viewed.body.event.accessibility_requirements, ['Hearing loop']); assert.equal(viewed.body.event.organiser_name, 'alice');
      assert.equal(viewed.body.event.registration_required, false); assert.equal(viewed.body.event.expected_attendance, 0);
    });
    await t.test('same organisation name does not grant access to another organiser', async () => {
      // Verifies: same organisation name does not grant access to another organiser.

      assert.equal((await request(`/api/events/${eventId}`, { token: bobToken })).status, 404);
      assert.deepEqual((await request('/api/events?organiser_id=1', { token: bobToken })).body.events, []);
      assert.equal((await request(`/api/events/${eventId}`)).status, 401);
      assert.equal((await request('/api/events/999999', { token: aliceToken })).status, 404);
    });
    await t.test('migration is repeatable and preserves saved event content', async () => {
      // Verifies: migration is repeatable and preserves saved event content.

      await client.query(migration);
      assert.equal((await request(`/api/events/${eventId}`, { token: aliceToken })).body.event.special_arrangements, 'Vegetarian lunch');
    });
    let rawToken;
    mock.method(emailService, 'emailConfig', () => (// Supplies controlled emailConfig behavior for this regression case, including its expected result or failure.

      // Handles this operation using the surrounding screen or request state.
      {}));
    mock.method(emailService, 'sendPasswordReset', async (_to, token) => {
      // Supplies controlled sendPasswordReset behavior for this regression case, including its expected result or failure.
       rawToken = token; });
    await t.test('expired reset links fail in PostgreSQL', async () => {
      // Verifies: expired reset links fail in PostgreSQL.

      await request('/api/auth/forgot-password', { method: 'POST', body: { email: 'alice@example.test' } });
      assert.ok(rawToken);
      await client.query("UPDATE users SET password_reset_expires_at = now() - interval '1 second' WHERE id = 1");
      assert.equal((await request('/api/auth/reset-password', { method: 'POST', body: { token: rawToken, password: 'changed-password123' } })).status, 400);
    });
    await t.test('reset token is single-use under simultaneous requests and invalidates old sessions', async () => {
      // Verifies: reset token is single-use under simultaneous requests and invalidates old sessions.

      await request('/api/auth/forgot-password', { method: 'POST', body: { email: 'alice@example.test' } });
      const results = await Promise.all([1, 2].map(() => // Starts each reset request to check simultaneous token consumption.

      // Converts each record into its displayed or submitted representation.
      request('/api/auth/reset-password', { method: 'POST', body: { token: rawToken, password: 'changed-password123' } })));
      assert.deepEqual(results.map((result) => // Extracts response statuses for the concurrent password-reset assertion.

      // Converts each record into its displayed or submitted representation.
      result.status).sort(), [200, 400]);
      assert.equal((await request('/api/auth/me', { token: aliceToken })).status, 401);
      assert.equal((await request('/api/auth/login', { method: 'POST', body: credentials('alice') })).status, 401);
      assert.equal((await request('/api/auth/login', { method: 'POST', body: { email: 'alice@example.test', password: 'changed-password123' } })).status, 200);
      assert.equal((await request('/api/auth/me', { token: bobToken })).status, 200);
    });
  } finally {
    mock.restoreAll();
    if (server?.listening) await new Promise((resolve) => // Resolves when the test HTTP server finishes closing.

      // Handles this operation using the surrounding screen or request state.
      server.close(resolve));
    await client.query('ROLLBACK');
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    client.release(); await pool.end();
  }
});
