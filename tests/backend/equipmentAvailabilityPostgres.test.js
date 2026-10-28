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

test('SCRUM-54 AC3-AC4 - preview uses peak overlap and calendar splits short reservations',
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
      const fullInterval = await eventModel.getEquipmentReservationAvailability(1);
      assert.deepEqual(fullInterval.items.map(item => [item.item, item.availableQuantity]), [
        ['Projector', 0],
        ['Unscheduled Projector', 3],
      ]);

      // A narrower selection excludes the later full reservation but retains stock on the unscheduled date.
      await client.query("UPDATE events SET proposed_end_time='10:00' WHERE id=1");
      const firstWindow = await eventModel.getEquipmentReservationAvailability(1);
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
    } finally {
      try {
        if (schemaCreated) await client.query(`DROP SCHEMA ${schema} CASCADE`);
      } finally {
        client.release();
      }
    }
  });
