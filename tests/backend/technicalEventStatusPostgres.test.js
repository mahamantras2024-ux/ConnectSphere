// Real PostgreSQL proves scope, current facts, lifecycle notification atomicity and audited release eligibility.
const { test, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../../backend/src/config/db');
const { listRelevantEvents } = require('../../backend/src/services/technicalEventStatus');
const { completePastEvents } = require('../../backend/src/services/eventCompletion');
const eventModel = require('../../backend/src/models/eventModel');
after(async () => { mock.restoreAll(); await pool.end(); });

test('TS status AC1-AC6 - current facts and lifecycle notices stay scoped and transactional in PostgreSQL',
  { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
    // Arrange: isolated task-owned schema, removed even on failure; no shared application rows are changed.
    const schema = `ts_status_${crypto.randomBytes(8).toString('hex')}`;
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      await client.query(`CREATE TABLE users (id INT PRIMARY KEY, full_name TEXT, role TEXT, roles TEXT[] DEFAULT '{}');
        CREATE TABLE events (id INT PRIMARY KEY, name TEXT, purpose TEXT, status TEXT, is_draft BOOLEAN DEFAULT false,
          proposed_date DATE, proposed_start_time TIME, proposed_end_time TIME, expected_attendance INT,
          equipment_items JSONB DEFAULT '[]', equipment_notes TEXT, technical_support_details TEXT,
          technical_specifications TEXT, video_conferencing_required BOOLEAN DEFAULT false, updated_at TIMESTAMPTZ DEFAULT now());
        CREATE TABLE event_technical_support_assignments (event_id INT, staff_id INT);
        CREATE TABLE event_equipment_reviews (event_id INT, reviewed_by INT);
        CREATE TABLE event_equipment_reservations (id INT PRIMARY KEY, event_id INT, reserved_by INT,
          status TEXT DEFAULT 'reserved', request_version INT DEFAULT 1, event_date DATE, start_time TIME, end_time TIME,
          venue_name TEXT, venue_location TEXT, reserved_at TIMESTAMPTZ DEFAULT now(), released_by INT, released_at TIMESTAMPTZ);
        CREATE TABLE venues (id INT PRIMARY KEY, name TEXT, location TEXT);
        CREATE TABLE venue_bookings (id INT PRIMARY KEY, event_id INT, venue_id INT, status TEXT);
        CREATE TABLE notifications (id SERIAL PRIMARY KEY, user_id INT, event_id INT, type TEXT,
          title VARCHAR(255), message TEXT, details JSONB, created_at TIMESTAMPTZ DEFAULT now());
        INSERT INTO users (id,full_name,role) VALUES (1,'Assigned','technical_support'), (2,'Reviewer','technical_support'),
          (3,'Reserver','technical_support'), (4,'Unrelated','technical_support'), (5,'Coordinator','event_coordinator');
        INSERT INTO events (id,name,status,proposed_date,proposed_start_time,proposed_end_time,technical_specifications) VALUES
          (10,'Support workshop','submitted','2030-11-01','09:00','11:00','Two microphones'),
          (11,'Unrelated workshop','confirmed','2030-11-01','09:00','11:00','Private unrelated facts'),
          (12,'Reviewed event','completed','2030-11-01','09:00','11:00',''),
          (13,'Reserved event','cancelled','2030-11-01','09:00','11:00','');
        INSERT INTO event_technical_support_assignments VALUES (10,1),(11,4);
        INSERT INTO event_equipment_reviews VALUES (10,1),(10,2),(10,5),(12,1);
        INSERT INTO event_equipment_reservations (id,event_id,reserved_by,event_date,start_time,end_time) VALUES
          (101,10,3,'2030-11-01','09:00','11:00'),(102,13,1,'2030-11-01','09:00','11:00');
        INSERT INTO venues VALUES (1,'Original hall','Level 1'),(2,'Latest hall','Level 2');
        INSERT INTO venue_bookings VALUES (1,10,1,'approved'),(2,10,2,'approved');`);
      const migration = fs.readFileSync(path.join(__dirname, '../../backend/src/db/migrations/019-technical-support-event-status.sql'), 'utf8');
      await client.query(migration); await client.query(migration);

      // Act/Assert AC1-AC3/AC6: all three explicit responsibilities grant access; unrelated staff get no event.
      assert.deepEqual((await listRelevantEvents(client, 1)).map(row => row.id), [10,12,13]);
      assert.deepEqual(await listRelevantEvents(client, 4, 10), []);
      assert.deepEqual(await listRelevantEvents(client, 1, 999), []);
      await client.query("UPDATE events SET technical_specifications='Four microphones' WHERE id=10");
      const [latest] = await listRelevantEvents(client, 1, 10);
      assert.equal(latest.venue_name, 'Latest hall'); assert.equal(latest.technical_specifications, 'Four microphones');

      // AC5: deduplicate multiple responsibilities and exclude unrelated people and non-support roles.
      await client.query("UPDATE events SET status='approved' WHERE id=10");
      let notes = (await client.query('SELECT * FROM notifications ORDER BY user_id')).rows;
      assert.deepEqual(notes.map(row => row.user_id), [1,2,3]);
      assert.ok(notes.every(row => row.details.status === 'confirmed' && row.details.previousStatus === 'planning'));
      await client.query("UPDATE events SET status='confirmed' WHERE id=10");
      assert.equal((await client.query('SELECT count(*)::int AS n FROM notifications')).rows[0].n, 3);
      for (const stage of ['completed','cancelled','submitted']) {
        await client.query('UPDATE events SET status=$1 WHERE id=10', [stage]);
      }
      notes = (await client.query('SELECT details FROM notifications')).rows;
      assert.deepEqual([...new Set(notes.map(row => row.details.status))].sort(), ['cancelled','completed','confirmed','planning']);
      assert.equal(notes.length, 12);
      await client.query('BEGIN');
      await client.query("UPDATE events SET status='approved' WHERE id=10");
      await client.query('ROLLBACK');
      assert.equal((await client.query('SELECT count(*)::int AS n FROM notifications')).rows[0].n, 12);
      await client.query("UPDATE events SET status='rejected' WHERE id=10");
      assert.equal((await client.query('SELECT count(*)::int AS n FROM notifications')).rows[0].n, 12);
      await client.query("UPDATE events SET status='draft', is_draft=true WHERE id=10");
      assert.equal((await client.query('SELECT count(*)::int AS n FROM notifications')).rows[0].n, 12);
      await client.query("UPDATE events SET status='submitted', is_draft=false, name=repeat('X',255) WHERE id=10");
      await client.query("UPDATE events SET status='confirmed' WHERE id=10");
      assert.equal((await client.query('SELECT max(length(title))::int AS n FROM notifications')).rows[0].n, 255);

      // AC4/AC6: release uses an atomic authorization and lifecycle check, retaining the first actor/time audit.
      mock.method(pool, 'connect', async () => ({ query: (sql, values) => client.query(sql, values), release() {} }));
      assert.equal(await eventModel.releaseEquipmentReservation(101, 1), null);
      await client.query("UPDATE events SET status='cancelled' WHERE id=10");
      assert.equal(await eventModel.releaseEquipmentReservation(101, 4), null);
      const released = await eventModel.releaseEquipmentReservation(101, 1);
      assert.equal(released.status, 'cancelled'); assert.equal(released.released_by, 1);
      assert.ok(released.released_at);
      assert.equal(await eventModel.releaseEquipmentReservation(101, 1), null);
      // AC5 zero-recipient and legacy multi-role boundaries: never broadcast, but retain a valid support role in roles[].
      await client.query("INSERT INTO events (id,name,status) VALUES (14,'No responsibilities','submitted')");
      await client.query("UPDATE events SET status='confirmed' WHERE id=14");
      assert.equal((await client.query('SELECT count(*)::int AS n FROM notifications WHERE event_id=14')).rows[0].n, 0);
      await client.query("INSERT INTO users (id,full_name,role,roles) VALUES (6,'Multi-role support','event_coordinator',ARRAY['technical_support'])");
      await client.query('INSERT INTO event_technical_support_assignments VALUES (12,6)');
      await client.query("UPDATE events SET status='confirmed' WHERE id=12");
      assert.deepEqual((await client.query('SELECT user_id FROM notifications WHERE event_id=12 ORDER BY user_id')).rows.map(row => row.user_id), [1,6]);
      // Completion AC: use an explicit instant to prove the Singapore end boundary without wall-clock races.
      await client.query("TRUNCATE notifications; DELETE FROM event_technical_support_assignments; DELETE FROM events");
      const statuses = ['approved', 'confirmed', 'cancelled', 'draft', 'rejected', 'submitted', 'under_review', 'planning', 'completed'];
      for (const [index, status] of statuses.entries()) {
        await client.query(`INSERT INTO events (id,name,status,is_draft,proposed_date,proposed_end_time)
          VALUES ($1,'Completion boundary',$2,$3,'2030-11-01','11:00')`, [100 + index, status, status === 'draft']);
        await client.query('INSERT INTO event_technical_support_assignments VALUES ($1,1)', [100 + index]);
      }
      // Draft flags and incomplete schedules must never be mistaken for an event that has taken place.
      await client.query(`INSERT INTO events (id,name,status,is_draft,proposed_date,proposed_end_time) VALUES
        (200,'Missing date','approved',false,NULL,'11:00'),
        (201,'Missing time','confirmed',false,'2030-11-01',NULL),
        (202,'Unpublished','confirmed',true,'2030-11-01','11:00')`);
      assert.deepEqual(await completePastEvents(client, new Date('2030-11-01T02:59:59.999Z')), []);
      assert.deepEqual(await completePastEvents(client, new Date('2030-11-01T03:00:00.000Z')), []);
      assert.deepEqual((await completePastEvents(client, new Date('2030-11-01T03:00:00.001Z'))).map(row => row.id).sort(), [100,101]);
      const persisted = (await client.query('SELECT id,status FROM events ORDER BY id')).rows;
      assert.deepEqual(persisted.map(row => row.status), ['completed','completed',...statuses.slice(2),'approved','confirmed','confirmed']);
      assert.equal((await listRelevantEvents(client, 1, 100))[0].status, 'completed');
      const completionNotes = (await client.query('SELECT user_id,event_id,details FROM notifications ORDER BY event_id')).rows;
      assert.deepEqual(completionNotes.map(row => [row.user_id,row.event_id,row.details.status]), [[1,100,'completed'],[1,101,'completed']]);
      // Repeated or concurrent workers cannot transition an already completed row or duplicate its notice.
      assert.deepEqual(await completePastEvents(client, new Date('2030-11-02T03:00:00Z')), []);
      assert.equal((await client.query('SELECT count(*)::int AS n FROM notifications')).rows[0].n, 2);
    } finally {
      mock.restoreAll();
      await client.query('ROLLBACK');
      await client.query('SET search_path TO public');
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      client.release();
    }
  });
