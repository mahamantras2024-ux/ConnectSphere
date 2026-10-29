// SCRUM-106: real HTTP routes, migrations, constraints and transactions in a disposable PostgreSQL schema.
require('../../backend/node_modules/dotenv').config();
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { pool } = require('../../backend/src/config/db');
const emailService = require('../../backend/src/services/emailService');

// The current production schema (every runner migration), so later venue and notification columns always exist.
const { liveSchemaFiles: migrations } = require('./support/liveSchema');
const sqlFile = (file) => fs.readFileSync(path.join(__dirname, '../../backend/src/db', file), 'utf8');

// Exercise closure and replacement through real routes; persisted state proves each gate and preservation rule.
test('SCRUM-106 AC1–AC5 - real PostgreSQL closure, approval blocking, isolated recovery and fresh safety review',
  { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
    const schema = `cs_scrum106_${crypto.randomBytes(8).toString('hex')}`;
    const client = await pool.connect();
    let server;
    try {
      // ---------- Arrange: disposable schema built from the real migrations ----------
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, full_name VARCHAR(255), password_hash VARCHAR(255),
        role VARCHAR(50), roles TEXT[] NOT NULL DEFAULT '{}', organisation_name VARCHAR(255), auth_version INTEGER NOT NULL DEFAULT 0)`);
      await client.query(`CREATE TABLE venues (id SERIAL PRIMARY KEY, name VARCHAR(255), location VARCHAR(255), capacity INTEGER, supported_layouts TEXT[],
        accessibility_features TEXT[], facilities TEXT[], operating_hours VARCHAR(255), availability_status VARCHAR(50), pricing VARCHAR(255), mrt VARCHAR(255), image TEXT)`);
      for (const file of migrations) await client.query(sqlFile(file));
      const people = [['olivia', 'event_organiser'], ['chris', 'event_coordinator'], ['cara', 'event_coordinator'], ['sam', 'safety_officer'], ['vera', 'venue_staff'], ['tina', 'technical_support']];
      for (const [name, role] of people) {
        await client.query('INSERT INTO users (email, full_name, password_hash, role, roles) VALUES ($1, $2, $3, $4::text, ARRAY[$4::text])', [`${name}@example.test`, name, 'unused', role]);
      }
      const id = Object.fromEntries(people.map(([name], index) => [name, index + 1]));
      // Safety facts keep the replacement review representative of the production workflow.
      await client.query(`INSERT INTO venues (name, location, capacity, supported_layouts, accessibility_features, operating_hours, setup_minutes, turnaround_minutes,
          emergency_access, known_restrictions)
        VALUES ('Hall A', 'Level 1', 100, ARRAY['Theatre'], ARRAY['Ramp'], '08:00 - 22:00', 30, 15, 'Two exits to Marina Road', 'No open flames')`);
      // The second event supplies a pending overlapping request for the closure approval regression.
      await client.query(`INSERT INTO events (organiser_id, coordinator_id, name, proposed_date, proposed_start_time, proposed_end_time, expected_attendance,
          room_layout_preference, accessibility_requirements, equipment_items, is_draft, status)
        VALUES ($1, $2, 'Workshop', '2030-10-15', '10:00', '12:00', 80, 'Theatre', '["Ramp"]', '[{"item":"Projector","quantity":1}]', false, 'submitted'),
               ($1, $2, 'Talk', '2030-10-16', '10:00', '11:00', 30, 'Theatre', '[]', '[]', false, 'submitted')`, [id.olivia, id.chris]);

      mock.method(pool, 'query', (sql, values) => client.query(sql, values));
      mock.method(pool, 'connect', async () => ({ query: (sql, values) => client.query(sql, values), release() {} }));
      // Email delivery is external; all SQL below executes against the disposable schema.
      mock.method(emailService, 'sendNotificationEmail', async () => {});
      const app = require('../../backend/src/index');
      server = app.listen(0, '127.0.0.1');
      await new Promise((resolve) => server.once('listening', resolve));
      const base = `http://127.0.0.1:${server.address().port}/api`;
      // Calls the API as one of the seeded people.
      async function as(person, method, url, body) {
        const role = people[id[person] - 1][1];
        const token = jwt.sign({ sub: id[person], role, email: `${person}@example.test`, authVersion: 0 }, process.env.JWT_SECRET, { expiresIn: '1h' });
        const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, body: await response.json() };
      }

      // Arrange: confirmed event with old safety approval, an unaffected booking and a replacement.
      await client.query("UPDATE events SET status='approved', equipment_items='[]' WHERE id=1");
      await client.query("INSERT INTO event_safety_checks(event_id,safety_officer_id,outcome,checked_at) VALUES(1,$1,'approved',now()-interval '1 day')",[id.sam]);
      await client.query("INSERT INTO venues(name,location,capacity,supported_layouts,operating_hours) VALUES('Hall B','Level 2',100,ARRAY['Theatre'],'08:00 - 22:00')");
      await client.query(`INSERT INTO venue_bookings(event_id,venue_id,requested_by,start_datetime,end_datetime,status)
        VALUES(1,1,$1,'2030-10-15T02:00Z','2030-10-15T04:00Z','approved'),
              (1,2,$1,'2030-10-16T02:00Z','2030-10-16T04:00Z','approved'),
              (1,2,$1,'2030-10-15T02:00Z','2030-10-15T04:00Z','approved'),
              (2,1,$1,'2030-10-15T02:00Z','2030-10-15T04:00Z','pending')`,[id.chris]);
      // AC1/AC2 boundary: execute the actual varchar constraint with maximum Unicode event name.
      await client.query('UPDATE events SET name=$1 WHERE id=1',['😀'.repeat(255)]);
      const saved=await as('vera','POST','/venues/1/closures',{
        startDatetime:'2030-10-15T01:45:00Z',endDatetime:'2030-10-15T04:15:00Z',reason:'Emergency repairs'});
      assert.equal(saved.status,201,JSON.stringify(saved.body));
      assert.equal((await client.query('SELECT count(*)::int AS n FROM venue_unavailability')).rows[0].n,1);
      assert.equal((await client.query("SELECT char_length(title) AS n FROM notifications WHERE user_id=$1 AND type='event_details_changed'",[id.chris])).rows[0].n,255);
      assert.equal((await client.query('SELECT status FROM events WHERE id=1')).rows[0].status,'planning');
      // Keep the separate safety/decision workflow independent of other stories' notification title limits.
      await client.query("UPDATE events SET name='Workshop' WHERE id=1");
      // AC3: an existing pending request must recheck the committed closure at approval time.
      const blocked=await as('vera','PUT','/venues/1/requests/4/decision',{decision:'approved'});
      assert.equal(blocked.status,409,JSON.stringify(blocked.body));
      assert.equal((await client.query('SELECT status FROM venue_bookings WHERE id=4')).rows[0].status,'pending');
      // AC4: even an approved alternative and old safety pass cannot hide an unresolved disruption.
      assert.equal((await as('chris','POST','/events/1/decision',{decision:'approved'})).body.code,'VENUE_DISRUPTED');
      const issue=(await as('chris','GET','/events/1/venue-disruptions')).body.issues[0];
      const recovered=await as('chris','POST',`/events/1/venue-disruptions/${issue.id}/resolve`,{replacementBookingId:3});
      assert.equal(recovered.status,200,JSON.stringify(recovered.body));
      // AC4/AC5: assert persisted rows, not SQL strings: only the affected booking is retired.
      assert.deepEqual((await client.query('SELECT id,status FROM venue_bookings ORDER BY id')).rows,
        [{id:1,status:'cancelled'},{id:2,status:'approved'},{id:3,status:'approved'},{id:4,status:'pending'}]);
      assert.equal((await as('chris','POST','/events/1/decision',{decision:'approved'})).body.code,'SAFETY_NOT_COMPLETED');
      assert.equal((await client.query('SELECT status FROM events WHERE id=1')).rows[0].status,'planning');
      // A fresh passed safety review enables, but does not perform, coordinator confirmation.
      const safety=await as('sam','POST','/events/1/safety-checks',{outcome:'approved'});
      assert.equal(safety.status,201,JSON.stringify(safety.body));
      assert.equal((await client.query('SELECT status FROM events WHERE id=1')).rows[0].status,'planning');
      assert.equal((await as('chris','POST','/events/1/decision',{decision:'approved'})).status,200);
      assert.equal((await client.query('SELECT status FROM events WHERE id=1')).rows[0].status,'approved');
    } finally {
      mock.restoreAll();
      if (server?.listening) await new Promise((resolve) => server.close(resolve));
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      client.release();
      await pool.end();
    }
  });
