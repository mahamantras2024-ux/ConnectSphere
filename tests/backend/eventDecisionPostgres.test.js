// File: Tests the Event Coordinator Approves/Rejects Event story end to end against real PostgreSQL in a disposable schema.
// Test scope: Real routes, SQL, constraints and transactions; only Gmail delivery is replaced. Shared application records remain untouched.
// AC1-AC7 plus the Week 7 Operational Safety Check prerequisite, using the agreed rule (approve needs arrangements and a
// passed safety check; reject is allowed when arrangements fail; clarifications block both).
require('../../backend/node_modules/dotenv').config();
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { pool } = require('../../backend/src/config/db');
const emailService = require('../../backend/src/services/emailService');

const migrations = ['migrations/001-external-events.sql', 'venueManagementSchema.sql', 'venueScheduleSchema.sql', 'venueAvailabilitySchema.sql',
  'migrations/002-event-change-requests.sql', 'migrations/003-event-clarifications.sql', 'migrations/004-event-attachments.sql',
  'migrations/004-event-equipment-requirements.sql', 'migrations/005-change-request-review.sql', 'migrations/006-event-decisions.sql'];
const sqlFile = (file) => fs.readFileSync(path.join(__dirname, '../../backend/src/db', file), 'utf8');

// Test case: Walks one event through safety review and decision and a second through rejection, checking every gate,
// the stored outcome, notifications and the database's own constraints on real PostgreSQL.
test('AR AC1-AC7 - safety checks gate approval, decisions are retained on the event and the organiser is notified in PostgreSQL',
  { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
    const schema = `cs_event_decision_${crypto.randomBytes(8).toString('hex')}`;
    const client = await pool.connect();
    let server;
    try {
      // ---------- Arrange: disposable schema built from the real migrations ----------
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, full_name VARCHAR(255), password_hash VARCHAR(255),
        role VARCHAR(50), roles TEXT[] NOT NULL DEFAULT '{}', organisation_name VARCHAR(255), auth_version INTEGER NOT NULL DEFAULT 0)`);
      await client.query(`CREATE TABLE venues (id SERIAL PRIMARY KEY, name VARCHAR(255), location VARCHAR(255), capacity INTEGER, supported_layouts TEXT[],
        accessibility_features TEXT[], facilities TEXT[], operating_hours VARCHAR(255), availability_status VARCHAR(50), pricing VARCHAR(255), mrt VARCHAR(255), image TEXT)`);
      for (const file of migrations) await client.query(sqlFile(file));
      const people = [['olivia', 'event_organiser'], ['chris', 'event_coordinator'], ['cara', 'event_coordinator'], ['sam', 'safety_officer'], ['vera', 'venue_staff']];
      for (const [name, role] of people) {
        await client.query('INSERT INTO users (email, full_name, password_hash, role, roles) VALUES ($1, $2, $3, $4::text, ARRAY[$4::text])', [`${name}@example.test`, name, 'unused', role]);
      }
      const id = Object.fromEntries(people.map(([name], index) => [name, index + 1]));
      await client.query("INSERT INTO venues (name, location, capacity, supported_layouts) VALUES ('Hall A', 'Level 1', 100, ARRAY['Theatre'])");
      // Event 1 asks for a projector (technical arrangements needed); event 2 needs nothing technical and has no venue.
      await client.query(`INSERT INTO events (organiser_id, coordinator_id, name, proposed_date, proposed_start_time, proposed_end_time, expected_attendance,
          room_layout_preference, accessibility_requirements, equipment_items, is_draft, status)
        VALUES ($1, $2, 'Workshop', '2030-10-15', '10:00', '12:00', 80, 'Theatre', '["Ramp"]', '[{"item":"Projector","quantity":1}]', false, 'submitted'),
               ($1, $2, 'Talk', '2030-10-16', '10:00', '11:00', 30, 'Theatre', '[]', '[]', false, 'submitted')`, [id.olivia, id.chris]);

      mock.method(pool, 'query', (sql, values) => client.query(sql, values));
      mock.method(pool, 'connect', async () => ({ query: (sql, values) => client.query(sql, values), release() {} }));
      const emails = [];
      mock.method(emailService, 'sendNotificationEmail', async (to, subject) => { emails.push({ to, subject }); });
      const app = require('../../backend/src/index');
      server = app.listen(0, '127.0.0.1');
      await new Promise((resolve) => server.once('listening', resolve));
      const base = `http://127.0.0.1:${server.address().port}/api`;
      // Calls the API as one of the seeded people.
      async function as(person, method, url, body) {
        const role = people[id[person] - 1][1];
        const token = jwt.sign({ sub: id[person], role, email: `${person}@example.test`, authVersion: 0 }, process.env.JWT_SECRET, { expiresIn: '1h' });
        const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, body: await response.json() };
      }
      const notes = async (person) => (await client.query('SELECT type, title, message FROM notifications WHERE user_id=$1 ORDER BY id', [id[person]])).rows;

      // ---------- Week 7 change 6: the safety check follows confirmed venue and technical arrangements ----------
      assert.deepEqual((await as('sam', 'GET', '/safety/checks')).body.events, []);
      assert.equal((await as('sam', 'POST', '/events/1/safety-checks', { outcome: 'approved' })).body.code, 'VENUE_NOT_CONFIRMED');
      await client.query(`INSERT INTO venue_bookings (event_id, venue_id, requested_by, start_datetime, end_datetime, status, decision_by)
        VALUES (1, 1, $1, '2030-10-15T02:00:00Z', '2030-10-15T04:00:00Z', 'approved', $2)`, [id.chris, id.vera]);
      assert.equal((await as('sam', 'POST', '/events/1/safety-checks', { outcome: 'approved' })).body.code, 'TECHNICAL_NOT_CONFIRMED');
      await client.query('UPDATE events SET equipment_confirmed_at = now() WHERE id = 1');
      const queue = (await as('sam', 'GET', '/safety/checks')).body.events;
      assert.deepEqual(queue.map((event) => [event.name, event.venues]), [['Workshop', [{ name: 'Hall A', capacity: 100 }]]]);

      // The Safety Officer requests changes; the coordinator is told and approval is blocked (AC1/AC2).
      assert.equal((await as('sam', 'POST', '/events/1/safety-checks', { outcome: 'changes_requested' })).status, 400);
      assert.equal((await as('sam', 'POST', '/events/1/safety-checks', { outcome: 'changes_requested', notes: 'Widen the fire exit route' })).status, 201);
      assert.deepEqual((await notes('chris')).map((note) => [note.type, note.title]), [['safety_check_recorded', 'Safety check needs changes: Workshop']]);
      const review = (await as('chris', 'GET', '/events/1/decision')).body;
      assert.deepEqual(review.allowed, { approved: false, rejected: true });
      assert.equal(review.blocked.approved.code, 'SAFETY_CHANGES_REQUESTED');
      assert.equal(review.safetyCheck.notes, 'Widen the fire exit route');
      assert.equal((await as('chris', 'POST', '/events/1/decision', { decision: 'approved' })).body.code, 'SAFETY_CHANGES_REQUESTED');
      assert.equal(review.readiness.find((item) => item.name === 'safetyPassed').met, false);

      // ---------- AC7: an outstanding clarification blocks both decisions until the organiser answers ----------
      const asked = await as('chris', 'POST', '/events/1/clarifications', { informationNeeded: ['expected_attendance'], message: 'Confirm the head count.' });
      assert.equal(asked.status, 201);
      for (const decision of ['approved', 'rejected']) {
        assert.equal((await as('chris', 'POST', '/events/1/decision', { decision })).body.code, 'CLARIFICATION_OUTSTANDING');
      }
      assert.equal((await as('olivia', 'POST', `/events/1/clarifications/${asked.body.clarificationRequest.id}/respond`, { response: '80 people.' })).status, 200);

      // ---------- AC1/AC4/AC5/AC6: after a passed check the coordinator approves; the outcome is stored and announced ----------
      assert.equal((await as('sam', 'POST', '/events/1/safety-checks', { outcome: 'approved' })).status, 201);
      assert.equal((await as('cara', 'POST', '/events/1/decision', { decision: 'approved' })).status, 404);
      emails.length = 0;
      const approved = await as('chris', 'POST', '/events/1/decision', { decision: 'approved' });
      assert.equal(approved.status, 200);
      const stored = (await client.query('SELECT status, decided_by, decided_at IS NOT NULL AS decided, decision_reason FROM events WHERE id = 1')).rows[0];
      assert.deepEqual(stored, { status: 'approved', decided_by: id.chris, decided: true, decision_reason: null });
      assert.deepEqual((await notes('olivia')).map((note) => note.type), ['event_approved']);
      assert.deepEqual(emails, [{ to: 'olivia@example.test', subject: 'Event approved: Workshop' }]);
      const organiserView = (await as('olivia', 'GET', '/events/1/decision')).body;
      assert.deepEqual([organiserView.status, organiserView.outcome.decision, organiserView.outcome.decidedBy, organiserView.outcome.reason],
        ['approved', 'approved', 'chris', null]);
      assert.equal('safetyCheck' in organiserView, false);
      assert.equal((await as('chris', 'POST', '/events/1/decision', { decision: 'rejected' })).body.code, 'ALREADY_DECIDED');
      // The decided event leaves the safety queue.
      assert.deepEqual((await as('sam', 'GET', '/safety/checks')).body.events, []);

      // ---------- AC3/AC4/AC6: a request without a venue can still be rejected, with the reason kept and sent ----------
      assert.equal((await as('chris', 'POST', '/events/2/decision', { decision: 'approved' })).body.code, 'VENUE_NOT_CONFIRMED');
      assert.equal((await as('chris', 'POST', '/events/2/decision', { decision: 'rejected', reason: ' No suitable venue is available. ' })).status, 200);
      assert.deepEqual((await client.query('SELECT status, decision_reason FROM events WHERE id = 2')).rows[0],
        { status: 'rejected', decision_reason: 'No suitable venue is available.' });
      const [, rejectedNote] = await notes('olivia');
      assert.deepEqual([rejectedNote.type, rejectedNote.message],
        ['event_rejected', 'Your event request Talk was not approved by the Event Coordinator.\nReason: No suitable venue is available.']);

      // ---------- The database enforces the same rules if the API were bypassed ----------
      await assert.rejects(client.query('UPDATE events SET decision_reason = $1 WHERE id = 2', ['x'.repeat(4001)]), { code: '23514' });
      await assert.rejects(client.query("INSERT INTO event_safety_checks (event_id, safety_officer_id, outcome) VALUES (1, $1, 'rejected')", [id.sam]), { code: '23514' });
      // The widened notification types still accept the change-request story's types and nothing unknown.
      await client.query("INSERT INTO notifications (user_id, type, title, message) VALUES ($1, 'change_request_submitted', 't', 'm')", [id.chris]);
      await assert.rejects(client.query("INSERT INTO notifications (user_id, type, title, message) VALUES ($1, 'unknown_type', 't', 'm')", [id.chris]), { code: '23514' });
      // Re-running the migration keeps stored decisions.
      await client.query(sqlFile('migrations/006-event-decisions.sql'));
      assert.equal((await client.query('SELECT status FROM events WHERE id = 1')).rows[0].status, 'approved');
    } finally {
      mock.restoreAll();
      if (server?.listening) await new Promise((resolve) => server.close(resolve));
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      client.release();
      await pool.end();
    }
  });
