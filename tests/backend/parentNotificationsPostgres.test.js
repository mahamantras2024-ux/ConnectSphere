// File: Parent notification system against real PostgreSQL in a disposable schema built from the real migrations.
// Test scope: Real routes, SQL, transactions and constraints; only the pool is pointed at the disposable schema and email is
// captured. Opt-in (RUN_DB_TESTS=1).
require('../../backend/node_modules/dotenv').config();
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { pool } = require('../../backend/src/config/db');
const emailService = require('../../backend/src/services/emailService');

// Every migration in the order the production runner applies them (shared live-schema helper).
const { sqlFile, runnerMigrations: runnerOrder, applyLiveSchema } = require('./support/liveSchema');

// Test case: The Lead hears about a new request, and the Safety Officer hears exactly once when it becomes ready.
test('NT AC1 - Coordinator Lead and Safety Officer notifications follow the real workflow, and every migration re-runs',
  { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
    const schema = `cs_parent_notifications_${crypto.randomBytes(8).toString('hex')}`;
    const client = await pool.connect();
    let server;
    try {
      // ---------- Arrange: disposable schema from the base schemas and the runner's migrations ----------
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255) UNIQUE NOT NULL, full_name VARCHAR(255), password_hash VARCHAR(255),
        role VARCHAR(50), roles TEXT[] NOT NULL DEFAULT '{}', organisation_name VARCHAR(255), auth_version INTEGER NOT NULL DEFAULT 0)`);
      await client.query(`CREATE TABLE venues (id SERIAL PRIMARY KEY, name VARCHAR(255), location VARCHAR(255), capacity INTEGER, supported_layouts TEXT[],
        accessibility_features TEXT[], facilities TEXT[], operating_hours VARCHAR(255), availability_status VARCHAR(50), pricing VARCHAR(255), mrt VARCHAR(255), image TEXT)`);
      await applyLiveSchema(client);
      const people = [['olivia', 'event_organiser'], ['chris', 'event_coordinator'], ['lee', 'event_coordinator_lead'], ['vera', 'venue_staff'],
        ['tina', 'technical_support'], ['sam', 'safety_officer'], ['sid', 'safety_officer'], ['vince','venue_staff']];
      for (const [name, role] of people) await client.query('INSERT INTO users (email, full_name, role, roles) VALUES ($1, $2, $3::text, ARRAY[$3::text])', [`${name}@example.test`, name, role]);
      const id = Object.fromEntries(people.map(([name], index) => [name, index + 1]));
      await client.query("INSERT INTO venues (name, location, capacity, supported_layouts, accessibility_features, facilities, operating_hours, availability_status) VALUES ('Hall A', 'Level 1', 100, ARRAY['Theatre'], ARRAY['Ramp'], ARRAY['Wi-Fi'], '08:00 - 22:00', 'Available')");

      mock.method(pool, 'query', (sql, values) => client.query(sql, values));
      mock.method(pool, 'connect', async () => ({ query: (sql, values) => client.query(sql, values), release() {} }));
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
      const notesOf = async (person, type) => (await client.query('SELECT title FROM notifications WHERE user_id = $1 AND type = $2 ORDER BY id', [id[person], type])).rows.map((row) => row.title);

      // ---------- Act / Assert: a submitted request reaches the Coordinator Lead (in-app list and email) ----------
      const created = await as('olivia', 'POST', '/events', { name: 'Gala', proposedDate: '2030-10-15', proposedStartTime: '10:00', proposedEndTime: '12:00',
        expectedAttendance: 50, isDraft: false, equipmentItems: [{ item: 'Projector', quantity: 1 }] });
      assert.equal(created.status, 201);
      const eventId = created.body.event.id;
      assert.deepEqual(await notesOf('lee', 'event_awaiting_assignment'), ['New request to assign: Gala']);
      assert.ok(emails.some(([to, subject]) => to === 'lee@example.test' && subject === 'New request to assign: Gala'));
      const leeList = (await as('lee', 'GET', '/notifications')).body;
      assert.deepEqual([leeList.unreadCount, leeList.notifications[0].type, leeList.notifications[0].event_id], [1, 'event_awaiting_assignment', eventId]);

      // Booking notice AC1/AC2: assigned staff receive immediate requests even without opting into reminders.
      await client.query("INSERT INTO venues (name,location,capacity) VALUES ('Hall B','Level 2',100)");
      await client.query('INSERT INTO venue_staff_assignments (venue_id,staff_user_id) VALUES (1,$1),(2,$2),(1,$3)',[id.vera,id.vince,id.chris]);
      // The Lead assigns Chris, who books Hall A; Venue Staff approve it. The projector is not confirmed yet: not ready.
      assert.equal((await as('lee', 'PUT', `/events/${eventId}/assignment`, { coordinatorId: id.chris, expectedCoordinatorId: null })).status, 200);
      // Booking AC3: a notification insert failure must roll back the new hold and send no email.
      await client.query(`CREATE FUNCTION fail_booking_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.type='venue_booking_requested' THEN RAISE EXCEPTION 'booking notice unavailable'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER fail_booking_notice BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION fail_booking_notice()`);
      assert.equal((await as('chris','POST','/venues/1/requests',{eventId,startDatetime:'2030-10-15T10:00:00+08:00',endDatetime:'2030-10-15T12:00:00+08:00'})).status,500);
      assert.equal((await client.query('SELECT count(*)::int AS n FROM venue_bookings WHERE event_id=$1',[eventId])).rows[0].n,0);
      assert.equal((await notesOf('vera','venue_booking_requested')).length,0);
      await client.query('DROP TRIGGER fail_booking_notice ON notifications');
      const booking = await as('chris', 'POST', '/venues/1/requests', { eventId, startDatetime: '2030-10-15T10:00:00+08:00', endDatetime: '2030-10-15T12:00:00+08:00' });
      assert.equal(booking.status, 201);
      const venueNotes=(await as('vera','GET','/notifications')).body.notifications.filter(note=>note.type==='venue_booking_requested');
      assert.deepEqual((await as('vince','GET','/notifications')).body.notifications,[]);
      assert.equal(venueNotes.length,1);assert.equal(venueNotes[0].event_id,eventId);
      assert.equal(venueNotes[0].details.requestId,booking.body.request.id);
      assert.match(venueNotes[0].message,/Gala.*Hall A.*review/);
      assert.ok(emails.some(([to,subject])=>to==='vera@example.test' && subject==='New venue booking request: Hall A'));
      assert.equal((await as('chris','GET','/notifications')).body.notifications.filter(note=>note.type==='venue_booking_requested').length,0);
      // An overlapping retry cannot persist a second hold or send another notice.
      assert.equal((await as('chris','POST','/venues/1/requests',{eventId,startDatetime:'2030-10-15T10:00:00+08:00',endDatetime:'2030-10-15T12:00:00+08:00'})).status,409);
      assert.equal((await notesOf('vera','venue_booking_requested')).length,1);
      assert.equal((await as('vera', 'PUT', `/venues/1/requests/${booking.body.request.id}/decision`, { decision: 'approved' })).status, 200);
      assert.deepEqual(await notesOf('sam', 'safety_check_ready'), []);

      // AC6: role notifications do not grant unrelated staff access to the equipment request.
      await client.query('INSERT INTO event_technical_support_assignments (event_id,staff_id) VALUES ($1,$2)', [eventId,id.tina]);
      // Technical Support confirms the projector: the event is now ready, and each Safety Officer hears once.
      const [pending] = (await as('tina', 'GET', '/events/equipment-requests')).body.requests;
      assert.equal((await as('tina', 'POST', `/events/${eventId}/equipment-reviews`, { outcome: 'fully_fulfillable', requestVersion: pending.request_version })).status, 201);
      assert.deepEqual(await notesOf('sam', 'safety_check_ready'), ['Ready for safety check: Gala']);
      assert.deepEqual(await notesOf('sid', 'safety_check_ready'), ['Ready for safety check: Gala']);
      assert.deepEqual((await as('sam', 'GET', '/notifications')).body.notifications.map((note) => note.type), ['safety_check_ready']);
      // Other people never see these role notifications.
      assert.deepEqual((await as('chris', 'GET', '/notifications')).body.notifications.filter((note) => ['safety_check_ready', 'event_awaiting_assignment'].includes(note.type)), []);

      // A late approval of a booking whose hold had expired leaves the already-ready Gala ready: no repeat notification.
      const late = await as('chris', 'POST', '/venues/1/requests', { eventId, startDatetime: '2030-10-15T14:00:00+08:00', endDatetime: '2030-10-15T16:00:00+08:00' });
      assert.equal(late.status, 201);
      await client.query("UPDATE venue_bookings SET hold_expires_at = now() - interval '1 minute' WHERE id = $1", [late.body.request.id]);
      assert.equal((await as('vera', 'PUT', `/venues/1/requests/${late.body.request.id}/decision`, { decision: 'approved' })).status, 200);
      assert.deepEqual(await notesOf('sam', 'safety_check_ready'), ['Ready for safety check: Gala']);

      // A booking still being held takes Gala out of the safety queue (VENUE_PENDING); approving it brings Gala back,
      // so the Safety Officers are told it is ready again.
      const held = await as('chris', 'POST', '/venues/1/requests', { eventId, startDatetime: '2030-10-15T17:00:00+08:00', endDatetime: '2030-10-15T18:00:00+08:00' });
      assert.equal(held.status, 201);
      assert.equal((await as('vera', 'PUT', `/venues/1/requests/${held.body.request.id}/decision`, { decision: 'approved' })).status, 200);
      assert.deepEqual(await notesOf('sam', 'safety_check_ready'), ['Ready for safety check: Gala', 'Ready for safety check: Gala']);

      // An event with nothing technical becomes ready the moment its venue is approved.
      const talk = await as('olivia', 'POST', '/events', { name: 'Talk', proposedDate: '2030-10-16', proposedStartTime: '10:00', proposedEndTime: '12:00', expectedAttendance: 20, isDraft: false });
      assert.equal(talk.status, 201);
      assert.equal((await as('lee', 'PUT', `/events/${talk.body.event.id}/assignment`, { coordinatorId: id.chris, expectedCoordinatorId: null })).status, 200);
      const talkBooking = await as('chris', 'POST', '/venues/1/requests', { eventId: talk.body.event.id, startDatetime: '2030-10-16T10:00:00+08:00', endDatetime: '2030-10-16T12:00:00+08:00' });
      assert.equal(talkBooking.status, 201);
      assert.equal((await as('vera', 'PUT', `/venues/1/requests/${talkBooking.body.request.id}/decision`, { decision: 'approved' })).status, 200);
      assert.deepEqual(await notesOf('sid', 'safety_check_ready'), ['Ready for safety check: Gala', 'Ready for safety check: Gala', 'Ready for safety check: Talk']);
      assert.ok(emails.some(([to, subject]) => to === 'sid@example.test' && subject === 'Ready for safety check: Talk'));

      // Reviewer regression: Expo has one approved and one still-pending booking, so it waits on Venue Staff. Rejecting the
      // pending one leaves the approved booking as its only arrangement; Expo is now ready, and Safety Officers are told.
      const expo = await as('olivia', 'POST', '/events', { name: 'Expo', proposedDate: '2030-10-17', proposedStartTime: '10:00', proposedEndTime: '12:00', expectedAttendance: 20, isDraft: false });
      assert.equal((await as('lee', 'PUT', `/events/${expo.body.event.id}/assignment`, { coordinatorId: id.chris, expectedCoordinatorId: null })).status, 200);
      const expoMorning = await as('chris', 'POST', '/venues/1/requests', { eventId: expo.body.event.id, startDatetime: '2030-10-17T10:00:00+08:00', endDatetime: '2030-10-17T12:00:00+08:00' });
      const expoEvening = await as('chris', 'POST', '/venues/1/requests', { eventId: expo.body.event.id, startDatetime: '2030-10-17T18:00:00+08:00', endDatetime: '2030-10-17T19:00:00+08:00' });
      assert.equal((await as('vera', 'PUT', `/venues/1/requests/${expoMorning.body.request.id}/decision`, { decision: 'approved' })).status, 200);
      assert.equal((await notesOf('sam', 'safety_check_ready')).includes('Ready for safety check: Expo'), false);
      assert.equal((await as('vera', 'PUT', `/venues/1/requests/${expoEvening.body.request.id}/decision`, { decision: 'rejected', reason: 'Hall closed' })).status, 200);
      assert.deepEqual((await notesOf('sam', 'safety_check_ready')).filter((title) => title.endsWith('Expo')), ['Ready for safety check: Expo']);
      assert.ok(emails.some(([to, subject]) => to === 'sam@example.test' && subject === 'Ready for safety check: Expo'));

      // Safety recovery AC1: reproduce an already-ready event with a missing notice for the signed-in officer.
      await client.query("DELETE FROM notifications WHERE event_id=$1 AND user_id=$2 AND type='safety_check_ready'",[talk.body.event.id,id.sam]);
      const retainedSid=(await notesOf('sid','safety_check_ready')).length;
      assert.ok((await as('sam','GET','/safety/checks')).body.events.some(event=>event.id===talk.body.event.id));
      assert.equal((await notesOf('sam','safety_check_ready')).filter(title=>title==='Ready for safety check: Talk').length,1);
      // Repeated and overlapping queue reads must not duplicate notices or resend email; other recipients are untouched.
      const recoveredEmails=emails.filter(([to,subject])=>to==='sam@example.test' && subject==='Ready for safety check: Talk').length;
      await Promise.all([as('sam','GET','/safety/checks'),as('sam','GET','/safety/checks')]);
      assert.equal((await notesOf('sam','safety_check_ready')).filter(title=>title==='Ready for safety check: Talk').length,1);
      assert.equal(emails.filter(([to,subject])=>to==='sam@example.test' && subject==='Ready for safety check: Talk').length,recoveredEmails);
      assert.equal((await notesOf('sid','safety_check_ready')).length,retainedSid);
      // Safety recovery AC2: preserve an existing legacy/read notice without resetting it or adding a replacement.
      const galaSam=(await client.query("SELECT id FROM notifications WHERE event_id=$1 AND user_id=$2 AND type='safety_check_ready' ORDER BY id LIMIT 1",[eventId,id.sam])).rows[0];
      await client.query("UPDATE notifications SET details=details-'reviewCycle',read_at=now() WHERE id=$1",[galaSam.id]);
      const galaBefore=(await client.query("SELECT count(*)::int AS n FROM notifications WHERE event_id=$1 AND user_id=$2 AND type='safety_check_ready'",[eventId,id.sam])).rows[0].n;
      await as('sam','GET','/safety/checks');
      assert.equal((await client.query("SELECT count(*)::int AS n FROM notifications WHERE event_id=$1 AND user_id=$2 AND type='safety_check_ready'",[eventId,id.sam])).rows[0].n,galaBefore);
      assert.ok((await client.query('SELECT read_at FROM notifications WHERE id=$1',[galaSam.id])).rows[0].read_at);

      // A distinct requested re-review must receive a new recovery notice rather than reuse the initial one.
      assert.equal((await as('sam','POST',`/events/${talk.body.event.id}/safety-checks`,{outcome:'changes_requested',notes:'Review crowd flow',changeAreas:['event_details']})).status,201);
      assert.equal((await as('chris','POST',`/events/${talk.body.event.id}/safety-changes/resolve`,{area:'event_details'})).status,200);
      await client.query("DELETE FROM notifications WHERE event_id=$1 AND user_id=$2 AND type='safety_check_ready' AND details->>'requirement'='reassessment'",[talk.body.event.id,id.sam]);
      await as('sam','GET','/safety/checks');
      const recoveredReview=(await client.query("SELECT details FROM notifications WHERE event_id=$1 AND user_id=$2 AND type='safety_check_ready' AND details->>'requirement'='reassessment'",[talk.body.event.id,id.sam])).rows;
      assert.equal(recoveredReview.length,1);assert.notEqual(recoveredReview[0].details.reviewCycle,'initial');

      // Safety recovery AC1: a provisioned officer added after readiness gets their own current notices on first queue load.
      await client.query("INSERT INTO users (email,full_name,role,roles) VALUES ('nora@example.test','nora','safety_officer',ARRAY['safety_officer'])");
      id.nora=(await client.query("SELECT id FROM users WHERE email='nora@example.test'")).rows[0].id;
      assert.ok((await as('nora','GET','/safety/checks')).body.events.some(event=>event.id===talk.body.event.id));
      assert.equal((await notesOf('nora','safety_check_ready')).filter(title=>title==='Ready for safety re-review: Talk').length,1);
      // ---------- Every migration re-runs with the new types (and older ones) stored ----------
      for (const file of runnerOrder) await client.query(sqlFile(file));
      await client.query("INSERT INTO notifications (user_id, type, title, message) VALUES ($1, 'safety_check_ready', 't', 'm'), ($1, 'event_awaiting_assignment', 't', 'm')", [id.sam]);
      await assert.rejects(client.query("INSERT INTO notifications (user_id, type, title, message) VALUES ($1, 'unknown_type', 't', 'm')", [id.sam]), { code: '23514' });
    } finally {
      mock.restoreAll();
      if (server?.listening) await new Promise((resolve) => server.close(resolve));
      await client.query('ROLLBACK').catch(() => {});
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      client.release();
      await pool.end();
    }
  });
