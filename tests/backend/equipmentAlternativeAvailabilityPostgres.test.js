// File: Reproduces replacement availability changing while a proposal waits for the stock row lock.
// Test scope: Real PostgreSQL READ COMMITTED transactions in a disposable schema; opt-in with RUN_DB_TESTS=1.
require('../../backend/node_modules/dotenv').config();
const { test, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../../backend/src/config/db');
const notificationService = require('../../backend/src/services/notificationService');
const { suggestAlternative } = require('../../backend/src/services/equipmentReservationUnavailability');

const sqlFile = (name) => fs.readFileSync(path.join(__dirname, '../../backend/src/db', name), 'utf8');

after(async () => {
  await pool.end();
});

test('AC1 - rejects a replacement when a reservation commits while its stock lock is awaited',
  { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
    const schema = `cs_alternative_availability_${crypto.randomBytes(8).toString('hex')}`;
    const setupClient = await pool.connect();
    const connect = pool.connect.bind(pool);
    let lockClient;
    let proposalPromise;
    let lockTransactionOpen = false;

    try {
      // Arrange: build just the real reservation workflow schema in isolation and seed one unit of replacement stock.
      await setupClient.query(`CREATE SCHEMA ${schema}`);
      await setupClient.query(`SET search_path TO ${schema}`);
      await setupClient.query(`CREATE TABLE users (
        id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, full_name VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL DEFAULT 'test-hash', role VARCHAR(50),
        roles TEXT[] NOT NULL DEFAULT '{}', organisation_name VARCHAR(255), auth_version INTEGER NOT NULL DEFAULT 0
      )`);
      await setupClient.query(sqlFile('migrations/001-external-events.sql'));
      await setupClient.query(`CREATE TABLE equipments (
        id SERIAL PRIMARY KEY, asset_code VARCHAR(20) NOT NULL UNIQUE, name VARCHAR(255) NOT NULL,
        specification TEXT NOT NULL, status VARCHAR(32) NOT NULL, quantity INTEGER NOT NULL DEFAULT 1,
        availability_status VARCHAR(20) NOT NULL DEFAULT 'Available', updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      await setupClient.query(`CREATE TABLE technical_equipment_availability (
        id SERIAL PRIMARY KEY, inventory_id INTEGER NOT NULL REFERENCES equipments(id),
        available_date DATE NOT NULL, start_time TIME NOT NULL, end_time TIME NOT NULL,
        UNIQUE (inventory_id, available_date, start_time, end_time)
      )`);
      await setupClient.query(`CREATE TABLE event_equipment_reservations (
        id SERIAL PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id),
        request_version INTEGER NOT NULL, event_date DATE NOT NULL, start_time TIME NOT NULL, end_time TIME NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'reserved', reserved_by INTEGER NOT NULL REFERENCES users(id),
        UNIQUE (event_id, request_version)
      )`);
      await setupClient.query(`CREATE TABLE event_equipment_reservation_items (
        reservation_id INTEGER NOT NULL REFERENCES event_equipment_reservations(id),
        inventory_id INTEGER NOT NULL REFERENCES equipments(id), quantity INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (reservation_id, inventory_id)
      )`);
      await setupClient.query(`CREATE TABLE notifications (
        id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
        event_id INTEGER REFERENCES events(id), change_request_id INTEGER,
        type VARCHAR(64) NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL, details JSONB NOT NULL
      )`);
      await setupClient.query(`CREATE TABLE event_technical_support_assignments (
        event_id INTEGER NOT NULL REFERENCES events(id), staff_id INTEGER NOT NULL REFERENCES users(id),
        PRIMARY KEY (event_id, staff_id)
      )`);
      await setupClient.query(sqlFile('migrations/014-equipment-reservation-unavailability.sql'));
      // The current replacement workflow stores suggestion state added by migration 015.
      await setupClient.query(sqlFile('migrations/015-equipment-replacement-suggestions.sql'));

      const support = (await setupClient.query(
        `INSERT INTO users (email, full_name, role) VALUES ('support@example.test', 'Test Support', 'technical_support') RETURNING id`,
      )).rows[0];
      const coordinator = (await setupClient.query(
        `INSERT INTO users (email, full_name, role) VALUES ('coordinator@example.test', 'Test Coordinator', 'event_coordinator') RETURNING id`,
      )).rows[0];
      const organiser = (await setupClient.query(
        `INSERT INTO users (email, full_name, role) VALUES ('organiser@example.test', 'Test Organiser', 'event_organiser') RETURNING id`,
      )).rows[0];
      const event = (await setupClient.query(
        `INSERT INTO events (organiser_id, coordinator_id, name, status)
         VALUES ($1, $2, 'Replacement Availability Race', 'confirmed') RETURNING id`,
        [organiser.id, coordinator.id],
      )).rows[0];
      const reservationDate = (await setupClient.query(
        'SELECT (CURRENT_DATE + 30)::text AS reservation_date',
      )).rows[0].reservation_date;
      const unavailable = (await setupClient.query(
        `INSERT INTO equipments (asset_code, name, specification, status, quantity, availability_status)
         VALUES ('RACE-OLD', 'Projector', 'Old projector', 'maintenance', 1, 'Unavailable') RETURNING id`,
      )).rows[0];
      const alternative = (await setupClient.query(
        `INSERT INTO equipments (asset_code, name, specification, status, quantity, availability_status)
         VALUES ('RACE-NEW', 'Projector', 'Replacement projector', 'operational', 1, 'Available') RETURNING id`,
      )).rows[0];
      await setupClient.query(
        `INSERT INTO technical_equipment_availability (inventory_id, available_date, start_time, end_time)
         VALUES ($1, $2::date, '09:00', '12:00')`,
        [alternative.id, reservationDate],
      );
      const affectedReservation = (await setupClient.query(
        `INSERT INTO event_equipment_reservations
           (event_id, request_version, event_date, start_time, end_time, status, reserved_by)
         VALUES ($1, 1, $2::date, '09:00', '12:00', 'reserved', $3) RETURNING id`,
        [event.id, reservationDate, organiser.id],
      )).rows[0];
      await setupClient.query(
        `INSERT INTO event_equipment_reservation_items (reservation_id, inventory_id, quantity)
         VALUES ($1, $2, 1)`,
        [affectedReservation.id, unavailable.id],
      );
      const issue = (await setupClient.query(
        `INSERT INTO equipment_reservation_unavailability (reservation_id, inventory_id, reason, created_by)
         VALUES ($1, $2, 'Damaged before event', $3) RETURNING id`,
        [affectedReservation.id, unavailable.id, support.id],
      )).rows[0];
      await setupClient.query(
        `INSERT INTO event_technical_support_assignments (event_id, staff_id) VALUES ($1, $2)`,
        [event.id, support.id],
      );

      // Give the service's actual pooled connection the disposable schema and a queryable identity.
      mock.method(pool, 'connect', async () => {
        const client = await connect();
        await client.query(`SET search_path TO ${schema}`);
        await client.query("SET application_name TO 'alternative-availability-race'");
        return client;
      });
      mock.method(notificationService, 'emailNotifications', async () => 0);
      lockClient = await connect();
      await lockClient.query(`SET search_path TO ${schema}`);
      await lockClient.query('BEGIN');
      lockTransactionOpen = true;
      await lockClient.query('SELECT id FROM equipments WHERE id=$1 FOR UPDATE', [alternative.id]);

      // Act: start proposing against that locked row, then reserve its only unit before releasing the lock.
      proposalPromise = suggestAlternative(issue.id, alternative.id, support.id);
      // Observe early rejection immediately so a setup failure cannot become an unhandled rejection.
      proposalPromise.catch(() => {});
      let proposalIsWaiting = false;
      for (let attempt = 0; attempt < 250; attempt += 1) {
        const waiting = await setupClient.query(
          `SELECT pid FROM pg_stat_activity
           WHERE application_name='alternative-availability-race'
             AND wait_event_type='Lock' AND query ILIKE '%equipments%'
           LIMIT 1`,
        );
        if (waiting.rows.length) {
          proposalIsWaiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(proposalIsWaiting, true, 'the proposal transaction must reach and wait on the locked stock row');

      await lockClient.query(
        `INSERT INTO event_equipment_reservations
           (event_id, request_version, event_date, start_time, end_time, status, reserved_by)
         VALUES ($1, 2, $2::date, '09:00', '12:00', 'reserved', $3)`,
        [event.id, reservationDate, organiser.id],
      );
      await lockClient.query(
        `INSERT INTO event_equipment_reservation_items (reservation_id, inventory_id, quantity)
         SELECT id, $2, 1 FROM event_equipment_reservations WHERE event_id=$1 AND request_version=2`,
        [event.id, alternative.id],
      );
      await lockClient.query('COMMIT');
      lockTransactionOpen = false;

      // Assert: the new committed reservation is visible to a fresh availability statement and no proposal is saved.
      await assert.rejects(proposalPromise, (error) => error.status === 409
        && error.message.includes('no longer available'));
      const storedProposals = await setupClient.query(
        'SELECT id FROM equipment_reservation_alternative_proposals WHERE unavailability_id=$1',
        [issue.id],
      );
      assert.deepEqual(storedProposals.rows, []);
    } finally {
      if (lockTransactionOpen) await lockClient.query('ROLLBACK').catch(() => {});
      if (proposalPromise) await proposalPromise.catch(() => {});
      mock.restoreAll();
      await setupClient.query('RESET search_path').catch(() => {});
      await setupClient.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
      setupClient.release();
      if (lockClient) lockClient.release();
    }
  });
