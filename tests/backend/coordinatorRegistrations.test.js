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
for (const count of [0, 1, 103]) {
  test(`AC1 AC2 - counts only stored waitlist at ${count} registered without calculating overflow`, async () => {
    // Arrange: zero, one and many registrations use stored statuses; no venue threshold is part of this report.
    mock.method(pool, 'query', async (sql, values) => {
      assert.deepEqual(values, ['101', 12]);
      if (sql.startsWith('SELECT id')) { assert.match(sql, /coordinator_id=\$2/); return { rows: [{ id: 101, name: 'Workshop' }] }; }
      assert.match(sql, /e.coordinator_id=\$2/);
      assert.match(sql, /r.status IN \('registered', 'waitlisted'\)/);
      assert.match(sql, /ORDER BY r.registered_at ASC, r.id ASC/);
      return { rows: [...Array.from({ length: count }, (_, id) => ({ id, status: 'registered' })),
        { id: 8, status: 'waitlisted', attendee_name: 'Bea', registered_at: '2031-01-01T09:00:00Z' }] };
    });
    // Act
    const result = await request();
    // Assert: would fail if registered overflow inflated the waitlist.
    assert.equal(result.body.headcount, count);
    assert.equal(result.body.waitlist_count, 1);
    assert.deepEqual(result.body.waitlist, [{ id: 8, status: 'waitlisted', attendee_name: 'Bea', registered_at: '2031-01-01T09:00:00Z' }]);
    assert.equal(result.body.registered.length, count);
  });
}
test('AC1 - empty event returns empty lists and zero counts', async () => {
  // Arrange / Act
  mock.method(pool, 'query', async sql => ({ rows: sql.startsWith('SELECT id') ? [{ id: 101 }] : [] }));
  const result = await request();
  // Assert
  assert.deepEqual(result.body, { event: { id: 101 }, registered: [], waitlist: [], headcount: 0, waitlist_count: 0 });
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
