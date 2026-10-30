// File: Parent notification system - the Coordinator Lead and Safety Officer receive notifications about changes relevant to
// them (AC1), through the real routes and services with only the database and email boundaries replaced.
const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('../../backend/node_modules/jsonwebtoken');
process.env.JWT_SECRET = 'parent-notifications-test-secret';
process.env.NODE_ENV = 'test';
const { pool } = require('../../backend/src/config/db');
const emailService = require('../../backend/src/services/emailService');
const { notifySafetyIfNewlyReady, isReadyForSafetyCheck } = require('../../backend/src/services/roleNotifications');
const app = require('../../backend/src/index');
let server, base;

const organiser = { id: 12, email: 'olivia@example.com', role: 'event_organiser', auth_version: 0 };
const coordinator = { id: 30, email: 'chris@example.com', role: 'event_coordinator', auth_version: 0 };
// A submittable request (the required fields for submission).
const request = { name: 'Gala', proposedDate: '2030-10-15', proposedStartTime: '09:00', proposedEndTime: '12:00', expectedAttendance: 50 };
// An event's decision context that is ready for its safety check (confirmed venue, nothing technical, no check yet).
const readyContext = { id: 101, name: 'Gala', organiser_id: 12, coordinator_id: 30, status: 'submitted', is_draft: false, equipment_items: [],
  technical_support_required: false, video_conferencing_required: false, equipment_notes: null, equipment_confirmed_at: null,
  pending_clarifications: 0, bookings: [{ status: 'approved', hold_expires_at: null }], safety_changes_open: [], latest_safety_check: null };

// Signs a test-only JWT for the supplied user.
function token(user) { return jwt.sign({ sub: user.id, email: user.email, authVersion: 0 }, process.env.JWT_SECRET); }
// Calls the local test HTTP server and returns status plus JSON.
async function call(path, { user = organiser, method = 'POST', body } = {}) {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(user)}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
}
/**
 * Mocks authentication (pool.query) and one transaction client whose statements are recorded in order. `answer` handles
 * the statements of the flow under test; role lookups return `roleMembers`; notification inserts echo their recipients.
 */
function mockDatabase({ user = organiser, roleMembers = {}, answer = () => ({ rows: [] }), failNotifications = false } = {}) {
  const statements = [];
  mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM users WHERE')) return { rows: [user] };
    throw new Error(`Unexpected pool query: ${sql}`);
  });
  mock.method(pool, 'connect', async () => ({
    release() {},
    async query(sql, values) {
      statements.push({ sql: sql.trim(), values });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql.trim())) return { rows: [] };
      if (/FROM users\s+WHERE role=\$1/.test(sql)) return { rows: (roleMembers[values[0]] || []).map((id) => ({ id })) };
      if (sql.includes('INSERT INTO notifications')) {
        if (failNotifications) throw new Error('database unavailable');
        return { rows: values[0].map((userId, index) => ({ id: index + 1, user_id: userId, title: values[4][index], message: values[5][index], email: `user${userId}@example.com` })) };
      }
      return answer(sql, values);
    },
  }));
  return {
    statements, find: (text) => statements.filter((statement) => statement.sql.includes(text)),
    words: () => statements.map((statement) => statement.sql).filter((sql) => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)),
  };
}
const notificationsOf = (tx) => tx.find('INSERT INTO notifications').map(({ values: [userIds, , , types, titles, messages] }) => ({ userIds, types, titles, messages }));

