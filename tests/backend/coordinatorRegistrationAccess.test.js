const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
process.env.JWT_SECRET = 'coordinator-registration-access-test';
process.env.NODE_ENV = 'test';
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { pool } = require('../../backend/src/config/db');
const app = require('../../backend/src/index');
let server, base;
before(async () => {
  // Real routing and authentication ensure a hidden button cannot substitute for server authorization.
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/events/101/coordinator-registrations`;
});
afterEach(() => mock.restoreAll());
after(async () => { await new Promise(resolve => server.close(resolve)); await pool.end(); });
for (const [role, id, expected] of [['event_coordinator', 12, 200], ['event_coordinator', 13, 404], ['event_organiser', 12, 403], ['attendee', 12, 403], [null, 12, 401]]) {
  test(`AC3 - real endpoint enforces ${role || 'unauthenticated'} identity ${id}: ${expected}`, async () => {
    // Arrange: only coordinator 12 owns this event; all other users must receive no attendee records.
    const query = mock.method(pool, 'query', async (sql, values) => {
      if (/FROM users WHERE/.test(sql)) return { rows: [{ id, role, auth_version: 0 }] };
      if (sql.startsWith('SELECT id')) {
        assert.deepEqual(values, ['101', id]);
        assert.match(sql, /coordinator_id=\$2/);
        return { rows: id === 12 ? [{ id: 101, name: 'Workshop' }] : [] };
      }
      if (/FROM registrations/.test(sql)) return { rows: [{ id: 1, attendee_name: 'Private attendee', status: 'registered' }] };
      throw new Error(`Unexpected query: ${sql}`);
    });
    const headers = role ? { Authorization: `Bearer ${jwt.sign({ sub: id, activeRole: role }, process.env.JWT_SECRET)}` } : {};
    // Act
    const response = await fetch(base, { headers });
    const body = await response.json();
    // Assert: direct URL requests enforce both role and assignment.
    assert.equal(response.status, expected);
    if (expected === 200) assert.equal(body.registered[0].attendee_name, 'Private attendee');
    else {
      assert.equal(JSON.stringify(body).includes('Private attendee'), false);
      assert.equal(query.mock.calls.some(call => /FROM registrations/.test(call.arguments[0])), false);
    }
  });
}
test('AC1 AC3 - database failure returns an error without attendee records', async () => {
  // Arrange: authentication succeeds but the authorized planning read fails.
  mock.method(pool, 'query', async sql => {
    if (/FROM users WHERE/.test(sql)) return { rows: [{ id: 12, role: 'event_coordinator', auth_version: 0 }] };
    throw new Error('Registration database unavailable');
  });
  const token = jwt.sign({ sub: 12, activeRole: 'event_coordinator' }, process.env.JWT_SECRET);
  // Act / Assert: an operational failure must not appear as a successful empty report.
  const response = await fetch(base, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 500);
  assert.equal((await response.json()).registered, undefined);
});
