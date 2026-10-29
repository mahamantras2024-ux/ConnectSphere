// Technical Support event-status access is exercised through the real authenticated HTTP routes.
const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
process.env.JWT_SECRET = 'technical-event-status-tests';
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { pool } = require('../../backend/src/config/db');
const app = require('../../backend/src/index');
const staff = { id: 41, email: 'staff@example.com', role: 'technical_support', auth_version: 0 };
let server, base;
before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}/api/events`; });
afterEach(() => mock.restoreAll());
after(async () => { await new Promise(resolve => server.close(resolve)); await pool.end(); });

/** Only the database boundary is mocked; authentication, role guards, validation and query construction stay real. */
function database(rows = [], role = staff.role) {
  const queries = [];
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('FROM users WHERE')) return { rows: [{ ...staff, role }] };
    queries.push({ sql, values }); return { rows };
  });
  return queries;
}
/** Signs an actual session and reads one protected event-status resource. */
async function read(path, role = staff.role) {
  const token = jwt.sign({ sub: staff.id, role, authVersion: 0 }, process.env.JWT_SECRET);
  const response = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` } });
  return { status: response.status, body: await response.json() };
}

// AC6 scope must be enforced in SQL, not by filtering an already disclosed response in the browser.
test('TS status AC1/AC2/AC6 - scopes the lifecycle list to assignments, reviews or reservation responsibility', async () => {
  const rows = [{ id: 7, name: 'Relevant cancelled workshop', status: 'cancelled' }];
  const queries = database(rows);
  const result = await read('/on-site-support');
  assert.equal(result.status, 200); assert.deepEqual(result.body.events, rows);
  assert.deepEqual(queries[0].values, [staff.id]);
  for (const relationship of ['event_technical_support_assignments', 'event_equipment_reviews', 'event_equipment_reservations']) assert.match(queries[0].sql, new RegExp(relationship));
  assert.match(queries[0].sql, /reviewed_by=\$1/);
  assert.match(queries[0].sql, /reserved_by=\$1/);
  assert.doesNotMatch(queries[0].sql, /status NOT IN \('cancelled','completed'/);
});

test('TS status AC3/AC6 - returns current preparation fields only through an involved staff detail query', async () => {
  const queries = database([{ id: 7, name: 'Updated workshop', status: 'approved', technical_specifications: 'Four microphones' }]);
  const result = await read('/on-site-support/7');
  assert.equal(result.status, 200); assert.equal(result.body.event.technical_specifications, 'Four microphones');
  assert.deepEqual(queries[0].values, [staff.id, 7]);
  assert.match(queries[0].sql, /e\.id=\$2/);
  assert.doesNotMatch(queries[0].sql, /organiser_email|organiser_response|SELECT e\.\*/);
});

test('TS status AC6 - hides unrelated and nonexistent event details with the same 404', async () => {
  database([]);
  const result = await read('/on-site-support/999');
  assert.equal(result.status, 404); assert.equal(result.body.message, 'Event not found.');
});

test('TS status AC6 - rejects invalid event IDs before querying preparation data', async () => {
  const queries = database([]);
  for (const id of ['0', '2147483648', 'not-an-id']) assert.equal((await read('/on-site-support/' + id)).status, 400);
  assert.equal(queries.length, 0);
});


test('TS status AC6 - denies signed-out users and other staff roles before reading any event', async () => {
  // Arrange: a valid coordinator session still has no permission to read this staff-only resource.
  const queries = database([], 'event_coordinator');
  assert.equal((await fetch(base + '/on-site-support')).status, 401);
  assert.equal((await read('/on-site-support', 'event_coordinator')).status, 403);
  assert.equal((await read('/on-site-support/7', 'event_coordinator')).status, 403);
  // Assert: the role guard prevents a private data query, not merely a hidden dashboard control.
  assert.equal(queries.length, 0);
});

test('TS status AC6 - accepts the valid integer ID boundary while hiding absent records', async () => {
  // Arrange/Act: values below and at the maximum integer ID remain valid query parameters.
  const queries = database([]);
  for (const id of ['1', '2', '2147483646', '2147483647']) {
    assert.equal((await read('/on-site-support/' + id)).status, 404);
  }
  // Assert: absence produces a scoped lookup rather than incorrectly rejecting a valid ID.
  assert.deepEqual(queries.map(query => query.values), [[41,1], [41,2], [41,2147483646], [41,2147483647]]);
});

// AC6: keep authenticated identity wired into every legacy queue and direct availability read.
for (const path of ['/equipment-requests', '/equipment-reservations', '/equipment-reservation-issues', '/7/equipment-availability']) {
  test(`TS status AC6 - passes staff responsibility to ${path}`, async () => {
    // Arrange: the database boundary returns no eligible rows; SQL still has to authorize before reading them.
    const queries = database([]);
    const result = await read(path);
    assert.equal(result.status, path.includes('/7/') ? 404 : 200);
    assert.ok(queries.length > 0);
    for (const query of queries) {
      // Assert all three responsibility relationships use the authenticated ID, including nested dashboard lists.
      assert.equal(query.values.at(-1), staff.id);
      for (const relationship of ['event_technical_support_assignments', 'event_equipment_reviews', 'event_equipment_reservations']) {
        assert.ok(query.sql.includes(relationship));
      }
      assert.match(query.sql, /staff_id=\$[12]/);
      assert.match(query.sql, /reviewed_by=\$[12]/);
      assert.match(query.sql, /reserved_by=\$[12]/);
    }
  });
}
