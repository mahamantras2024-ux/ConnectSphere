// SCRUM-61 AC6: executes the actual migration and trigger against a session-local table, never application records.
require('../../backend/node_modules/dotenv').config();
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../../backend/src/config/db');

test('SCRUM-61 AC5 AC6 - SQL cancellation handles opt-in/out, changes, approval, recursion and scope atomically', { skip: process.env.RUN_VENUE_BOOKING_DB !== '1' }, async () => {
  const db = await pool.connect();
  try {
    // Arrange: TEMP shadows public. Qualifying the test function prevents replacing production functions.
    await db.query(`CREATE TEMP TABLE venue_bookings (
      id int PRIMARY KEY, event_id int, requested_by int, venue_id int, status text,
      start_datetime timestamptz, end_datetime timestamptz, updated_at timestamptz, decision_notes text)`);
    const sql = fs.readFileSync(path.join(__dirname, '../../backend/src/db/migrations/20261018064942_venue_booking_requests.sql'), 'utf8')
      .replaceAll('cancel_sibling_venue_requests()', 'pg_temp.cancel_sibling_venue_requests()');
    await db.query(sql);
    await db.query(sql); // additive migration must remain safe to rerun.

    /** Seeds alternatives and protected records; every scenario starts independently. */
    async function seed(optIn, status = 'pending') {
      await db.query('TRUNCATE venue_bookings');
      await db.query(`INSERT INTO venue_bookings(id,event_id,requested_by,venue_id,status,start_datetime,end_datetime,cancel_other_pending)
        VALUES (1,3,1,7,$2,'2090-01-01T10:00Z','2090-01-01T11:00Z',$1),
        (2,3,1,8,'pending','2090-01-01T10:00Z','2090-01-01T11:00Z',true),
        (3,3,1,9,'approved','2090-01-01T10:00Z','2090-01-01T11:00Z',false),
        (4,4,1,8,'pending','2090-01-01T10:00Z','2090-01-01T11:00Z',false),
        (5,3,2,8,'pending','2090-01-01T10:00Z','2090-01-01T11:00Z',false)`, [optIn, status]);
    }
    for (const [optIn, change, expected, originalStatus = 'pending'] of [
      [false, "status='cancelled'", 'pending'],
      [true, "status='approved'", 'pending'],
      [true, "status='rejected'", 'pending'],
      [true, "status='cancelled'", 'cancelled'],
      [true, 'venue_id=10', 'cancelled'],
      [true, "start_datetime='2090-01-01T10:15Z'", 'cancelled'],
      [true, "end_datetime='2090-01-01T11:15Z'", 'cancelled'],
      [true, `requirements='{"capacity":40}'`, 'cancelled'],
      [true, 'venue_id=venue_id', 'pending'],
      [true, "status='cancelled'", 'cancelled', 'approved'],
      [true, 'venue_id=10', 'cancelled', 'approved'],
      [true, 'venue_id=10', 'pending', 'rejected'],
      [true, 'venue_id=10', 'pending', 'cancelled'],
    ]) {
      await seed(optIn, originalStatus);
      // Act: execute SQL, not a JavaScript imitation of the trigger's cancellation rules.
      await db.query(`UPDATE venue_bookings SET ${change} WHERE id=1`);
      const rows = (await db.query('SELECT id,status FROM venue_bookings ORDER BY id')).rows;
      // Assert: siblings only, approved/other events/other creators protected, and nested opt-in cannot cancel initiator.
      assert.equal(rows[1].status, expected, `${optIn}: ${change}`);
      assert.deepEqual(rows.slice(2).map(row => row.status), ['approved', 'pending', 'pending']);
      if (!change.startsWith('status=')) assert.equal(rows[0].status, originalStatus);
    }
    await seed(true);
    await db.query('BEGIN');
    await db.query("UPDATE venue_bookings SET status='cancelled' WHERE id=1");
    await db.query('ROLLBACK');
    assert.equal((await db.query('SELECT count(*)::int AS total FROM venue_bookings WHERE status=\'pending\'')).rows[0].total, 4);
  } finally {
    await db.query('ROLLBACK');
    // Session-local objects disappear when the connection closes; no shared schemas need cleanup.
    db.release(true);
    await pool.end();
  }
});
