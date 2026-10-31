// File: "Request All Post-Submission Amendments Through the Coordinator" end to end against real PostgreSQL in a disposable
// schema built from the production migrations (read from the runner, so the schema never falls behind).
// Test scope: Real routes, SQL, constraints and transactions; only Gmail delivery is replaced. Opt-in (RUN_DB_TESTS=1).
require('../../backend/node_modules/dotenv').config();
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { pool } = require('../../backend/src/config/db');
const emailService = require('../../backend/src/services/emailService');

const dbDir = path.join(__dirname, '../../backend/src/db');
const sqlFile = (name) => fs.readFileSync(path.join(dbDir, name), 'utf8');
const runnerSource = sqlFile('migrateExternalEvents.js');
// Every migration in the order the production runner applies them.
const runnerOrder = [...runnerSource.slice(runnerSource.indexOf('async function migrate()')).matchAll(/'(migrations\/[^']+\.sql)'/g)].map(([, file]) => file);

// Test case: The organiser cannot edit a submitted event, requests an amendment with an explanation, the event keeps its
// accepted details while pending, and the assigned coordinator is notified, sees the explanation and decides.
test('AM AC1-AC4 - post-submission amendments go through the assigned coordinator in PostgreSQL',
  { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
    const schema = `cs_amendments_${crypto.randomBytes(8).toString('hex')}`;
    const client = await pool.connect();
    let server;
    try {
      // ---------- Arrange: disposable schema, people and events ----------
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, full_name VARCHAR(255), password_hash VARCHAR(255),
        role VARCHAR(50), roles TEXT[] NOT NULL DEFAULT '{}', organisation_name VARCHAR(255), auth_version INTEGER NOT NULL DEFAULT 0)`);
      await client.query(`CREATE TABLE venues (id SERIAL PRIMARY KEY, name VARCHAR(255), location VARCHAR(255), capacity INTEGER, supported_layouts TEXT[],
        accessibility_features TEXT[], facilities TEXT[], operating_hours VARCHAR(255), availability_status VARCHAR(50), pricing VARCHAR(255), mrt VARCHAR(255), image TEXT)`);
      await client.query(sqlFile('migrations/001-external-events.sql'));
      for (const file of ['sprintOneSchema.sql', 'venueManagementSchema.sql', 'venueScheduleSchema.sql', 'venueAvailabilitySchema.sql']) await client.query(sqlFile(file));
      for (const file of runnerOrder) await client.query(sqlFile(file));
      // Venue booking requests have their own runner.
      await client.query(sqlFile('migrations/20261018064942_venue_booking_requests.sql'));
      // This branch's registration settings use a dedicated migration outside the common event runner.
      await client.query(sqlFile('migrations/021-registration-settings.sql'));
      const people = [['olivia', 'event_organiser'], ['chris', 'event_coordinator'], ['cara', 'event_coordinator'], ['otto', 'event_organiser']];
      for (const [name, role] of people) {
        await client.query('INSERT INTO users (email, full_name, role, roles) VALUES ($1, $2, $3::text, ARRAY[$3::text])', [`${name}@example.test`, name, role]);
      }
      const id = Object.fromEntries(people.map(([name], index) => [name, index + 1]));
      // 1: submitted, assigned to Chris (with a confirmed projector); 2: submitted, unassigned; 3: Olivia's draft; 4: cancelled.
      await client.query(`INSERT INTO events (organiser_id, coordinator_id, name, proposed_date, proposed_start_time, proposed_end_time,
        expected_attendance, room_layout_preference, equipment_items, is_draft, status)
        VALUES ($1, $2, 'Gala', '2030-10-15', '18:00', '20:00', 60, 'Theatre', '[{"item":"Projector","quantity":1}]', false, 'submitted'),
               ($1, NULL, 'Fair', '2030-10-16', '10:00', '12:00', 40, 'Theatre', '[]', false, 'submitted'),
               ($1, NULL, 'Draft talk', NULL, NULL, NULL, NULL, NULL, '[]', true, 'draft'),
               ($1, $2, 'Old dinner', '2030-10-17', '18:00', '20:00', 30, 'Banquet', '[]', false, 'cancelled')`, [id.olivia, id.chris]);
      await client.query('UPDATE events SET equipment_confirmed_at = now() WHERE id = 1');

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
      const gala = async () => (await client.query(`SELECT expected_attendance, room_layout_preference, equipment_items,
        equipment_confirmed_at IS NOT NULL AS confirmed, equipment_requirements_version AS version FROM events WHERE id = 1`)).rows[0];
      const accepted = await gala();
      const equipment = { equipmentItems: [{ item: 'Projector', quantity: 2 }], technicalSupportRequired: false,
        technicalSupportDetails: null, videoConferencingRequired: false, technicalSpecifications: null };

      // ---------- AC1: no direct edits after submission (a draft still edits directly) ----------
      const direct = await as('olivia', 'PUT', '/events/1/non-critical', { expectedAttendance: 90 });
      const directEquipment = await as('olivia', 'PUT', '/events/1/equipment', equipment);
      assert.deepEqual([direct.status, direct.body.code, directEquipment.status, directEquipment.body.code], [409, 'AMENDMENT_REQUIRED', 409, 'AMENDMENT_REQUIRED']);
      assert.deepEqual(await gala(), accepted);
      assert.equal((await as('olivia', 'PUT', '/events/3/non-critical', { name: 'Draft talk v2' })).status, 200);

      // ---------- AC2: an amendment request with the proposed changes and an explanation ----------
      const requested = await as('olivia', 'POST', '/events/1/amendment-requests', { changes: { expectedAttendance: 90,
        roomLayoutPreference: 'Banquet', ...equipment }, explanation: 'Ticket sales doubled.' });
      assert.equal(requested.status, 202);
      const stored = (await client.query('SELECT requested_changes, explanation, status, coordinator_id FROM event_change_requests')).rows;
      assert.deepEqual(stored, [{ requested_changes: { expectedAttendance: 90, roomLayoutPreference: 'Banquet', equipmentItems: equipment.equipmentItems },
        explanation: 'Ticket sales doubled.', status: 'pending', coordinator_id: id.chris }]);

      // ---------- AC3: the accepted information stays in effect while the request awaits review ----------
      assert.deepEqual(await gala(), accepted);
      assert.equal((await as('olivia', 'GET', '/events/1')).body.event.expected_attendance, 60);
      const listed = (await as('olivia', 'GET', '/events/1/amendment-requests')).body.amendmentRequests;
      assert.deepEqual(listed.map((item) => [item.status, item.explanation, item.changes.map((change) => change.label)]),
        [['pending', 'Ticket sales doubled.', ['Expected attendance', 'Layout requirements', 'Equipment items']]]);
      assert.equal((await as('otto', 'GET', '/events/1/amendment-requests')).status, 404);

      // ---------- AC4: the assigned coordinator is notified and reviews it ----------
      const [note] = (await client.query("SELECT user_id, message FROM notifications WHERE type = 'change_request_submitted'")).rows;
      assert.equal(note.user_id, id.chris);
      assert.match(note.message, /Expected attendance: 60 → 90[\s\S]*Explanation: Ticket sales doubled\.$/);
      assert.deepEqual(emails, [['chris@example.test', 'New amendment request: Gala']]);
      const [inboxItem] = (await as('chris', 'GET', '/events/change-requests')).body.changeRequests;
      assert.equal(inboxItem.explanation, 'Ticket sales doubled.');
      assert.deepEqual((await as('cara', 'GET', '/events/change-requests')).body.changeRequests, []);
      // Approving applies the changes; the changed equipment goes back to Technical Support as a new version.
      assert.equal((await as('chris', 'POST', `/events/change-requests/${inboxItem.id}/decision`, { decision: 'approved' })).status, 200);
      assert.deepEqual(await gala(), { expected_attendance: 90, room_layout_preference: 'Banquet', equipment_items: equipment.equipmentItems,
        confirmed: false, version: accepted.version + 1 });
      // A second request is rejected: nothing changes, and the organiser's list shows both outcomes.
      await as('olivia', 'POST', '/events/1/amendment-requests', { changes: { name: 'Gala Night' }, explanation: 'Sponsor request.' });
      const [second] = (await as('chris', 'GET', '/events/change-requests')).body.changeRequests;
      await as('chris', 'POST', `/events/change-requests/${second.id}/decision`, { decision: 'rejected', reason: 'Tickets are printed.' });
      assert.equal((await client.query('SELECT name FROM events WHERE id = 1')).rows[0].name, 'Gala');
      assert.deepEqual((await as('olivia', 'GET', '/events/1/amendment-requests')).body.amendmentRequests.map((item) => [item.status, item.decision_reason]),
        [['rejected', 'Tickets are printed.'], ['approved', null]]);

      // ---------- Events that cannot take an amendment ----------
      const amend = (eventId, person = 'olivia') => as(person, 'POST', `/events/${eventId}/amendment-requests`, { changes: { expectedAttendance: 99 }, explanation: 'Why' });
      assert.deepEqual([(await amend(2)).body.code, (await amend(3)).body.code, (await amend(4)).body.code, (await amend(1, 'otto')).status],
        ['COORDINATOR_NOT_ASSIGNED', 'USE_DRAFT_EDIT', 'AMENDMENT_CLOSED', 404]);

      // ---------- The database enforces the explanation rule, keeps legacy requests and re-runs the migration ----------
      const insert = (explanation) => client.query(`INSERT INTO event_change_requests (event_id, organiser_id, coordinator_id, requested_changes, explanation)
        VALUES (1, $1, $2, '{}', $3)`, [id.olivia, id.chris, explanation]);
      await assert.rejects(insert(''), { code: '23514' });
      await assert.rejects(insert('x'.repeat(2001)), { code: '23514' });
      await insert('x'.repeat(2000));
      await insert(null);
      await client.query(sqlFile('migrations/019-amendment-explanations.sql'));
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
