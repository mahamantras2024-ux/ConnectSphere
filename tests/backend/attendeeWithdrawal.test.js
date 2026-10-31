const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
process.env.JWT_SECRET = 'withdrawal-test-secret';
process.env.NODE_ENV = 'test';
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { pool } = require('../../backend/src/config/db');
const app = require('../../backend/src/index');
const service = require('../../backend/src/services/attendeeWithdrawal');
const event = { id: 44, name: 'Arts Day', status: 'approved', is_draft: false, registration_required: true,
  starts_at: '2031-06-12T01:30:00Z', registration_capacity: 2, venue_capacity: 3 };
let server, base;

/** Keeps HTTP/authentication/business logic real; simulates PostgreSQL with explicit transaction evidence. */
function database({ context = event, registration = { id: 7, status: 'registered' }, occupied = 2,
  next = { id: 9, attendee_id: 10 }, failNotification = false, failRollback = false, userRole = 'attendee' } = {}) {
  mock.method(Date, 'now', () => Date.parse('2031-06-01T00:00:00Z'));
  let current = registration;
  const statements = [];
  const execute = async (sql, values = []) => {
    statements.push({ sql, values });
    if (sql === 'ROLLBACK' && failRollback) throw new Error('Rollback failed');
    if (sql.includes('FROM users WHERE')) return { rows: [{ id: 8, role: userRole, auth_version: 0 }] };
    if (sql.includes('FROM events e')) return { rows: context ? [context] : [] };
    if (sql.includes('AS occupied')) return { rows: [{ registration: current,
      occupied: occupied - (registration?.status === 'registered' && current?.status === 'withdrawn' ? 1 : 0) }] };
    if (sql.startsWith("UPDATE registrations SET status='withdrawn'")) {
      current = { ...current, status: 'withdrawn', withdrawn_at: '2031-06-01T00:00:00Z' };
      return { rows: [current] };
    }
    if (sql.startsWith("UPDATE registrations SET status='registered'")) return { rows: next ? [next] : [] };
    if (sql.includes('INSERT INTO notifications') && failNotification) throw new Error('Notification store failed');
    return { rows: [] };
  };
  const release = mock.fn();
  mock.method(pool, 'query', execute);
  mock.method(pool, 'connect', async () => ({ query: execute, release }));
  return { statements, release };
}

