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
test('SCRUM-111 AC1 AC2 AC3 AC4 - PostgreSQL rejection, explicit re-review, fresh confirmation and complete history',
  { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
    const schema = `cs_scrum111_${crypto.randomBytes(8).toString('hex')}`;
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
      // Registration settings have their own runner; event detail/decision reads use those current columns.
      await client.query(sqlFile('migrations/021-registration-settings.sql'));
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

      // Arrange: an initially approved event is ready for its first safety review.
      await client.query("UPDATE events SET status='approved',equipment_items='[]',decided_at=clock_timestamp(),decided_by=$1 WHERE id=1",[id.chris]);
      await client.query(`INSERT INTO venue_bookings(event_id,venue_id,requested_by,start_datetime,end_datetime,status)
        VALUES(1,1,$1,'2030-10-15T02:00Z','2030-10-15T04:00Z','approved')`,[id.chris]);
      const original=(await client.query('SELECT decided_at,decided_by FROM events WHERE id=1')).rows[0];
      // AC1: a plain rejection, without change-area selections, still reopens Planning and retains the reason.
      const rejected=await as('sam','POST','/events/1/safety-checks',{outcome:'rejected',notes:'Fire exit blocked.'});
      assert.equal(rejected.status,201,JSON.stringify(rejected.body));
      assert.deepEqual((await client.query('SELECT status,safety_resubmission_required FROM events WHERE id=1')).rows[0],{status:'planning',safety_resubmission_required:true});
      const decisionView=await as('chris','GET','/events/1/decision');
      assert.equal(decisionView.status,200);assert.equal(decisionView.body.safetyResubmissionRequired,true);
      let history=await as('chris','GET','/events/1/safety-review-history');
      assert.equal(history.body.history[0].notes,'Fire exit blocked.');
      assert.equal((await as('chris','POST','/events/1/status',{status:'confirmed'})).body.code,'SAFETY_RESUBMISSION_REQUIRED');
      assert.equal((await as('sam','POST','/events/1/safety-checks',{outcome:'approved'})).body.code,'SAFETY_RESUBMISSION_REQUIRED');
      assert.equal((await as('sam','GET','/safety/checks')).body.events.some(event=>event.id===1),false);
      // AC2: the unchanged, flagged venue must be corrected through the existing staff re-confirmation flow.
      await client.query("UPDATE venue_bookings SET recheck_required_at=clock_timestamp(),recheck_reason='Recheck the corrected exit route.' WHERE id=1");
      assert.equal((await as('chris','POST','/events/1/safety-resubmissions',{})).body.code,'VENUE_RECHECK');
      assert.equal((await as('vera','PUT','/venues/1/requests/1/recheck',{decision:'confirmed'})).status,200);
      assert.equal((await as('cara','POST','/events/1/safety-resubmissions',{})).status,404);
      // Real independent transactions serialize two clicks: one durable submission and one conflict.
      const submitted=await Promise.all([as('chris','POST','/events/1/safety-resubmissions',{}),as('chris','POST','/events/1/safety-resubmissions',{})]);
      assert.deepEqual(submitted.map(r=>r.status).sort(),[201,409]);
      assert.equal((await client.query('SELECT count(*)::int AS n FROM event_safety_resubmissions')).rows[0].n,1);
      assert.equal((await client.query('SELECT e.safety_recheck_required_at=r.submitted_at AS exact FROM events e CROSS JOIN event_safety_resubmissions r WHERE e.id=1')).rows[0].exact,true);
      // An idempotent migration must not reset an already resubmitted rejection back to required.
      await client.query(sqlFile('migrations/024-safety-rereview.sql'));
      assert.equal((await client.query('SELECT safety_resubmission_required FROM events WHERE id=1')).rows[0].safety_resubmission_required,false);
      assert.equal((await as('chris','POST','/events/1/status',{status:'confirmed'})).body.code,'SAFETY_NOT_COMPLETED');
      assert.ok((await as('sam','GET','/safety/checks')).body.events.some(event=>event.id===1));
      // AC3: a fresh pass enters history but leaves final confirmation to the coordinator.
      const passed=await as('sam','POST','/events/1/safety-checks',{outcome:'approved'});
      assert.equal(passed.status,201,JSON.stringify(passed.body));
      assert.equal((await client.query('SELECT status FROM events WHERE id=1')).rows[0].status,'planning');
      assert.equal((await as('chris','POST','/events/1/status',{status:'confirmed'})).status,200);
      assert.deepEqual((await client.query('SELECT decided_at,decided_by FROM events WHERE id=1')).rows[0],original);
      // AC4: no old outcome is overwritten, including after responsibility changes.
      history=await as('chris','GET','/events/1/safety-review-history');
      assert.deepEqual(history.body.history.map(row=>[row.kind,row.outcome??null]),[['review','rejected'],['resubmission',null],['review','approved']]);
      assert.equal(history.body.history[0].notes,'Fire exit blocked.');
      assert.deepEqual(history.body.history.map(row=>row.actor),['sam','chris','sam']);
      await client.query('UPDATE events SET coordinator_id=$1 WHERE id=1',[id.cara]);
      assert.equal((await as('chris','GET','/events/1/safety-review-history')).status,404);
      assert.equal((await as('cara','GET','/events/1/safety-review-history')).body.history.length,3);
      // A notification outage must undo both rejection and the return to Planning.
      await client.query("UPDATE events SET status='approved' WHERE id=2");
      await client.query(`INSERT INTO venue_bookings(event_id,venue_id,requested_by,start_datetime,end_datetime,status)
        VALUES(2,1,$1,'2030-10-16T02:00Z','2030-10-16T03:00Z','approved')`,[id.chris]);
      await client.query(`CREATE FUNCTION fail_safety_notice() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.type='safety_check_recorded' THEN RAISE EXCEPTION 'safety notice unavailable'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER fail_safety_notice BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION fail_safety_notice()`);
      assert.equal((await as('sam','POST','/events/2/safety-checks',{outcome:'rejected',notes:'Electrical fault'})).status,500);
      assert.deepEqual((await client.query('SELECT status,safety_resubmission_required FROM events WHERE id=2')).rows[0],{status:'approved',safety_resubmission_required:false});
      assert.equal((await client.query('SELECT count(*)::int AS n FROM event_safety_checks WHERE event_id=2')).rows[0].n,0);
      await client.query('DROP TRIGGER fail_safety_notice ON notifications');
      // Existing plain rejections get recovery on upgrade, rather than remaining permanently terminal.
      await client.query("INSERT INTO event_safety_checks(event_id,safety_officer_id,outcome,notes) VALUES(2,$1,'rejected','Legacy electrical issue')",[id.sam]);
      await client.query(sqlFile('migrations/024-safety-rereview.sql'));
      assert.deepEqual((await client.query('SELECT status,safety_resubmission_required FROM events WHERE id=2')).rows[0],{status:'planning',safety_resubmission_required:true});
    } finally {
      mock.restoreAll();
      if (server?.listening) await new Promise((resolve) => server.close(resolve));
      if(isolated)await isolated.end();
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      client.release();
      await pool.end();
    }
  });
