// Organiser outcome AC1-AC6: real HTTP, SQL, notification ownership and current event facts in a disposable schema.
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { pool } = require('../../backend/src/config/db');
const emailService = require('../../backend/src/services/emailService');
const { applyLiveSchema } = require('./support/liveSchema');

test('Organiser outcomes AC1-AC6 - submission, review, amendments and clarification outcomes are private and current',
  { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
    const schema = `organiser_outcomes_${crypto.randomBytes(8).toString('hex')}`;
    const client = await pool.connect();
    let server;
    try {
      // Arrange a current production schema and two owners so privacy assertions cannot pass on empty fixtures.
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`CREATE TABLE users (id SERIAL PRIMARY KEY,email VARCHAR(255) UNIQUE NOT NULL,full_name VARCHAR(255),
        password_hash VARCHAR(255),role VARCHAR(50),roles TEXT[] DEFAULT '{}',organisation_name VARCHAR(255),auth_version INT DEFAULT 0);
        CREATE TABLE venues (id SERIAL PRIMARY KEY,name VARCHAR(255),location VARCHAR(255),capacity INT,supported_layouts TEXT[],
        accessibility_features TEXT[],facilities TEXT[],operating_hours VARCHAR(255),availability_status VARCHAR(50),pricing VARCHAR(255),mrt VARCHAR(255),image TEXT)`);
      await applyLiveSchema(client);
      await applyLiveSchema(client);
      for (const role of ['event_organiser','event_coordinator','event_organiser']) {
        await client.query('INSERT INTO users (email,full_name,role,roles) VALUES ($1,$1,$2::text,ARRAY[$2::text])', [`${crypto.randomUUID()}@example.test`,role]);
      }
      mock.method(pool, 'query', (sql, values) => client.query(sql, values));
      mock.method(pool, 'connect', async () => ({ query: (sql, values) => client.query(sql, values), release() {} }));
      mock.method(emailService, 'sendNotificationEmail', async () => {});
      server = require('../../backend/src/index').listen(0, '127.0.0.1');
      await new Promise(resolve => server.once('listening', resolve));
      /** Real signed sessions resolve users through the real authentication middleware. */
      async function as(userId, method, path, body) {
        const token = jwt.sign({ sub: userId,authVersion: 0 },process.env.JWT_SECRET);
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
          method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body ? {body:JSON.stringify(body)} : {}),
        });
        return {status:response.status,body:await response.json()};
      }
      // AC1 success and explained validation failure; a failed submission creates no phantom event.
      const invalid = await as(1,'POST','/events',{isDraft:false,name:'Incomplete'});
      assert.equal(invalid.status,400); assert.ok(invalid.body.message.length > 0);
      const submitted = await as(1,'POST','/events',{isDraft:false,name:'Owner workshop',proposedDate:'2035-01-20',proposedStartTime:'10:00',proposedEndTime:'12:00',expectedAttendance:20});
      assert.equal(submitted.status,201); assert.match(submitted.body.message,/submitted/i);
      const id = submitted.body.event.id;
      await client.query('UPDATE events SET coordinator_id=2 WHERE id=$1',[id]);
      assert.equal((await as(2,'POST',`/events/${id}/decision`,{decision:'approved'})).status,200);
      let initialNotes = (await as(1,'GET','/notifications')).body.notifications;
      assert.match(initialNotes.find(note=>note.type==='event_approved').message,/initially approved.*not final confirmation/);
      await client.query("INSERT INTO venues (name,location,capacity) VALUES ('Hall A','Level 1',100)");
      await client.query(`INSERT INTO venue_bookings (event_id,venue_id,requested_by,start_datetime,end_datetime,status,decision_by)
        VALUES ($1,1,2,'2035-01-20T02:00:00Z','2035-01-20T04:00:00Z','approved',2)`,[id]);
      await client.query("INSERT INTO event_safety_checks (event_id,safety_officer_id,outcome) VALUES ($1,2,'approved')",[id]);
      // AC2 error: if persistence of the owner's notice fails, final confirmation must not commit silently.
      await client.query(`CREATE FUNCTION fail_confirmation_note() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.type='event_confirmed' THEN RAISE EXCEPTION 'notification unavailable'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER fail_confirmation_note BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION fail_confirmation_note()`);
      assert.equal((await as(2,'POST',`/events/${id}/status`,{status:'confirmed'})).status,500);
      assert.equal((await client.query('SELECT status FROM events WHERE id=$1',[id])).rows[0].status,'approved');
      await client.query('DROP TRIGGER fail_confirmation_note ON notifications');
      assert.equal((await as(2,'POST',`/events/${id}/status`,{status:'confirmed'})).status,200);
      const confirmedNotes = (await as(1,'GET','/notifications')).body.notifications.filter(note=>note.type==='event_confirmed');
      assert.equal(confirmedNotes.length,1); assert.match(confirmedNotes[0].message,/finally confirmed/);
      assert.equal((await as(2,'POST',`/events/${id}/status`,{status:'confirmed'})).status,409);
      const rejected = await as(1,'POST','/events',{isDraft:false,name:'Rejected workshop',proposedDate:'2035-01-21',proposedStartTime:'10:00',proposedEndTime:'12:00',expectedAttendance:20});
      await client.query('UPDATE events SET coordinator_id=2 WHERE id=$1',[rejected.body.event.id]);
      assert.equal((await as(2,'POST',`/events/${rejected.body.event.id}/decision`,{decision:'rejected',reason:'Venue unavailable'})).status,200);
      assert.match((await as(1,'GET','/notifications')).body.notifications.find(note=>note.type==='event_rejected').message,/Reason: Venue unavailable/);

      // AC5 clarification is committed with a notice that contains the actual requested information.
      // AC5 error: one statement must not save the question if its notification cannot be stored.
      await client.query(`CREATE FUNCTION fail_question_note() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.type='event_clarification_requested' THEN RAISE EXCEPTION 'notification unavailable'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER fail_question_note BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION fail_question_note()`);
      assert.equal((await as(2,'POST',`/events/${id}/clarifications`,{informationNeeded:['purpose'],message:'This save must roll back.'})).status,500);
      assert.equal((await client.query('SELECT count(*)::int AS n FROM event_clarification_requests WHERE event_id=$1',[id])).rows[0].n,0);
      await client.query('DROP TRIGGER fail_question_note ON notifications');
      const clarification = await as(2,'POST',`/events/${id}/clarifications`,{informationNeeded:['purpose'],message:'Please explain the learning objectives.'});
      assert.equal(clarification.status,201);
      assert.equal((await as(3,'POST',`/events/${id}/clarifications`,{informationNeeded:['purpose'],message:'Unrelated question'})).status,403);
      let inbox = (await as(1,'GET','/notifications')).body.notifications;
      const question = inbox.find(note => note.type==='event_clarification_requested');
      assert.ok(question); assert.equal(question.event_id,id);
      assert.match(question.message,/Please explain the learning objectives/);
      assert.deepEqual(question.details.informationNeeded,['purpose']);
      assert.deepEqual((await as(3,'GET','/notifications')).body.notifications,[]);
      assert.equal((await as(3,'GET',`/events/${id}`)).status,404);
      assert.equal((await as(3,'POST',`/notifications/${question.id}/read`,{})).status,404);
      await as(1,'POST',`/events/${id}/clarifications/${clarification.body.clarificationRequest.id}/respond`,{response:'Learning objectives supplied.'});

      // AC3/AC4 equipment amendments route to the coordinator and notify the owner only when actually applied.
      await client.query('UPDATE events SET equipment_confirmed_at=now() WHERE id=$1',[id]);
      const amendment = await as(1,'PUT',`/events/${id}/equipment`,{equipmentItems:[{item:'Projector',quantity:1}]});
      assert.equal(amendment.status,202); assert.match(amendment.body.message,/pending review/i);
      const applied = await as(2,'POST',`/events/change-requests/${amendment.body.changeRequest.id}/decision`,{decision:'approved'});
      assert.equal(applied.status,200);
      inbox = (await as(1,'GET','/notifications')).body.notifications;
      const changed = inbox.find(note => note.type==='change_request_approved');
      assert.ok(changed); assert.match(changed.message,/approved and applied/); assert.match(changed.message,/Projector/);
      // AC6: notification links use the stored event ID; the detail read returns latest committed facts, never a snapshot.
      const latest = await as(1,'GET',`/events/${changed.event_id}`);
      assert.equal(latest.status,200); assert.deepEqual(latest.body.event.equipment_items,[{item:'Projector',quantity:1}]);
      assert.equal((await as(3,'GET',`/events/${changed.event_id}/decision`)).status,404);
      // Re-running upgrades with both new notification types already stored preserves history and adds no duplicates.
      const beforeUpgrade = (await client.query('SELECT count(*)::int AS n FROM notifications')).rows[0].n;
      await applyLiveSchema(client);
      assert.equal((await client.query('SELECT count(*)::int AS n FROM notifications')).rows[0].n,beforeUpgrade);
    } finally {
      mock.restoreAll();
      if (server?.listening) await new Promise(resolve=>server.close(resolve));
      await client.query('ROLLBACK'); await client.query('SET search_path TO public');
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); client.release(); await pool.end();
    }
  });
