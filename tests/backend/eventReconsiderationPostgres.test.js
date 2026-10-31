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
test('Reconsider AC1 AC2 AC3 AC4 - corrected rejections re-enter review with private durable history and cancellation remains final',
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
      const people = [['olivia', 'event_organiser'], ['chris', 'event_coordinator'], ['cara', 'event_coordinator'], ['otto', 'event_organiser']];
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
      // AC1: unresolved information blocks approval, but can still justify a recorded rejection.
      const question = await as('chris','POST','/events/1/clarifications', {informationNeeded:['purpose'],message:'Explain who will attend, or request an amendment.'});
      assert.equal(question.status,201);
      assert.equal((await as('chris','POST','/events/1/decision',{decision:'approved'})).status,409);
      assert.equal((await as('chris','POST','/events/1/decision',{decision:'rejected',reason:'Insufficient detail'})).status,200);
      const view = async person => as(person,'GET','/events/1/review-history');
      let review = await view('chris');
      assert.equal(review.status,200);
      const firstRejection = review.body.history.find(entry=>entry.outcome==='rejected');
      assert.equal(firstRejection.details.reason,'Insufficient detail');
      assert.equal((await view('cara')).status,404);
      assert.equal((await view('otto')).status,404);
      assert.equal((await view('olivia')).status,200);
      const reopen = (person, rejectionId=firstRejection.id) => as(person,'POST','/events/1/reconsider',{rejectionId});
      assert.equal((await reopen('chris')).status,409,'an uncorrected rejection cannot reopen');
      assert.equal((await reopen('cara')).status,404);
      assert.equal((await reopen('olivia')).status,403);
      assert.equal((await as('chris','POST','/events/1/reconsider',{rejectionId:0})).status,400);
      // AC2/AC3: a saved request alone is not a correction; the assigned coordinator must apply it.
      const requested = await as('olivia','POST','/events/1/amendment-requests', {changes:{purpose:'Corrected community audience'},explanation:'Responding to the rejection'});
      assert.equal(requested.status,202);
      assert.equal((await reopen('chris')).status,409);
      const decisionPath = `/events/change-requests/${requested.body.amendmentRequest.id}/decision`;
      assert.equal((await as('chris','POST',decisionPath,{decision:'approved'})).status,200);
      assert.equal((await reopen('chris')).status,409,'pending clarifications still require a response');
      assert.equal((await as('olivia','POST',`/events/1/clarifications/${question.body.clarificationRequest.id}/respond`,{response:'Audience corrected in the amendment'})).status,200);
      assert.equal((await reopen('chris',firstRejection.id+999)).status,409,'stale rejection ids cannot act on this review');
      // Failure inserting the organiser notice must roll back status and its automatically recorded history.
      await client.query(`CREATE FUNCTION fail_reconsider_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.details->>'kind'='event_reconsidered' THEN RAISE EXCEPTION 'notice unavailable'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER fail_reconsider_notice BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION fail_reconsider_notice()`);
      assert.equal((await reopen('chris')).status,500);
      assert.equal((await client.query('SELECT status FROM events WHERE id=1')).rows[0].status,'rejected');
      assert.equal((await view('chris')).body.history.filter(entry=>entry.kind==='reconsideration').length,0);
      await client.query('DROP TRIGGER fail_reconsider_notice ON notifications');
      const races = await Promise.all([reopen('chris'),reopen('chris')]);
      assert.deepEqual(races.map(result=>result.status).sort(),[200,409]);
      const current = (await client.query('SELECT status,decided_at,decision_reason FROM events WHERE id=1')).rows[0];
      assert.deepEqual(current,{status:'under_review',decided_at:null,decision_reason:null});
      const notice = (await as('olivia','GET','/notifications')).body.notifications.find(note=>note.details.kind==='event_reconsidered');
      assert.equal(notice.event_id,1);
      assert.match(notice.message,/review.*again/i);
      // The reopened request goes through the existing review gate; a new unresolved clarification still blocks approval.
      const again = await as('chris','POST','/events/1/clarifications',{informationNeeded:['purpose'],message:'Confirm correction'});
      assert.equal((await as('chris','POST','/events/1/decision',{decision:'approved'})).status,409);
      await as('olivia','POST',`/events/1/clarifications/${again.body.clarificationRequest.id}/respond`,{response:'Confirmed'});
      assert.equal((await as('chris','POST','/events/1/decision',{decision:'rejected',reason:'Correction still insufficient'})).status,200);
      const secondRejection = (await view('chris')).body.history.filter(entry=>entry.outcome==='rejected').at(-1);
      assert.equal((await reopen('chris',secondRejection.id)).status,409,'old corrections cannot satisfy a new rejection');
      assert.equal((await as('chris','POST','/events/1/agreed-amendments',{changes:{purpose:'Fully corrected community audience'},explanation:'Agreed further correction'})).status,201);
      assert.equal((await reopen('chris')).status,409,'a stale rejection cannot reopen a later cycle');
      assert.equal((await reopen('chris',secondRejection.id)).status,200);
      assert.equal((await as('chris','POST','/events/1/decision',{decision:'approved'})).status,200);
      review = await view('olivia');
      const outcomes = review.body.history.filter(entry=>['review','reconsideration','correction'].includes(entry.kind));
      assert.deepEqual(outcomes.map(entry=>entry.kind),['review','correction','reconsideration','review','correction','reconsideration','review']);
      assert.deepEqual(outcomes.filter(entry=>entry.kind==='review').map(entry=>entry.outcome),['rejected','rejected','approved']);
      assert.ok(JSON.stringify(outcomes).includes('Corrected community audience'));
      assert.ok(JSON.stringify(outcomes).includes('Responding to the rejection'));
      assert.equal((await reopen('chris')).status,409);
      // AC4: neither corrections nor a historical rejection can restore a cancelled event.
      await client.query("UPDATE events SET status='cancelled' WHERE id=1");
      const cancelled = await reopen('chris');
      assert.equal(cancelled.status,409); assert.match(cancelled.body.message,/new event request/i);
      assert.equal((await as('olivia','POST','/events/1/amendment-requests',{changes:{purpose:'Revive'},explanation:'Try again'})).status,409);
      assert.equal((await client.query('SELECT status FROM events WHERE id=1')).rows[0].status,'cancelled');
      // Schema upgrades are repeatable and never erase recorded outcomes/corrections.
      const before = (await view('chris')).body.history;
      const upgrade = sqlFile('migrations/026-event-reconsideration.sql');
      await client.query(upgrade); await client.query(upgrade);
      assert.deepEqual((await view('chris')).body.history,before);
      // AC3 upgrade boundary: retain a rejection and correction that predate the history migration itself.
      const legacy = (await client.query(`INSERT INTO events(organiser_id,coordinator_id,name,is_draft,status,decided_at,decided_by,decision_reason)
        VALUES(1,2,'Legacy rejected',false,'rejected',now()-interval '2 hours',2,'Original rejection') RETURNING id`)).rows[0].id;
      await client.query('DROP TRIGGER event_correction_history_changed ON event_change_requests');
      await client.query(`INSERT INTO event_change_requests(event_id,organiser_id,coordinator_id,requested_changes,status,reviewed_at,reviewed_by,explanation,applied_changes)
        VALUES($1,1,2,'{"purpose":"Legacy correction"}','approved',now()-interval '1 hour',2,'Earlier correction',
          '[{"field":"purpose","label":"Purpose","before":"Vague","after":"Legacy correction"}]')`,[legacy]);
      await client.query(upgrade); await client.query(upgrade);
      const migrated = await as('chris','GET',`/events/${legacy}/review-history`);
      assert.deepEqual(migrated.body.history.map(entry=>entry.kind),['review','correction']);
      assert.equal(migrated.body.history[0].details.reason,'Original rejection');
      assert.equal(migrated.body.blocked,null);

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