/** Sends withdrawal as a session identity; tests cannot select another attendee through request JSON. */
async function request({ id = '44', body = {}, role = 'attendee', auth = true } = {}) {
  const token = jwt.sign({ sub: 8, activeRole: role, authVersion: 0 }, process.env.JWT_SECRET);
  const response = await fetch(`${base}/${id}/withdraw`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
before(async () => {
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/registrations/events`;
});
afterEach(() => mock.restoreAll());
after(async () => { await new Promise(resolve => server.close(resolve)); await pool.end(); });

test('Withdraw AC1/AC2 - withdrawal, first-in-queue promotion and its notification commit together', async () => {
  // Arrange
  const db = database();
  // Act
  const result = await request();
  // Assert: ownership comes from the session, and the notification announces the actual Registered status.
  assert.equal(result.status, 200); assert.equal(result.body.registration.status, 'withdrawn');
  assert.deepEqual(db.statements.find(row => row.sql.startsWith("UPDATE registrations SET status='withdrawn'")).values, [44, 8]);
  assert.match(db.statements.find(row => row.sql.startsWith("UPDATE registrations SET status='registered'")).sql, /ORDER BY registered_at, id LIMIT 1 FOR UPDATE/);
  const notice = db.statements.find(row => row.sql.includes('INSERT INTO notifications'));
  assert.deepEqual(notice.values[0], [10]); assert.deepEqual(notice.values[3], ['waitlist_promoted']);
  assert.match(notice.values[5][0], /moved off the waitlist.*Registered/);
  assert.deepEqual(JSON.parse(notice.values[6][0]), { registrationId: 9, status: 'registered' });
  assert.ok(db.statements.indexOf(notice) < db.statements.findIndex(row => row.sql === 'COMMIT'));
  assert.equal(db.release.mock.callCount(), 1);
});
test('Withdraw AC1 - repeating a withdrawal returns Withdrawn without freeing another place', async () => {
  const db = database({ registration: { id: 7, status: 'withdrawn' }, context: { ...event, status: 'completed' } });
  const result = await request();
  assert.equal(result.status, 200); assert.equal(result.body.registration.status, 'withdrawn');
  assert.equal(db.statements.some(row => row.sql.startsWith('UPDATE')), false);
});
test('Withdraw AC1/AC2 - leaving the waitlist changes status without promoting another attendee', async () => {
  const db = database({ registration: { id: 7, status: 'waitlisted' } });
  const result = await request();
  assert.equal(result.body.registration.status, 'withdrawn');
  assert.equal(db.statements.some(row => row.values[3]?.includes('waitlist_promoted')), false);
  assert.equal(db.statements.some(row => row.sql.startsWith("UPDATE registrations SET status='registered'")), false);
});
for (const occupied of [2, 3, 4]) {
  test(`Withdraw AC2 - ${occupied - 1} remaining registrations against capacity 2 ${occupied < 3 ? 'allows' : 'blocks'} promotion`, async () => {
    const db = database({ occupied });
    await request();
    assert.equal(db.statements.some(row => row.values[3]?.includes('waitlist_promoted')), occupied < 3);
  });
}
test('Withdraw AC2 - no waitlist, disabled registration or unknown capacity creates no promotion notification', async () => {
  for (const options of [{ next: null }, { context: { ...event, registration_required: false } },
    { context: { ...event, registration_capacity: null, venue_capacity: null } }]) {
    const db = database(options);
    assert.equal((await request()).status, 200);
    assert.equal(db.statements.some(row => row.values[3]?.includes('waitlist_promoted')), false);
    mock.restoreAll();
  }
});
test('Withdraw AC2 - a previously closed registration deadline does not prevent promotion before event start', async () => {
  const db = database({ context: { ...event, registration_deadline: '2030-01-01T00:00:00Z' } });
  assert.equal((await request()).status, 200);
  assert.equal(db.statements.some(row => row.sql.includes('INSERT INTO notifications')), true);
});
test('Withdraw AC3 - a passed deadline returns its cutoff and does not alter the registration', async () => {
  const db = database({ context: { ...event, withdrawal_deadline: '2031-05-31T00:00:00Z' } });
  const result = await request();
  assert.equal(result.status, 409); assert.equal(result.body.deadline, '2031-05-31T00:00:00.000Z');
  assert.match(result.body.message, /no longer available/);
  assert.equal(db.statements.some(row => row.sql.startsWith('UPDATE')), false);
});
test('Withdraw AC1 - missing event or someone else’s registration cannot be withdrawn', async () => {
  for (const options of [{ context: null }, { registration: null }]) {
    const db = database(options); assert.equal((await request()).status, 404);
    assert.equal(db.statements.some(row => row.sql.startsWith('UPDATE')), false); mock.restoreAll();
  }
});
test('Withdraw AC1 - unsupported registration states cannot be silently overwritten', async () => {
  const db = database({ registration: { id: 7, status: 'pending' } });
  assert.equal((await request()).status, 409);
  assert.equal(db.statements.some(row => row.sql.startsWith('UPDATE')), false);
});
test('Withdraw AC2 - a notification failure rolls back withdrawal and promotion and releases the connection', async () => {
  const db = database({ failNotification: true });
  await assert.rejects(service.withdraw(44, 8), /Notification store failed/);
  assert.equal(db.statements.some(row => row.sql === 'COMMIT'), false);
  assert.equal(db.statements.at(-1).sql, 'ROLLBACK'); assert.equal(db.release.mock.callCount(), 1);
});
test('Withdraw AC2 - failed rollback still releases the connection', async () => {
  const db = database({ failNotification: true, failRollback: true });
  await assert.rejects(service.withdraw(44, 8), /Rollback failed/); assert.equal(db.release.mock.callCount(), 1);
});
test('Withdraw AC1 - invalid identity fields, event IDs and unauthenticated requests are rejected', async () => {
  const db = database();
  for (const body of [{ attendeeId: 99 }, []]) assert.equal((await request({ body })).status, 400);
  for (const id of ['0', '-1', '2147483648']) assert.equal((await request({ id })).status, 400);
  assert.equal((await request({ auth: false })).status, 401);
  assert.equal(db.statements.some(row => row.sql.startsWith('UPDATE')), false);
});
test('Withdraw AC1 - authenticated organisers cannot use the attendee withdrawal endpoint', async () => {
  const db = database({ userRole: 'event_organiser' });
  assert.equal((await request({ role: 'event_organiser' })).status, 403);
  assert.equal(db.statements.some(row => row.sql.includes('FROM events')), false);
});
