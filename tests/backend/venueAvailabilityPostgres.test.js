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
    await database.query(`CREATE TABLE users(id INTEGER PRIMARY KEY, email TEXT, full_name TEXT, role TEXT, auth_version INTEGER DEFAULT 0, roles TEXT[] DEFAULT '{}');
      CREATE TABLE events(id INTEGER PRIMARY KEY, coordinator_id INTEGER REFERENCES users(id), name TEXT,
        organiser_id INTEGER, status TEXT DEFAULT 'submitted', is_draft BOOLEAN DEFAULT false, equipment_items JSONB DEFAULT '[]',
        technical_support_required BOOLEAN DEFAULT false, video_conferencing_required BOOLEAN DEFAULT false,
        equipment_notes TEXT, equipment_confirmed_at TIMESTAMPTZ, decision_reason TEXT, decided_at TIMESTAMPTZ,
        decided_by INTEGER, safety_changes_open TEXT[] DEFAULT '{}', proposed_date DATE, proposed_end_time TIME,
        expected_attendance INTEGER DEFAULT 100, room_layout_preference TEXT DEFAULT 'Seminar', accessibility_requirements TEXT[] DEFAULT '{Ramp}');
      CREATE TABLE event_clarification_requests(id SERIAL PRIMARY KEY,event_id INTEGER,status TEXT);
      CREATE TABLE event_safety_checks(id SERIAL PRIMARY KEY,event_id INTEGER,safety_officer_id INTEGER,
        outcome TEXT,notes TEXT,checked_at TIMESTAMPTZ,change_areas TEXT[]);
      CREATE TABLE notifications(id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), event_id INTEGER,
        change_request_id INTEGER, type TEXT, title TEXT, message TEXT, details JSONB);
      CREATE TABLE venues(id INTEGER PRIMARY KEY, name TEXT, availability_status TEXT, operating_hours TEXT NOT NULL DEFAULT '08:00 - 22:00');
      INSERT INTO users(id,role) VALUES (1,'event_coordinator'),(2,'venue_staff');
      INSERT INTO events(id,coordinator_id,name) VALUES (3,1,'Gala'),(4,1,'Workshop');
      INSERT INTO venues VALUES (7,'Hall A','Available'),(8,'Hall B','Available')`);
    // Apply prerequisites and the new migration on a single checked-out connection per transaction.
    const client = await database.connect();
    try {
      for (const file of ['venueManagementSchema.sql', 'venueScheduleSchema.sql', 'venueAvailabilitySchema.sql', 'migrations/20261018064942_venue_booking_requests.sql','migrations/019-venue-tentative-holds.sql']) await client.query(migration(file));
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
    await database.query('TRUNCATE venue_bookings, venue_unavailability, venue_schedule_periods, notifications RESTART IDENTITY');
    writerPids.clear();
    await database.query("UPDATE venues SET is_active=true, operating_hours='08:00 - 22:00', setup_minutes=30, turnaround_minutes=15 WHERE id=7");
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
    // The historical setup installs its original guard; replay the latest additive migration to exercise current behavior.
    const lifecycle = await database.connect();
    try {
      await lifecycle.query(migration('migrations/019-venue-tentative-holds.sql'));
      await lifecycle.query(migration('migrations/019-venue-tentative-holds.sql'));
    } finally { lifecycle.release(); }
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
    const approval = request(`/7/requests/${created.body.request.id}/decision`, { decision: 'approved', holdExpiresAt:'2099-01-01T00:00:00Z' }, 'PUT', 2);
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
    const late = await request(`/7/requests/${created.body.request.id}/decision`, { decision: 'approved', holdExpiresAt:'2099-01-01T00:00:00Z' }, 'PUT', 2);
    // Assert: expiration neither confirms the old request nor gives it priority over the new hold.
    assert.equal(replacement.status, 201);
    assert.equal(late.status, 409);
    assert.deepEqual((await database.query('SELECT status FROM venue_bookings ORDER BY id')).rows, [{ status: 'pending' }, { status: 'pending' }]);
  });

  test('AC7 - staff decisions persist, rejection releases the slot and request IDs remain venue scoped', async () => {
    // Arrange
    const created = await request('/7/requests', { ...body, capacity: 40, layout: 'Theatre', accessibility: ['Step-free'] });
    assert.equal(created.status, 201);
    // Act / Assert: another venue must not allow deciding this request by its globally unique ID.
    const queue = await request('/requests/pending', undefined, 'GET', 2);
    assert.equal(queue.status, 200);
    // SCRUM-43 AC1: the query must retrieve the per-request snapshot, not the event's default 100/Seminar/Ramp.
    assert.equal(queue.body.requests[0].expected_attendance, 40);
    assert.equal(queue.body.requests[0].room_layout_preference, 'Theatre');
    assert.deepEqual(queue.body.requests[0].accessibility_requirements, ['Step-free']);
    assert.equal((await request(`/8/requests/${created.body.request.id}/decision`, { decision: 'approved', holdExpiresAt:'2099-01-01T00:00:00Z' }, 'PUT', 2)).status, 404);
    assert.equal((await request(`/7/requests/${created.body.request.id}/decision`, { decision: 'rejected' }, 'PUT', 2)).status, 200);
    const replacement = await request('/7/requests', body);
    assert.equal(replacement.status, 201);
    assert.equal((await request(`/7/requests/${replacement.body.request.id}/decision`, { decision: 'approved', holdExpiresAt:'2099-01-01T00:00:00Z' }, 'PUT', 2)).status, 200);
    assert.deepEqual((await database.query('SELECT status,decision_by FROM venue_bookings ORDER BY id')).rows, [{ status: 'rejected', decision_by: 2 }, { status: 'tentative', decision_by: 2 }]);
    // SCRUM-43 AC5/AC7: each committed decision has a separate durable coordinator/audit notice.
    const notices = (await database.query('SELECT user_id, details FROM notifications ORDER BY id')).rows;
    assert.deepEqual(notices.map(note => [note.user_id, note.details.decisionBy, note.details.decision]), [[1, 2, 'rejected'], [1, 2, 'approved']]);
    assert.ok(notices.every(note => Number.isFinite(Date.parse(note.details.decidedAt))));
  });

  test('SCRUM-43 AC2 AC3 AC5 AC7 - concurrent opposing decisions commit one audit and notification only', async () => {
    // Arrange: both staff calls target the same locked pending request; PostgreSQL supplies real serialization.
    const created = await request('/7/requests', body);
    const path = `/7/requests/${created.body.request.id}/decision`;
    const decisions = await Promise.all(['approved', 'rejected'].map(decision => request(path, { decision,holdExpiresAt:'2099-01-01T00:00:00Z' }, 'PUT', 2)));
    assert.deepEqual(decisions.map(result => result.status).sort(), [200, 409]);
    const persisted = (await database.query('SELECT status, decision_by, updated_at FROM venue_bookings')).rows[0];
    const notes = (await database.query('SELECT details FROM notifications')).rows;
    assert.equal(notes.length, 1); assert.equal(notes[0].details.decision, persisted.status==='tentative'?'approved':persisted.status);
    assert.equal(notes[0].details.decisionBy, persisted.decision_by);
    assert.equal(new Date(notes[0].details.decidedAt).getTime(), persisted.updated_at.getTime());
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

  test('Schedule AC1 AC2 AC6 AC7 - saved day replaces prior periods and both roles see booking-safe results', async () => {
    // Arrange: staff write one unavailable period for Hall A in the real database.
    const first = await request('/7/schedule', { date, periods: [{ status: 'unavailable', start: '12:00', end: '13:00' }] }, 'PUT', 2);
    assert.equal(first.status, 200);
    // Act: a later day save replaces it with an explicitly available period.
    const replacement = await request('/7/schedule', { date, periods: [{ status: 'available', start: '12:00', end: '13:00' }] }, 'PUT', 2);
    const staffView = await request(`/7/schedule?date=${date}`, undefined, 'GET', 2);
    const coordinatorView = await request(`/7/schedule?date=${date}`, undefined, 'GET', 1);
    // Assert: replacement and venue scoping come from persisted SQL rows, not an in-memory route mock.
    assert.equal(replacement.status, 200);
    assert.deepEqual(staffView.body.map(item => item.status), ['available']);
    assert.deepEqual(coordinatorView.body.map(item => item.status), ['available']);
    assert.deepEqual((await request(`/8/schedule?date=${date}`, undefined, 'GET')).body, []);
    // A confirmed booking then prevents a closure, preserving the saved available row.
    await database.query("INSERT INTO venue_bookings(venue_id,event_id,requested_by,start_datetime,end_datetime,status) VALUES (7,3,1,$1,$2,'approved')", [at('10:00'), at('11:00')]);
    const conflict = await request('/7/schedule', { date, periods: [{ status: 'unavailable', start: '10:30', end: '11:30' }] }, 'PUT', 2);
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.affectedBookings.length, 1);
    assert.deepEqual((await database.query('SELECT status FROM venue_schedule_periods')).rows, [{ status: 'available' }]);
  });

  test('Schedule AC3 AC6 AC7 - saved closures block requests, late approvals and direct database bookings', async () => {
    // Arrange: a pending request exists before staff close its time; AC6 protects confirmed bookings only.
    const pending = await request('/7/requests', { ...body, startDatetime: at('12:15'), endDatetime: at('12:45') });
    assert.equal(pending.status, 201);
    // Act: the persisted closure must affect both API paths and the PostgreSQL booking guard.
    const saved = await request('/7/schedule', { date, periods: [{ status: 'unavailable', start: '12:00', end: '13:00' }] }, 'PUT', 2);
    const newRequest = await request('/7/requests', { ...body, eventId: 4, startDatetime: at('12:30'), endDatetime: at('12:45') });
    const approval = await request(`/7/requests/${pending.body.request.id}/decision`, { decision: 'approved', holdExpiresAt:'2099-01-01T00:00:00Z' }, 'PUT', 2);
    const direct = "INSERT INTO venue_bookings(venue_id,event_id,requested_by,start_datetime,end_datetime,status) VALUES (7,4,1,$1,$2,'approved')";
    // Assert: no available mark or stale pending hold overrides the unavailable period.
    assert.equal(saved.status, 200);
    assert.equal(newRequest.status, 409);
    assert.equal(approval.status, 409);
    await assert.rejects(database.query(direct, [at('12:30'), at('12:45')]), { code: '23P01' });
    assert.deepEqual((await database.query('SELECT status FROM venue_bookings')).rows, [{ status: 'pending' }]);
  });
  test('SCRUM-107 AC3 AC4 AC6 - PostgreSQL rejects expired confirmation and concurrent workers notify only once', async () => {
    // Arrange: a real staff-approved hold passes its deadline while the app is offline.
    const held = (await database.query(`INSERT INTO venue_bookings
      (venue_id,event_id,requested_by,start_datetime,end_datetime,status,hold_expires_at)
      VALUES (7,3,1,$1,$2,'tentative',clock_timestamp()+interval '1 second') RETURNING id`, [at('10:00'),at('11:00')])).rows[0];
    await database.query('SELECT pg_sleep(1.1)');
    // Act / Assert: the trigger independently rejects a direct database attempt to confirm the expired row.
    await assert.rejects(database.query("UPDATE venue_bookings SET status='approved' WHERE id=$1",[held.id]),
      error=>error.code==='23514' && error.constraint==='venue_hold_expiry_guard');
    const {expireVenueHolds}=require('../../backend/src/services/venueHolds');
    const counts=await Promise.all([expireVenueHolds(database),expireVenueHolds(database)]);
    assert.equal(counts[0]+counts[1],1);
    assert.equal((await database.query("SELECT count(*)::int AS count FROM notifications WHERE details->>'kind'='venue_hold_expired'")).rows[0].count,1);
    assert.equal((await database.query('SELECT status FROM venue_bookings WHERE id=$1',[held.id])).rows[0].status,'expired');
  });

  test('SCRUM-107 AC5 AC6 - expired confirmation cannot displace a concurrent fresh booking', async () => {
    // Arrange: the old row is retained as expired history and no longer reserves the slot.
    const expired=(await database.query(`INSERT INTO venue_bookings
      (venue_id,event_id,requested_by,start_datetime,end_datetime,status,hold_expires_at)
      VALUES (7,3,1,$1,$2,'expired',clock_timestamp()-interval '1 second') RETURNING id`,[at('10:00'),at('11:00')])).rows[0];
    // Act: fresh booking and late confirmation contend for the same venue lock.
    const [late,fresh]=await Promise.all([
      request(`/7/requests/${expired.id}/confirm`,{},'PUT',1),
      request('/7/requests',{...body,eventId:4}),
    ]);
    // Assert: request ordering never gives the old expired arrangement priority over the fresh request.
    assert.equal(late.status,409);assert.equal(fresh.status,201);
    assert.deepEqual((await database.query('SELECT status FROM venue_bookings ORDER BY id')).rows,[{status:'expired'},{status:'pending'}]);
  });

  test('SCRUM-107 AC1 AC2 AC3 - staff approval and deadline replacement persist before coordinator confirmation', async () => {
    // Arrange: create an actual request; staff approval must remain tentative in PostgreSQL.
    const created=await request('/7/requests',body);
    const route=`/7/requests/${created.body.request.id}`;
    const first=new Date(Date.now()+3600000).toISOString();
    const replacement=new Date(Date.now()+7200000).toISOString();
    const approval=await request(`${route}/decision`,{decision:'approved',holdExpiresAt:first},'PUT',2);
    assert.equal(approval.status,200);assert.equal(approval.body.request.status,'tentative');
    // Act: replace the deadline through the staff endpoint, then finalize as the assigned coordinator.
    const updated=await request(`${route}/expiry`,{holdExpiresAt:replacement},'PUT',2);
    assert.equal(updated.status,200);
    assert.equal(updated.body.request.hold_expires_at,replacement);
    const confirmed=await request(`${route}/confirm`,{},'PUT',1);
    // Assert: a final booking retains its audit deadline but no longer expires as a tentative hold.
    assert.equal(confirmed.status,200);
    const saved=(await database.query('SELECT status,hold_expires_at,confirmed_by,confirmed_at FROM venue_bookings')).rows[0];
    assert.equal(saved.status,'approved');assert.equal(saved.hold_expires_at.toISOString(),replacement);
    assert.equal(saved.confirmed_by,1);assert.ok(saved.confirmed_at instanceof Date);
  });

});
