// SCRUM-93: real HTTP/auth/model behavior; PostgreSQL is the only replaced boundary.
const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('../../backend/node_modules/jsonwebtoken');
process.env.JWT_SECRET = 'scrum93-api-test';
process.env.NODE_ENV = 'test';
const { pool } = require('../../backend/src/config/db');
const app = require('../../backend/src/index');
let server, base;
const user = { id: 12, role: 'event_organiser', auth_version: 0 };
before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.on('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
afterEach(() => mock.restoreAll());
after(async () => { await new Promise(resolve => server.close(resolve)); await pool.end(); });
/** Calls the production router using a signed identity; request query parameters cannot change its scope. */
async function get(path, identity = user) {
  const response = await fetch(`${base}${path}`, { headers: identity ? { Authorization: `Bearer ${jwt.sign({ sub: identity.id, authVersion: 0 }, process.env.JWT_SECRET)}` } : {} });
  return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
}
for (const canManage of [true, false]) {
  test(`SCRUM-93 AC1/AC4 - ${canManage ? 'submitter' : 'organisation colleague'} receives a private status-only snapshot`, async () => {
    // Arrange: a database-scoped row, never a client-provided organisation or owner.
    const event = { id: 101, status: 'rejected', name: 'Workshop', can_manage: canManage, decision_reason: 'No safe venue' };
    mock.method(pool, 'query', async (sql, values) => {
      if (sql.includes('FROM users WHERE')) return { rows: [user] };
      assert.deepEqual(values, [12, 101]);
      assert.match(sql, /viewer.id=\$1/);
      assert.match(sql, /NULLIF\(lower\(btrim\(viewer.organisation_name\)\), ''\) IS NOT NULL/);
      assert.match(sql, /WHERE \(e.organiser_id=\$1 OR/);
      assert.doesNotMatch(sql, /organiser_email|equipment_notes|programme_details|attachments/);
      return { rows: [event] };
    });
    const result = await get('/api/events/101/request-status?organiser_id=99&organisation_name=Other');
    assert.equal(result.status, 200); assert.deepEqual(result.body, { event }); assert.equal(result.cache, 'no-store');
  });
}
test('SCRUM-93 AC6 - unrelated or missing event returns no status data', async () => {
  mock.method(pool, 'query', async sql => ({ rows: sql.includes('FROM users WHERE') ? [user] : [] }));
  const result = await get('/api/events/999/request-status');
  assert.equal(result.status, 404); assert.deepEqual(result.body, { message: 'Event not found.' });
});
for (const id of ['0','-1','1.5','2147483648']) {
  test(`SCRUM-93 AC6 - invalid event identifier ${id} cannot query event status`, async () => {
    mock.method(pool, 'query', async sql => { assert.match(sql, /FROM users WHERE/); return { rows: [user] }; });
    assert.equal((await get(`/api/events/${id}/request-status`)).status, 400);
  });
}
for (const identity of [null, { ...user, role: 'attendee' }]) {
  test(`SCRUM-93 AC6 - ${identity ? 'unrelated role' : 'signed out user'} cannot read organiser status`, async () => {
    mock.method(pool, 'query', async sql => { assert.match(sql, /FROM users WHERE/); return { rows: [identity] }; });
    assert.equal((await get('/api/events/101/request-status', identity)).status, identity ? 403 : 401);
  });
}

for (const fails of [false,true]) {
  test(`SCRUM-93 AC5 - isolated notification migration ${fails ? 'rolls back failures' : 'installs the transactional trigger'}`, async () => {
    // Arrange only the database connection; assert the actual migration SQL and release/rollback behavior.
    const { migrateOrganiserRequestStatus } = require('../../backend/src/db/migrateExternalEvents');
    const queries = []; let released = false;
    mock.method(pool, 'connect', async () => ({ query: async sql => {
      queries.push(sql); if (fails && sql.includes('CREATE TRIGGER')) throw new Error('Upgrade failed');
    }, release: () => { released = true; } }));
    if (fails) await assert.rejects(migrateOrganiserRequestStatus(), /Upgrade failed/);
    else { await migrateOrganiserRequestStatus(); }
    assert.equal(released, true);
    // The runner alone owns the transaction; a SQL-owned COMMIT would defeat rollback after a later failure.
    assert.equal(queries.length, 3);
    assert.equal(queries[0], 'BEGIN');
    assert.match(queries[1], /CREATE TRIGGER organiser_request_status_notification/);
    assert.doesNotMatch(queries[1], /^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/im);
    assert.equal(queries[2], fails ? 'ROLLBACK' : 'COMMIT');
  });
}

for (const failedBoundary of ['BEGIN', 'COMMIT']) {
  test(`SCRUM-93 AC5 review - ${failedBoundary} failure rolls back and releases the migration connection`, async () => {
    // Arrange: emulate a database failure at each transaction boundary rather than only inside the SQL body.
    const { migrateOrganiserRequestStatus } = require('../../backend/src/db/migrateExternalEvents');
    const queries = []; let released = false;
    mock.method(pool, 'connect', async () => ({
      async query(sql) { queries.push(sql); if (sql === failedBoundary) throw new Error('Boundary failed'); },
      release() { released = true; },
    }));
    // Act / Assert: no later step may succeed or hide the error, and the same connection must be cleaned up.
    await assert.rejects(migrateOrganiserRequestStatus(), /Boundary failed/);
    assert.equal(queries.at(-1), 'ROLLBACK');
    assert.equal(queries.length, failedBoundary === 'BEGIN' ? 2 : 4);
    assert.equal(released, true);
  });
}

for (const id of [1, 2, 2147483646, 2147483647]) {
  test(`SCRUM-93 AC6 - accepts event identifier boundary ${id}`, async () => {
    // PostgreSQL integer identifiers allow 1 through 2147483647, including both edges and their interior neighbours.
    mock.method(pool, 'query', async (sql, values) => {
      if (sql.includes('FROM users WHERE')) return { rows: [user] };
      assert.deepEqual(values, [12, id]);
      return { rows: [{ id, status: 'submitted' }] };
    });
    const result = await get(`/api/events/${id}/request-status`);
    assert.equal(result.status, 200); assert.equal(result.body.event.id, id);
  });
}
