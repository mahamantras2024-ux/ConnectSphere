// Test-only infrastructure: real HTTP and PostgreSQL, with outbound email captured instead of delivered.
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { mock } = require('node:test');
const path = require('node:path');
require('../../../backend/node_modules/dotenv').config({ path: path.join(__dirname, '../../../backend/.env') });
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'workflow-test-only-signing-secret';
// The browser fixture uses a private frontend origin; keep the real CORS middleware enabled for it.
process.env.CORS_ORIGIN = 'http://127.0.0.1:4175';
const { Pool } = require('../../../backend/node_modules/pg');
const bcrypt = require('../../../backend/node_modules/bcryptjs');
const jwt = require('../../../backend/node_modules/jsonwebtoken');
const { pool } = require('../../../backend/src/config/db');
const { applyLiveSchema, sqlFile } = require('./liveSchema');

/**
 * Starts an isolated copy of the current API. Every SQL connection is confined to a generated schema;
 * separate connections preserve real locking/concurrency. Only the mail provider is replaced.
 */
async function createWorkflowFixture() {
  const schema = `cs_workflow_${randomBytes(8).toString('hex')}`;
  const config = { ...pool.options, password: pool.options.password, connectionTimeoutMillis: 10000,
    query_timeout: 30000, statement_timeout: 30000 };
  const admin = new Pool(config);
  const database = new Pool({ ...config, max: 8 });
  const emails = [];
  const replacements = [];
  let server;
  let created = false;
  let databaseFailure;
  // Treat an idle connection loss as a fixture failure without dumping a pg client/configuration into test evidence.
  function recordDatabaseFailure(error) { databaseFailure = error.code || 'connection lost'; }
  database.on('error', recordDatabaseFailure);
  admin.on('error', recordDatabaseFailure);
  // Credentials are generated test data, never real user accounts or secrets.
  const password = 'Workflow-test-Only-123!';
  const people = {
    organiser: 'event_organiser', coordinator: 'event_coordinator', lead: 'event_coordinator_lead',
    venue: 'venue_staff', support: 'technical_support', safety: 'safety_officer',
    attendee: 'attendee', second: 'attendee', third: 'attendee', outsider: 'event_organiser',
    otherCoordinator: 'event_coordinator',
  };
  const users = {};

  /** A checked-out connection must select the test schema before any application query can run. */
  async function connect() {
    if (databaseFailure) throw new Error(`Workflow database connection failed: ${databaseFailure}`);
    const client = await database.connect();
    try { await client.query(`SET search_path TO ${schema}`); return client; }
    catch (error) { client.release(true); throw error; }
  }
  /** Uses one test-scoped connection for an independent persistence assertion or fixture insert. */
  async function query(sql, values) {
    const client = await connect();
    try { return await client.query(sql, values); } finally { client.release(); }
  }
  /** Restores only replacements owned by this fixture and always removes its test-owned schema. */
  async function close() {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    for (const replacement of replacements.reverse()) replacement.mock.restore();
    await database.end();
    try { if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`); }
    finally { await admin.end(); }
  }
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    created = true;
    const client = await connect();
    try {
      // These are the startup tables; all subsequent structures come from production migrations.
      await client.query(`CREATE TABLE users(id SERIAL PRIMARY KEY,email VARCHAR(255) UNIQUE NOT NULL,
        full_name VARCHAR(255),password_hash VARCHAR(255),role VARCHAR(50),roles TEXT[] DEFAULT '{}',
        organisation_name VARCHAR(255),auth_version INT NOT NULL DEFAULT 0);
        CREATE TABLE venues(id SERIAL PRIMARY KEY,name VARCHAR(255),location VARCHAR(255),capacity INT,
        supported_layouts TEXT[],accessibility_features TEXT[],facilities TEXT[],operating_hours VARCHAR(255),
        availability_status VARCHAR(50),pricing VARCHAR(255),mrt VARCHAR(255),image TEXT)`);
      await applyLiveSchema(client);
      // These upgrades have separate production runners and must follow the older availability guard.
      await client.query(sqlFile('migrations/019-venue-tentative-holds.sql'));
      await client.query(sqlFile('migrations/020-session-venue-requests.sql'));
    } finally { client.release(); }
    const hash = await bcrypt.hash(password, 4);
    for (const [name, role] of Object.entries(people)) {
      const email = `${name}@workflow.example.test`;
      const { rows } = await query(`INSERT INTO users(email,full_name,password_hash,role,roles)
        VALUES($1,$2,$3,$4::text,ARRAY[$4::text]) RETURNING id`, [email, name, hash, role]);
      users[name] = { id: rows[0].id, email, role };
    }
    const venueId = (await query(`INSERT INTO venues(name,location,capacity,supported_layouts,accessibility_features,
      facilities,operating_hours,availability_status,setup_minutes,turnaround_minutes)
      VALUES('Workflow Hall','Singapore',20,ARRAY['Theatre'],ARRAY['Ramp'],ARRAY['Projector'],
      '08:00 - 22:00','Available',30,15) RETURNING id`)).rows[0].id;
    await query('INSERT INTO venue_staff_assignments(venue_id,staff_user_id) VALUES($1,$2)', [venueId, users.venue.id]);
    const inventoryId = (await query(`INSERT INTO equipments(asset_code,name,specification,status,quantity)
      VALUES('WORKFLOW-PROJECTOR','Projector','HD','operational',1) RETURNING id`)).rows[0].id;
    replacements.push(mock.method(pool, 'query', query), mock.method(pool, 'connect', connect));
    replacements.push(mock.method(require('../../../backend/src/services/emailService'), 'sendNotificationEmail',
      async (...args) => { emails.push(args); }));
    server = require('../../../backend/src/index').listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const apiUrl = `http://127.0.0.1:${server.address().port}/api`;

    /** Uses real authentication/authorization; expected statuses are asserted at the exact workflow step. */
    async function request(person, method, route, body, expectedStatus = 200) {
      const headers = { 'Content-Type': 'application/json' };
      if (person) headers.Authorization = `Bearer ${jwt.sign({ sub: users[person].id, authVersion: 0 }, process.env.JWT_SECRET)}`;
      const response = await fetch(apiUrl + route, { method, headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const result = await response.json();
      assert.equal(response.status, expectedStatus, `${method} ${route}: ${JSON.stringify(result)}`);
      return result;
    }
    /** Creates through the organiser's API; no lifecycle state is manufactured in the database. */
    async function submit(overrides = {}) {
      return (await request('organiser', 'POST', '/events', {
        isDraft: false, name: 'Workflow workshop', purpose: 'Learn together', description: 'A practical workshop',
        proposedDate: '2090-06-12', proposedStartTime: '10:00', proposedEndTime: '11:00',
        expectedAttendance: 20, roomLayoutPreference: 'Theatre', accessibilityRequirements: ['Ramp'],
        equipmentItems: [{ item: 'Projector', quantity: 1 }], technicalSupportRequired: true,
        technicalSupportDetails: 'Projector setup', registrationRequired: true, registrationCapacity: 2,
        ...overrides,
      }, 201)).event;
    }
    /** Assigns and initially approves using the current Lead and Coordinator workflows. */
    async function assignAndApprove(eventId) {
      await request('lead', 'PUT', `/events/${eventId}/assignment`, { coordinatorId: users.coordinator.id, expectedCoordinatorId: null });
      await request('coordinator', 'POST', `/events/${eventId}/decision`, { decision: 'approved' });
    }
    /** Requests a venue, gets a finite staff approval and confirms the hold before it expires (SCRUM-107). */
    async function book(eventId, overrides = {}) {
      const { request: booking } = await request('coordinator', 'POST', `/venues/${venueId}/requests`, {
        eventId, startDatetime: '2090-06-12T10:00:00+08:00', endDatetime: '2090-06-12T11:00:00+08:00',
        capacity: 20, layout: 'Theatre', accessibility: ['Ramp'], ...overrides,
      }, 201);
      await request('venue', 'PUT', `/venues/${venueId}/requests/${booking.id}/decision`, {
        decision: 'approved', holdExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      });
      await request('coordinator', 'PUT', `/venues/${venueId}/requests/${booking.id}/confirm`, {});
      return booking.id;
    }
    /** Reviews the current request and reserves actual stock; both are genuine staff API operations. */
    async function equip(eventId) {
      await request('coordinator', 'PUT', `/events/${eventId}/technical-support-assignment`, { staffIds: [users.support.id] });
      await request('support', 'POST', `/events/${eventId}/equipment-reviews`, { outcome: 'fully_fulfillable', requestVersion: 1 }, 201);
      return request('support', 'POST', `/events/${eventId}/equipment-reservations`, {
        selections: [{ inventoryId, quantity: 1 }],
      }, 201);
    }
    /** Only safety clearance permits final confirmation; registration is opened explicitly by the organiser. */
    async function confirm(eventId) {
      await request('safety', 'POST', `/events/${eventId}/safety-checks`, { outcome: 'approved' }, 201);
      await request('coordinator', 'POST', `/events/${eventId}/status`, { status: 'confirmed' });
      await request('organiser', 'PUT', `/events/${eventId}/registration-availability`, { open: true });
    }
    /** Provides a repeatable, fully arranged starting point using public feature APIs rather than SQL state shortcuts. */
    async function arrange(overrides, bookingOverrides) {
      const event = await submit(overrides);
      await assignAndApprove(event.id);
      const bookingId = await book(event.id, bookingOverrides);
      await equip(event.id);
      await confirm(event.id);
      return { event, bookingId };
    }
    return { apiUrl, users, password, venueId, inventoryId, emails, query, request, submit,
      assignAndApprove, book, equip, confirm, arrange, close };
  } catch (error) { await close(); throw error; }
}

module.exports = { createWorkflowFixture };
