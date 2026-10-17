// File: Verifies reservation release and slot availability against disposable PostgreSQL data.
const { after, test, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
require('../../backend/node_modules/dotenv').config({ path: path.join(__dirname, '../../backend/.env') });
const { pool } = require('../../backend/src/config/db');
const eventModel = require('../../backend/src/models/eventModel');

after(async () => pool.end());

// This test uses a random schema and only runs when the database suite is explicitly enabled.
test('AC1-AC3 - releases seeded postponed/cancelled reservations and restores PostgreSQL slot availability', {
  skip: process.env.RUN_DB_TESTS !== '1',
}, async () => {
  const schema = `cs_equipment_release_${crypto.randomBytes(8).toString('hex')}`;
  const client = await pool.connect();
  let schemaCreated = false;

  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    schemaCreated = true;
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`CREATE TABLE users (
      id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, password_hash VARCHAR(255) NOT NULL,
      full_name VARCHAR(255) NOT NULL, role VARCHAR(50), roles TEXT[] NOT NULL DEFAULT '{}',
      organisation_name VARCHAR(255), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await client.query(`CREATE TABLE venues (id SERIAL PRIMARY KEY, name VARCHAR(255), location VARCHAR(255))`);
    await client.query(`CREATE TABLE venue_bookings (
      id SERIAL PRIMARY KEY, event_id INTEGER, venue_id INTEGER REFERENCES venues(id),
      status VARCHAR(32), start_datetime TIMESTAMPTZ
    )`);
    for (const file of [
      'migrations/001-external-events.sql',
      'migrations/004-event-equipment-requirements.sql',
      'migrations/005-technical-support-reviews.sql',
    ]) {
      const migration = fs.readFileSync(path.join(__dirname, '../../backend/src/db', file), 'utf8');
      await client.query(migration);
    }
    // Build only the equipment tables used by the scenario; this avoids invoking inventory seeding that targets public.
    await client.query(`CREATE TABLE equipments (
      id SERIAL PRIMARY KEY, asset_code VARCHAR(20) NOT NULL UNIQUE, name VARCHAR(255) NOT NULL,
      specification TEXT NOT NULL, status VARCHAR(32) NOT NULL, quantity INTEGER NOT NULL DEFAULT 1,
      availability_status VARCHAR(20) NOT NULL DEFAULT 'Available',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await client.query(`CREATE TABLE technical_equipment_availability (
      id SERIAL PRIMARY KEY, inventory_id INTEGER NOT NULL REFERENCES equipments(id) ON DELETE CASCADE,
      available_date DATE NOT NULL, start_time TIME NOT NULL, end_time TIME NOT NULL,
      UNIQUE (inventory_id, available_date, start_time, end_time)
    )`);
    await client.query(`CREATE TABLE event_equipment_reservations (
      id SERIAL PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      request_version INTEGER NOT NULL, event_date DATE NOT NULL, start_time TIME NOT NULL,
      end_time TIME NOT NULL, venue_name VARCHAR(255), venue_location VARCHAR(255),
      status VARCHAR(20) NOT NULL DEFAULT 'reserved', reserved_by INTEGER NOT NULL REFERENCES users(id),
      reserved_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (event_id, request_version)
    )`);
    await client.query(`CREATE TABLE event_equipment_reservation_items (
      reservation_id INTEGER NOT NULL REFERENCES event_equipment_reservations(id) ON DELETE CASCADE,
      inventory_id INTEGER NOT NULL REFERENCES equipments(id), quantity INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (reservation_id, inventory_id)
    )`);
    const releaseMigration = fs.readFileSync(
      path.join(__dirname, '../../backend/src/db/migrations/013-equipment-reservation-release-audit.sql'),
      'utf8',
    );
    await client.query(releaseMigration);
    await client.query(releaseMigration);
    await client.query(`INSERT INTO equipments (asset_code, name, specification, status, quantity)
      VALUES ('PROJ-001', 'Projector', 'Full HD', 'operational', 2)`);

    const demoSeed = fs.readFileSync(
      path.join(__dirname, '../../backend/src/db/seeds/equipment-reservation-release.sql'),
      'utf8',
    );
    await client.query(demoSeed);
    await client.query(demoSeed);

    // Redirect model queries to the connection whose search_path points only at this temporary schema.
    mock.method(pool, 'query', (sql, values) => client.query(sql, values));
    mock.method(pool, 'connect', async () => client);
    mock.method(client, 'release', () => {});

    const staff = (await client.query(
      "SELECT id FROM users WHERE email='equipment-release-demo-support@connectsphere.invalid'",
    )).rows[0];
    const cancelledReservation = (await client.query(`
      SELECT reservation.id, reservation.event_id
      FROM event_equipment_reservations reservation
      JOIN events e ON e.id=reservation.event_id
      WHERE e.name='[DEMO] Cancelled equipment event'
    `)).rows[0];
    const postponedReservation = (await client.query(`
      SELECT reservation.id, reservation.event_id
      FROM event_equipment_reservations reservation
      JOIN events e ON e.id=reservation.event_id
      WHERE e.name='[DEMO] Postponed equipment event'
    `)).rows[0];
    const replacementEvent = (await client.query(
      "SELECT id FROM events WHERE name='[DEMO] Replacement equipment event'",
    )).rows[0];

    // Arrange two reservations for one two-unit asset at the replacement event's requested time.
    const beforeRelease = await eventModel.getEquipmentReservationAvailability(replacementEvent.id);
    assert.equal(beforeRelease.items[0].availableQuantity, 0);

    // Act: release both the cancelled event's allocation and the old slot for its postponed event.
    const cancelledRelease = await eventModel.releaseEquipmentReservation(cancelledReservation.id, staff.id);
    const afterFirstRelease = await eventModel.getEquipmentReservationAvailability(replacementEvent.id);
    const postponedRelease = await eventModel.releaseEquipmentReservation(postponedReservation.id, staff.id);

    // Assert: each release returns a complete database audit and frees the stock for a fresh check.
    assert.equal(cancelledRelease.released_by, staff.id);
    assert.ok(cancelledRelease.released_at instanceof Date);
    assert.equal(afterFirstRelease.items[0].availableQuantity, 1);
    assert.equal(postponedRelease.released_by, staff.id);
    assert.ok(postponedRelease.released_at instanceof Date);
    const afterRelease = await eventModel.getEquipmentReservationAvailability(replacementEvent.id);
    assert.equal(afterRelease.items[0].availableQuantity, 2);

    const reservations = await eventModel.listActiveEquipmentReservations();
    assert.equal(reservations.filter(item => item.status === 'cancelled').length, 2);
    assert.ok(reservations.every(item => item.released_by_name === 'Equipment Release Demo Support'));
  } finally {
    mock.restoreAll();
    if (schemaCreated) {
      await client.query('SET search_path TO public');
      await client.query(`DROP SCHEMA ${schema} CASCADE`);
    }
    client.release();
  }
});
