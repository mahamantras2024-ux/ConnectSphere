// AC6 regression: real authentication, routes and SQL must agree on responsibility across every dashboard read.
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { pool } = require('../../backend/src/config/db');
const { applyLiveSchema } = require('./support/liveSchema');

test('TS status AC6 - unrelated staff cannot read status, request, reservation or affected queues and details',
  { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
    // Arrange: all fixtures are otherwise eligible; only staff 3 has an assignment at first.
    const schema = `ts_queue_access_${crypto.randomBytes(8).toString('hex')}`;
    const client = await pool.connect();
    let server;
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL,
        full_name VARCHAR(255), password_hash VARCHAR(255), role VARCHAR(50), roles TEXT[] DEFAULT '{}',
        organisation_name VARCHAR(255), auth_version INTEGER DEFAULT 0);
        CREATE TABLE venues (id SERIAL PRIMARY KEY, name VARCHAR(255), location VARCHAR(255), capacity INTEGER,
        supported_layouts TEXT[], accessibility_features TEXT[], facilities TEXT[], operating_hours VARCHAR(255),
        availability_status VARCHAR(50), pricing VARCHAR(255), mrt VARCHAR(255), image TEXT)`);
      await applyLiveSchema(client);
      for (const [index, role] of ['event_organiser', 'event_coordinator', 'technical_support', 'technical_support'].entries()) {
        await client.query('INSERT INTO users (email,full_name,role,roles) VALUES ($1,$1,$2::text,ARRAY[$2::text])',
          [`person${index + 1}@example.test`, role]);
      }
      const events = [];
      for (const name of ['Pending request', 'Reviewed request', 'Reserved request']) {
        events.push((await client.query(`INSERT INTO events (organiser_id,coordinator_id,name,proposed_date,
          proposed_start_time,proposed_end_time,equipment_items,expected_attendance,is_draft,status)
          VALUES (1,2,$1,CURRENT_DATE + 10,'10:00','12:00','[{"item":"Projector","quantity":1}]',50,false,'submitted') RETURNING id`, [name])).rows[0].id);
      }
      await client.query('INSERT INTO event_technical_support_assignments (event_id,staff_id) SELECT unnest($1::int[]),3', [events]);
      await client.query(`INSERT INTO event_equipment_reviews (event_id,request_version,outcome,reviewed_by)
        SELECT unnest($1::int[]),1,'fully_fulfillable',3`, [events.slice(1)]);
      const inventoryId = (await client.query("SELECT id FROM equipments WHERE asset_code='PROJ-002'")).rows[0].id;
      const reservationId = (await client.query(`INSERT INTO event_equipment_reservations
        (event_id,request_version,reserved_by,event_date,start_time,end_time)
        VALUES ($1,1,3,CURRENT_DATE + 10,'10:00','12:00') RETURNING id`, [events[2]])).rows[0].id;
      await client.query('INSERT INTO event_equipment_reservation_items (reservation_id,inventory_id,quantity) VALUES ($1,$2,1)', [reservationId, inventoryId]);
      await client.query(`INSERT INTO equipment_reservation_unavailability (reservation_id,inventory_id,reason)
        VALUES ($1,$2,'Broken projector')`, [reservationId, inventoryId]);
      mock.method(pool, 'query', (sql, values) => client.query(sql, values));
      mock.method(pool, 'connect', async () => ({ query: (sql, values) => client.query(sql, values), release() {} }));
      server = require('../../backend/src/index').listen(0, '127.0.0.1');
      await new Promise(resolve => server.once('listening', resolve));
      /** Uses a real signed session; the selected staff member is loaded from the disposable database. */
      async function request(staffId, path, method = 'GET', body) {
        const token = jwt.sign({ sub: staffId, authVersion: 0 }, process.env.JWT_SECRET);
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/events${path}`, {
          method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        return { status: response.status, body: await response.json() };
      }
      // Act/Assert: an unrelated authenticated support user gets no event facts through any read path.
      assert.deepEqual((await request(4, '/on-site-support')).body.events, []);
      assert.equal((await request(4, `/on-site-support/${events[0]}`)).status, 404);
      assert.deepEqual((await request(4, '/equipment-requests')).body.requests, []);
      assert.deepEqual((await request(4, '/equipment-reservations')).body, { requests: [], reservations: [], affectedReservations: [] });
      assert.deepEqual((await request(4, '/equipment-reservation-issues')).body.affectedReservations, []);
      for (const method of ['GET', 'POST']) {
        assert.equal((await request(4, `/${events[1]}/equipment-availability`, method, method === 'POST' ? {} : undefined)).status, 404);
      }
      // Writes must not let an unrelated user manufacture a review/reservation relationship and gain read access.
      assert.equal((await request(4, `/${events[0]}/equipment-reviews`, 'POST', { outcome: 'fully_fulfillable', requestVersion: 1 })).status, 409);
      assert.equal((await request(4, `/${events[1]}/equipment-reservations`, 'POST', { selections: [{ inventoryId, quantity: 1 }] })).status, 409);
      assert.deepEqual((await request(4, '/on-site-support')).body.events, []);

      // Cancelled history must also be scoped: an unparenthesized OR would disclose this row.
      await client.query("UPDATE event_equipment_reservations SET status='cancelled'");
      assert.deepEqual((await request(4, '/equipment-reservations')).body.reservations, []);
      assert.deepEqual((await request(3, '/equipment-reservations')).body.reservations.map(row => row.id), [reservationId]);
      await client.query("UPDATE event_equipment_reservations SET status='reserved'");

      // Positive controls prevent empty-result implementations from passing the access checks.
      assert.deepEqual((await request(3, '/equipment-requests')).body.requests.map(row => row.id), [events[0]]);
      const queues = (await request(3, '/equipment-reservations')).body;
      assert.deepEqual(queues.requests.map(row => row.id), [events[1]]);
      assert.deepEqual(queues.reservations.map(row => row.id), [reservationId]);
      assert.equal(queues.affectedReservations[0].event_id, events[2]);
      assert.equal((await request(3, `/${events[1]}/equipment-availability`)).status, 200);
      assert.equal((await request(3, `/on-site-support/${events[1]}`)).body.event.id, events[1]);

      // Prior review and reservation actors retain responsibility even without an on-site assignment.
      await client.query('UPDATE event_equipment_reviews SET reviewed_by=4');
      await client.query('UPDATE events SET equipment_requirements_version=2 WHERE id=$1', [events[0]]);
      await client.query("INSERT INTO event_equipment_reviews (event_id,request_version,outcome,reviewed_by) VALUES ($1,1,'fully_fulfillable',4)", [events[0]]);
      assert.deepEqual((await request(4, '/equipment-requests')).body.requests.map(row => row.id), [events[0]]);
      assert.deepEqual((await request(4, '/equipment-reservations')).body.requests.map(row => row.id), [events[1]]);
      await client.query('UPDATE event_equipment_reservations SET reserved_by=4');
      const retained = (await request(4, '/equipment-reservations')).body;
      assert.deepEqual(retained.reservations.map(row => row.id), [reservationId]);
      assert.equal(retained.affectedReservations[0].event_id, events[2]);
      assert.equal((await request(4, `/${events[1]}/equipment-availability`)).status, 200);
    } finally {
      mock.restoreAll();
      if (server?.listening) await new Promise(resolve => server.close(resolve));
      await client.query('ROLLBACK');
      await client.query('SET search_path TO public');
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      client.release();
      await pool.end();
    }
  });
