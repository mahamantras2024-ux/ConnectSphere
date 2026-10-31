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
test('SCRUM-87 AC1 AC2 - PostgreSQL status notices remain atomic under last-seat races and cancellation',
  { skip: process.env.RUN_DB_TESTS !== '1' }, async (t) => {
    const schema = `cs_scrum87_${crypto.randomBytes(8).toString('hex')}`;
    const client = await pool.connect();
    let server,isolated;
    try {
      // ---------- Arrange: disposable schema built from the real migrations ----------
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, full_name VARCHAR(255), password_hash VARCHAR(255),
        role VARCHAR(50), roles TEXT[] NOT NULL DEFAULT '{}', organisation_name VARCHAR(255), auth_version INTEGER NOT NULL DEFAULT 0)`);
      await client.query(`CREATE TABLE venues (id SERIAL PRIMARY KEY, name VARCHAR(255), location VARCHAR(255), capacity INTEGER, supported_layouts TEXT[],
        accessibility_features TEXT[], facilities TEXT[], operating_hours VARCHAR(255), availability_status VARCHAR(50), pricing VARCHAR(255), mrt VARCHAR(255), image TEXT)`);
      for (const file of migrations) await client.query(sqlFile(file));
      // Finite venue holds have a separate migration runner, so include that production schema as well.
      await client.query(sqlFile('migrations/019-venue-tentative-holds.sql'));
      const people = [['olivia', 'event_organiser'], ['chris', 'event_coordinator'], ['cara', 'event_coordinator'], ['sam', 'safety_officer'], ['vera', 'venue_staff'], ['tina', 'technical_support'], ['lee','event_coordinator_lead'], ['ada','attendee'], ['bea','attendee'], ['cam','attendee'], ['drew','attendee']];
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

      // Independent connections preserve real row-lock behavior for concurrent HTTP requests.
      const {Pool}=require('../../backend/node_modules/pg');
      isolated=new Pool({...pool.options,password:pool.options.password,options:`-c search_path=${schema}`,max:8});
      mock.method(pool, 'query', (sql, values) => isolated.query(sql, values));
      mock.method(pool, 'connect', () => isolated.connect());
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

      await client.query(sqlFile('migrations/021-registration-settings.sql'));
      await client.query("UPDATE events SET status='confirmed',registration_required=true,registration_open=true,registration_capacity=1,name=$1 WHERE id=1",['😀'.repeat(255)]);
      const notices=async()=> (await client.query("SELECT user_id,type,details,char_length(title) AS length FROM notifications WHERE user_id=ANY($1::int[]) ORDER BY id",[[id.ada,id.bea,id.cam,id.drew]])).rows;
      // AC1: real independent writers contend for the last place; the rejected writer has no status to announce.
      const racers=['ada','bea'];
      const results=await Promise.all(racers.map(person=>as(person,'POST','/registrations/events/1',{})));
      assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
      const winner=racers[results.findIndex(r=>r.status===201)],waiter=racers[results.findIndex(r=>r.status===409)];
      assert.equal((await as(waiter,'POST','/registrations/events/1',{joinWaitlist:true})).status,201);
      assert.equal((await as(winner,'POST','/registrations/events/1',{})).status,200);
      let stored=await notices();assert.equal(stored.length,2);
      assert.deepEqual(stored.map(n=>n.details.status).sort(),['registered','waitlisted']);
      assert.ok(stored.every(n=>n.length===255));
      // Withdrawal, its own notice and FIFO promotion all share the same locked transaction.
      assert.equal((await as(winner,'POST','/registrations/events/1/withdraw',{})).status,200);
      assert.equal((await as(winner,'POST','/registrations/events/1/withdraw',{})).status,200);
      stored=await notices();assert.equal(stored.length,4);
      assert.equal(stored.find(n=>n.type==='waitlist_promoted').user_id,id[waiter]);
      assert.equal(stored.filter(n=>n.user_id===id[winner]&&n.details.status==='withdrawn').length,1);
      await as('cam','POST','/registrations/events/1',{joinWaitlist:true});
      await client.query("INSERT INTO registrations(event_id,attendee_id,status) VALUES(2,$1,'registered')",[id.drew]);
      // AC2: organiser cancellation reaches registered AND waitlisted attendees, excluding withdrawn/unrelated people.
      const cancelled=await as('olivia','POST','/events/1/cancel',{});
      assert.equal(cancelled.status,200,JSON.stringify(cancelled.body));
      stored=await notices();assert.deepEqual(stored.filter(n=>n.type==='event_cancelled').map(n=>n.user_id).sort((a,b)=>a-b),[id[waiter],id.cam].sort((a,b)=>a-b));
      assert.equal((await as('olivia','POST','/events/1/cancel',{})).status,409);
      // A genuine PostgreSQL insert failure must undo a registration instead of silently losing its notification.
      await client.query("UPDATE events SET status='confirmed',registration_required=true,registration_open=true,registration_capacity=3 WHERE id=2");
      await client.query(`CREATE FUNCTION fail_status_notice() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.details->>'kind'='registration_status_changed' THEN RAISE EXCEPTION 'status notice unavailable'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER fail_status_notice BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION fail_status_notice()`);
      assert.equal((await as('cam','POST','/registrations/events/2',{})).status,500);
      assert.equal((await client.query('SELECT count(*)::int AS n FROM registrations WHERE event_id=2 AND attendee_id=$1',[id.cam])).rows[0].n,0);
    } finally {
      mock.restoreAll();
      if (server?.listening) await new Promise((resolve) => server.close(resolve));
      if(isolated)await isolated.end();
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      client.release();
      await pool.end();
    }
  });
