// File: Parent notification system against real PostgreSQL in a disposable schema built from the real migrations.
// Test scope: Real routes, SQL, transactions and constraints; only the pool is pointed at the disposable schema and email is
// captured. Opt-in (RUN_DB_TESTS=1).
require('../../backend/node_modules/dotenv').config();
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { pool } = require('../../backend/src/config/db');
const emailService = require('../../backend/src/services/emailService');

// Every migration in the order the production runner applies them (shared live-schema helper).
const { sqlFile, runnerMigrations: runnerOrder, applyLiveSchema } = require('./support/liveSchema');

// Test case: The Lead hears about a new request, and the Safety Officer hears exactly once when it becomes ready.
test('NT AC1 - Coordinator Lead and Safety Officer notifications follow the real workflow, and every migration re-runs',
  { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
    const schema = `cs_parent_notifications_${crypto.randomBytes(8).toString('hex')}`;
    const client = await pool.connect();
    let server;
    try {
      // ---------- Arrange: disposable schema from the base schemas and the runner's migrations ----------
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, full_name VARCHAR(255), password_hash VARCHAR(255),
        role VARCHAR(50), roles TEXT[] NOT NULL DEFAULT '{}', organisation_name VARCHAR(255), auth_version INTEGER NOT NULL DEFAULT 0)`);
      await client.query(`CREATE TABLE venues (id SERIAL PRIMARY KEY, name VARCHAR(255), location VARCHAR(255), capacity INTEGER, supported_layouts TEXT[],
        accessibility_features TEXT[], facilities TEXT[], operating_hours VARCHAR(255), availability_status VARCHAR(50), pricing VARCHAR(255), mrt VARCHAR(255), image TEXT)`);
      await applyLiveSchema(client);
      const people = [['olivia', 'event_organiser'], ['chris', 'event_coordinator'], ['lee', 'event_coordinator_lead'], ['vera', 'venue_staff'],
        ['tina', 'technical_support'], ['sam', 'safety_officer'], ['sid', 'safety_officer']];
      for (const [name, role] of people) await client.query('INSERT INTO users (email, full_name, role, roles) VALUES ($1, $2, $3::text, ARRAY[$3::text])', [`${name}@example.test`, name, role]);
      const id = Object.fromEntries(people.map(([name], index) => [name, index + 1]));
      await client.query("INSERT INTO venues (name, location, capacity, supported_layouts, accessibility_features, facilities, operating_hours, availability_status) VALUES ('Hall A', 'Level 1', 100, ARRAY['Theatre'], ARRAY['Ramp'], ARRAY['Wi-Fi'], '08:00 - 22:00', 'Available')");

      mock.method(pool, 'query', (sql, values) => client.query(sql, values));
      mock.method(pool, 'connect', async () => ({ query: (sql, values) => client.query(sql, values), release() {} }));
      const emails = [];
      mock.method(emailService, 'sendNotificationEmail', async (to, subject) => { emails.push([to, subject]); });
      const app = require('../../backend/src/index');
      server = app.listen(0, '127.0.0.1');
      await new Promise((resolve) => server.once('listening', resolve));
      // Calls the API as one of the seeded people.
      async function as(person, method, url, body) {
        const token = jwt.sign({ sub: id[person], authVersion: 0 }, process.env.JWT_SECRET, { expiresIn: '1h' });
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api${url}`, { method,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, body: await response.json() };
      }
      const notesOf = async (person, type) => (await client.query('SELECT title FROM notifications WHERE user_id = $1 AND type = $2 ORDER BY id', [id[person], type])).rows.map((row) => row.title);

      // ---------- Act / Assert: a submitted request reaches the Coordinator Lead (in-app list and email) ----------
      const created = await as('olivia', 'POST', '/events', { name: 'Gala', proposedDate: '2030-10-15', proposedStartTime: '10:00', proposedEndTime: '12:00',
        expectedAttendance: 50, isDraft: false, equipmentItems: [{ item: 'Projector', quantity: 1 }] });
      assert.equal(created.status, 201);
      const eventId = created.body.event.id;
      assert.deepEqual(await notesOf('lee', 'event_awaiting_assignment'), ['New request to assign: Gala']);
      assert.ok(emails.some(([to, subject]) => to === 'lee@example.test' && subject === 'New request to assign: Gala'));
      const leeList = (await as('lee', 'GET', '/notifications')).body;
      assert.deepEqual([leeList.unreadCount, leeList.notifications[0].type, leeList.notifications[0].event_id], [1, 'event_awaiting_assignment', eventId]);

      // The Lead assigns Chris, who books Hall A; Venue Staff approve it. The projector is not confirmed yet: not ready.
      assert.equal((await as('lee', 'PUT', `/events/${eventId}/assignment`, { coordinatorId: id.chris, expectedCoordinatorId: null })).status, 200);
      const booking = await as('chris', 'POST', '/venues/1/requests', { eventId, startDatetime: '2030-10-15T10:00:00+08:00', endDatetime: '2030-10-15T12:00:00+08:00' });
      assert.equal(booking.status, 201);
      assert.equal((await as('vera', 'PUT', `/venues/1/requests/${booking.body.request.id}/decision`, { decision: 'approved' })).status, 200);
      assert.deepEqual(await notesOf('sam', 'safety_check_ready'), []);

      // Technical Support confirms the projector: the event is now ready, and each Safety Officer hears once.
      const [pending] = (await as('tina', 'GET', '/events/equipment-requests')).body.requests;
      assert.equal((await as('tina', 'POST', `/events/${eventId}/equipment-reviews`, { outcome: 'fully_fulfillable', requestVersion: pending.request_version })).status, 201);
      assert.deepEqual(await notesOf('sam', 'safety_check_ready'), ['Ready for safety check: Gala']);
      assert.deepEqual(await notesOf('sid', 'safety_check_ready'), ['Ready for safety check: Gala']);
      assert.deepEqual((await as('sam', 'GET', '/notifications')).body.notifications.map((note) => note.type), ['safety_check_ready']);
      // Other people never see these role notifications.
      assert.deepEqual((await as('chris', 'GET', '/notifications')).body.notifications.filter((note) => ['safety_check_ready', 'event_awaiting_assignment'].includes(note.type)), []);

      // A late approval of a booking whose hold had expired leaves the already-ready Gala ready: no repeat notification.
      const late = await as('chris', 'POST', '/venues/1/requests', { eventId, startDatetime: '2030-10-15T14:00:00+08:00', endDatetime: '2030-10-15T16:00:00+08:00' });
      assert.equal(late.status, 201);
      await client.query("UPDATE venue_bookings SET hold_expires_at = now() - interval '1 minute' WHERE id = $1", [late.body.request.id]);
      assert.equal((await as('vera', 'PUT', `/venues/1/requests/${late.body.request.id}/decision`, { decision: 'approved' })).status, 200);
      assert.deepEqual(await notesOf('sam', 'safety_check_ready'), ['Ready for safety check: Gala']);

      // A booking still being held takes Gala out of the safety queue (VENUE_PENDING); approving it brings Gala back,
      // so the Safety Officers are told it is ready again.
      const held = await as('chris', 'POST', '/venues/1/requests', { eventId, startDatetime: '2030-10-15T17:00:00+08:00', endDatetime: '2030-10-15T18:00:00+08:00' });
      assert.equal(held.status, 201);
      assert.equal((await as('vera', 'PUT', `/venues/1/requests/${held.body.request.id}/decision`, { decision: 'approved' })).status, 200);
      assert.deepEqual(await notesOf('sam', 'safety_check_ready'), ['Ready for safety check: Gala', 'Ready for safety check: Gala']);

      // An event with nothing technical becomes ready the moment its venue is approved.
      const talk = await as('olivia', 'POST', '/events', { name: 'Talk', proposedDate: '2030-10-16', proposedStartTime: '10:00', proposedEndTime: '12:00', expectedAttendance: 20, isDraft: false });
      assert.equal(talk.status, 201);
      assert.equal((await as('lee', 'PUT', `/events/${talk.body.event.id}/assignment`, { coordinatorId: id.chris, expectedCoordinatorId: null })).status, 200);
      const talkBooking = await as('chris', 'POST', '/venues/1/requests', { eventId: talk.body.event.id, startDatetime: '2030-10-16T10:00:00+08:00', endDatetime: '2030-10-16T12:00:00+08:00' });
      assert.equal(talkBooking.status, 201);
      assert.equal((await as('vera', 'PUT', `/venues/1/requests/${talkBooking.body.request.id}/decision`, { decision: 'approved' })).status, 200);
      assert.deepEqual(await notesOf('sid', 'safety_check_ready'), ['Ready for safety check: Gala', 'Ready for safety check: Gala', 'Ready for safety check: Talk']);
      assert.ok(emails.some(([to, subject]) => to === 'sid@example.test' && subject === 'Ready for safety check: Talk'));

      // ---------- Every migration re-runs with the new types (and older ones) stored ----------
      for (const file of runnerOrder) await client.query(sqlFile(file));
      await client.query("INSERT INTO notifications (user_id, type, title, message) VALUES ($1, 'safety_check_ready', 't', 'm'), ($1, 'event_awaiting_assignment', 't', 'm')", [id.sam]);
      await assert.rejects(client.query("INSERT INTO notifications (user_id, type, title, message) VALUES ($1, 'unknown_type', 't', 'm')", [id.sam]), { code: '23514' });
    } finally {
      mock.restoreAll();
      if (server?.listening) await new Promise((resolve) => server.close(resolve));
      await client.query('ROLLBACK').catch(() => {});
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      client.release();
      await pool.end();
    }
  });
