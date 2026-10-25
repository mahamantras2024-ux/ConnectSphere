// File: "Record Offline Clarifications and Apply Agreed Amendments" end to end against real PostgreSQL in a disposable
// schema built from the production migrations: an offline clarification is recorded and resolved (AC1/AC2), the agreed
// amendment is applied with its history (AC3), the right people are told (AC4), the venue, technical and safety checks
// are redone (AC5) and a deadline change is reviewed (AC6).
// Test scope: Real routes, SQL, constraints and transactions; only Gmail delivery is replaced. Opt-in (RUN_DB_TESTS=1).
require('../../backend/node_modules/dotenv').config();
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { pool } = require('../../backend/src/config/db');
const emailService = require('../../backend/src/services/emailService');
const { applyLiveSchema, sqlFile } = require('./support/liveSchema');
const { loadDecisionContext } = require('../../backend/src/models/eventDecisionModel');
const { evaluateSafetyReview } = require('../../backend/src/services/eventDecisionPolicy');

// Test case: The coordinator records a phone call offline, resolves it and applies what was agreed to an approved event.
// Its booking waits for Venue Staff, its equipment for Technical Support and it returns to planning for a new safety
// check; once Venue Staff re-confirm, Safety Officers hear it is ready again. A deadline change is then approved.
test('OC AC1-AC6 - offline clarifications, agreed amendments, history and re-checks in PostgreSQL',
  { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
    const schema = `cs_offline_clar_${crypto.randomBytes(8).toString('hex')}`;
    const client = await pool.connect();
    let server;
    try {
      // ---------- Arrange: disposable schema, people, an approved event with a confirmed booking and safety check ----------
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, full_name VARCHAR(255), password_hash VARCHAR(255),
        role VARCHAR(50), roles TEXT[] NOT NULL DEFAULT '{}', organisation_name VARCHAR(255), auth_version INTEGER NOT NULL DEFAULT 0)`);
      await client.query(`CREATE TABLE venues (id SERIAL PRIMARY KEY, name VARCHAR(255), location VARCHAR(255), capacity INTEGER, supported_layouts TEXT[],
        accessibility_features TEXT[], facilities TEXT[], operating_hours VARCHAR(255), availability_status VARCHAR(50), pricing VARCHAR(255), mrt VARCHAR(255), image TEXT)`);
      await applyLiveSchema(client);
      const people = [['olivia', 'event_organiser'], ['chris', 'event_coordinator'], ['lee', 'event_coordinator_lead'], ['vera', 'venue_staff'],
        ['vic', 'venue_staff'], ['tess', 'technical_support'], ['sam', 'safety_officer'], ['otto', 'event_organiser'], ['ann', 'attendee']];
      for (const [name, role] of people) {
        await client.query('INSERT INTO users (email, full_name, role, roles) VALUES ($1, $2, $3::text, ARRAY[$3::text])', [`${name}@example.test`, name, role]);
      }
      const id = Object.fromEntries(people.map(([name], index) => [name, index + 1]));
      await client.query(`INSERT INTO venues (name, location, capacity, supported_layouts) VALUES ('Hall A', 'Level 1', 100, ARRAY['Theatre'])`);
      // Gala runs 18:00-20:00 Singapore time on 15 Oct 2030 (10:00-12:00 UTC) with a confirmed projector, and was approved
      // after Vera confirmed the hall and Sam passed its safety check.
      await client.query(`INSERT INTO events (organiser_id, coordinator_id, name, proposed_date, proposed_start_time, proposed_end_time,
        expected_attendance, room_layout_preference, equipment_items, equipment_confirmed_at, withdrawal_deadline, is_draft, status)
        VALUES ($1, $2, 'Gala', '2030-10-15', '18:00', '20:00', 60, 'Theatre', '[{"item":"Projector","quantity":1}]', now(),
          '2030-10-14T10:00:00Z', false, 'approved')`, [id.olivia, id.chris]);
      await client.query(`INSERT INTO venue_bookings (event_id, venue_id, requested_by, start_datetime, end_datetime, status, decision_by)
        VALUES (1, 1, $1, '2030-10-15T10:00:00Z', '2030-10-15T12:00:00Z', 'approved', $2)`, [id.chris, id.vera]);
      await client.query("INSERT INTO event_safety_checks (event_id, safety_officer_id, outcome, checked_at) VALUES (1, $1, 'approved', now() - interval '1 day')", [id.sam]);
      await client.query('INSERT INTO event_technical_support_assignments (event_id, staff_id) VALUES (1, $1)', [id.tess]);

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
      const notes = async () => (await client.query('SELECT user_id, type, title, message FROM notifications ORDER BY id')).rows;

      // ---------- AC1: the coordinator records an offline clarification ----------
      const offline = await as('chris', 'POST', '/events/1/clarifications/offline', { informationNeeded: ['expected_attendance'],
        message: 'How many guests now?', response: 'About 90.', outcome: 'Attendance to become 90.', comments: 'Phone call.', resolve: false });
      assert.equal(offline.status, 201);
      assert.equal((await as('otto', 'POST', '/events/1/clarifications/offline', { informationNeeded: ['name'], message: 'x', response: 'y' })).status, 403);
      assert.deepEqual((await client.query(`SELECT source, status, message, organiser_response, outcome, coordinator_comments, responded_at IS NOT NULL AS answered
        FROM event_clarification_requests`)).rows, [{ source: 'offline', status: 'responded', message: 'How many guests now?', organiser_response: 'About 90.',
        outcome: 'Attendance to become 90.', coordinator_comments: 'Phone call.', answered: true }]);

      // ---------- AC2: it is marked resolved and its history is kept ----------
      const clarificationId = offline.body.clarificationRequest.id;
      const resolved = await as('chris', 'POST', `/events/1/clarifications/${clarificationId}/resolve`, { comments: 'Confirmed in writing.' });
      assert.equal(resolved.status, 200);
      assert.equal((await as('chris', 'POST', `/events/1/clarifications/${clarificationId}/resolve`, {})).status, 409);
      const [row] = (await client.query('SELECT status, message, organiser_response, outcome, coordinator_comments, resolved_by FROM event_clarification_requests')).rows;
      assert.deepEqual(row, { status: 'resolved', message: 'How many guests now?', organiser_response: 'About 90.', outcome: 'Attendance to become 90.',
        coordinator_comments: 'Confirmed in writing.', resolved_by: id.chris });
      const [shown] = (await as('olivia', 'GET', '/events/1')).body.event.clarification_requests;
      assert.deepEqual([shown.status, shown.source, shown.resolved_by_name], ['resolved', 'offline', 'chris']);

      // ---------- AC3-AC5: the coordinator applies the agreed amendment ----------
      const applied = await as('chris', 'POST', '/events/1/agreed-amendments', { changes: { expectedAttendance: 90 },
        explanation: 'Agreed by phone.', clarificationId });
      assert.equal(applied.status, 201);
      const event = (await client.query(`SELECT expected_attendance, status, equipment_confirmed_at IS NULL AS technical_reopened,
        safety_recheck_required_at IS NOT NULL AS safety_reopened FROM events WHERE id = 1`)).rows[0];
      assert.deepEqual(event, { expected_attendance: 90, status: 'planning', technical_reopened: true, safety_reopened: true });
      assert.deepEqual((await client.query('SELECT recheck_required_at IS NOT NULL AS flagged, recheck_reason FROM venue_bookings')).rows,
        [{ flagged: true, recheck_reason: 'Event details relevant to the venue changed: Expected attendance.' }]);
      // History: the change is stored before -> after with who agreed it and which clarification it came from.
      const [stored] = (await client.query(`SELECT source, status, reviewed_by, clarification_id, applied_changes, rechecks->'returnedToPlanning' AS back
        FROM event_change_requests`)).rows;
      assert.deepEqual(stored, { source: 'coordinator_agreed', status: 'approved', reviewed_by: id.chris, clarification_id: clarificationId,
        applied_changes: [{ field: 'expectedAttendance', label: 'Expected attendance', before: 60, after: 90 }], back: true });
      for (const viewer of ['olivia', 'chris', 'lee']) {
        const [entry] = (await as(viewer, 'GET', '/events/1/amendment-requests')).body.amendmentRequests;
        assert.deepEqual([entry.source, entry.changes[0].before, entry.changes[0].after], ['coordinator_agreed', 60, 90]);
      }
      assert.equal((await as('otto', 'GET', '/events/1/amendment-requests')).status, 404);
      assert.equal((await as('ann', 'GET', '/events/1/amendment-requests')).status, 403);
      // AC4: the organiser, the booking's Venue Staff, the assigned Technical Support and Safety Officers - never attendees.
      const told = await notes();
      assert.deepEqual(told.map((note) => [note.user_id, note.type]), [[id.olivia, 'change_request_approved'], [id.vera, 'event_details_changed'],
        [id.tess, 'event_details_changed'], [id.sam, 'event_details_changed']]);
      assert.match(told[0].message, /^The Event Coordinator applied the amendment agreed with you to Gala\.\nExpected attendance: 60 → 90\nWhat was agreed: Agreed by phone\./);
      assert.match(told[1].message, /Venue booking at Hall A must be re-confirmed by Venue Staff[\s\S]*A new operational safety check is needed\./);
      assert.deepEqual(emails.map(([to]) => to), ['olivia@example.test', 'vera@example.test', 'tess@example.test', 'sam@example.test']);

      // ---------- AC5: the event is ready again only after every reopened check is done ----------
      const blocker = async () => evaluateSafetyReview({ ...await loadDecisionContext(client, 1), now: Date.now() })?.code ?? null;
      assert.equal(await blocker(), 'VENUE_RECHECK');
      // Technical Support confirms the reviewed equipment; the booking still waits, so Safety Officers are not told yet.
      await client.query('UPDATE events SET equipment_confirmed_at = now() WHERE id = 1');
      assert.equal(await blocker(), 'VENUE_RECHECK');
      assert.equal((await as('vic', 'PUT', '/venues/1/requests/1/recheck', { decision: 'maybe' })).status, 400);
      const reconfirmed = await as('vera', 'PUT', '/venues/1/requests/1/recheck', { decision: 'confirmed' });
      assert.deepEqual([reconfirmed.status, reconfirmed.body.request.status, reconfirmed.body.request.recheck_required_at], [200, 'approved', null]);
      assert.equal((await as('vera', 'PUT', '/venues/1/requests/1/recheck', { decision: 'confirmed' })).status, 409);
      assert.equal(await blocker(), null);
      const after = (await notes()).slice(told.length);
      assert.deepEqual(after.map((note) => [note.user_id, note.type, note.title]), [[id.chris, 'event_details_changed', 'Venue booking re-confirmed: Gala'],
        [id.sam, 'safety_check_ready', 'Ready for safety check: Gala']]);

      // ---------- AC6: the organiser asks to move the withdrawal deadline; the coordinator sees both values and approves ----------
      const deadline = await as('olivia', 'POST', '/events/1/amendment-requests', { changes: { withdrawalDeadline: '2030-10-13T12:00' },
        explanation: 'Caterer needs final numbers earlier.' });
      assert.equal(deadline.status, 202);
      const [inbox] = (await as('chris', 'GET', '/events/change-requests')).body.changeRequests;
      assert.equal(inbox.explanation, 'Caterer needs final numbers earlier.');
      assert.deepEqual(inbox.changes.map((change) => change.label), ['Withdrawal deadline']);
      assert.equal((await as('chris', 'POST', `/events/change-requests/${inbox.id}/decision`, { decision: 'approved' })).status, 200);
      assert.equal((await client.query('SELECT withdrawal_deadline::text FROM events WHERE id = 1')).rows[0].withdrawal_deadline.slice(0, 16), '2030-10-13 04:00');
      // A deadline after the event starts is refused.
      const late = await as('olivia', 'POST', '/events/1/amendment-requests', { changes: { registrationDeadline: '2030-10-15T18:01' }, explanation: 'Late.' });
      assert.equal(late.status, 400);

      // ---------- The database enforces the new rules, and the migration re-runs without losing data ----------
      // An offline record with neither the organiser's answer nor an outcome says nothing, so it is refused.
      await assert.rejects(client.query(`INSERT INTO event_clarification_requests (event_id, coordinator_id, organiser_id, information_needed, message, source)
        VALUES (1, $1, $2, '["name"]', 'x', 'offline')`, [id.chris, id.olivia]), { code: '23514' });
      await assert.rejects(client.query("UPDATE event_clarification_requests SET resolved_by = NULL"), { code: '23514' });
      await assert.rejects(client.query(`INSERT INTO event_change_requests (event_id, organiser_id, coordinator_id, requested_changes, source, status)
        VALUES (1, $1, $2, '{}', 'coordinator_agreed', 'pending')`, [id.olivia, id.chris]), { code: '23514' });
      await client.query(sqlFile('migrations/020-clarifications-and-amendment-history.sql'));
      assert.equal((await client.query("SELECT count(*)::int AS n FROM event_change_requests WHERE applied_changes IS NOT NULL")).rows[0].n, 2);
      assert.equal((await client.query("SELECT status FROM event_clarification_requests")).rows[0].status, 'resolved');
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
