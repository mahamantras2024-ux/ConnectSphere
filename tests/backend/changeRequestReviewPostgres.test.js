// File: Tests the Event Coordinator Review & Process Change Requests story end to end against real PostgreSQL in a disposable schema.
// Test scope: Real routes, SQL, constraints and transactions; only Gmail delivery is replaced. Shared application records remain untouched.
// AC1 view requested changes; AC2 coordinator notified on submission; AC3 apply/reject and notify relevant personnel immediately.
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
  'migrations/002-event-change-requests.sql', 'migrations/003-event-clarifications.sql', 'migrations/004-change-request-review.sql'];

// Test case: Organiser submits a critical change on a confirmed booking; the coordinator sees current vs requested values and the
// affected booking, approves it, and the organiser, the booking's Venue Staff decision-maker and Technical Support are notified
// in the same commit. A second change is rejected with a reason. Expected values come from the ACs and Week 7 rules, not the code.
test('CR AC1/AC2/AC3 - change requests are notified, reviewed, applied or rejected, and routed to relevant personnel in PostgreSQL',
  { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
    const schema = `cs_change_review_${crypto.randomBytes(8).toString('hex')}`;
    const client = await pool.connect();
    let server;
    try {
      // ---------- Arrange: a disposable schema built with the real migrations ----------
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, full_name VARCHAR(255), password_hash VARCHAR(255),
        role VARCHAR(50), roles TEXT[] NOT NULL DEFAULT '{}', organisation_name VARCHAR(255), auth_version INTEGER NOT NULL DEFAULT 0)`);
      await client.query(`CREATE TABLE venues (id SERIAL PRIMARY KEY, name VARCHAR(255), location VARCHAR(255), capacity INTEGER, supported_layouts TEXT[],
        accessibility_features TEXT[], facilities TEXT[], operating_hours VARCHAR(255), availability_status VARCHAR(50), pricing VARCHAR(255), mrt VARCHAR(255), image TEXT)`);
      for (const file of migrations) await client.query(fs.readFileSync(path.join(__dirname, '../../backend/src/db', file), 'utf8'));
      // The review migration must be safe to re-run on a database that already has it.
      await client.query(fs.readFileSync(path.join(__dirname, '../../backend/src/db/migrations/004-change-request-review.sql'), 'utf8'));

      // People: ids are fixed by insertion order. Vera approved the booking; Vic is other Venue Staff; Tess is Technical Support.
      const people = [['olivia', 'event_organiser'], ['chris', 'event_coordinator'], ['cara', 'event_coordinator'], ['vera', 'venue_staff'],
        ['vic', 'venue_staff'], ['tess', 'technical_support'], ['otto', 'event_organiser']];
      for (const [name, role] of people) {
        await client.query('INSERT INTO users (email, full_name, password_hash, role, roles) VALUES ($1, $2, $3, $4::text, ARRAY[$4::text])', [`${name}@example.test`, name, 'unused', role]);
      }
      const id = Object.fromEntries(people.map(([name], index) => [name, index + 1]));
      // Week 7 example venue: capacity 100, 30 min setup, 45 min turnaround.
      await client.query(`INSERT INTO venues (name, location, capacity, supported_layouts, setup_minutes, turnaround_minutes)
        VALUES ('Hall A', 'Level 1', 100, ARRAY['Theatre'], 30, 45)`);
      // Event 1 (Olivia's) runs 10:00-12:00 Singapore time with equipment needs; event 2 (Otto's) is booked from 13:30 at the same hall.
      await client.query(`INSERT INTO events (organiser_id, coordinator_id, name, proposed_date, proposed_start_time, proposed_end_time,
        expected_attendance, room_layout_preference, equipment_notes, is_draft, status)
        VALUES ($1, $2, 'Workshop', '2030-10-15', '10:00', '12:00', 80, 'Theatre', 'Two microphones', false, 'submitted'),
               ($3, $2, 'Afternoon talk', '2030-10-15', '13:30', '15:00', 40, 'Theatre', NULL, false, 'submitted')`, [id.olivia, id.chris, id.otto]);
      await client.query(`INSERT INTO venue_bookings (event_id, venue_id, requested_by, start_datetime, end_datetime, status, decision_by)
        VALUES (1, 1, $1, '2030-10-15T02:00:00Z', '2030-10-15T04:00:00Z', 'approved', $2),
               (2, 1, $1, '2030-10-15T05:30:00Z', '2030-10-15T07:00:00Z', 'approved', $2)`, [id.chris, id.vera]);

      // API traffic and the decision transaction both use the disposable schema's connection; Gmail is replaced.
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
        const [, role] = people[id[person] - 1];
        const token = jwt.sign({ sub: id[person], role, email: `${person}@example.test`, authVersion: 0 }, process.env.JWT_SECRET, { expiresIn: '1h' });
        const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, body: await response.json() };
      }
      const notificationsFor = async (person) => (await client.query('SELECT type, title, message, details FROM notifications WHERE user_id=$1 ORDER BY id', [id[person]])).rows;

      // ---------- AC2: submitting notifies the assigned coordinator ----------
      // 150 guests exceed the 100-seat hall; ending at 12:16 plus 45 min turnaround overlaps the next booking's 13:00 setup start.
      const submitted = await as('olivia', 'PUT', '/events/1/non-critical', { expectedAttendance: 150, proposedEndTime: '12:16' });
      assert.equal(submitted.status, 202);
      assert.equal(submitted.body.changeRequest.coordinator_email, undefined);
      assert.deepEqual((await client.query('SELECT expected_attendance FROM events WHERE id=1')).rows[0], { expected_attendance: 80 });
      const [coordinatorNote] = await notificationsFor('chris');
      assert.equal(coordinatorNote.type, 'change_request_submitted');
      assert.equal(coordinatorNote.message, 'The Event Organiser requested changes to Workshop.\nEnd time: 12:00:00 → 12:16:00\nExpected attendance: 80 → 150');
      assert.deepEqual(emails, [{ to: 'chris@example.test', subject: 'New change request: Workshop' }]);
      const inbox = await as('chris', 'GET', '/notifications');
      assert.equal(inbox.body.unreadCount, 1);
      assert.equal((await as('chris', 'POST', `/notifications/${inbox.body.notifications[0].id}/read`)).status, 200);
      assert.equal((await as('chris', 'GET', '/notifications')).body.unreadCount, 0);
      // Another user cannot read or mark the coordinator's notification.
      assert.deepEqual((await as('olivia', 'GET', '/notifications')).body, { notifications: [], unreadCount: 0 });
      assert.equal((await as('olivia', 'POST', `/notifications/${inbox.body.notifications[0].id}/read`)).status, 404);

      // ---------- AC1: the coordinator sees current vs requested values and the booking at risk ----------
      const listed = await as('chris', 'GET', '/events/change-requests');
      assert.equal(listed.status, 200);
      const [pending] = listed.body.changeRequests;
      // Listed in the event page's field order (times before attendance), whatever order JSONB stores the keys in.
      assert.deepEqual(pending.changes.map((change) => [change.label, change.current, change.requested]),
        [['End time', '12:00:00', '12:16:00'], ['Expected attendance', 80, 150]]);
      assert.deepEqual(pending.arrangements.map((item) => item.venueName), ['Hall A']);
      assert.deepEqual(pending.arrangements[0].reasons, [
        'This booking still reserves 2030-10-15 10:00 to 2030-10-15 12:00; the event now runs 2030-10-15 10:00 to 2030-10-15 12:16.',
        'The new time conflicts with another booking or closure at this venue, including setup and turnaround time.',
        '150 expected guests exceed the venue capacity of 100.',
      ]);
      // Another coordinator has no access to the request.
      assert.deepEqual((await as('cara', 'GET', '/events/change-requests')).body.changeRequests, []);
      assert.equal((await as('cara', 'POST', `/events/change-requests/${pending.id}/decision`, { decision: 'approved' })).status, 404);
      assert.equal((await as('olivia', 'POST', `/events/change-requests/${pending.id}/decision`, { decision: 'approved' })).status, 403);

      // ---------- AC3: approving applies the change and notifies relevant personnel in the same commit ----------
      emails.length = 0;
      const approved = await as('chris', 'POST', `/events/change-requests/${pending.id}/decision`, { decision: 'approved' });
      assert.equal(approved.status, 200);
      assert.deepEqual(approved.body.notified, { organiser: [id.olivia], venueStaff: [id.vera], technicalSupport: [id.tess] });
      const event = (await client.query('SELECT expected_attendance, proposed_end_time::text AS end_time FROM events WHERE id=1')).rows[0];
      assert.deepEqual(event, { expected_attendance: 150, end_time: '12:16:00' });
      const decided = (await client.query('SELECT status, reviewed_by, reviewed_at IS NOT NULL AS reviewed, decision_reason FROM event_change_requests WHERE id=$1', [pending.id])).rows[0];
      assert.deepEqual(decided, { status: 'approved', reviewed_by: id.chris, reviewed: true, decision_reason: null });
      // The affected booking is flagged, never moved or cancelled.
      assert.deepEqual((await client.query("SELECT status, start_datetime = '2030-10-15T02:00:00Z' AS unchanged FROM venue_bookings WHERE id=1")).rows[0], { status: 'approved', unchanged: true });
      assert.deepEqual((await notificationsFor('olivia')).map((note) => note.type), ['change_request_approved']);
      const [veraNote] = await notificationsFor('vera');
      assert.equal(veraNote.type, 'event_details_changed');
      assert.match(veraNote.message, /Hall A: .*150 expected guests exceed the venue capacity of 100\./);
      assert.deepEqual((await notificationsFor('tess')).map((note) => note.type), ['event_details_changed']);
      // Vic did not decide the booking, so is not notified.
      assert.deepEqual(await notificationsFor('vic'), []);
      assert.deepEqual(emails.map((email) => email.to).sort(), ['olivia@example.test', 'tess@example.test', 'vera@example.test']);
      // A second decision on the same request is refused and notifies nobody.
      const again = await as('chris', 'POST', `/events/change-requests/${pending.id}/decision`, { decision: 'rejected' });
      assert.equal(again.status, 409);
      assert.equal(again.body.code, 'ALREADY_DECIDED');
      assert.equal((await notificationsFor('olivia')).length, 1);

      // ---------- AC3: rejecting keeps the event unchanged and tells the organiser why ----------
      const renamed = await as('olivia', 'PUT', '/events/1/non-critical', { name: 'Renamed workshop' });
      assert.equal(renamed.status, 202);
      const second = (await as('chris', 'GET', '/events/change-requests')).body.changeRequests[0];
      const rejected = await as('chris', 'POST', `/events/change-requests/${second.id}/decision`, { decision: 'rejected', reason: '  Name is already in use.  ' });
      assert.equal(rejected.status, 200);
      assert.deepEqual(rejected.body.notified, { organiser: [id.olivia], venueStaff: [], technicalSupport: [] });
      assert.equal((await client.query('SELECT name FROM events WHERE id=1')).rows[0].name, 'Workshop');
      assert.equal((await client.query('SELECT decision_reason FROM event_change_requests WHERE id=$1', [second.id])).rows[0].decision_reason, 'Name is already in use.');
      const olivia = await notificationsFor('olivia');
      assert.equal(olivia[1].type, 'change_request_rejected');
      assert.equal(olivia[1].message, 'Your requested changes to Workshop were not approved. The confirmed details remain in effect.\nReason: Name is already in use.');
      // The database itself refuses an over-long reason even if the API check were bypassed.
      await assert.rejects(client.query('UPDATE event_change_requests SET decision_reason=$1 WHERE id=$2', ['x'.repeat(4001), second.id]), { code: '23514' });
    } finally {
      mock.restoreAll();
      if (server?.listening) await new Promise((resolve) => server.close(resolve));
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      client.release();
      await pool.end();
    }
  });
