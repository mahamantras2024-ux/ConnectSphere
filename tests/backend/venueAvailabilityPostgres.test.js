require('../../backend/node_modules/dotenv').config();
const { describe, test, before, beforeEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('../../backend/node_modules/pg');
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { pool } = require('../../backend/src/config/db');

// Opt in explicitly: every table and connection belongs to a generated, disposable schema, never public application records.
describe('AC1–AC9 - PostgreSQL venue availability integration', { skip: process.env.RUN_VENUE_AVAILABILITY_DB !== '1' }, () => {
  const schema = `cs_availability_${crypto.randomBytes(8).toString('hex')}`;
  const date = '2090-01-10';
  const at = time => `${date}T${time}:00+08:00`;
  const body = { eventId: 3, startDatetime: at('10:00'), endDatetime: at('11:00') };
  const adminQuery = pool.query.bind(pool);
  const writerPids = new Set();
  let database, server, base;

  /** Loads the actual migration text; tests execute PostgreSQL, not a JavaScript interpretation of SQL. */
  function migration(name) { return fs.readFileSync(path.join(__dirname, '../../backend/src/db', name), 'utf8'); }

  before(async () => {
    await adminQuery(`CREATE SCHEMA ${schema}`);
    // pg keeps the password non-enumerable; preserve it explicitly without logging credentials.
    database = new Pool({ ...pool.options, password: pool.options.password, options: `-c search_path=${schema}`, application_name: schema, max: 10 });
    await database.query(`CREATE TABLE users(id INTEGER PRIMARY KEY, email TEXT, role TEXT, auth_version INTEGER DEFAULT 0, roles TEXT[] DEFAULT '{}');
      CREATE TABLE events(id INTEGER PRIMARY KEY, coordinator_id INTEGER REFERENCES users(id));
      CREATE TABLE venues(id INTEGER PRIMARY KEY, name TEXT, availability_status TEXT);
      INSERT INTO users(id,role) VALUES (1,'event_coordinator'),(2,'venue_staff');
      INSERT INTO events VALUES (3,1),(4,1);
      INSERT INTO venues VALUES (7,'Hall A','Available'),(8,'Hall B','Available')`);
    // Apply prerequisites and the new migration on a single checked-out connection per transaction.
    const client = await database.connect();
    try {
      for (const file of ['venueManagementSchema.sql', 'venueScheduleSchema.sql', 'venueAvailabilitySchema.sql']) await client.query(migration(file));
    } finally { client.release(); }
    // Redirect only connection acquisition. All route SQL, constraints, locking and commits run on real PostgreSQL.
    mock.method(pool, 'query', (sql, values) => database.query(sql, values));
    mock.method(pool, 'connect', async () => {
      const client = await database.connect();
      return {
        // Observe backend IDs inside BEGIN: transaction poolers may replace session names and change idle backend assignments.
        async query(sql, values) {
          const result = await client.query(sql, values);
          if (sql === 'BEGIN') writerPids.add((await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
          return result;
        },
        release() { client.release(); },
      };
    });
    server = require('../../backend/src/index').listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}/api/venues`;
  });

  beforeEach(async () => {
    // Test data is isolated even between cases; catalogue status must never become a venue-wide hold.
    await database.query('TRUNCATE venue_bookings, venue_unavailability RESTART IDENTITY');
    writerPids.clear();
    await database.query('UPDATE venues SET setup_minutes=30, turnaround_minutes=15 WHERE id=7');
  });

  after(async () => {
    mock.restoreAll();
    if (server) await new Promise(resolve => server.close(resolve));
    if (database) await database.end();
    // The identifier is generated above; teardown can only remove this test-owned schema.
    await adminQuery(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  });

  /** Calls actual authenticated routes as coordinator 1 or staff 2. */
  async function request(url, data, method = 'POST', user = 1) {
    const response = await fetch(base + url, { method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ sub: user }, process.env.JWT_SECRET)}` },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    return { status: response.status, body: await response.json() };
  }

  /** Waits for observable lock contention, with a deadline only to diagnose a broken locking contract. */
  async function waitForBlockedWriters(count) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const result = await database.query("SELECT count(*)::integer AS n FROM pg_stat_activity WHERE pid=ANY($1::integer[]) AND wait_event_type='Lock'", [[...writerPids]]);
      if (result.rows[0].n >= count) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail(`Expected ${count} writers waiting for a real PostgreSQL lock`);
  }

  test('AC7 AC9 - migration is repeatable and preserves existing requests without inventing holds', async () => {
    // Arrange: one old pending record without expiry and one newly created, expiring hold.
    await database.query("INSERT INTO venue_bookings(venue_id,event_id,requested_by,start_datetime,end_datetime,status) VALUES (8,3,1,$1,$2,'pending')", [at('10:00'), at('11:00')]);
    const created = await request('/7/requests', body);
    assert.equal(created.status, 201);
    const before = (await database.query('SELECT * FROM venue_bookings ORDER BY id')).rows;
    // Act: apply the actual additive migration twice with data already present.
    const { setup } = require('../../backend/src/db/setupVenueAvailability');
    await setup(); await setup();
    // Assert: no status/deadline rewriting or loss of historical records is allowed.
    assert.deepEqual((await database.query('SELECT * FROM venue_bookings ORDER BY id')).rows, before);
    assert.equal(before[0].hold_expires_at, null);
    assert.equal(new Date(created.body.request.hold_expires_at) - new Date(created.body.request.created_at), 86400000);
    assert.deepEqual((await database.query('SELECT availability_status FROM venues ORDER BY id')).rows, [{ availability_status: 'Available' }, { availability_status: 'Available' }]);
  });

  test('AC1 AC5 AC6 - SQL retrieves buffer-only overlaps across both midnight boundaries for the selected venue', async () => {
    // Arrange: neither event itself intersects the selected day; only turnaround/setup does.
    await database.query(`INSERT INTO venue_bookings(venue_id,event_id,requested_by,start_datetime,end_datetime,status) VALUES
      (7,3,1,'2090-01-09T23:00:00+08:00','2090-01-09T23:55:00+08:00','approved'),
      (7,4,1,'2090-01-11T00:15:00+08:00','2090-01-11T01:00:00+08:00','approved'),
      (8,3,1,'2090-01-10T10:00:00+08:00','2090-01-10T11:00:00+08:00','approved')`);
    // Act
    const response = await request(`/7/schedule?date=${date}`, undefined, 'GET');
    // Assert: catches raw-time SQL filtering and cross-venue leakage, which mocked query tests cannot prove.
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.map(record => record.id), [1, 2]);
    assert.equal(response.body[0].setup_minutes, 30);
    assert.equal(response.body[0].turnaround_minutes, 15);
  });

  test('AC6 AC7 - simultaneous overlapping submissions commit exactly one hold', async () => {
    // Arrange: block the venue before starting both requests so the race is reproducible.
    const gate = await database.connect();
    await gate.query('BEGIN');
    await gate.query('SELECT id FROM venues WHERE id=7 FOR UPDATE');
    const attempts = [request('/7/requests', body), request('/7/requests', { ...body, eventId: 4 })];
    let responses;
    try { await waitForBlockedWriters(2); }
    finally {
      await gate.query('COMMIT'); gate.release();
      // Always join requests before the next test truncates tables, even when the lock-observation assertion fails.
      responses = await Promise.all(attempts);
    }
    // Act: let both queued writers compete for the same occupied window.
    // Assert: response and persisted-row counts reject both duplicate success and phantom rejection.
    assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
    const rows = (await database.query('SELECT status,hold_expires_at FROM venue_bookings')).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'pending');
    assert.ok(rows[0].hold_expires_at > new Date());
  });

  test('AC3 AC6 AC7 - approval waits for concurrent maintenance and rechecks the committed blocker', async () => {
    // Arrange: maintenance is uncommitted when staff attempt to approve an active hold.
    const created = await request('/7/requests', body);
    assert.equal(created.status, 201);
    const gate = await database.connect();
    await gate.query('BEGIN');
    await gate.query("INSERT INTO venue_unavailability(venue_id,reason,start_datetime,end_datetime) VALUES (7,'Repair',$1,$2)", [at('10:30'), at('11:00')]);
    const approval = request(`/7/requests/${created.body.request.id}/decision`, { decision: 'approved' }, 'PUT', 2);
    let response;
    try { await waitForBlockedWriters(1); }
    finally { await gate.query('COMMIT'); gate.release(); response = await approval; }
    // Act / Assert: missing maintenance locking would approve using an obsolete snapshot.
    assert.equal(response.status, 409);
    assert.equal((await database.query('SELECT status FROM venue_bookings')).rows[0].status, 'pending');
  });

  test('AC6 - PostgreSQL rejects direct buffer conflicts and permits exact adjacency', async () => {
    // Arrange: administrative writers must obey the same rule as the HTTP request workflow.
    const created = await request('/7/requests', body);
    assert.equal(created.status, 201);
    const sql = "INSERT INTO venue_bookings(venue_id,event_id,requested_by,start_datetime,end_datetime,status) VALUES (7,4,1,$1,$2,'approved') RETURNING id";
    // Act / Assert: check one millisecond below, exactly at and one millisecond above buffered adjacency.
    await assert.rejects(database.query(sql, [`${date}T11:44:59.999+08:00`, at('12:45')]), { code: '23P01' });
    for (const start of ['11:45:00.000', '11:45:00.001']) {
      const inserted = await database.query(sql, [`${date}T${start}+08:00`, at('12:45')]);
      assert.equal(inserted.rowCount, 1);
      // Remove only this adjacent fixture so the next boundary probe does not conflict with the previous probe.
      await database.query('DELETE FROM venue_bookings WHERE id=$1', [inserted.rows[0].id]);
    }
    assert.equal((await database.query('SELECT count(*)::integer AS n FROM venue_bookings')).rows[0].n, 1);
  });

  test('AC7 AC8 AC9 - expired holds release without a worker and cannot displace a newly reserved slot', async () => {
    // Arrange: expire a stored request directly; no browser or cleanup process is involved.
    const created = await request('/7/requests', body);
    assert.equal(created.status, 201);
    await database.query("UPDATE venue_bookings SET created_at=now()-interval '2 days',hold_expires_at=now()-interval '1 day'");
    // Act: another coordinator request acquires the released slot, then staff try the old request.
    const replacement = await request('/7/requests', { ...body, eventId: 4 });
    const late = await request(`/7/requests/${created.body.request.id}/decision`, { decision: 'approved' }, 'PUT', 2);
    // Assert: expiration neither confirms the old request nor gives it priority over the new hold.
    assert.equal(replacement.status, 201);
    assert.equal(late.status, 409);
    assert.deepEqual((await database.query('SELECT status FROM venue_bookings ORDER BY id')).rows, [{ status: 'pending' }, { status: 'pending' }]);
  });

  test('AC7 - staff decisions persist, rejection releases the slot and request IDs remain venue scoped', async () => {
    // Arrange
    const created = await request('/7/requests', body);
    assert.equal(created.status, 201);
    // Act / Assert: another venue must not allow deciding this request by its globally unique ID.
    assert.equal((await request(`/8/requests/${created.body.request.id}/decision`, { decision: 'approved' }, 'PUT', 2)).status, 404);
    assert.equal((await request(`/7/requests/${created.body.request.id}/decision`, { decision: 'rejected' }, 'PUT', 2)).status, 200);
    const replacement = await request('/7/requests', body);
    assert.equal(replacement.status, 201);
    assert.equal((await request(`/7/requests/${replacement.body.request.id}/decision`, { decision: 'approved' }, 'PUT', 2)).status, 200);
    assert.deepEqual((await database.query('SELECT status,decision_by FROM venue_bookings ORDER BY id')).rows, [{ status: 'rejected', decision_by: 2 }, { status: 'approved', decision_by: 2 }]);
  });

  test('AC3 AC5 - moving and deleting recorded maintenance updates only the affected venue schedules', async () => {
    // Arrange: an administrative maintenance record starts on Hall A.
    await database.query("INSERT INTO venue_unavailability(venue_id,reason,start_datetime,end_datetime) VALUES (7,'Repair',$1,$2)", [at('10:00'), at('11:00')]);
    // Act: move it to Hall B, exercising the two-venue update lock, then remove it.
    await database.query('UPDATE venue_unavailability SET venue_id=8');
    const first = await request(`/7/schedule?date=${date}`, undefined, 'GET');
    const second = await request(`/8/schedule?date=${date}`, undefined, 'GET');
    // Assert: wrong venue scoping or a stale original closure would leave these schedules incorrect.
    assert.deepEqual(first.body, []);
    assert.equal(second.body.length, 1);
    assert.equal(second.body[0].kind, 'unavailability');
    await database.query('DELETE FROM venue_unavailability');
    assert.deepEqual((await request(`/8/schedule?date=${date}`, undefined, 'GET')).body, []);
  });

  test('AC7 - the database guard also rejects direct reservations for an inactive venue', async () => {
    // Arrange: withdraw an unbooked venue through its existing lifecycle field.
    await database.query('UPDATE venues SET is_active=false WHERE id=7');
    // Act / Assert: bypassing the HTTP controller must not bypass the active-venue business rule.
    await assert.rejects(database.query("INSERT INTO venue_bookings(venue_id,event_id,requested_by,start_datetime,end_datetime,status) VALUES (7,3,1,$1,$2,'approved')", [at('10:00'), at('11:00')]), { code: '23514' });
    assert.equal((await request('/7/requests', body)).status, 404);
    assert.equal((await database.query('SELECT count(*)::integer AS n FROM venue_bookings')).rows[0].n, 0);
  });
});
