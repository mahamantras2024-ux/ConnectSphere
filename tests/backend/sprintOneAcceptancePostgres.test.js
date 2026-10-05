// File: Verifies the PDF's Sprint 1 acceptance criteria against actual PostgreSQL in a disposable schema.
// Test scope: Uses real PostgreSQL in a disposable schema; shared application records remain untouched.
require('../../backend/node_modules/dotenv').config();
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('../../backend/node_modules/bcryptjs');
const { pool } = require('../../backend/src/config/db');
const { provisionAccount } = require('../../backend/src/db/provisionAccount');

// Test case: Exercises the six Sprint 1 stories against isolated PostgreSQL records, including signup, single-role staff, venues and private reads.
test('PDF Sprint 1 acceptance: registration, single-role staff, venue persistence and private event access', { skip: process.env.RUN_DB_TESTS !== '1' }, async t => {
  const schema = `cs_acceptance_${randomBytes(8).toString('hex')}`;
  const client = await pool.connect();
  let server;
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, full_name VARCHAR(255), password_hash VARCHAR(255), role VARCHAR(50), organisation_name VARCHAR(255), auth_version INTEGER NOT NULL DEFAULT 0)`);
    await client.query(`CREATE TABLE venues (id SERIAL PRIMARY KEY, name VARCHAR(255), location VARCHAR(255), capacity INTEGER, supported_layouts TEXT[], accessibility_features TEXT[], facilities TEXT[], operating_hours VARCHAR(255), availability_status VARCHAR(50), pricing VARCHAR(255), mrt VARCHAR(255), image TEXT)`);
    for (const file of ['migrations/001-external-events.sql', 'sprintOneSchema.sql', 'venueManagementSchema.sql']) {
      await client.query(fs.readFileSync(path.join(__dirname, '../../backend/src/db', file), 'utf8'));
    }
    mock.method(pool, 'query', (sql, values) => client.query(sql, values));
    const app = require('../../backend/src/index');
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    // Calls the local API without changing any record in the shared public schema.
    async function request(endpoint, body, token) {
      const res = await fetch(base + endpoint, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: res.status, body: await res.json() };
    }
    const password = 'acceptance-password123';
    const accounts = {}, sessions = {};
    // Test case: Tries mismatched confirmation and duplicate email and checks invalid registration cannot replace stored credentials.
    await t.test('external accounts require matching confirmation and reject duplicate email without changing credentials', async () => {
      for (const role of ['event_organiser', 'attendee']) {
        const body = { fullName: role, email: `${role}@example.test`, password, confirmation: password, role, organisationName: 'Same organisation' };
        for (const invalid of [{ confirmation: undefined }, { confirmation: 'mismatch' }, { email: 'invalid' }, { fullName: '' }, { password: '' }]) assert.equal((await request('/auth/register', { ...body, ...invalid })).status, 400);
        const created = await request('/auth/register', body);
        assert.equal(created.status, 201); assert.match(created.body.message, /sign in/i);
        accounts[role] = created.body.user;
        const row = (await client.query('SELECT * FROM users WHERE id=$1', [created.body.user.id])).rows[0];
        assert.notEqual(row.password_hash, password); assert.equal(await bcrypt.compare(password, row.password_hash), true);
        assert.equal((await request('/auth/register', { ...body, email: body.email.toUpperCase() })).status, 409);
        assert.equal((await client.query('SELECT count(*)::int AS n FROM users WHERE email=$1', [body.email])).rows[0].n, 1);
      }
    });
    // Test case: Provisions single-role internal accounts and checks public signup cannot grant staff roles.
    await t.test('each internally provisioned account has one role; public signup cannot provision staff', async () => {
      for (const role of ['venue_staff', 'event_coordinator', 'technical_support']) {
        accounts[role] = await provisionAccount({ email: `${role}@example.test`, fullName: role, password, roles: [role] });
        assert.deepEqual(accounts[role].roles, [role]);
        assert.equal((await request('/auth/register', { fullName: 'Intruder', email: 'intruder@example.test', password, confirmation: password, role })).status, 400);
      }
    });
    // Test case: Authenticates all five Sprint 1 roles using real hashes and checks invalid credentials are rejected.
    await t.test('all five roles authenticate with hashed credentials and invalid credentials fail', async () => {
      for (const [role, account] of Object.entries(accounts)) {
        const credentials = { email: account.email.toUpperCase(), password, audience: ['attendee','event_organiser'].includes(role) ? 'external' : 'internal' };
        const login = await request('/auth/login', credentials);
        assert.equal(login.status, 200); assert.equal(login.body.user.role, role);
        sessions[role] = login.body.token;
        assert.equal((await request('/auth/login', { ...credentials, password: 'incorrect' })).status, 401);
        assert.equal((await request('/auth/switch-role', { role: role === 'venue_staff' ? 'event_coordinator' : 'venue_staff' }, login.body.token)).status, 403);
      }
    });
    const venue = { name: 'Acceptance Hall', location: 'Stamford Road, Singapore', capacity: 120, facilities: ['Projector','Wi-Fi'], accessibilityFeatures: ['Ramp'], supportedLayouts: ['Theatre'], operatingHours: '08:00 - 18:00', pricing: '75.50' };
    let venueId;
    // Test case: Creates a complete venue as Venue Staff and checks other roles and missing fields cannot save.
    await t.test('only Venue Staff can create a complete venue and invalid required fields do not save', async () => {
      for (const [role, session] of Object.entries(sessions)) if (role !== 'venue_staff') assert.equal((await request('/venues', venue, session)).status, 403);
      for (const field of ['name','location','capacity','facilities','accessibilityFeatures','supportedLayouts','operatingHours']) assert.equal((await request('/venues', { ...venue, [field]: undefined }, sessions.venue_staff)).status, 400);
      for (const invalid of [{ capacity: 0 }, { capacity: 1.5 }, { operatingHours: '18:00 - 08:00' }]) assert.equal((await request('/venues', { ...venue, ...invalid }, sessions.venue_staff)).status, 400);
      assert.equal((await client.query('SELECT count(*)::int AS n FROM venues')).rows[0].n, 0);
      const created = await request('/venues', venue, sessions.venue_staff);
      assert.equal(created.status, 201); venueId = created.body.venue.id;
    });
    // Test case: Reads catalogue/profile records and checks all required and optional fields survive persistence.
    await t.test('catalogue and profile return every saved required and optional venue detail', async () => {
      const catalogue = await request('/venues'); assert.equal(catalogue.status, 200); assert.equal(catalogue.body[0].id, venueId);
      const detail = await request(`/venues/${venueId}`); assert.equal(detail.status, 200);
      for (const [key, value] of Object.entries({ name: venue.name, location: venue.location, capacity: 120, facilities: venue.facilities, accessibility_features: venue.accessibilityFeatures, supported_layouts: venue.supportedLayouts, operating_hours: venue.operatingHours, pricing: '75.50' })) assert.deepEqual(detail.body[key], value);
      assert.equal((await request('/venues/999999')).status, 404);
    });
    const otherOrganiser = await provisionAccount({ email: 'other-organiser@example.test', fullName: 'Other organiser', password, roles: ['event_organiser'], organisationName: 'Same organisation' });
    const otherAttendee = await provisionAccount({ email: 'other-attendee@example.test', fullName: 'Other attendee', password, roles: ['attendee'] });
    const otherCoordinator = await provisionAccount({ email: 'other-coordinator@example.test', fullName: 'Other coordinator', password, roles: ['event_coordinator'] });
    const details = { name: 'Complete submitted event', purpose: 'Acceptance verification', proposedDate: '2030-10-15', proposedStartTime: '09:00', proposedEndTime: '12:00', expectedAttendance: 50, programmeDetails: 'Welcome and workshop', roomLayoutPreference: 'Theatre', accessibilityRequirements: ['Ramp'], equipmentNotes: 'Two microphones', registrationRequired: true, registrationCapacity: 50, specialArrangements: 'Vegetarian lunch' };
    const created = await request('/events', details, sessions.event_organiser);
    assert.equal(created.status, 201); const eventId = created.body.event.id;
    await client.query('UPDATE events SET coordinator_id=$1 WHERE id=$2', [accounts.event_coordinator.id, eventId]);
    // Test case: Reads organiser-owned and coordinator-assigned events and checks complete details and denial of unrelated records.
    await t.test('organiser and assigned coordinator see all submitted details and only their own lists', async () => {
      for (const role of ['event_organiser','event_coordinator']) {
        const result = await request(`/events/${eventId}`, null, sessions[role]); assert.equal(result.status, 200);
        for (const [key,value] of Object.entries({ purpose: details.purpose, proposed_date: details.proposedDate, expected_attendance: 50, programme_details: details.programmeDetails, room_layout_preference: 'Theatre', accessibility_requirements: ['Ramp'], equipment_notes: details.equipmentNotes, registration_required: true, registration_capacity: 50, special_arrangements: details.specialArrangements })) assert.deepEqual(result.body.event[key], value);
        assert.equal((await request('/events', null, sessions[role])).body.events.length, 1);
      }
      for (const account of [otherOrganiser, otherCoordinator]) {
        const login = await request('/auth/login', { email: account.email, password });
        assert.equal((await request(`/events/${eventId}`, null, login.body.token)).status, 404);
        assert.equal((await request('/events?organiser_id=' + accounts.event_organiser.id, null, login.body.token)).body.events.length, 0);
      }
      for (const role of ['venue_staff','technical_support','attendee']) assert.equal((await request(`/events/${eventId}`, null, sessions[role])).status, 403);
    });
    // Test case: Supplies a forged attendee parameter and checks registration summaries still belong only to the session owner.
    await t.test('attendee summaries are private even when another attendee ID is supplied', async () => {
      await client.query("INSERT INTO registrations (event_id,attendee_id,status) VALUES ($1,$2,'registered'),($1,$3,'waitlisted')", [eventId, accounts.attendee.id, otherAttendee.id]);
      const mine = await request(`/registrations/mine?attendee_id=${otherAttendee.id}`, null, sessions.attendee);
      assert.equal(mine.status, 200); assert.equal(mine.body.registrations.length, 1); assert.equal(mine.body.registrations[0].status, 'registered');
      for (const role of ['event_organiser','event_coordinator','venue_staff','technical_support']) assert.equal((await request('/registrations/mine', null, sessions[role])).status, 403);
    });
  } finally {
    mock.restoreAll();
    if (server) await new Promise(resolve => server.close(resolve));
    await client.query('ROLLBACK'); await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    client.release(); await pool.end();
  }
});
