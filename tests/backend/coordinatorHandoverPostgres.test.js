// File: "Request All Post-Submission Amendments Through the Coordinator" end to end against real PostgreSQL in a disposable
// schema built from the production migrations (read from the runner, so the schema never falls behind).
// Test scope: Real routes, SQL, constraints and transactions; only Gmail delivery is replaced. Opt-in (RUN_DB_TESTS=1).
require('../../backend/node_modules/dotenv').config();
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { pool } = require('../../backend/src/config/db');
const emailService = require('../../backend/src/services/emailService');

const dbDir = path.join(__dirname, '../../backend/src/db');
const sqlFile = (name) => fs.readFileSync(path.join(dbDir, name), 'utf8');
const runnerSource = sqlFile('migrateExternalEvents.js');
// Every migration in the order the production runner applies them.
const runnerOrder = [...runnerSource.slice(runnerSource.indexOf('async function migrate()')).matchAll(/'(migrations\/[^']+\.sql)'/g)].map(([, file]) => file);

// Test case: The organiser cannot edit a submitted event, requests an amendment with an explanation, the event keeps its
// accepted details while pending, and the assigned coordinator is notified, sees the explanation and decides.
test('Handover AC1 AC2 AC3 - confirmed reassignment transfers access, preserves all arrangements and records atomic history',
  { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
    const schema = `cs_amendments_${crypto.randomBytes(8).toString('hex')}`;
    const client = await pool.connect();
    let server;
    try {
      // ---------- Arrange: disposable schema, people and events ----------
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, full_name VARCHAR(255), password_hash VARCHAR(255),
        role VARCHAR(50), roles TEXT[] NOT NULL DEFAULT '{}', organisation_name VARCHAR(255), auth_version INTEGER NOT NULL DEFAULT 0)`);
      await client.query(`CREATE TABLE venues (id SERIAL PRIMARY KEY, name VARCHAR(255), location VARCHAR(255), capacity INTEGER, supported_layouts TEXT[],
        accessibility_features TEXT[], facilities TEXT[], operating_hours VARCHAR(255), availability_status VARCHAR(50), pricing VARCHAR(255), mrt VARCHAR(255), image TEXT)`);
      await client.query(sqlFile('migrations/001-external-events.sql'));
      for (const file of ['sprintOneSchema.sql', 'venueManagementSchema.sql', 'venueScheduleSchema.sql', 'venueAvailabilitySchema.sql']) await client.query(sqlFile(file));
      for (const file of runnerOrder) await client.query(sqlFile(file));
      // Registration settings have a separate production runner; event detail reads now depend on this column.
      await client.query(sqlFile('migrations/021-registration-settings.sql'));
      // Venue booking requests have their own runner.
      await client.query(sqlFile('migrations/20261018064942_venue_booking_requests.sql'));
      const people = [['olivia', 'event_organiser'], ['chris', 'event_coordinator'], ['cara', 'event_coordinator'], ['otto', 'event_organiser'], ['lee', 'event_coordinator_lead'], ['tina', 'technical_support'], ['sam', 'safety_officer'], ['vera', 'venue_staff'], ['ada', 'attendee']];
      for (const [name, role] of people) {
        await client.query('INSERT INTO users (email, full_name, role, roles) VALUES ($1, $2, $3::text, ARRAY[$3::text])', [`${name}@example.test`, name, role]);
      }
      const id = Object.fromEntries(people.map(([name], index) => [name, index + 1]));
      // 1: submitted, assigned to Chris (with a confirmed projector); 2: submitted, unassigned; 3: Olivia's draft; 4: cancelled.
      await client.query(`INSERT INTO events (organiser_id, coordinator_id, name, proposed_date, proposed_start_time, proposed_end_time,
        expected_attendance, room_layout_preference, equipment_items, is_draft, status)
        VALUES ($1, $2, 'Gala', '2030-10-15', '18:00', '20:00', 60, 'Theatre', '[{"item":"Projector","quantity":1}]', false, 'submitted'),
               ($1, NULL, 'Fair', '2030-10-16', '10:00', '12:00', 40, 'Theatre', '[]', false, 'submitted'),
               ($1, NULL, 'Draft talk', NULL, NULL, NULL, NULL, NULL, '[]', true, 'draft'),
               ($1, $2, 'Old dinner', '2030-10-17', '18:00', '20:00', 30, 'Banquet', '[]', false, 'cancelled')`, [id.olivia, id.chris]);
      await client.query('UPDATE events SET equipment_confirmed_at = now() WHERE id = 1');

      mock.method(pool, 'query', (sql, values) => client.query(sql, values));
      const connect = pool.connect.bind(pool);
      mock.method(pool, 'connect', async () => {
        const session = await connect();
        await session.query(`SET search_path TO ${schema}`);
        return { query: (sql, values) => session.query(sql, values), release() { session.release(); } };
      });
      const emails = [];
      mock.method(emailService, 'sendNotificationEmail', async (to, subject) => { emails.push([to, subject]); });
      const app = require('../../backend/src/index');
      server = app.listen(0, '127.0.0.1');
      await new Promise((resolve) => server.once('listening', resolve));
      // Calls the API as one of the seeded people.
      async function as(person, method, url, body) {
        const token = jwt.sign({ sub: id[person], authVersion: 0 }, process.env.JWT_SECRET, { expiresIn: '1h' });
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api${url}`, { method,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, body: await response.json() };
      }
      // Arrange an actually confirmed event with independently persisted venue, stock, staffing and safety records.
      await client.query("INSERT INTO venues(name,location,capacity,supported_layouts) VALUES('Hall A','Level 1',200,ARRAY['Theatre'])");
      await client.query(`INSERT INTO venue_bookings(event_id,venue_id,requested_by,start_datetime,end_datetime,status,decision_by)
        VALUES(1,1,2,'2030-10-15T10:00:00Z','2030-10-15T12:00:00Z','approved',8)`);
      await client.query("INSERT INTO event_technical_support_assignments(event_id,staff_id) VALUES(1,6)");
      await client.query("INSERT INTO event_equipment_reviews(event_id,request_version,outcome,reviewed_by) VALUES(1,1,'fully_fulfillable',6)");
      const reservation = (await client.query(`INSERT INTO event_equipment_reservations(event_id,request_version,event_date,start_time,end_time,reserved_by)
        VALUES(1,1,'2030-10-15','18:00','20:00',6) RETURNING id`)).rows[0].id;
      const equipment = (await client.query("INSERT INTO equipments(asset_code,name,specification,status,quantity) VALUES('PROJ-HANDOVER','Projector','HD projector','operational',4) RETURNING id")).rows[0].id;
      await client.query('INSERT INTO event_equipment_reservation_items(reservation_id,inventory_id,quantity) VALUES($1,$2,1)',[reservation,equipment]);
      await client.query("INSERT INTO event_safety_checks(event_id,safety_officer_id,outcome,notes) VALUES(1,7,'approved','Safety approved')");
      await client.query("UPDATE events SET status='confirmed',decided_by=2,decided_at=now(),technical_support_required=true,technical_support_details='AV support',registration_required=true,registration_open=true,registration_capacity=80,registration_deadline='2030-10-14T12:00:00Z' WHERE id=1");
      await client.query("INSERT INTO registrations(event_id,attendee_id,status) VALUES(1,9,'registered')");
      const amendment = (await client.query(`INSERT INTO event_change_requests(event_id,organiser_id,coordinator_id,requested_changes,explanation)
        VALUES(1,1,2,'{"purpose":"Updated briefing"}','Clarify briefing') RETURNING id`)).rows[0].id;
      const question = await as('chris','POST','/events/1/clarifications',{informationNeeded:['purpose'],message:'Confirm briefing'});
      assert.equal(question.status,201);
      const snapshot = async () => {
        const stored = (await client.query('SELECT * FROM events WHERE id=1')).rows[0];
        const {coordinator_id,updated_at,...confirmed} = stored;
        const records = {};
        for (const table of ['venue_bookings','event_technical_support_assignments','event_equipment_reviews','event_equipment_reservations','event_equipment_reservation_items','event_safety_checks','event_clarification_requests','event_change_requests','registrations','equipments']) {
          records[table]=(await client.query(`SELECT * FROM ${table} ORDER BY 1`)).rows;
        }
        return {confirmed,records};
      };
      const before = await snapshot();
      const assign = (person,coordinatorId,expectedCoordinatorId) => as(person,'PUT','/events/1/assignment',{coordinatorId,expectedCoordinatorId});
      const history = person => as(person,'GET','/events/1/assignment-history');
      for (const person of ['olivia','chris','cara','tina','sam','vera','ada']) assert.equal((await assign(person,3,2)).status,403);
      assert.equal((await assign('lee',6,2)).status,400,'non-coordinators cannot receive responsibility');
      // AC1/AC2: the new coordinator inherits current access; historical ownership fields must stay historical.
      const result = await assign('lee',3,2);
      assert.equal(result.status,200); assert.equal(result.body.event.status,'confirmed');
      assert.deepEqual(await snapshot(),before,'only coordinator_id and updated_at may change');
      for (const path of ['/events/1','/events/1/decision','/events/1/venue-bookings','/events/1/coordinator-registrations','/events/1/equipment-status','/events/1/amendment-requests','/events/1/assignment-history']) {
        assert.equal((await as('chris','GET',path)).status,404,`previous coordinator denied ${path}`);
        assert.equal((await as('cara','GET',path)).status,200,`new coordinator allowed ${path}`);
      }
      assert.equal((await as('otto','GET','/events/1/assignment-history')).status,404);
      assert.ok(!(await as('chris','GET','/events')).body.events.some(event=>event.id===1));
      assert.ok((await as('cara','GET','/events')).body.events.some(event=>event.id===1));
      assert.ok(!(await as('chris','GET','/events/change-requests')).body.changeRequests.some(request=>request.id===amendment));
      assert.ok((await as('cara','GET','/events/change-requests')).body.changeRequests.some(request=>request.id===amendment));
      const oldWrite = await as('chris','POST','/events/1/clarifications',{informationNeeded:['purpose'],message:'Old coordinator write'});
      assert.equal(oldWrite.status,404);
      // AC3: snapshots retain both coordinators and the Lead, even if user display names subsequently change.
      const entries = (await history('lee')).body.history;
      assert.equal(entries.length,1);
      assert.equal(entries[0].previous_coordinator_id,2);assert.equal(entries[0].new_coordinator_id,3);
      assert.equal(entries[0].previous_name,'chris');assert.equal(entries[0].new_name,'cara');
      assert.equal(entries[0].changed_by,5);assert.equal(entries[0].changed_by_name,'lee');
      assert.equal(entries[0].event_status,'confirmed');assert.ok(entries[0].changed_at);
      await client.query("UPDATE users SET full_name='Renamed account' WHERE id=2");
      assert.deepEqual((await history('cara')).body.history,entries);
      assert.deepEqual((await history('olivia')).body.history,entries);
      assert.equal((await assign('lee',2,2)).status,409,'stale assignment cannot overwrite the handover');
      assert.equal((await assign('lee',3,3)).status,200,'saving the current assignment is not a new handover');
      assert.deepEqual((await history('lee')).body.history,entries);
      assert.equal((await client.query("SELECT count(*)::int AS n FROM notifications WHERE event_id=1 AND details->>'kind'='event_assignment'")).rows[0].n,1);
      // Audit and notification failures both roll back the event and all newly inserted history.
      await client.query(`CREATE FUNCTION fail_handover_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'history unavailable'; END $$;
        CREATE TRIGGER fail_handover_audit BEFORE INSERT ON event_coordinator_history FOR EACH ROW EXECUTE FUNCTION fail_handover_audit()`);
      assert.equal((await assign('lee',2,3)).status,500);
      await client.query('DROP TRIGGER fail_handover_audit ON event_coordinator_history');
      await client.query(`CREATE FUNCTION fail_handover_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.details->>'kind'='event_assignment' THEN RAISE EXCEPTION 'notice unavailable'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER fail_handover_notice BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION fail_handover_notice()`);
      assert.equal((await assign('lee',2,3)).status,500);
      await client.query('DROP TRIGGER fail_handover_notice ON notifications');
      assert.equal((await client.query('SELECT coordinator_id FROM events WHERE id=1')).rows[0].coordinator_id,3);
      assert.deepEqual((await history('lee')).body.history,entries);
      assert.deepEqual(await snapshot(),before);
      const concurrent = await Promise.all([assign('lee',2,3),assign('lee',2,3)]);
      assert.deepEqual(concurrent.map(response=>response.status).sort(),[200,409]);
      assert.equal((await history('lee')).body.history.length,2);
      assert.equal((await history('cara')).status,404);
      assert.equal((await history('chris')).status,200);
      assert.deepEqual(await snapshot(),before);
      // The additive history upgrade is repeatable and does not manufacture historical assignments.
      const all = (await history('lee')).body.history;
      const upgrade = sqlFile('migrations/027-coordinator-handover-history.sql');
      await client.query(upgrade);await client.query(upgrade);
      assert.deepEqual((await history('lee')).body.history,all);
      // AC1: after the second handover the restored assignee can act; the outgoing one can no longer write.
      const work = {informationNeeded:['purpose'],message:'Handover follow-up'};
      assert.equal((await as('cara','POST','/events/1/clarifications',work)).status,404);
      assert.equal((await as('chris','POST','/events/1/clarifications',work)).status,201);
      // AC1 race: transfer a second event after its real access check but before history is read.
      await client.query("UPDATE events SET coordinator_id=2,status='confirmed' WHERE id=2");
      const model = require('../../backend/src/models/eventModel');
      const read = model.findAccessibleById;
      mock.method(model,'findAccessibleById',async (...args)=>{
        const authorised = await read(...args);
        if (String(args[0])==='2' && args[1].id===2) {
          const handover = await as('lee','PUT','/events/2/assignment',{coordinatorId:3,expectedCoordinatorId:2});
          assert.equal(handover.status,200);
        }
        return authorised;
      });
      const interrupted = await as('chris','GET','/events/2/assignment-history');
      assert.equal(interrupted.status,200);assert.deepEqual(interrupted.body.history,[]);
      const currentHistory = await as('cara','GET','/events/2/assignment-history');
      assert.equal(currentHistory.status,200);assert.equal(currentHistory.body.history.length,1);

    } finally {
      mock.restoreAll();
      if (server?.listening) await new Promise((resolve) => server.close(resolve));
      // A failed request can leave the shared client inside an aborted transaction; end it so cleanup still runs.
      await client.query('ROLLBACK').catch(() => {});
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      client.release();
      await pool.end();
    }
  });
