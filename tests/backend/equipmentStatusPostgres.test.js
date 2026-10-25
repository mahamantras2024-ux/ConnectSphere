// File: Tracks Equipment Request Status against real PostgreSQL in a disposable schema built from the real migrations.
// Test scope: Real routes, SQL, transactions and constraints; only the pool is pointed at the disposable schema and email
// is captured. Opt-in (RUN_DB_TESTS=1).
require('../../backend/node_modules/dotenv').config();
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { pool } = require('../../backend/src/config/db');
const emailService = require('../../backend/src/services/emailService');

const sqlFile = (name) => fs.readFileSync(path.join(__dirname, '../../backend/src/db', name), 'utf8');
const migrations = ['migrations/001-external-events.sql', 'venueManagementSchema.sql', 'venueScheduleSchema.sql', 'venueAvailabilitySchema.sql',
  'migrations/002-event-change-requests.sql', 'migrations/003-event-clarifications.sql', 'migrations/004-event-attachments.sql',
  'migrations/004-event-equipment-requirements.sql', 'migrations/005-change-request-review.sql', 'migrations/005-technical-support-reviews.sql',
  'migrations/006-event-decisions.sql', 'migrations/012-event-cancellation-notifications.sql', 'migrations/013-equipment-review-affected-items.sql',
  // A full review can make the event ready for its safety check, which reads 010/011's safety facts and notifies with 017's type.
  'migrations/010-venue-safety-facts.sql', 'migrations/011-safety-change-stages.sql', 'migrations/017-parent-notifications.sql'];

