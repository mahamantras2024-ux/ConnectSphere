// Real row locks, transactions and notification constraints are checked only in a disposable PostgreSQL schema.
require('../../backend/node_modules/dotenv').config({ path: require('node:path').join(__dirname, '../../backend/.env') });
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { Pool } = require('../../backend/node_modules/pg');
const { pool } = require('../../backend/src/config/db');
const { withdraw } = require('../../backend/src/services/attendeeWithdrawal');
const { register } = require('../../backend/src/services/attendeeRegistration');

test('Withdraw AC1/AC2/AC3 - PostgreSQL preserves capacity, FIFO order, notifications and atomic rollback under races',
  { skip: process.env.RUN_DB_TESTS !== '1' }, async (t) => {
    // Arrange: real separate sessions share a random schema; application tables are never used.
    const schema = `attendee_withdrawal_${randomBytes(8).toString('hex')}`;
    const configuration = { ...pool.options, password: pool.options.password, connectionTimeoutMillis: 10000 };
    const admin = new Pool(configuration);
    const isolated = new Pool({ ...configuration, options: `-c search_path=${schema}` });
    let created = false;
    /** Restores two confirmed places and three queued attendees; equal queue times must use registration ID order. */
    async function reset() {
      await isolated.query(`TRUNCATE notifications, registrations RESTART IDENTITY;
        INSERT INTO registrations(event_id,attendee_id,status,registered_at) VALUES
          (44,8,'registered','2030-01-01'),(44,9,'registered','2030-01-01'),
          (44,10,'waitlisted','2030-01-02'),(44,11,'waitlisted','2030-01-02'),(44,12,'waitlisted','2030-01-03');`);
    }
    /** Reads stable attendee/status pairs as an independent oracle for persisted transactions. */
    async function states() {
      return (await isolated.query('SELECT attendee_id,status FROM registrations ORDER BY attendee_id')).rows;
    }
    try {
      mock.method(Date, 'now', () => Date.parse('2031-06-01T00:00:00Z'));
      await admin.query(`CREATE SCHEMA ${schema}`); created = true;
      await isolated.query(`CREATE TABLE users(id int PRIMARY KEY,email text);
        CREATE TABLE events(id int PRIMARY KEY,name text,status text,is_draft boolean,registration_required boolean,
          registration_capacity int,registration_deadline timestamptz,proposed_date date,proposed_start_time time,proposed_end_time time);
        CREATE TABLE venues(id int PRIMARY KEY,capacity int);
        CREATE TABLE venue_bookings(event_id int,venue_id int,status text);
        CREATE TABLE registrations(id serial PRIMARY KEY,event_id int REFERENCES events(id),attendee_id int REFERENCES users(id),
          status text,registered_at timestamptz DEFAULT clock_timestamp(),withdrawn_at timestamptz,UNIQUE(event_id,attendee_id));
        CREATE TABLE notifications(id serial PRIMARY KEY,user_id int REFERENCES users(id),event_id int REFERENCES events(id),
          change_request_id int,type text NOT NULL,title text,message text,details jsonb,created_at timestamptz DEFAULT now(),read_at timestamptz,
          CONSTRAINT notifications_type_check CHECK(type IN ('event_cancelled','legacy_notice')));
        INSERT INTO users VALUES (8,'8@example.test'),(9,'9@example.test'),(10,'10@example.test'),
          (11,'11@example.test'),(12,'12@example.test'),(13,'13@example.test');
        INSERT INTO events VALUES (44,'Arts Day','approved',false,true,2,'2030-01-01','2099-06-12','09:30','10:30');
        INSERT INTO venues VALUES (1,2); INSERT INTO venue_bookings VALUES (44,1,'approved');
        INSERT INTO notifications(user_id,event_id,type,title) VALUES(8,44,'legacy_notice','Stored earlier');`);
      const sql = readFileSync(path.join(__dirname, '../../backend/src/db/migrations/016-attendee-withdrawal.sql'), 'utf8');
      await isolated.query(sql); await isolated.query(sql);
      assert.equal((await isolated.query("SELECT title FROM notifications WHERE type='legacy_notice'")).rows[0].title, 'Stored earlier');
      mock.method(pool, 'connect', () => isolated.connect());
      mock.method(pool, 'query', (text, values) => isolated.query(text, values));
      await t.test('Withdraw AC1/AC2 - simultaneous withdrawals promote the first two FIFO entries and notify them', async () => {
        await reset();
        // Act: two different attendees withdraw concurrently; each freed place must go to one FIFO entry.
        const outcomes = await Promise.all([withdraw(44, 8), withdraw(44, 9)]);
        assert.deepEqual(outcomes.map(result => result.status), [200, 200]);
        assert.deepEqual(await states(), [
          { attendee_id: 8, status: 'withdrawn' }, { attendee_id: 9, status: 'withdrawn' },
          { attendee_id: 10, status: 'registered' }, { attendee_id: 11, status: 'registered' }, { attendee_id: 12, status: 'waitlisted' },
        ]);
        const notices = (await isolated.query("SELECT user_id,details FROM notifications WHERE type='waitlist_promoted' ORDER BY user_id")).rows;
        assert.deepEqual(notices.map(notice => notice.user_id), [10, 11]);
        assert.ok(notices.every(notice => notice.details.status === 'registered'));
        const mine = await require('../../backend/src/models/registrationModel').listForAttendee(8);
        assert.equal(mine[0].status, 'withdrawn');
        assert.equal(mine[0].withdrawal_deadline.toISOString(), '2099-06-12T01:30:00.000Z');

      });

      await t.test('Withdraw AC2 - earlier migration constraints preserve stored promotion notifications', async () => {
        await reset(); await withdraw(44, 8);
        // Existing promotion notifications must survive the earlier fixed-list constraint migrations on rerun.
        for (const file of ['008-technical-support-assignments.sql', '012-event-cancellation-notifications.sql',
          '013-equipment-review-affected-items.sql', '014-equipment-reservation-unavailability.sql']) {
          const source = readFileSync(path.join(__dirname, '../../backend/src/db/migrations', file), 'utf8');
          const constraint = source.match(/ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK \([\s\S]*?\);/)[0];
          await isolated.query('ALTER TABLE notifications DROP CONSTRAINT notifications_type_check');
          await isolated.query(constraint);
        }
        assert.equal((await isolated.query("SELECT count(*)::int AS n FROM notifications WHERE type='waitlist_promoted'")).rows[0].n, 1);
      });

      await t.test('Withdraw AC1/AC2 - duplicate first-time withdrawals free only one place', async () => {
        // Duplicate first-time withdrawals must free only one place and store one promotion notification.
        await reset(); await Promise.all([withdraw(44, 8), withdraw(44, 8)]);
        assert.equal((await isolated.query('SELECT count(*)::int AS n FROM notifications')).rows[0].n, 1);
        assert.equal((await states()).find(row => row.attendee_id === 11).status, 'waitlisted');

      });

      await t.test('Withdraw AC2 - an eligible new registrant cannot take the place ahead of the waitlist', async () => {
        // A new registrant cannot steal the freed place ahead of an existing waitlisted attendee.
        await reset();
        await isolated.query('UPDATE events SET registration_deadline=NULL WHERE id=44');
        const race = await Promise.all([register(44, 13, false), withdraw(44, 8)]);
        assert.deepEqual(race.map(result => result.status), [409, 200]);
        assert.equal((await states()).find(row => row.attendee_id === 10).status, 'registered');
        assert.equal((await states()).some(row => row.attendee_id === 13), false);

      });

      await t.test('Withdraw AC2 - a notification failure rolls back both registration changes', async () => {
        // A database notification error must roll back both the withdrawal and its promotion.
        await reset();
        await isolated.query(`CREATE FUNCTION reject_promotion() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN RAISE EXCEPTION 'notification store unavailable'; END $$;
          CREATE TRIGGER reject_promotion BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION reject_promotion();`);
        await assert.rejects(withdraw(44, 8), /notification store unavailable/);
        assert.equal((await states()).find(row => row.attendee_id === 8).status, 'registered');
        assert.equal((await states()).find(row => row.attendee_id === 10).status, 'waitlisted');
        assert.equal((await isolated.query('SELECT count(*)::int AS n FROM notifications')).rows[0].n, 0);
      });
    } finally {
      mock.restoreAll(); await isolated.end();
      if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end(); await pool.end();
    }
  });
