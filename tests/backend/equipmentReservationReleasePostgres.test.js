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
test('AC1-AC3 and PR42-AC1 - releases reservations and permits audited rebooking after postponement', {
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
    // TS status AC6: production release SQL also checks explicit assignments; include that relation in this partial schema.
    await client.query('CREATE TABLE event_technical_support_assignments (event_id INTEGER, staff_id INTEGER)');
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
    const rebookingMigration = fs.readFileSync(
      path.join(__dirname, '../../backend/src/db/migrations/014-active-equipment-reservation-uniqueness.sql'),
      'utf8',
    );
    await client.query(rebookingMigration);
    await client.query(rebookingMigration);
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
    // Availability and booking require a current coordinator assignment in the production model.
    await client.query('UPDATE events SET coordinator_id=$1 WHERE id=$2', [staff.id, replacementEvent.id]);

    // Arrange two reservations for one two-unit asset at the replacement event's requested time.
    const beforeRelease = await eventModel.getEquipmentReservationAvailability(replacementEvent.id, [], staff.id);
    assert.equal(beforeRelease.items[0].availableQuantity, 0);

    // Act: release both the cancelled event's allocation and the old slot for its postponed event.
    const cancelledRelease = await eventModel.releaseEquipmentReservation(cancelledReservation.id, staff.id);
    const afterFirstRelease = await eventModel.getEquipmentReservationAvailability(replacementEvent.id, [], staff.id);
    const postponedRelease = await eventModel.releaseEquipmentReservation(postponedReservation.id, staff.id);

    // Assert: each release returns a complete database audit and frees the stock for a fresh check.
    assert.equal(cancelledRelease.released_by, staff.id);
    assert.ok(cancelledRelease.released_at instanceof Date);
    assert.equal(afterFirstRelease.items[0].availableQuantity, 1);
    assert.equal(postponedRelease.released_by, staff.id);
    assert.ok(postponedRelease.released_at instanceof Date);
    const afterRelease = await eventModel.getEquipmentReservationAvailability(replacementEvent.id, [], staff.id);
    assert.equal(afterRelease.items[0].availableQuantity, 2);

    // Arrange: give one reviewed event a future slot, matching stock windows, and unchanged request version.
    const organiser = (await client.query(
      "SELECT id FROM users WHERE email='equipment-release-demo-organiser@connectsphere.invalid'",
    )).rows[0];
    const coordinator = (await client.query(`
      INSERT INTO users (email, password_hash, full_name, role, roles)
      VALUES ('equipment-rebooking-demo-coordinator@connectsphere.invalid', 'not-a-login-account',
        'Equipment Rebooking Demo Coordinator', 'event_coordinator', ARRAY['event_coordinator'])
      RETURNING id
    `)).rows[0];
    const projector = (await client.query(
      "SELECT id FROM equipments WHERE asset_code='PROJ-001'",
    )).rows[0];
    const rebookingEvent = (await client.query(`
      INSERT INTO events (
        organiser_id, coordinator_id, name, proposed_date, proposed_start_time, proposed_end_time,
        equipment_items, is_draft, status
      )
      VALUES ($1, $2, '[TEST] Equipment rebooking event', CURRENT_DATE + 30, '09:00', '12:00',
        '[{"item":"Projector","quantity":1}]'::jsonb, false, 'planning')
      RETURNING id
    `, [organiser.id, coordinator.id])).rows[0];
    await client.query(`
      INSERT INTO event_equipment_reviews (event_id, request_version, outcome, reviewed_by)
      VALUES ($1, 1, 'fully_fulfillable', $2)
    `, [rebookingEvent.id, staff.id]);
    await client.query(`
      INSERT INTO technical_equipment_availability (inventory_id, available_date, start_time, end_time)
      SELECT id, CURRENT_DATE + days_after, '09:00', '12:00'
      FROM equipments CROSS JOIN (VALUES (30), (37)) AS slots(days_after)
      WHERE asset_code='PROJ-001'
      ON CONFLICT (inventory_id, available_date, start_time, end_time) DO NOTHING
    `);

    // Act: reserve, postpone the event without changing its request version, release, then reserve again.
    const firstBooking = await eventModel.createEquipmentReservation(
      rebookingEvent.id, [{ inventoryId: projector.id, quantity: 1 }], staff.id,
    );
    assert.ok(firstBooking.reservation);
    await client.query(
      'UPDATE events SET proposed_date=CURRENT_DATE + 37 WHERE id=$1',
      [rebookingEvent.id],
    );
    const rebookingRelease = await eventModel.releaseEquipmentReservation(firstBooking.reservation.id, staff.id);
    const secondBooking = await eventModel.createEquipmentReservation(
      rebookingEvent.id, [{ inventoryId: projector.id, quantity: 1 }], staff.id,
    );
    const duplicateActiveBooking = await eventModel.createEquipmentReservation(
      rebookingEvent.id, [{ inventoryId: projector.id, quantity: 1 }], staff.id,
    );

    // Assert: the old row remains auditable while the same event/version has a new active reservation.
    assert.equal(rebookingRelease.status, 'cancelled');
    assert.equal(rebookingRelease.released_by, staff.id);
    assert.ok(rebookingRelease.released_at instanceof Date);
    assert.ok(secondBooking.reservation, secondBooking.conflict);
    assert.equal(duplicateActiveBooking.conflict, 'Equipment has already been reserved for this request.');
    assert.equal(secondBooking.reservation.event_id, rebookingEvent.id);
    assert.equal(secondBooking.reservation.request_version, 1);
    assert.notEqual(secondBooking.reservation.id, firstBooking.reservation.id);
    const rebookingHistory = (await client.query(`
      SELECT id, request_version, event_date::text AS event_date, status, released_by, released_at
      FROM event_equipment_reservations
      WHERE event_id=$1
      ORDER BY id
    `, [rebookingEvent.id])).rows;
    assert.equal(rebookingHistory.length, 2);
    assert.equal(rebookingHistory[0].id, firstBooking.reservation.id);
    assert.equal(rebookingHistory[0].status, 'cancelled');
    assert.equal(rebookingHistory[0].released_by, staff.id);
    assert.ok(rebookingHistory[0].released_at instanceof Date);
    assert.equal(rebookingHistory[1].id, secondBooking.reservation.id);
    assert.equal(rebookingHistory[1].status, 'reserved');
    assert.equal(rebookingHistory[1].request_version, rebookingHistory[0].request_version);

    const reservations = await eventModel.listActiveEquipmentReservations(staff.id);
    assert.equal(reservations.filter(item => item.status === 'cancelled').length, 3);
    assert.ok(reservations
      .filter(item => item.status === 'cancelled')
      .every(item => item.released_by_name === 'Equipment Release Demo Support'));
  } finally {
    mock.restoreAll();
    if (schemaCreated) {
      await client.query('ROLLBACK');
      await client.query('SET search_path TO public');
      await client.query(`DROP SCHEMA ${schema} CASCADE`);
    }
    client.release();
  }
});
