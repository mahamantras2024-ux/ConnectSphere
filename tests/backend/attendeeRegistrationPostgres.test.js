// PostgreSQL evidence is opt-in and uses a disposable schema, never application tables.
require('../../backend/node_modules/dotenv').config({ path: require('node:path').join(__dirname, '../../backend/.env') });
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { Pool } = require('../../backend/node_modules/pg');
const { pool } = require('../../backend/src/config/db');
const service = require('../../backend/src/services/attendeeRegistration');

test('Register AC1/AC2/AC4 - PostgreSQL serializes the last seat and duplicate submissions',
  { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
    // Arrange: separate sessions share only a random, disposable schema with one available seat.
    const schema = `attendee_registration_${randomBytes(8).toString('hex')}`;
    // pg makes password non-enumerable; copy it explicitly without logging credentials.
    const configuration = { ...pool.options, password: pool.options.password, connectionTimeoutMillis: 10000 };
    const admin = new Pool(configuration);
    const isolated = new Pool({ ...configuration, options: `-c search_path=${schema}` });
    let created = false;
    try {
      mock.method(Date, 'now', () => Date.parse('2031-06-01T00:00:00Z'));
      await admin.query(`CREATE SCHEMA ${schema}`); created = true;
      await isolated.query(`CREATE TABLE users (id int PRIMARY KEY);
        CREATE TABLE events (id int PRIMARY KEY, name text, status text, is_draft boolean,
          registration_required boolean, registration_capacity int, registration_deadline timestamptz,
          proposed_date date, proposed_start_time time);
        CREATE TABLE venues (id int PRIMARY KEY, capacity int);
        CREATE TABLE venue_bookings (event_id int, venue_id int, status text);
        CREATE TABLE registrations (id serial PRIMARY KEY, event_id int REFERENCES events(id), attendee_id int REFERENCES users(id),
          status text, registered_at timestamptz DEFAULT clock_timestamp(), withdrawn_at timestamptz, UNIQUE(event_id,attendee_id));
        INSERT INTO users VALUES (8),(9),(10);
        INSERT INTO events VALUES (44,'Arts Day','approved',false,true,1,NULL,'2099-06-12','09:30');
        INSERT INTO venues VALUES (1,1);
        INSERT INTO venue_bookings VALUES (44,1,'approved');`);
      // The real additive migration must be repeatable and preserve the event already recorded above.
      const migration = require('node:fs').readFileSync(require('node:path').join(__dirname,
        '../../backend/src/db/migrations/015-attendee-registration.sql'), 'utf8');
      await isolated.query(migration); await isolated.query(migration);
      assert.equal((await isolated.query('SELECT name FROM events WHERE id=44')).rows[0].name, 'Arts Day');
      mock.method(pool, 'connect', () => isolated.connect());
      mock.method(pool, 'query', (sql, values) => isolated.query(sql, values));
      // Act: real row locks arbitrate two simultaneous requests; no mocked concurrency evidence.
      const results = await Promise.all([service.register(44, 8, false), service.register(44, 9, false)]);
      // Assert: exactly one confirmed place and one full response, with one persisted row.
      assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
      assert.equal((await isolated.query("SELECT count(*)::int AS n FROM registrations WHERE status='registered'")).rows[0].n, 1);
      const winner = results[0].status === 201 ? 8 : 9;
      const repeat = await Promise.all([service.register(44, winner, false), service.register(44, winner, false)]);
      assert.deepEqual(repeat.map(result => result.status), [200, 200]);
      assert.equal(repeat[0].registration.id, repeat[1].registration.id);
      const waitlisted = await service.register(44, 10, true);
      assert.equal(waitlisted.registration.status, 'waitlisted');
      assert.equal(waitlisted.waitlistPosition, 1);
      const loser = winner === 8 ? 9 : 8;
      const secondWaiter = await service.register(44, loser, true);
      assert.equal(secondWaiter.waitlistPosition, 2);
      assert.equal((await service.getRegistration(44, 10)).waitlistPosition, 1);
      // First-time duplicate submissions also race; only one INSERT may allocate the place.
      await isolated.query('TRUNCATE registrations RESTART IDENTITY');
      const sameAttendee = await Promise.all([service.register(44, 8, false), service.register(44, 8, false)]);
      assert.deepEqual(sameAttendee.map(result => result.status).sort(), [200, 201]);
      assert.equal((await isolated.query('SELECT count(*)::int AS n FROM registrations')).rows[0].n, 1);
    } finally {
      mock.restoreAll(); await isolated.end();
      if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end(); await pool.end();
    }
  });
