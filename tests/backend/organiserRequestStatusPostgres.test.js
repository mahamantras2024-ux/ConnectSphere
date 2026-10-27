// SCRUM-93: execute real organisation scope and transactional notification SQL in an isolated disposable schema.
require('../../backend/node_modules/dotenv').config({ path: require('node:path').join(__dirname, '../../backend/.env') });
const { test, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { pool } = require('../../backend/src/config/db');
const { findRequestStatus } = require('../../backend/src/models/organiserRequestStatusModel');
const { listForOrganiser, updateEditable } = require('../../backend/src/models/eventModel');
const sql = fs.readFileSync(require('node:path').join(__dirname, '../../backend/src/db/migrations/019-organiser-request-status.sql'), 'utf8');
after(async () => { mock.restoreAll(); await pool.end(); });
test('SCRUM-93 AC1-AC6 - real organisation isolation and atomic status notifications', { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
  pool.options.connectionTimeoutMillis = 5000;
  const client = await pool.connect();
  const schema = `cs_scrum93_${crypto.randomBytes(6).toString('hex')}`;
  try {
    // Arrange: all tables are private to this random schema, preserving shared application data.
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`CREATE TABLE users (id integer PRIMARY KEY, role text, roles text[] DEFAULT '{}', organisation_name text);
      CREATE TABLE events (id serial PRIMARY KEY, organiser_id integer REFERENCES users(id), name text, purpose text,
        status text, coordinator_id integer, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), decision_reason text, decided_at timestamptz);
      CREATE TABLE venue_bookings (event_id integer, status text);
      CREATE TABLE event_clarification_requests (id serial, event_id integer, status text, information_needed jsonb, message text, organiser_response text, created_at timestamptz DEFAULT now(), responded_at timestamptz);
      CREATE TABLE notifications (id serial PRIMARY KEY, user_id integer REFERENCES users(id), event_id integer REFERENCES events(id),
        type varchar(40) CHECK (type IN ('future_type')), title text, message text, details jsonb);`);
    await client.query(`INSERT INTO users (id,role,organisation_name,roles) VALUES
      (1,'event_organiser','Acme','{}'), (2,'event_organiser',' acme ','{}'), (3,'event_organiser','Other','{}'),
      (4,'event_organiser',' ','{}'), (5,'event_organiser','','{}'), (6,'event_organiser',NULL,'{}'), (7,'event_organiser',NULL,'{}'),
      (8,'attendee','Acme','{}'), (9,'attendee','Acme',ARRAY['attendee','event_organiser']),
      (10,'event_organiser',chr(9),'{}'), (11,'event_organiser',chr(9),'{}');
      INSERT INTO events (organiser_id,name,status) VALUES (1,'Workshop','draft'),(3,'Other','draft'),(4,'Blank','draft'),(6,'Null','draft'),(10,'Tabs','draft');
      INSERT INTO notifications (user_id,event_id,type,title,message,details) VALUES (3,2,'future_type','Existing','Preserve','{}');`);
    await client.query(sql); await client.query(sql); // AC5: repeatable deployment never duplicates existing notices.
    mock.method(pool, 'query', (text, values) => client.query(text, values));

    // AC1/AC6: own access always works; only non-empty normalised organisation names share status.
    assert.equal((await findRequestStatus(1,1)).can_manage, true);
    assert.equal((await findRequestStatus(2,1)).can_manage, false);
    for (const [viewer, event] of [[3,1],[5,3],[7,4],[11,5],[2,999]]) assert.equal(await findRequestStatus(viewer,event), null);
    assert.deepEqual((await listForOrganiser(2)).map(event => event.id), [1]);
    assert.deepEqual((await listForOrganiser(4)).map(event => event.id), [3]);
    // Organisation status sharing must never grant the peer permission to change the underlying request.
    assert.equal(await updateEditable(1, 2, { purpose: 'Unauthorised change' }, false), null);
    assert.equal((await client.query('SELECT purpose FROM events WHERE id=1')).rows[0].purpose, null);

    // AC5: creation is not a status transition; draft submission notifies its owner without sharing blank organisations.
    const initialCount = Number((await client.query('SELECT count(*) AS n FROM notifications')).rows[0].n);
    await client.query("INSERT INTO events (organiser_id,name,status) VALUES (4,'New draft','draft')");
    assert.equal(Number((await client.query('SELECT count(*) AS n FROM notifications')).rows[0].n), initialCount);
    await client.query("INSERT INTO events (organiser_id,name,status) VALUES (4,'New request','submitted')");
    assert.equal(Number((await client.query('SELECT count(*) AS n FROM notifications')).rows[0].n), initialCount);
    await client.query("UPDATE events SET status='submitted' WHERE name='New draft'");
    assert.deepEqual((await client.query('SELECT user_id FROM notifications ORDER BY id OFFSET $1', [initialCount])).rows, [{ user_id: 4 }]);

    // AC2/AC5: each actual persisted lifecycle transition records matching notices for authorised organisers only.
    for (const status of ['submitted','under_review','approved','planning','confirmed','completed','cancelled','rejected','draft']) {
      const before = Number((await client.query('SELECT count(*) AS n FROM notifications')).rows[0].n);
      await client.query('UPDATE events SET status=$1 WHERE id=1', [status]);
      const notes = (await client.query('SELECT user_id, details, message FROM notifications ORDER BY id OFFSET $1', [before])).rows;
      const recipients = ['approved','rejected'].includes(status) ? [2,9] : [1,2,9];
      assert.deepEqual(notes.map(note => note.user_id).sort((a,b) => a-b), recipients);
      assert.ok(notes.every(note => note.details.status===status));
      assert.equal((await findRequestStatus(2,1)).status, status);
      // Re-saving an unchanged status is not a new lifecycle transition and must not notify again.
      await client.query('UPDATE events SET status=$1 WHERE id=1', [status]);
      assert.equal(Number((await client.query('SELECT count(*) AS n FROM notifications')).rows[0].n), before+recipients.length);
    }
    // AC3/AC4: the colleague snapshot exposes action state and the actual stored rejection reason.
    await client.query("UPDATE events SET status='rejected', decision_reason='No safe venue', decided_at=now() WHERE id=1");
    await client.query(`INSERT INTO event_clarification_requests (event_id,status,information_needed,message) VALUES (1,'pending','["purpose"]','Please clarify')`);
    assert.equal((await findRequestStatus(2,1)).clarification_outstanding, true);
    assert.deepEqual((await findRequestStatus(2,1)).clarification_requests, []);
    assert.equal((await findRequestStatus(1,1)).clarification_requests[0].message, 'Please clarify');
    assert.equal((await findRequestStatus(2,1)).decision_reason, 'No safe venue');
    await client.query("UPDATE event_clarification_requests SET status='responded'");
    assert.equal((await findRequestStatus(2,1)).clarification_outstanding, false);
    // AC5: a rollback leaves neither a changed status nor its notice behind.
    const count = Number((await client.query('SELECT count(*) AS n FROM notifications')).rows[0].n);
    await client.query('BEGIN'); await client.query("UPDATE events SET status='planning' WHERE id=1"); await client.query('ROLLBACK');
    assert.equal((await findRequestStatus(1,1)).status, 'rejected');
    assert.equal(Number((await client.query('SELECT count(*) AS n FROM notifications')).rows[0].n), count);
    assert.equal((await client.query("SELECT count(*) AS n FROM notifications WHERE type='future_type'")).rows[0].n, '1');
    // AC5 error path: an actual notification insert failure must roll back the status write itself.
    await client.query(`ALTER TABLE notifications ADD CONSTRAINT fail_new_confirmation
      CHECK (details->>'status' IS DISTINCT FROM 'confirmed') NOT VALID`);
    await assert.rejects(client.query("UPDATE events SET status='confirmed' WHERE id=1"), /fail_new_confirmation/);
    assert.equal((await findRequestStatus(1,1)).status, 'rejected');
    assert.equal(Number((await client.query('SELECT count(*) AS n FROM notifications')).rows[0].n), count);

  } finally {
    mock.restoreAll();
    await client.query('ROLLBACK');
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    client.release();
  }
});
