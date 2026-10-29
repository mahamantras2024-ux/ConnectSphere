// File: Upgrade test for migration 013 (Tracks Equipment Request Status): reviews recorded under the older schema must
// survive the upgrade, and the coordinator must not be told an older partial review's items are available.
// Test scope: Real PostgreSQL in a disposable schema built from the migrations as they ran before 013; real routes for
// the coordinator's status view. Opt-in (RUN_DB_TESTS=1).
require('../../backend/node_modules/dotenv').config();
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { pool } = require('../../backend/src/config/db');

const sqlFile = (name) => fs.readFileSync(path.join(__dirname, '../../backend/src/db', name), 'utf8');
// The schema an existing deployment had before migration 013 (no affected_items column).
const beforeUpgrade = ['migrations/001-external-events.sql', 'venueManagementSchema.sql', 'migrations/002-event-change-requests.sql',
  'migrations/003-event-clarifications.sql', 'migrations/004-event-attachments.sql', 'migrations/004-event-equipment-requirements.sql',
  'migrations/005-change-request-review.sql', 'migrations/005-technical-support-reviews.sql', 'migrations/006-event-decisions.sql'];

// Test case: Legacy reviews (including a partial one with no affected items) are preserved by the upgrade, new partial
// reviews still need affected items, and the coordinator sees the legacy partial review's items as "not recorded".
test('ES AC3 - migration 013 upgrades a database holding older reviews without losing or rejecting them',
  { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
    const schema = `cs_equipment_upgrade_${crypto.randomBytes(8).toString('hex')}`;
    const client = await pool.connect();
    let server;
    try {
      // ---------- Arrange: the pre-013 schema with reviews recorded the old way ----------
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, full_name VARCHAR(255), password_hash VARCHAR(255),
        role VARCHAR(50), roles TEXT[] NOT NULL DEFAULT '{}', organisation_name VARCHAR(255), auth_version INTEGER NOT NULL DEFAULT 0)`);
      await client.query(`CREATE TABLE venues (id SERIAL PRIMARY KEY, name VARCHAR(255), location VARCHAR(255), capacity INTEGER, supported_layouts TEXT[],
        accessibility_features TEXT[], facilities TEXT[], operating_hours VARCHAR(255), availability_status VARCHAR(50), pricing VARCHAR(255), mrt VARCHAR(255), image TEXT)`);
      for (const file of beforeUpgrade) await client.query(sqlFile(file));
      for (const [email, role] of [['olivia@example.test', 'event_organiser'], ['chris@example.test', 'event_coordinator'], ['tina@example.test', 'technical_support']]) {
        await client.query('INSERT INTO users (email, full_name, role, roles) VALUES ($1, $1, $2::text, ARRAY[$2::text])', [email, role]);
      }
      await client.query(`INSERT INTO events (organiser_id, coordinator_id, name, proposed_date, proposed_start_time, proposed_end_time, expected_attendance,
          equipment_items, technical_support_required, technical_support_details, is_draft, status)
        VALUES (1, 2, 'Gala', '2030-10-15', '10:00', '12:00', 80, '[{"item":"Microphone","quantity":4}]', true, 'AV tech', false, 'submitted'),
               (1, 2, 'Talk', '2030-10-16', '10:00', '11:00', 30, '[{"item":"Projector","quantity":1}]', false, null, false, 'submitted')`);
      // Old-style reviews: no affected_items column exists yet. Event 1's current version was only partially fulfillable.
      await client.query(`INSERT INTO event_equipment_reviews (event_id, request_version, outcome, reason, reviewed_by) VALUES
        (1, 1, 'partially_fulfillable', 'Two microphones are under repair.', 3), (2, 1, 'fully_fulfillable', null, 3)`);

      // ---------- Act: upgrade, and upgrade again (deployments re-run every migration) ----------
      await client.query(sqlFile('migrations/013-equipment-review-affected-items.sql'));
      await client.query(sqlFile('migrations/013-equipment-review-affected-items.sql'));

      // ---------- Assert: legacy reviews are kept as they were ----------
      assert.deepEqual((await client.query('SELECT event_id, outcome, reason, affected_items FROM event_equipment_reviews ORDER BY event_id')).rows, [
        { event_id: 1, outcome: 'partially_fulfillable', reason: 'Two microphones are under repair.', affected_items: [] },
        { event_id: 2, outcome: 'fully_fulfillable', reason: null, affected_items: [] },
      ]);
      // New reviews still follow the rule: a partial review must name affected items; other outcomes name none.
      await assert.rejects(client.query("INSERT INTO event_equipment_reviews (event_id, request_version, outcome, reason, reviewed_by, affected_items) VALUES (1, 2, 'partially_fulfillable', 'x', 3, '[]')"), { code: '23514' });
      await assert.rejects(client.query("INSERT INTO event_equipment_reviews (event_id, request_version, outcome, reviewed_by, affected_items) VALUES (1, 2, 'fully_fulfillable', 3, '[{\"key\":\"equipment:0\"}]')"), { code: '23514' });
      await client.query("INSERT INTO event_equipment_reviews (event_id, request_version, outcome, reason, reviewed_by, affected_items) VALUES (2, 2, 'partially_fulfillable', 'x', 3, '[{\"key\":\"equipment:0\"}]')");

      // The coordinator sees the legacy partial review's items as not recorded, never as available.
      // Current routes require replacement tables added after this legacy fixture's original schema.
      await require('./support/liveSchema').applyLiveSchema(client);
      mock.method(pool, 'query', (sql, values) => client.query(sql, values));
      mock.method(pool, 'connect', async () => ({ query: (sql, values) => client.query(sql, values), release() {} }));
      const app = require('../../backend/src/index');
      server = app.listen(0, '127.0.0.1');
      await new Promise((resolve) => server.once('listening', resolve));
      const token = jwt.sign({ sub: 2, authVersion: 0 }, process.env.JWT_SECRET, { expiresIn: '1h' });
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/events/1/equipment-status`, { headers: { Authorization: `Bearer ${token}` } });
      const view = await response.json();
      assert.equal(response.status, 200);
      assert.deepEqual([view.status, view.review.reason, view.items.map((item) => [item.label, item.status])], ['partially_available', 'Two microphones are under repair.',
        [['Microphone', 'not_recorded'], ['On-site technical support', 'not_recorded']]]);
    } finally {
      mock.restoreAll();
      if (server?.listening) await new Promise((resolve) => server.close(resolve));
      await client.query('ROLLBACK').catch(() => {});
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      client.release();
      await pool.end();
    }
  });