before(async () => {
  await new Promise((resolve, reject) => { server = app.listen(0, '127.0.0.1', resolve); server.on('error', reject); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() => mock.restoreAll());
after(async () => { if (server?.listening) await new Promise((done) => server.close(done)); await pool.end(); });

// ---------- Coordinator Lead: a new request needs assigning ----------

// Test case: Submitting a new request tells every Coordinator Lead in the same transaction, then emails them.
test('NT AC1 - submitting a new event request notifies every Coordinator Lead', async () => {
  // Arrange: two Leads; the insert returns the stored event.
  const tx = mockDatabase({ roleMembers: { event_coordinator_lead: [40, 41] },
    answer: (sql, values) => (sql.includes('INSERT INTO events') ? { rows: [{ id: 101, name: values[1], status: 'submitted' }] } : { rows: [] }) });
  const sent = [];
  mock.method(emailService, 'sendNotificationEmail', async (to, title) => { sent.push([to, title]); });
  // Act
  const result = await call('/api/events', { body: { ...request, isDraft: false } });
  // Assert: one notification per Lead, written before commit, then emailed.
  assert.equal(result.status, 201);
  assert.deepEqual(notificationsOf(tx), [{ userIds: [40, 41], types: ['event_awaiting_assignment', 'event_awaiting_assignment'],
    titles: ['New request to assign: Gala', 'New request to assign: Gala'], messages: ['Gala was submitted and needs an Event Coordinator.', 'Gala was submitted and needs an Event Coordinator.'] }]);
  assert.deepEqual(tx.words(), ['BEGIN', 'COMMIT']);
  assert.ok(tx.statements.findIndex((s) => s.sql.includes('INSERT INTO events')) < tx.statements.findIndex((s) => s.sql.includes('INSERT INTO notifications')));
  assert.deepEqual(sent, [['user40@example.com', 'New request to assign: Gala'], ['user41@example.com', 'New request to assign: Gala']]);
});
// Test case: Saving a draft is not a submission: no transaction, no notification.
test('NT AC1 - saving a draft does not notify the Coordinator Lead', async () => {
  let inserted = false;
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('FROM users WHERE')) return { rows: [organiser] };
    inserted = sql.includes('INSERT INTO events');
    return { rows: [{ id: 102, name: values[1], status: 'draft' }] };
  });
  const connect = mock.method(pool, 'connect', async () => assert.fail('A draft must not start a notification transaction.'));
  assert.equal((await call('/api/events', { body: { ...request, isDraft: true } })).status, 201);
  assert.equal(inserted, true);
  assert.equal(connect.mock.callCount(), 0);
});
// Test case: Submitting a saved draft tells every Lead too.
test('NT AC1 - submitting a saved draft notifies every Coordinator Lead', async () => {
  const draft = { id: 103, name: 'Talk', proposed_date: '2030-10-15', proposed_start_time: '09:00:00', proposed_end_time: '10:00:00', expected_attendance: 20 };
  const tx = mockDatabase({ roleMembers: { event_coordinator_lead: [40] },
    answer: (sql) => (sql.includes('FOR UPDATE') ? { rows: [draft] } : sql.includes('UPDATE events SET is_draft=false') ? { rows: [{ ...draft, status: 'submitted' }] } : { rows: [] }) });
  mock.method(emailService, 'sendNotificationEmail', async () => {});
  assert.equal((await call('/api/events/103/submit')).status, 200);
  assert.deepEqual(notificationsOf(tx).map((note) => [note.userIds, note.titles]), [[[40], ['New request to assign: Talk']]]);
});
// Test case: With no Lead accounts the submission still succeeds and nothing is written for them.
test('NT AC1 - a submission with no Coordinator Lead accounts stores no notification', async () => {
  const tx = mockDatabase({ answer: (sql, values) => (sql.includes('INSERT INTO events') ? { rows: [{ id: 104, name: values[1] }] } : { rows: [] }) });
  assert.equal((await call('/api/events', { body: { ...request, isDraft: false } })).status, 201);
  assert.equal(tx.find('INSERT INTO notifications').length, 0);
});
// Test case: If the notification cannot be stored, the submission is rolled back rather than silently unannounced.
test('NT AC1 - a submission whose Lead notification fails is rolled back', async () => {
  mock.method(console, 'error', () => {});
  const tx = mockDatabase({ roleMembers: { event_coordinator_lead: [40] }, failNotifications: true,
    answer: (sql, values) => (sql.includes('INSERT INTO events') ? { rows: [{ id: 105, name: values[1] }] } : { rows: [] }) });
  assert.equal((await call('/api/events', { body: { ...request, isDraft: false } })).status, 500);
  assert.deepEqual(tx.words(), ['BEGIN', 'ROLLBACK']);
});
// Test case: The same applies when a saved draft is submitted: it stays a draft if the Leads cannot be notified.
test('NT AC1 - a draft submission whose Lead notification fails is rolled back', async () => {
  mock.method(console, 'error', () => {});
  const draft = { id: 106, name: 'Talk', proposed_date: '2030-10-15', proposed_start_time: '09:00:00', proposed_end_time: '10:00:00', expected_attendance: 20 };
  const tx = mockDatabase({ roleMembers: { event_coordinator_lead: [40] }, failNotifications: true,
    answer: (sql) => (sql.includes('FOR UPDATE') ? { rows: [draft] } : sql.includes('UPDATE events SET is_draft=false') ? { rows: [{ ...draft, status: 'submitted' }] } : { rows: [] }) });
  const sent = mock.method(emailService, 'sendNotificationEmail', async () => {});
  assert.equal((await call('/api/events/106/submit')).status, 500);
  assert.deepEqual(tx.words(), ['BEGIN', 'ROLLBACK']);
  assert.equal(sent.mock.callCount(), 0);
});

// ---------- Safety Officer: an event becomes ready for its safety check ----------

