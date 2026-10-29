// SCRUM-85: real HTTP routes, migrations, constraints and transactions in a disposable PostgreSQL schema.
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

// Exercise notification-producing transactions and the scheduler; persisted state proves long names cannot roll back other work.
test('SCRUM-85 AC1 AC4 AC6 AC7 AC9 - PostgreSQL long-name transactions and multi-coordinator delivery',
  { skip: process.env.RUN_DB_TESTS !== '1' }, async (t) => {
    const schema = `cs_scrum85_${crypto.randomBytes(8).toString('hex')}`;
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
      const people = [['olivia', 'event_organiser'], ['chris', 'event_coordinator'], ['cara', 'event_coordinator'], ['sam', 'safety_officer'], ['vera', 'venue_staff'], ['tina', 'technical_support'], ['lee','event_coordinator_lead']];
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

      const notifications = require('../../backend/src/services/notificationService');
      const coordinatorNotifications = require('../../backend/src/services/coordinatorNotifications');
      const longName = '😀'.repeat(255);
      await client.query('UPDATE events SET name=$1,coordinator_id=NULL WHERE id=1',[longName]);
      await client.query("UPDATE events SET name='Short event',coordinator_id=$1 WHERE id=2",[id.cara]);
      await client.query(`INSERT INTO events(organiser_id,coordinator_id,name,proposed_date,proposed_start_time,proposed_end_time,
        expected_attendance,equipment_items,is_draft,status)
        VALUES($1,$2,$3,'2030-10-17','10:00','11:00',20,'[]',false,'planning')`,[id.olivia,id.cara,'L'.repeat(255)]);
      await t.test('SCRUM-85 AC1 - assignment and reassignment commit with maximum Unicode event names',async()=>{
        // Act through real auth, transaction and PostgreSQL varchar constraints.
        for(const [coordinatorId,expectedCoordinatorId] of [[id.cara,null],[id.chris,id.cara]]){
          const response=await as('lee','PUT','/events/1/assignment',{coordinatorId,expectedCoordinatorId});
          assert.equal(response.status,200,JSON.stringify(response.body));
          assert.equal((await client.query('SELECT coordinator_id FROM events WHERE id=1')).rows[0].coordinator_id,coordinatorId);
        }
        const rows=(await client.query("SELECT user_id,title,event_id FROM notifications WHERE details->>'kind'='event_assignment' ORDER BY id")).rows;
        assert.deepEqual(rows.map(row=>row.user_id),[id.cara,id.chris]);
        assert.ok(rows.every(row=>row.event_id===1&&row.title==='Event assigned: '+'😀'.repeat(239)));
      });
      await t.test('SCRUM-85 AC4 - equipment reservation commits alongside its long-name notification',async()=>{
        // Arrange a genuine reviewed request and operational stock; do not substitute SQL results.
        await client.query("INSERT INTO event_equipment_reviews(event_id,request_version,outcome,reviewed_by) VALUES(1,1,'fully_fulfillable',$1)",[id.tina]);
        const stock=(await client.query("SELECT id FROM equipments WHERE asset_code='PROJ-001'")).rows[0].id;
        const response=await as('tina','POST','/events/1/equipment-reservations',{selections:[{inventoryId:stock,quantity:1}]});
        assert.equal(response.status,201,JSON.stringify(response.body));
        assert.equal((await client.query("SELECT count(*)::int AS n FROM event_equipment_reservations WHERE event_id=1 AND status='reserved'")).rows[0].n,1);
        assert.equal((await client.query("SELECT title FROM notifications WHERE details->>'kind'='equipment_reservation_confirmed'")).rows[0].title,
          'Equipment reservation confirmed: '+'😀'.repeat(222));
      });
      await t.test('SCRUM-85 AC6 - closure and disruption persist despite a maximum-length event name',async()=>{
        await client.query(`INSERT INTO venue_bookings(event_id,venue_id,requested_by,start_datetime,end_datetime,status)
          VALUES(1,1,$1,'2030-10-15T02:00Z','2030-10-15T04:00Z','approved')`,[id.chris]);
        const response=await as('vera','POST','/venues/1/closures',{startDatetime:'2030-10-15T01:45:00Z',endDatetime:'2030-10-15T04:15:00Z',reason:'Repairs'});
        assert.equal(response.status,201,JSON.stringify(response.body));
        assert.equal((await client.query('SELECT count(*)::int AS n FROM venue_booking_disruptions')).rows[0].n,1);
        assert.equal((await client.query("SELECT title FROM notifications WHERE details->>'kind'='venue_disruption'")).rows[0].title,
          'Venue unavailable: '+'😀'.repeat(236));
      });
      await t.test('SCRUM-85 AC7 AC9 - one job commits all long and short event warnings and reminders for both coordinators',async()=>{
        // Arrange: long names occur before and after the short event, exposing rollback of unrelated work.
        // Give each hold a separate booking day so occupancy constraints remain active and valid.
        const now=Date.parse('2030-10-14T12:00:00Z');
        await client.query(`INSERT INTO venue_bookings(event_id,venue_id,requested_by,start_datetime,end_datetime,status,hold_expires_at)
          SELECT e.id,1,e.coordinator_id,'2030-10-18T02:00Z'::timestamptz+e.id*interval '1 day','2030-10-18T04:00Z'::timestamptz+e.id*interval '1 day','pending',to_timestamp($1/1000.0)+interval '30 seconds'
          FROM events e ORDER BY e.id`,[now]);
        await client.query('INSERT INTO coordinator_notification_preferences(user_id,enabled,frequency_days) VALUES($1,true,1),($2,true,1)',[id.chris,id.cara]);
        // Act: execute the actual atomic worker against PostgreSQL, including advisory locks and receipts.
        await coordinatorNotifications.runCoordinatorNotifications(pool,now);
        const rows=(await client.query("SELECT event_id,user_id,char_length(title) AS length,details->>'kind' AS kind FROM notifications WHERE details->>'kind' IN ('venue_hold_expiry','coordinator_pending_reviews') ORDER BY kind,event_id")).rows;
        // Assert all six deliveries, not merely an empty/partial successful result.
        assert.deepEqual(rows.map(row=>[row.kind,row.event_id,row.user_id]),
          ['coordinator_pending_reviews','venue_hold_expiry'].flatMap(kind=>[[kind,1,id.chris],[kind,2,id.cara],[kind,3,id.cara]]));
        assert.ok(rows.every(row=>row.event_id===2?row.length<255:row.length===255));
        assert.equal((await client.query('SELECT count(*)::int AS n FROM coordinator_hold_warnings')).rows[0].n,3);
        assert.equal((await client.query('SELECT count(*)::int AS n FROM coordinator_notification_preferences WHERE last_sent_at=to_timestamp($1/1000.0)',[now])).rows[0].n,2);
        await coordinatorNotifications.runCoordinatorNotifications(pool,now);
        assert.equal((await client.query("SELECT count(*)::int AS n FROM notifications WHERE details->>'kind' IN ('venue_hold_expiry','coordinator_pending_reviews')")).rows[0].n,6);
      });
      await t.test('SCRUM-85 AC1 AC4 AC6 AC7 AC9 - PostgreSQL accepts below at and above-limit inputs in one batch',async()=>{
        const prefixes=['Event assigned: ','Equipment reservation confirmed: ','Venue unavailable: ','Venue hold expiring: ','Venue hold expired: ','Pending reviews: '];
        // Arrange independent expected output for each prefix and each 254/255/256 boundary.
        const cases=prefixes.flatMap(prefix=>[254,255,256].map(length=>({prefix,length})));
        const notes=cases.map(({prefix,length})=>({userId:id.chris,eventId:1,changeRequestId:null,type:'event_details_changed',
          title:prefix+'x'.repeat(length-prefix.length),message:longName,details:{kind:'length_boundary'}}));
        await notifications.insertNotifications(client,notes);
        const rows=(await client.query("SELECT title,message FROM notifications WHERE details->>'kind'='length_boundary' ORDER BY id")).rows;
        assert.equal(rows.length,18);
        rows.forEach((row,i)=>{
          assert.equal(row.title,cases[i].prefix+'x'.repeat(Math.min(cases[i].length,255)-cases[i].prefix.length));
          assert.equal(row.message,longName);
        });
      });
    } finally {
      mock.restoreAll();
      if (server?.listening) await new Promise((resolve) => server.close(resolve));
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      client.release();
      await pool.end();
    }
  });
