// File: Runs Sprint 1 role, venue-buffer, and attendee-summary integration checks in a disposable PostgreSQL schema.
// Test scope: Uses real PostgreSQL in a disposable schema; shared application records remain untouched.
require('../../backend/node_modules/dotenv').config();
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../../backend/src/config/db');
const { provisionAccount } = require('../../backend/src/db/provisionAccount');
// Test case: Uses real isolated records to check role switching, venue buffers, attendee-only registration reads and access rejection after role revocation.
test('Sprint 1 persists roles, venue buffers and personal registrations in real PostgreSQL', { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
  // Uses a unique schema so no live account, event, venue or registration is modified.
  const schema = `cs_sprint_one_${crypto.randomBytes(8).toString('hex')}`;
  const client = await pool.connect(); let server;
  try {
    await client.query(`CREATE SCHEMA ${schema}`); await client.query(`SET search_path TO ${schema}`);
    await client.query(`CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, full_name VARCHAR(255), password_hash VARCHAR(255), role VARCHAR(50), organisation_name VARCHAR(255), auth_version INTEGER NOT NULL DEFAULT 0)`);
    await client.query(`CREATE TABLE venues (id SERIAL PRIMARY KEY, name VARCHAR(255), location VARCHAR(255), capacity INTEGER, supported_layouts TEXT[], accessibility_features TEXT[], facilities TEXT[], operating_hours VARCHAR(255), availability_status VARCHAR(50), pricing VARCHAR(255), mrt VARCHAR(255), image TEXT)`);
    await client.query(fs.readFileSync(path.join(__dirname, '../../backend/src/db/migrations/001-external-events.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, '../../backend/src/db/sprintOneSchema.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, '../../backend/src/db/venueManagementSchema.sql'), 'utf8'));
    mock.method(pool, 'query', (sql, values) =>
      // Handles this operation using the surrounding screen or request state.
      client.query(sql, values));
    const account = await provisionAccount({ email: 'multi@example.test', fullName: 'Test User', password: 'password123', roles: ['venue_staff', 'attendee', 'event_coordinator_lead', 'safety_officer'] });
    const other = await provisionAccount({ email: 'other@example.test', fullName: 'Other User', password: 'password123', roles: ['attendee'] });
    const app = require('../../backend/src/index'); server = app.listen(0, '127.0.0.1'); await new Promise(resolve =>
      // Handles this operation using the surrounding screen or request state.
      server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    // Exercises the local HTTP API backed by the isolated real database connection.
    async function request(url, body, token) { const res = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: res.status, body: await res.json() }; }
    const login = await request('/api/auth/login', { email: account.email, password: 'password123', audience: 'internal' });
    assert.equal(login.status, 200);
    const created = await request('/api/venues', { name: 'Real Test Hall', location: 'Marina', capacity: 80, facilities: ['Wi-Fi'], accessibilityFeatures: ['Ramp'], supportedLayouts: ['Theatre'], operatingHours: '09:00 - 18:00', setupMinutes: 30, turnaroundMinutes: 45 }, login.body.token);
    assert.equal(created.status, 201); assert.equal(created.body.venue.setup_minutes, 30); assert.equal(created.body.venue.turnaround_minutes, 45);
    const catalogue = await request('/api/venues'); assert.equal(catalogue.body[0].name, 'Real Test Hall');
    const event = await client.query("INSERT INTO events (organiser_id, name) VALUES ($1, 'Private Workshop') RETURNING id", [account.id]);
    await client.query("INSERT INTO registrations (event_id, attendee_id, status) VALUES ($1,$2,'registered'),($1,$3,'waitlisted')", [event.rows[0].id, account.id, other.id]);
    const switched = await request('/api/auth/switch-role', { role: 'attendee' }, login.body.token); assert.equal(switched.status, 200);
    const mine = await request('/api/registrations/mine?attendee_id=' + other.id, null, switched.body.token);
    assert.equal(mine.status, 200); assert.equal(mine.body.registrations.length, 1); assert.equal(mine.body.registrations[0].status, 'registered');
    assert.equal((await request('/api/venues', { name: 'Forbidden Hall' }, switched.body.token)).status, 403);
    const safety = await request('/api/auth/switch-role', { role: 'safety_officer' }, switched.body.token); assert.equal(safety.status, 200);
    assert.equal((await request('/api/auth/me', null, safety.body.token)).body.user.role, 'safety_officer');
    await client.query("UPDATE users SET roles = array_remove(roles, 'safety_officer') WHERE id=$1", [account.id]);
    assert.equal((await request('/api/auth/me', null, safety.body.token)).status, 401);
    const verified = await client.query(`SELECT count(*)::integer AS n FROM ${schema}.venues`); assert.equal(verified.rows[0].n, 1);
  } finally {
    mock.restoreAll(); if (server) await new Promise(resolve =>
      // Handles this operation using the surrounding screen or request state.
      server.close(resolve));
    await client.query('ROLLBACK'); await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); client.release(); await pool.end();
  }
});
