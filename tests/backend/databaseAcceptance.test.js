// File: Real PostgreSQL acceptance, ownership, schema and session checks in disposable schemas.
// Test scope: Shared scenarios are sequential; each describe block owns its fixtures and hooks.
const {describe,after}=require('node:test');
// Load backend/.env before the shared pool is created: the pool reads its connection settings once, at require time.
require('../../backend/node_modules/dotenv').config();
const sharedPool=require('../../backend/src/config/db').pool;
// Closes the shared pool once, after all grouped fixtures have finished.
after(()=>sharedPool.end());

// Group: sprintOneAcceptancePostgres - retained checks with independent fixture ownership.
describe('sprintOneAcceptancePostgres',{concurrency:false},()=>{
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
    for (const file of ['migrations/001-external-events.sql', 'sprintOneSchema.sql', 'venueManagementSchema.sql', 'migrations/002-event-change-requests.sql', 'migrations/003-event-clarifications.sql', 'migrations/004-event-equipment-requirements.sql']) {
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
    await t.test('External AC1-3 - external accounts require matching confirmation and reject duplicate email without changing credentials', async () => {
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
    await t.test('Internal AC1 - each internally provisioned account has one role; public signup cannot provision staff', async () => {
      for (const role of ['venue_staff', 'event_coordinator', 'technical_support']) {
        accounts[role] = await provisionAccount({ email: `${role}@example.test`, fullName: role, password, roles: [role] });
        assert.deepEqual(accounts[role].roles, [role]);
        assert.equal((await request('/auth/register', { fullName: 'Intruder', email: 'intruder@example.test', password, confirmation: password, role })).status, 400);
      }
    });
    // Test case: Authenticates all five Sprint 1 roles using real hashes and checks invalid credentials are rejected.
    await t.test('Internal AC2/AC5 / External AC5 - all five roles authenticate with hashed credentials and invalid credentials fail', async () => {
      for (const [role, account] of Object.entries(accounts)) {
        const credentials = { email: account.email.toUpperCase(), password, audience: ['attendee','event_organiser'].includes(role) ? 'external' : 'internal' };
        const login = await request('/auth/login', credentials);
        assert.equal(login.status, 200);
        assert.deepEqual(login.body.user,{id:account.id,email:account.email,full_name:role,role,roles:[role]});
        assert.ok(login.body.token);
        sessions[role] = login.body.token;
        const invalid=await request('/auth/login', { ...credentials, password: 'incorrect' });
        assert.equal(invalid.status,401);assert.deepEqual(invalid.body,{message:'Invalid email or password.'});
        assert.equal((await request('/auth/switch-role', { role: role === 'venue_staff' ? 'event_coordinator' : 'venue_staff' }, login.body.token)).status, 403);
      }
    });
    // Test case: Uses real staff credentials through external login and checks no session is issued; retained from the removed duplicate database login suite.
    await t.test('Internal AC4 / External AC5 - external login refuses internal-only staff credentials',async()=>{
      const account=accounts.event_coordinator;
      const result=await request('/auth/login',{email:account.email,password,audience:'external'});
      assert.equal(result.status,401);assert.deepEqual(result.body,{message:'Invalid email or password.'});
    });
    const venue = { name: 'Acceptance Hall', location: 'Stamford Road, Singapore', capacity: 120, facilities: ['Projector','Wi-Fi'], accessibilityFeatures: ['Ramp'], supportedLayouts: ['Theatre'], operatingHours: '08:00 - 18:00', pricing: '75.50' };
    let venueId;
    // Test case: Creates a complete venue as Venue Staff and checks other roles and missing fields cannot save.
    await t.test('Create venue AC1/AC2/AC4 - only Venue Staff can create a complete venue and invalid required fields do not save', async () => {
      for (const [role, session] of Object.entries(sessions)) if (role !== 'venue_staff') assert.equal((await request('/venues', venue, session)).status, 403);
      for (const field of ['name','location','capacity','facilities','accessibilityFeatures','supportedLayouts','operatingHours']) assert.equal((await request('/venues', { ...venue, [field]: undefined }, sessions.venue_staff)).status, 400);
      for (const invalid of [{ capacity: 0 }, { capacity: 1.5 }, { operatingHours: '18:00 - 08:00' }]) assert.equal((await request('/venues', { ...venue, ...invalid }, sessions.venue_staff)).status, 400);
      assert.equal((await client.query('SELECT count(*)::int AS n FROM venues')).rows[0].n, 0);
      const created = await request('/venues', venue, sessions.venue_staff);
      assert.equal(created.status, 201); venueId = created.body.venue.id;
    });
    // Test case: Reads catalogue/profile records and checks all required and optional fields survive persistence.
    await t.test('View venue AC1/AC2 - catalogue and profile return every saved required and optional venue detail', async () => {
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
    await t.test('Organiser AC1-3 / Coordinator AC1-3 - organiser and assigned coordinator see all submitted details and only their own lists', async () => {
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
    await t.test('External AC7/AC8 - attendee summaries are private even when another attendee ID is supplied', async () => {
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
    client.release(); 
  }
});

});

// Group: sprintOnePostgres - retained checks with independent fixture ownership.
describe('sprintOnePostgres',{concurrency:false},()=>{
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
    await client.query(fs.readFileSync(path.join(__dirname, '../../backend/src/db/migrations/002-event-change-requests.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, '../../backend/src/db/migrations/003-event-clarifications.sql'), 'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname, '../../backend/src/db/migrations/004-event-equipment-requirements.sql'), 'utf8'));
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
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); client.release(); 
  }
});

});

// Group: postgresEvents - retained checks with independent fixture ownership.
describe('postgresEvents',{concurrency:false},()=>{
// File: Runs opt-in real PostgreSQL event/migration/reset integration checks inside an isolated temporary schema.
// Test scope: Uses real handlers/services with controlled database/email/provider boundaries where configured.
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

// Test case: Exercises organiser ownership, repeatable migrations and password reset using an isolated real PostgreSQL schema.
test('PostgreSQL event ownership, additive migration and password reset', { skip: process.env.RUN_DB_TESTS !== '1' }, async (t) => {

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
    // Event detail now checks approved venue bookings and outstanding clarification requests.
    // Build those related tables in this disposable schema just as production migrations do.
    await client.query('CREATE TABLE venues (id SERIAL PRIMARY KEY)');
    for (const file of [
      'migrations/001-external-events.sql',
      'migrations/002-event-change-requests.sql',
      'migrations/003-event-clarifications.sql',
      'migrations/004-event-equipment-requirements.sql',
      'venueManagementSchema.sql'
    ]) {
      const migration = fs.readFileSync(path.join(__dirname, '../../backend/src/db', file), 'utf8');
      await client.query(migration);
    }
    const eventMigration = fs.readFileSync(path.join(__dirname, '../../backend/src/db/migrations/001-external-events.sql'), 'utf8');
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
    // Test case: Provisions two organisers with actual password hashes and checks successful external login.
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
    // Test case: Saves and reads every submitted field and checks forged owner input cannot replace the session owner.
    await t.test('save and read all submitted fields without changing owner from request input', async () => {

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
      assert.equal(viewed.body.event.venue_confirmed, false);
      assert.equal(viewed.body.event.clarification_outstanding, false);
      assert.deepEqual(viewed.body.event.clarification_requests, []);
    });
    // Test case: Gives organisers the same organisation name and checks this does not grant cross-account event access.
    await t.test('same organisation name does not grant access to another organiser', async () => {

      assert.equal((await request(`/api/events/${eventId}`, { token: bobToken })).status, 404);
      assert.deepEqual((await request('/api/events?organiser_id=1', { token: bobToken })).body.events, []);
      assert.equal((await request(`/api/events/${eventId}`)).status, 401);
      assert.equal((await request('/api/events/999999', { token: aliceToken })).status, 404);
    });
    // Test case: EQ AC1-AC4 against real PostgreSQL - equipment saves and reads back, the database enforces the
    // support-details rule, the migration is repeatable, and confirmed arrangements cannot be overwritten directly.
    await t.test('EQ AC1/AC2/AC3/AC4 - equipment requirements persist and confirmed arrangements are protected in PostgreSQL', async () => {
      // Arrange
      const equipment = { equipmentItems: [{ item: 'Wireless microphone', quantity: 2 }, { item: 'Projector', quantity: 1 }],
        technicalSupportRequired: true, technicalSupportDetails: 'AV technician on site', videoConferencingRequired: true,
        technicalSpecifications: 'Zoom for 50 remote participants' };
      // Act: save before confirmation, then read back.
      const saved = await request(`/api/events/${eventId}/equipment`, { method: 'PUT', token: aliceToken, body: equipment });
      const viewed = (await request(`/api/events/${eventId}`, { token: aliceToken })).body.event;
      // Assert: the confirmation message and every stored value round-trip through the real schema.
      assert.equal(saved.status, 200); assert.equal(saved.body.message, 'Equipment requirements saved.');
      assert.deepEqual(viewed.equipment_items, equipment.equipmentItems);
      assert.deepEqual([viewed.technical_support_required, viewed.technical_support_details, viewed.video_conferencing_required, viewed.technical_specifications, viewed.equipment_confirmed],
        [true, 'AV technician on site', true, 'Zoom for 50 remote participants', false]);
      // The database itself refuses "support required" without details, even if the API were bypassed.
      await assert.rejects(client.query('UPDATE events SET technical_support_details=NULL WHERE id=$1', [eventId]), { code: '23514' });
      // Re-running the migration keeps the saved requirements.
      await client.query(fs.readFileSync(path.join(__dirname, '../../backend/src/db/migrations/004-event-equipment-requirements.sql'), 'utf8'));
      // Technical Support confirms; with no coordinator assigned there is nobody to review a change, so the edit is refused and nothing changes.
      await client.query('UPDATE events SET equipment_confirmed_at=now() WHERE id=$1', [eventId]);
      const afterConfirmation = await request(`/api/events/${eventId}/equipment`, { method: 'PUT', token: aliceToken, body: { equipmentItems: [] } });
      assert.equal(afterConfirmation.status, 409); assert.equal(afterConfirmation.body.code, 'COORDINATOR_NOT_ASSIGNED');
      const unchanged = (await request(`/api/events/${eventId}`, { token: aliceToken })).body.event;
      assert.deepEqual(unchanged.equipment_items, equipment.equipmentItems); assert.equal(unchanged.equipment_confirmed, true);
    });
    // Test case: Runs the migration again after saving an event and checks stored content survives.
    await t.test('migration is repeatable and preserves saved event content', async () => {

      await client.query(eventMigration);
      assert.equal((await request(`/api/events/${eventId}`, { token: aliceToken })).body.event.special_arrangements, 'Vegetarian lunch');
    });
    let rawToken;
    mock.method(emailService, 'emailConfig', () => (// Supplies controlled emailConfig behavior for this regression case, including its expected result or failure.

      // Handles this operation using the surrounding screen or request state.
      {}));
    mock.method(emailService, 'sendPasswordReset', async (_to, token) => {
      // Supplies controlled sendPasswordReset behavior for this regression case, including its expected result or failure.
       rawToken = token; });
    // Test case: Creates an expired reset token in PostgreSQL and checks password change is denied.
    await t.test('expired reset links fail in PostgreSQL', async () => {

      await request('/api/auth/forgot-password', { method: 'POST', body: { email: 'alice@example.test' } });
      assert.ok(rawToken);
      await client.query("UPDATE users SET password_reset_expires_at = now() - interval '1 second' WHERE id = 1");
      assert.equal((await request('/api/auth/reset-password', { method: 'POST', body: { token: rawToken, password: 'changed-password123' } })).status, 400);
    });
    // Test case: Sends simultaneous resets with one token and checks single-use consumption and invalidation of old sessions.
    await t.test('reset token is single-use under simultaneous requests and invalidates old sessions', async () => {

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
    client.release(); 
  }
});

});
