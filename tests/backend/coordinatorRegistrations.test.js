const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { pool } = require('../../backend/src/config/db');
const { getRegistrations } = require('../../backend/src/controllers/coordinatorRegistrationController');
afterEach(() => mock.restoreAll());
/** Calls the controller with session identity and records the HTTP response. */
async function request(id = '101') {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await getRegistrations({ params: { id }, user: { id: 12 } }, res);
  return res;
}
for (const [count, overflowIds] of [[99, []], [100, []], [101, [101]], [103, [101, 102, 103]]]) {
  test(`AC1 AC2 - ${count} registered against confirmed capacity 100 keeps overflow separate from stored waitlist`, async () => {
    // Arrange: registration order determines overflow; withdrawn and stored-waitlisted attendees never consume capacity.
    const registered = Array.from({ length: count }, (_, index) => ({ id: index + 1, status: 'registered',
      attendee_name: `Registered ${index + 1}`, registered_at: new Date(Date.UTC(2031, 0, 1, 0, index)).toISOString() }));
    // Equal registration times straddle the last confirmed place; the ID tie-break keeps attendee 100 before 101.
    if (count > 100) registered[100].registered_at = registered[99].registered_at;
    const waitlist = [{ id: 1001, status: 'waitlisted', attendee_name: 'Waiting Bea', registered_at: '2030-12-31T09:00:00Z' }];
    // Interleave inactive statuses before Registered so slicing all rows before filtering would fail these oracles.
    const rows = [{ id: 2001, status: 'withdrawn', registered_at: '2030-12-30T09:00:00Z' },
      ...waitlist, ...registered, { id: 2002, status: 'withdrawn', registered_at: '2031-01-03T09:00:00Z' }];
    const original = JSON.stringify(rows);
    mock.method(pool, 'query', async (sql, values) => {
      assert.deepEqual(values, ['101', 12]);
      if (sql.startsWith('SELECT id')) {
        assert.match(sql, /coordinator_id=\$2/);
        // Only approved bookings determine capacity, with the existing organiser report's deterministic latest-booking rule.
        assert.match(sql, /JOIN venues/);
        assert.match(sql, /booking.status='approved'/);
        assert.match(sql, /ORDER BY booking.updated_at DESC, booking.id DESC LIMIT 1/);
        return { rows: [{ id: 101, name: 'Workshop', venue_capacity: 100 }] };
      }
      assert.match(sql, /e.coordinator_id=\$2/);
      assert.match(sql, /r.status IN \('registered', 'waitlisted', 'withdrawn'\)/);
      assert.match(sql, /ORDER BY r.registered_at ASC, r.id ASC/);
      return { rows };
    });
    // Act
    const result = await request();
    // Assert: the boundary oracle uses explicit attendee IDs, not the implementation's slicing calculation.
    assert.equal(result.body.headcount, count);
    assert.equal(result.body.venue_capacity, 100);
    assert.equal(result.body.withdrawal_count, 2);
    assert.equal(result.body.waitlist_count, 1);
    assert.deepEqual(result.body.waitlist, waitlist);
    assert.deepEqual(result.body.overflow.map(row => row.id), overflowIds);
    assert.equal(result.body.overflow_count, overflowIds.length);
    assert.equal(result.body.registered.length, count);
    assert.ok(result.body.overflow.every(row => row.status === 'registered'));
    assert.equal(JSON.stringify(rows), original, 'Planning report must not mutate stored statuses');
  });
}

for (const withdrawals of [0, 2]) {
  test(`AC1 - reports exactly ${withdrawals} withdrawals independently of active counts`, async () => {
    // Arrange: distinguish withdrawn records from both registered and waitlisted records.
    mock.method(pool, 'query', async sql => ({ rows: sql.startsWith('SELECT id')
      ? [{ id: 101, venue_capacity: 10 }]
      : [{ id: 1, status: 'registered' }, { id: 2, status: 'waitlisted' },
        ...Array.from({ length: withdrawals }, (_, index) => ({ id: index + 3, status: 'withdrawn' }))] }));
    // Act / Assert
    const { body } = await request();
    assert.equal(body.withdrawal_count, withdrawals);
    assert.equal(body.headcount, 1);
    assert.equal(body.waitlist_count, 1);
    assert.deepEqual(body.registered.map(row => row.id), [1]);
    assert.deepEqual(body.waitlist.map(row => row.id), [2]);
  });
}