/** A transaction-like db for the readiness helper: the decision context, the event name and role lookups. */
function readinessDb({ context, safetyOfficers = [50, 51] }) {
  const statements = [];
  return { statements, async query(sql, values) {
    statements.push(sql);
    if (sql.includes('AS pending_clarifications')) return { rows: context ? [context] : [] };
    if (sql.includes('SELECT id, name FROM events')) return { rows: [{ id: values[0], name: 'Gala' }] };
    if (/FROM users\s+WHERE role=\$1/.test(sql)) return { rows: safetyOfficers.map((id) => ({ id })) };
    if (sql.includes('INSERT INTO notifications')) return { rows: values[0].map((userId, index) => ({ user_id: userId, type: values[3][index], title: values[4][index] })) };
    throw new Error(`Unexpected query: ${sql}`);
  } };
}
// Readiness transitions: only not-ready -> ready notifies.
for (const [label, wasReady, context, expected] of [
  ['was not ready and now is', false, readyContext, [[50, 'safety_check_ready', 'Ready for safety check: Gala'], [51, 'safety_check_ready', 'Ready for safety check: Gala']]],
  ['was already ready', true, readyContext, []],
  ['is still not ready (no confirmed venue)', false, { ...readyContext, bookings: [] }, []],
  ['is still not ready (changes requested and open)', false, { ...readyContext, safety_changes_open: ['venue'] }, []],
  ['already has a passed check', false, { ...readyContext, latest_safety_check: { outcome: 'approved' } }, []],
  ['no longer exists', false, null, []],
]) {
  // Test case: One readiness transition.
  test(`NT AC1 - an event that ${label} ${expected.length ? 'notifies every Safety Officer' : 'notifies no one'}`, async () => {
    const db = readinessDb({ context });
    const stored = await notifySafetyIfNewlyReady(db, 101, wasReady);
    assert.deepEqual(stored.map((row) => [row.user_id, row.type, row.title]), expected);
  });
}
// Test case: A ready event with no Safety Officer accounts stores nothing.
test('NT AC1 - a ready event with no Safety Officer accounts stores no notification', async () => {
  const db = readinessDb({ context: readyContext, safetyOfficers: [] });
  assert.deepEqual(await notifySafetyIfNewlyReady(db, 101, false), []);
  assert.equal(db.statements.some((sql) => sql.includes('INSERT INTO notifications')), false);
});
// Test case: Readiness uses the same rule as the Safety Officer's queue.
test('NT AC1 - readiness follows the safety queue rule', async () => {
  assert.equal(await isReadyForSafetyCheck(readinessDb({ context: readyContext }), 101), true);
  assert.equal(await isReadyForSafetyCheck(readinessDb({ context: { ...readyContext, technical_support_required: true } }), 101), false);
});

// Test case: Completing the last requested-change stage makes the event ready again, so Safety Officers are told.
test('NT AC1 - completing the last requested change notifies every Safety Officer that the event is ready again', async () => {
  // Arrange: the venue stage is open; once removed nothing is open.
  let open = ['venue'];
  const tx = mockDatabase({ user: coordinator, roleMembers: { safety_officer: [50] }, answer: (sql, values) => {
    if (sql.includes('AS pending_clarifications')) return { rows: [{ ...readyContext, safety_changes_open: open, latest_safety_check: { outcome: 'changes_requested', notes: 'x', change_areas: ['venue'] } }] };
    if (sql.includes('array_remove(safety_changes_open')) { open = []; return { rows: [{ safety_changes_open: [] }] }; }
    if (sql.includes('SELECT id, name FROM events')) return { rows: [{ id: values[0], name: 'Gala' }] };
    return { rows: [] };
  } });
  mock.method(emailService, 'sendNotificationEmail', async () => {});
  // Act
  const result = await call('/api/events/101/safety-changes/resolve', { user: coordinator, body: { area: 'venue' } });
  // Assert
  assert.equal(result.status, 200);
  assert.deepEqual(notificationsOf(tx).map((note) => [note.userIds, note.types]), [[[50], ['safety_check_ready']]]);
});
// Test case: While other stages remain open the event is not ready, so nothing is sent and readiness is not even checked.
test('NT AC1 - completing a stage while others remain open notifies no Safety Officer', async () => {
  const tx = mockDatabase({ user: coordinator, roleMembers: { safety_officer: [50] }, answer: (sql) => {
    if (sql.includes('AS pending_clarifications')) return { rows: [{ ...readyContext, safety_changes_open: ['venue', 'event_details'] }] };
    if (sql.includes('array_remove(safety_changes_open')) return { rows: [{ safety_changes_open: ['event_details'] }] };
    return { rows: [] };
  } });
  assert.equal((await call('/api/events/101/safety-changes/resolve', { user: coordinator, body: { area: 'venue' } })).status, 200);
  assert.equal(tx.find('INSERT INTO notifications').length, 0);
});
