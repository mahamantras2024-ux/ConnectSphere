// File: Regression test - Technical Support must not see or act on an event's equipment request until an Event
// Coordinator is assigned. Runs against real PostgreSQL in a disposable schema built from the real migrations.
// Test scope: Real routes, SQL and constraints; only the pool is pointed at the disposable schema. Opt-in (RUN_DB_TESTS=1).
require('../../backend/node_modules/dotenv').config();
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { pool } = require('../../backend/src/config/db');
const emailService = require('../../backend/src/services/emailService');

// The current production schema (every runner migration), so tables added by later migrations always exist.
const { applyLiveSchema } = require('./support/liveSchema');

// Test case: Unassigned requests are absent from every Technical Support queue and refused by every action; the same
// actions work once a coordinator is assigned, so the assignment is what gates them.
test('Bug fix - Technical Support cannot view or act on equipment requests until an Event Coordinator is assigned',
  { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
    const schema = `cs_ts_assignment_gate_${crypto.randomBytes(8).toString('hex')}`;
    const client = await pool.connect();
    let server;
    try {
      // ---------- Arrange: two submitted events needing a projector; only event 2 has a coordinator ----------
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, full_name VARCHAR(255), password_hash VARCHAR(255),
        role VARCHAR(50), roles TEXT[] NOT NULL DEFAULT '{}', organisation_name VARCHAR(255), auth_version INTEGER NOT NULL DEFAULT 0)`);
      await client.query(`CREATE TABLE venues (id SERIAL PRIMARY KEY, name VARCHAR(255), location VARCHAR(255), capacity INTEGER, supported_layouts TEXT[],
        accessibility_features TEXT[], facilities TEXT[], operating_hours VARCHAR(255), availability_status VARCHAR(50), pricing VARCHAR(255), mrt VARCHAR(255), image TEXT)`);
      await applyLiveSchema(client);
      for (const [email, role] of [['olivia@example.test', 'event_organiser'], ['chris@example.test', 'event_coordinator'], ['tina@example.test', 'technical_support']]) {
        await client.query('INSERT INTO users (email, full_name, role, roles) VALUES ($1, $1, $2::text, ARRAY[$2::text])', [email, role]);
      }
      const insertEvent = (name, coordinatorId) => client.query(`INSERT INTO events (organiser_id, coordinator_id, name, proposed_date, proposed_start_time,
          proposed_end_time, expected_attendance, equipment_items, is_draft, status)
        VALUES (1, $2, $1, '2030-10-15', '10:00', '12:00', 50, '[{"item":"Projector","quantity":1}]', false, 'submitted') RETURNING id`, [name, coordinatorId]);
      const unassigned = (await insertEvent('Unassigned Gala', null)).rows[0].id;
      const assigned = (await insertEvent('Assigned Talk', 2)).rows[0].id;
      // AC6: support responsibility is independent of the coordinator-assignment gate tested here.
      await client.query('INSERT INTO event_technical_support_assignments (event_id,staff_id) VALUES ($1,3),($2,3)', [unassigned, assigned]);
      // A review recorded before this fix existed on an event that is still unassigned (legacy data).
      const legacy = (await insertEvent('Legacy Unassigned Fair', null)).rows[0].id;
      await client.query("INSERT INTO event_equipment_reviews (event_id, request_version, outcome, reviewed_by) VALUES ($1, 1, 'fully_fulfillable', 3)", [legacy]);
      // A projector free during the event, so a reservation is otherwise valid and only the missing coordinator can refuse it.
      const projector = (await client.query("SELECT id FROM equipments WHERE asset_code = 'PROJ-002'")).rows[0].id;
      await client.query("INSERT INTO technical_equipment_availability (inventory_id, available_date, start_time, end_time) VALUES ($1, '2030-10-15', '09:00', '18:00')", [projector]);
      const reservation = { selections: [{ inventoryId: projector, quantity: 1 }] };

      mock.method(pool, 'query', (sql, values) => client.query(sql, values));
      mock.method(pool, 'connect', async () => ({ query: (sql, values) => client.query(sql, values), release() {} }));
      mock.method(emailService, 'sendNotificationEmail', async () => {});
      const app = require('../../backend/src/index');
      server = app.listen(0, '127.0.0.1');
      await new Promise((resolve) => server.once('listening', resolve));
      const token = jwt.sign({ sub: 3, authVersion: 0 }, process.env.JWT_SECRET, { expiresIn: '1h' });
      // Calls the API as Technical Support.
      async function asSupport(method, url, body) {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/events${url}`, { method,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, body: await response.json() };
      }
      const queueIds = async () => (await asSupport('GET', '/equipment-requests')).body.requests.map((request) => request.id);
      const candidateIds = async () => (await asSupport('GET', '/equipment-reservations')).body.requests.map((request) => request.id);

      // ---------- Act / Assert: nothing about an unassigned event reaches Technical Support ----------
      assert.deepEqual(await queueIds(), [assigned]);
      const refusedReview = await asSupport('POST', `/${unassigned}/equipment-reviews`, { outcome: 'fully_fulfillable', requestVersion: 1 });
      assert.equal(refusedReview.status, 409);
      assert.equal((await client.query('SELECT count(*)::int AS n FROM event_equipment_reviews WHERE event_id = $1', [unassigned])).rows[0].n, 0);
      // Even a review that predates this fix does not expose the event for reservation.
      assert.deepEqual(await candidateIds(), []);
      assert.equal((await asSupport('GET', `/${legacy}/equipment-availability`)).status, 404);
      const refusedReservation = await asSupport('POST', `/${legacy}/equipment-reservations`, reservation);
      assert.deepEqual([refusedReservation.status, refusedReservation.body.message], [409, 'This event does not have a current equipment review or is no longer upcoming.']);
      assert.equal((await client.query('SELECT count(*)::int AS n FROM event_equipment_reservations WHERE event_id = $1', [legacy])).rows[0].n, 0);

      // ---------- Once a coordinator is assigned, the same requests and actions become available ----------
      await client.query('UPDATE events SET coordinator_id = 2 WHERE id = ANY($1::int[])', [[unassigned, legacy]]);
      assert.deepEqual((await queueIds()).sort((a, b) => a - b), [unassigned, assigned]);
      assert.equal((await asSupport('POST', `/${unassigned}/equipment-reviews`, { outcome: 'fully_fulfillable', requestVersion: 1 })).status, 201);
      assert.ok((await candidateIds()).includes(legacy));
      assert.equal((await asSupport('GET', `/${legacy}/equipment-availability`)).status, 200);
      assert.equal((await asSupport('POST', `/${legacy}/equipment-reservations`, reservation)).status, 201);
    } finally {
      mock.restoreAll();
      if (server?.listening) await new Promise((resolve) => server.close(resolve));
      // A failed request can leave the shared client inside an aborted transaction; end it so cleanup still runs.
      await client.query('ROLLBACK').catch(() => {});
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      client.release();
      await pool.end();
    }
  });