// Test case: Pending -> partially available (affected items) -> approved amendment -> pending -> confirmed -> approved amendment -> pending.
test('ES AC1-AC3 - equipment request status, affected items and coordinator notifications follow the real workflow in PostgreSQL',
  { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
    const schema = `cs_equipment_status_${crypto.randomBytes(8).toString('hex')}`;
    const client = await pool.connect();
    let server;
    try {
      // ---------- Arrange: disposable schema, the people involved and one submitted event ----------
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, full_name VARCHAR(255), password_hash VARCHAR(255),
        role VARCHAR(50), roles TEXT[] NOT NULL DEFAULT '{}', organisation_name VARCHAR(255), auth_version INTEGER NOT NULL DEFAULT 0)`);
      await client.query(`CREATE TABLE venues (id SERIAL PRIMARY KEY, name VARCHAR(255), location VARCHAR(255), capacity INTEGER, supported_layouts TEXT[],
        accessibility_features TEXT[], facilities TEXT[], operating_hours VARCHAR(255), availability_status VARCHAR(50), pricing VARCHAR(255), mrt VARCHAR(255), image TEXT)`);
      for (const file of migrations) await client.query(sqlFile(file));
      // Amendment requests carry the organiser's explanation (post-submission amendments story).
      await client.query(sqlFile('migrations/019-amendment-explanations.sql'));
      const people = [['olivia', 'event_organiser'], ['chris', 'event_coordinator'], ['tina', 'technical_support'], ['cara', 'event_coordinator']];
      for (const [name, role] of people) await client.query('INSERT INTO users (email, full_name, role, roles) VALUES ($1, $2, $3::text, ARRAY[$3::text])', [`${name}@example.test`, name, role]);
      const id = { olivia: 1, chris: 2, tina: 3, cara: 4 };
      await client.query(`INSERT INTO events (organiser_id, coordinator_id, name, proposed_date, proposed_start_time, proposed_end_time, expected_attendance,
          equipment_items, technical_support_required, technical_support_details, is_draft, status)
        VALUES (1, 2, 'Gala', '2030-10-15', '10:00', '12:00', 80, '[{"item":"Microphone","quantity":4}]', true, 'AV tech', false, 'submitted')`);

      mock.method(pool, 'query', (sql, values) => client.query(sql, values));
      mock.method(pool, 'connect', async () => ({ query: (sql, values) => client.query(sql, values), release() {} }));
      const emails = [];
      mock.method(emailService, 'sendNotificationEmail', async (to, subject) => { emails.push([to, subject]); });
      const app = require('../../backend/src/index');
      server = app.listen(0, '127.0.0.1');
      await new Promise((resolve) => server.once('listening', resolve));
      const base = `http://127.0.0.1:${server.address().port}/api/events`;
      // Calls the API as one of the seeded people.
      async function as(person, method, url, body) {
        const token = jwt.sign({ sub: id[person], authVersion: 0 }, process.env.JWT_SECRET, { expiresIn: '1h' });
        const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, body: await response.json() };
      }
      const status = async () => (await as('chris', 'GET', '/1/equipment-status')).body;
      const chrisNotes = async () => (await client.query("SELECT title FROM notifications WHERE user_id = 2 AND type = 'equipment_status_changed' ORDER BY id")).rows.map((row) => row.title);

      // ---------- AC1: submitted, not yet reviewed; only the assigned coordinator can see it ----------
      assert.equal((await status()).status, 'pending');
      assert.equal((await as('cara', 'GET', '/1/equipment-status')).status, 404);

      // ---------- AC2/AC3: Technical Support finds only 2 of 4 microphones ----------
      assert.equal((await as('tina', 'POST', '/1/equipment-reviews', { outcome: 'partially_fulfillable', reason: 'Two are under repair.', requestVersion: 1 })).status, 400);
      const partial = await as('tina', 'POST', '/1/equipment-reviews',
        { outcome: 'partially_fulfillable', reason: 'Two are under repair.', requestVersion: 1, affectedItems: [{ key: 'equipment:0', availableQuantity: 2 }] });
      assert.equal(partial.status, 201);
      let view = await status();
      assert.deepEqual([view.status, view.items.map((item) => [item.label, item.status, item.availableQuantity])],
        ['partially_available', [['Microphone', 'affected', 2], ['On-site technical support', 'available', null]]]);
      assert.deepEqual(await chrisNotes(), ['Equipment request partially available: Gala']);
      assert.deepEqual(emails, [['chris@example.test', 'Equipment request partially available: Gala']]);

      // ---------- AC2: the organiser reduces the request through an amendment; once approved it is pending again ----------
      // A submitted request is never edited directly (post-submission amendments story); the coordinator approves the change.
      const equipmentBlock = (quantity) => ({ equipmentItems: [{ item: 'Microphone', quantity }], technicalSupportRequired: true,
        technicalSupportDetails: 'AV tech', videoConferencingRequired: false, technicalSpecifications: null });
      assert.equal((await as('olivia', 'PUT', '/1/equipment', equipmentBlock(2))).status, 409);
      const reduced = await as('olivia', 'POST', '/1/amendment-requests', { changes: equipmentBlock(2), explanation: 'Two microphones are enough.' });
      assert.equal(reduced.status, 202);
      assert.equal((await as('chris', 'POST', `/change-requests/${reduced.body.amendmentRequest.id}/decision`, { decision: 'approved' })).status, 200);
      view = await status();
      assert.deepEqual([view.status, view.version, view.history.map((entry) => entry.status)], ['pending', 2, ['partially_available']]);

      // ---------- AC1/AC2: Technical Support confirms the new version ----------
      assert.equal((await as('tina', 'POST', '/1/equipment-reviews', { outcome: 'fully_fulfillable', requestVersion: 2 })).status, 201);
      view = await status();
      assert.deepEqual([view.status, view.items.map((item) => item.status)], ['confirmed', ['available', 'available']]);
      assert.equal((await chrisNotes()).at(-1), 'Equipment request confirmed: Gala');

      // ---------- AC1: an approved equipment change after confirmation sends the request back for review ----------
      const change = await as('olivia', 'POST', '/1/amendment-requests', { changes: equipmentBlock(3), explanation: 'One more speaker.' });
      assert.equal(change.status, 202);
      assert.equal((await as('chris', 'POST', `/change-requests/${change.body.amendmentRequest.id}/decision`, { decision: 'approved' })).status, 200);
      assert.deepEqual((await client.query('SELECT equipment_requirements_version AS v, equipment_confirmed_at FROM events WHERE id = 1')).rows[0], { v: 3, equipment_confirmed_at: null });
      view = await status();
      assert.deepEqual([view.status, view.items[0].quantity], ['pending', 3]);
      assert.equal((await as('tina', 'GET', '/equipment-requests')).body.requests[0].request_version, 3);

      // ---------- The database enforces the affected-item rule and the new notification type ----------
      for (const [outcome, affected] of [['partially_fulfillable', '[]'], ['fully_fulfillable', '[{"key":"equipment:0"}]'], ['partially_fulfillable', '{}']]) {
        await assert.rejects(client.query('INSERT INTO event_equipment_reviews (event_id, request_version, outcome, reason, reviewed_by, affected_items) VALUES (1, 99, $1, $2, 3, $3::jsonb)',
          [outcome, 'x', affected]), { code: '23514' });
      }
      await client.query("INSERT INTO notifications (user_id, type, title, message) VALUES (2, 'safety_check_recorded', 't', 'm')");
      await assert.rejects(client.query("INSERT INTO notifications (user_id, type, title, message) VALUES (2, 'unknown_type', 't', 'm')"), { code: '23514' });
      // Re-running every migration keeps stored reviews. 006 runs before 013 on each deploy, so it must also allow the
      // equipment_status_changed notifications stored above (regression: a re-run failed once one existed).
      assert.ok((await client.query("SELECT count(*)::int AS n FROM notifications WHERE type = 'equipment_status_changed'")).rows[0].n > 0);
      // The attendee story's event_cancelled type (migration 012) is stored too: every migration that redefines the type
      // list must keep both, in whichever order they re-run.
      await client.query("INSERT INTO notifications (user_id, type, title, message) VALUES (1, 'event_cancelled', 't', 'm')");
      for (const file of ['006-event-decisions', '012-event-cancellation-notifications', '013-equipment-review-affected-items', '006-event-decisions']) {
        await client.query(sqlFile(`migrations/${file}.sql`));
      }
      await client.query("INSERT INTO notifications (user_id, type, title, message) VALUES (1, 'event_cancelled', 't', 'm'), (2, 'equipment_status_changed', 't', 'm')");
      assert.deepEqual((await client.query("SELECT affected_items FROM event_equipment_reviews WHERE outcome = 'partially_fulfillable'")).rows[0].affected_items,
        [{ key: 'equipment:0', availableQuantity: 2 }]);
    } finally {
      mock.restoreAll();
      if (server?.listening) await new Promise((resolve) => server.close(resolve));
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      client.release();
      await pool.end();
    }
  });