for (const capacity of [null, undefined, -1, 1.5]) {
  test(`AC2 - missing or invalid confirmed capacity ${capacity} leaves overflow unknown and preserves stored waitlist`, async () => {
    // Arrange: unknown capacity is never interpreted as zero places.
    mock.method(pool, 'query', async sql => ({ rows: sql.startsWith('SELECT id')
      ? [{ id: 101, venue_capacity: capacity }]
      : [{ id: 1, status: 'registered' }, { id: 2, status: 'waitlisted' }] }));
    // Act / Assert
    const { body } = await request();
    assert.equal(body.venue_capacity, null);
    assert.equal(body.overflow_count, null);
    assert.deepEqual(body.overflow, []);
    assert.equal(body.headcount, 1);
    assert.equal(body.waitlist_count, 1);
  });
}

test('AC2 - zero confirmed places classifies all registered attendees as overflow', async () => {
  // Arrange: a real zero is different from missing capacity.
  mock.method(pool, 'query', async sql => ({ rows: sql.startsWith('SELECT id')
    ? [{ id: 101, venue_capacity: 0 }] : [{ id: 1, status: 'registered' }] }));
  // Act / Assert
  const { body } = await request();
  assert.equal(body.venue_capacity, 0);
  assert.equal(body.overflow_count, 1);
  assert.deepEqual(body.overflow.map(row => row.id), [1]);
  assert.equal(body.waitlist_count, 0);
});

test('AC1 AC2 - empty event returns zero status counts and unknown capacity without inventing overflow', async () => {
  // Arrange / Act
  mock.method(pool, 'query', async sql => ({ rows: sql.startsWith('SELECT id') ? [{ id: 101 }] : [] }));
  const result = await request();
  // Assert
  assert.deepEqual(result.body, { event: { id: 101 }, registered: [], waitlist: [], headcount: 0, waitlist_count: 0,
    withdrawal_count: 0, venue_capacity: null, overflow_count: null, overflow: [] });
});
test('AC3 - denied assignment never queries attendee data', async () => {
  // Arrange
  const query = mock.method(pool, 'query', async () => ({ rows: [] }));
  // Act / Assert
  assert.equal((await request()).statusCode, 404);
  assert.equal(query.mock.callCount(), 1);
});
for (const id of ['0', '-1', 'abc', '2147483648']) {
  test(`AC3 - rejects invalid identifier ${id} before database access`, async () => {
    // Arrange / Act / Assert
    const query = mock.method(pool, 'query', async () => { throw new Error('Must not query'); });
    assert.equal((await request(id)).statusCode, 400);
    assert.equal(query.mock.callCount(), 0);
  });
}
for (const id of ['1', '2', '2147483646', '2147483647']) {
  test(`AC3 - accepts valid identifier boundary ${id} for the assignment lookup`, async () => {
    // Arrange: the minimum and maximum database identifiers and their valid neighbours reach the scoped lookup.
    const query = mock.method(pool, 'query', async (_, values) => {
      assert.deepEqual(values, [id, 12]);
      return { rows: [] };
    });
    // Act / Assert: a scoped not-found response proves validation allowed the lookup.
    assert.equal((await request(id)).statusCode, 404);
    assert.equal(query.mock.callCount(), 1);
  });
}

test('AC2 - 103 registered against capacity 100 produces three overflow attendees even without a stored waitlist', async () => {
  // Arrange: reproduce the reviewer's example with no waitlisted or withdrawn records to trigger conditional calculation.
  const registered = Array.from({ length: 103 }, (_, index) => ({ id: index + 1, status: 'registered',
    attendee_name: `Attendee ${index + 1}`, registered_at: new Date(Date.UTC(2031, 0, 1, 0, index)).toISOString() }));
  mock.method(pool, 'query', async sql => ({ rows: sql.startsWith('SELECT id')
    ? [{ id: 101, venue_capacity: 100 }] : registered }));
  // Act
  const { body } = await request();
  // Assert: calculated overflow cannot depend on a persisted waitlist already existing.
  assert.equal(body.headcount, 103);
  assert.equal(body.waitlist_count, 0);
  assert.equal(body.withdrawal_count, 0);
  assert.deepEqual(body.waitlist, []);
  assert.equal(body.overflow_count, 3);
  assert.deepEqual(body.overflow.map(row => row.id), [101, 102, 103]);
});
