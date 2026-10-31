// Tests equipment preview and calendar SQL against real rows in an isolated PostgreSQL schema.
require('../../backend/node_modules/dotenv').config();
const { test, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { pool } = require('../../backend/src/config/db');
const eventModel = require('../../backend/src/models/eventModel');

after(async () => {
  await pool.end();
});

test('SCRUM-54 AC1 AC2 AC3 - calculates stock, splits reservations and preserves maintenance/damage blocks',
  { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
    const schema = `cs_equipment_availability_${crypto.randomBytes(8).toString('hex')}`;
    const client = await pool.connect();
    let schemaCreated = false;

    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      schemaCreated = true;
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT NOT NULL)`);
      await client.query(`CREATE TABLE venues (id INTEGER PRIMARY KEY, name TEXT, location TEXT)`);
      await client.query(`CREATE TABLE venue_bookings (
        id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL, venue_id INTEGER NOT NULL,
        status TEXT NOT NULL, start_datetime TIMESTAMP
      )`);
      await client.query(`CREATE TABLE events (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, proposed_date DATE NOT NULL,
        proposed_start_time TIME NOT NULL, proposed_end_time TIME NOT NULL,
        equipment_items JSONB NOT NULL, equipment_requirements_version INTEGER NOT NULL,
        coordinator_id INTEGER NOT NULL, is_draft BOOLEAN NOT NULL DEFAULT false,
        status TEXT NOT NULL
      )`);
      await client.query(`CREATE TABLE event_equipment_reviews (
        event_id INTEGER NOT NULL, request_version INTEGER NOT NULL,
        outcome TEXT NOT NULL, reason TEXT
      )`);
      await client.query(`CREATE TABLE equipments (
        id INTEGER PRIMARY KEY, asset_code TEXT NOT NULL, name TEXT NOT NULL,
        specification TEXT NOT NULL, status TEXT NOT NULL, quantity INTEGER NOT NULL,
        availability_status TEXT NOT NULL
      )`);
      await client.query(`CREATE TABLE equipment_status_history (
        id INTEGER PRIMARY KEY, inventory_id INTEGER NOT NULL, status TEXT NOT NULL,
        note TEXT, changed_at TIMESTAMP NOT NULL DEFAULT now(), changed_by INTEGER
      )`);
      await client.query(`CREATE TABLE technical_equipment_availability (
        id INTEGER PRIMARY KEY, inventory_id INTEGER NOT NULL,
        available_date DATE NOT NULL, start_time TIME NOT NULL, end_time TIME NOT NULL
      )`);
      await client.query(`CREATE TABLE event_equipment_reservations (
        id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL, request_version INTEGER NOT NULL,
        event_date DATE NOT NULL, start_time TIME NOT NULL, end_time TIME NOT NULL,
        status TEXT NOT NULL
      )`);
      await client.query(`CREATE TABLE event_equipment_reservation_items (
        reservation_id INTEGER NOT NULL, inventory_id INTEGER NOT NULL, quantity INTEGER NOT NULL
      )`);

      // AC6: the preview caller has an explicit assignment; the other reservations remain stock blockers.
      await client.query('CREATE TABLE event_technical_support_assignments (event_id INT, staff_id INT); INSERT INTO event_technical_support_assignments VALUES (1,10)');
      await client.query('ALTER TABLE event_equipment_reviews ADD COLUMN reviewed_by INT; ALTER TABLE event_equipment_reservations ADD COLUMN reserved_by INT');
      const reservationDate = (await client.query(
        'SELECT (CURRENT_DATE + 30)::text AS date',
      )).rows[0].date;
      await client.query(`
        INSERT INTO events
          (id, name, proposed_date, proposed_start_time, proposed_end_time,
           equipment_items, equipment_requirements_version, coordinator_id, status)
        VALUES
          (1, 'Requested event', $1::date, '09:00', '11:00',
           '[{"item":"Projector","quantity":1},{"item":"Unscheduled Projector","quantity":1}]',
           1, 10, 'confirmed'),
          (2, 'First reservation', $1::date, '09:00', '10:00', '[]', 1, 10, 'confirmed'),
          (3, 'Second reservation', $1::date, '10:00', '11:00', '[]', 1, 10, 'confirmed'),
          (4, 'Short reservation', $1::date, '10:00', '11:00', '[]', 1, 10, 'confirmed')
      `, [reservationDate]);
      await client.query(`
        INSERT INTO event_equipment_reviews (event_id, request_version, outcome)
        VALUES (1, 1, 'fully_fulfillable')
      `);
      await client.query(`
        INSERT INTO equipments (id, asset_code, name, specification, status, quantity, availability_status)
        VALUES
          (1, 'PROJ-001', 'Projector', 'Full HD', 'operational', 2, 'Available'),
          (2, 'CAM-001', 'Camera', 'HD', 'operational', 1, 'Available'),
          (3, 'PROJ-002', 'Unscheduled Projector', 'Portable', 'operational', 3, 'Available')
      `);
      await client.query(`
        INSERT INTO technical_equipment_availability (id, inventory_id, available_date, start_time, end_time)
        VALUES
          (1, 1, $1::date, '09:00', '17:00'),
          (2, 2, $1::date, '09:00', '17:00')
      `, [reservationDate]);
      await client.query(`
        INSERT INTO event_equipment_reservations
          (id, event_id, request_version, event_date, start_time, end_time, status)
        VALUES
          (1, 2, 1, $1::date, '09:00', '10:00', 'reserved'),
          (2, 3, 1, $1::date, '10:00', '11:00', 'reserved'),
          (3, 4, 1, $1::date, '10:00', '11:00', 'reserved')
      `, [reservationDate]);
      await client.query(`
        INSERT INTO event_equipment_reservation_items (reservation_id, inventory_id, quantity)
        VALUES (1, 1, 1), (2, 1, 2), (3, 2, 1)
      `);
      mock.method(pool, 'query', (sql, values) => client.query(sql, values));

      // A complete interval must use the worst concurrent occupancy, not the best remaining window.
      const fullInterval = await eventModel.getEquipmentReservationAvailability(1, [], 10);
      assert.deepEqual(fullInterval.items.map(item => [item.item, item.availableQuantity]), [
        ['Projector', 0],
        ['Unscheduled Projector', 3],
      ]);

      // A narrower selection excludes the later full reservation but retains stock on the unscheduled date.
      await client.query("UPDATE events SET proposed_end_time='10:00' WHERE id=1");
      const firstWindow = await eventModel.getEquipmentReservationAvailability(1, [], 10);
      assert.deepEqual(firstWindow.items.map(item => [item.item, item.availableQuantity]), [
        ['Projector', 1],
        ['Unscheduled Projector', 3],
      ]);

      const inventory = await eventModel.listEquipmentInventory();
      const projector = inventory.find(item => item.id === 1);
      const camera = inventory.find(item => item.id === 2);
      assert.deepEqual(projector.availabilities.map(window => [
        window.startTime, window.endTime, window.reservedQuantity, window.availableQuantity,
      ]), [
        ['09:00:00', '10:00:00', 1, 1],
        ['10:00:00', '11:00:00', 2, 0],
        ['11:00:00', '17:00:00', 0, 2],
      ]);
      assert.deepEqual(camera.availabilities.map(window => [
        window.startTime, window.endTime, window.reservedQuantity, window.availableQuantity,
      ]), [
        ['09:00:00', '10:00:00', 0, 1],
        ['10:00:00', '11:00:00', 1, 0],
        ['11:00:00', '17:00:00', 0, 1],
      ]);

      // SCRUM-54 AC3: persisted maintenance and damage records must survive the actual calendar SQL.
      // Change existing stock so the original reservation assertions above still exercise operational assets.
      await client.query("UPDATE equipments SET status='maintenance', availability_status='Unavailable' WHERE id=1");
      await client.query("UPDATE equipments SET availability_status='Unavailable' WHERE id=2");
      await client.query(`
        INSERT INTO equipment_status_history (id, inventory_id, status, note, changed_by)
        VALUES (1, 1, 'Unavailable', 'Routine maintenance: lamp inspection', NULL),
               (2, 2, 'Unavailable', 'Damage: cracked lens', NULL)
      `);
      const blockedInventory = await eventModel.listEquipmentInventory();
      for (const [id, reason] of [
        [1, 'Routine maintenance: lamp inspection'],
        [2, 'Damage: cracked lens'],
      ]) {
        const asset = blockedInventory.find(item => item.id === id);
        assert.ok(asset.availabilities.length > 0, 'blocked schedules must remain visible');
        assert.equal(asset.availability_status, 'Unavailable');
        // Each split interval must retain the reason and zero stock, including the unreserved intervals.
        for (const window of asset.availabilities) {
          assert.equal(window.status, 'Unavailable');
          assert.equal(window.availableQuantity, 0);
          assert.equal(window.blockReason, reason);
        }
      }

    } finally {
      try {
        if (schemaCreated) await client.query(`DROP SCHEMA ${schema} CASCADE`);
      } finally {
        client.release();
      }
    }
  });

