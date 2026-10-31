// File: Proves a real PostgreSQL repair transition enables reservation and preserves its resolution note.
// Test scope: Real migrations, API routes, SQL, transactions, and constraints in a disposable schema.
// Opt-in (RUN_DB_TESTS=1) because it requires a PostgreSQL connection.
require('../../backend/node_modules/dotenv').config();
const { test, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { pool } = require('../../backend/src/config/db');

const databaseFile = (file) => fs.readFileSync(
  path.join(__dirname, '../../backend/src/db', file),
  'utf8',
);

const migrations = [
  'migrations/001-external-events.sql',
  'migrations/002-event-change-requests.sql',
  'migrations/003-event-clarifications.sql',
  'migrations/004-event-attachments.sql',
  'migrations/004-event-equipment-requirements.sql',
  'migrations/005-change-request-review.sql',
  'migrations/005-technical-support-reviews.sql',
  'migrations/006-event-decisions.sql',
  'migrations/006-equipment-inventory-reservations.sql',
  'migrations/007-equipment-stock-quantities.sql',
  'migrations/012-equipment-repair-history.sql',
];

after(async () => {
  await pool.end();
});

test('AC1-AC2 - repaired equipment can be reserved and its resolution note persists in PostgreSQL history',
  { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
    const schema = `cs_repair_reservation_${crypto.randomBytes(8).toString('hex')}`;
    const client = await pool.connect();
    let server;

    try {
      // Arrange: create a disposable schema with only the supporting venue relation needed by reservation queries.
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL DEFAULT 'test-hash',
        role VARCHAR(50),
        roles TEXT[] NOT NULL DEFAULT '{}',
        organisation_name VARCHAR(255),
        auth_version INTEGER NOT NULL DEFAULT 0
      )`);
      await client.query('CREATE TABLE venues (id SERIAL PRIMARY KEY, name VARCHAR(255), location VARCHAR(255))');
      for (const file of migrations) await client.query(databaseFile(file));
      await client.query(`CREATE TABLE venue_bookings (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(id),
        venue_id INTEGER NOT NULL REFERENCES venues(id),
        status VARCHAR(50) NOT NULL,
        start_datetime TIMESTAMPTZ NOT NULL,
        end_datetime TIMESTAMPTZ NOT NULL
      )`);

      const support = (await client.query(
        `INSERT INTO users (email, full_name, role, roles)
         VALUES ('repair-support@example.test', 'Repair Support', 'technical_support', ARRAY['technical_support'])
         RETURNING id`,
      )).rows[0];
      const coordinator = (await client.query(
        `INSERT INTO users (email, full_name, role, roles)
         VALUES ('repair-coordinator@example.test', 'Repair Coordinator', 'event_coordinator', ARRAY['event_coordinator'])
         RETURNING id`,
      )).rows[0];
      const organiser = (await client.query(
        `INSERT INTO users (email, full_name, role, roles)
         VALUES ('repair-organiser@example.test', 'Repair Organiser', 'event_organiser', ARRAY['event_organiser'])
         RETURNING id`,
      )).rows[0];
      const repairDate = (await client.query(
        `SELECT (CURRENT_DATE + 30)::text AS reservation_date`,
      )).rows[0].reservation_date;
      const stock = (await client.query(
        `INSERT INTO equipments (asset_code, name, specification, status, quantity, availability_status)
         VALUES ('REPAIR-RESERVE-001', 'Repair Reservation Projector', 'Portable HD projector', 'maintenance', 1, 'Unavailable')
         RETURNING id`,
      )).rows[0];
      await client.query(
        `INSERT INTO technical_equipment_availability (inventory_id, available_date, start_time, end_time)
         VALUES ($1, $2::date, '09:00', '12:00')`,
        [stock.id, repairDate],
      );
      const event = (await client.query(
        `INSERT INTO events (
           organiser_id, coordinator_id, name, proposed_date, proposed_start_time, proposed_end_time,
           equipment_items, equipment_requirements_version, is_draft, status
         ) VALUES (
           $1, $2, 'Repair Reservation Test', $3::date, '09:00', '12:00',
           '[{"item":"Repair Reservation Projector","quantity":1}]'::jsonb, 1, false, 'submitted'
         ) RETURNING id`,
        [organiser.id, coordinator.id, repairDate],
      )).rows[0];
      await client.query(
        `INSERT INTO event_equipment_reviews (event_id, request_version, outcome, reviewed_by)
         VALUES ($1, 1, 'fully_fulfillable', $2)`,
        [event.id, support.id],
      );

      // AC6: production authorization reads this relation even when a prior review grants responsibility.
      await client.query('CREATE TABLE IF NOT EXISTS event_technical_support_assignments (event_id INT,staff_id INT)');
      mock.method(pool, 'query', (sql, values) => client.query(sql, values));
      mock.method(pool, 'connect', async () => ({
        query: (sql, values) => client.query(sql, values),
        release() {},
      }));
      process.env.JWT_SECRET = process.env.JWT_SECRET || 'equipment-repair-postgres-test-secret';
      const app = require('../../backend/src/index');
      server = app.listen(0, '127.0.0.1');
      await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
      });

      const token = jwt.sign({
        sub: support.id,
        role: 'technical_support',
        authVersion: 0,
      }, process.env.JWT_SECRET, { expiresIn: '1h' });
      const baseUrl = `http://127.0.0.1:${server.address().port}/api/events`;
      const resolutionNote = 'Replaced the damaged lamp and passed the projection test.';

      // Act: repair through the authorised API, then reserve that exact asset for a reviewed future event.
      const repairResponse = await fetch(`${baseUrl}/equipment-inventory/${stock.id}/repair`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ resolutionNote }),
      });
      const repair = await repairResponse.json();
      const reservationResponse = await fetch(`${baseUrl}/${event.id}/equipment-reservations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ selections: [{ inventoryId: stock.id, quantity: 1 }] }),
      });
      const reservation = await reservationResponse.json();

      // Assert: a successful reservation proves repaired stock is eligible; persisted history proves the audit is durable.
      assert.equal(repairResponse.status, 200);
      assert.equal(repair.equipment.availability_status, 'Available');
      assert.equal(reservationResponse.status, 201);
      assert.equal(reservation.reservation.event_id, event.id);
      assert.deepEqual(
        (await client.query(
          `SELECT history.status, history.note, history.changed_by, staff.full_name AS changed_by_name
           FROM equipment_status_history history
           LEFT JOIN users staff ON staff.id=history.changed_by
           WHERE history.inventory_id=$1 AND history.note=$2`,
          [stock.id, resolutionNote],
        )).rows,
        [{
          status: 'Available',
          note: resolutionNote,
          changed_by: support.id,
          changed_by_name: 'Repair Support',
        }],
      );
      assert.deepEqual(
        (await client.query(
          `SELECT inventory_id, quantity
           FROM event_equipment_reservation_items
           WHERE reservation_id=$1`,
          [reservation.reservation.id],
        )).rows,
        [{ inventory_id: stock.id, quantity: 1 }],
      );
    } finally {
      mock.restoreAll();
      if (server?.listening) await new Promise((resolve) => server.close(resolve));
      await client.query('ROLLBACK').catch(() => {});
      await client.query('RESET search_path').catch(() => {});
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
      client.release();
    }
  });
