require('dotenv').config();
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const { pool } = require('../src/config/db');

test('login API authenticates users and enforces external audience rules', {
  skip: process.env.RUN_DB_TESTS !== '1',
}, async (t) => {
  const schema = `cs_login_test_${crypto.randomBytes(8).toString('hex')}`;
  const client = await pool.connect();
  let server;

  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`CREATE TABLE users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      auth_version INTEGER NOT NULL DEFAULT 0,
      full_name VARCHAR(255) NOT NULL,
      role VARCHAR(50) NOT NULL
    )`);

    const passwordHash = await bcrypt.hash('password123', 10);
    const users = [
      ['organiser@example.test', 'Test Organiser', 'event_organiser'],
      ['coordinator@example.test', 'Test Coordinator', 'event_coordinator'],
      ['attendee@example.test', 'Test Attendee', 'attendee'],
      ['venue@example.test', 'Test Venue Staff', 'venue_staff'],
      ['support@example.test', 'Test Technical Support', 'technical_support'],
    ];
    for (const [email, fullName, role] of users) {
      await client.query(
        'INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, $4)',
        [email, passwordHash, fullName, role],
      );
    }

    mock.method(pool, 'query', (sql, values) => client.query(sql, values));
    const app = require('../src/index');
    await new Promise((resolve, reject) => {
      server = app.listen(0, '127.0.0.1', resolve);
      server.on('error', reject);
    });

    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(body) {
      const response = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    }

    for (const [index, [email, fullName, role]] of users.entries()) {
      await t.test(`returns a token for valid ${role} credentials`, async () => {
        const isExternal = ['event_organiser', 'attendee'].includes(role);
        const result = await request({
          email: email.toUpperCase(),
          password: 'password123',
          ...(isExternal ? { audience: 'external' } : {}),
        });

        assert.equal(result.status, 200);
        assert.ok(result.body.token);
        assert.deepEqual(result.body.user, {
          id: index + 1,
          email,
          full_name: fullName,
          role,
        });
      });
    }

    await t.test('rejects invalid credentials without revealing the account state', async () => {
      const result = await request({ email: 'organiser@example.test', password: 'wrong-password' });

      assert.equal(result.status, 401);
      assert.deepEqual(result.body, { message: 'Invalid email or password.' });
    });

    await t.test('rejects staff accounts for external audience login', async () => {
      const result = await request({
        email: 'coordinator@example.test',
        password: 'password123',
        audience: 'external',
      });

      assert.equal(result.status, 401);
      assert.deepEqual(result.body, { message: 'Invalid email or password.' });
    });
  } finally {
    mock.restoreAll();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await client.query('ROLLBACK');
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    client.release();
    await pool.end();
  }
});