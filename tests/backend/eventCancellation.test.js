// File: Covers SCRUM-90 cancellation access, public status updates, and attendee notifications through the real API.
const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
process.env.JWT_SECRET = 'scrum-90-cancellation-test-secret';
process.env.NODE_ENV = 'test';
const jwt = require('../../backend/node_modules/jsonwebtoken');
const { pool } = require('../../backend/src/config/db');
const emailService = require('../../backend/src/services/emailService');
const app = require('../../backend/src/index');

const organiser = { id: 12, email: 'organiser@example.com', role: 'event_organiser', auth_version: 0 };
const coordinator = { id: 30, email: 'coordinator@example.com', role: 'event_coordinator', auth_version: 0 };
const attendees = [{ attendee_id: 41 }, { attendee_id: 42 }];
const event = { id: 101, name: 'Community Workshop', status: 'approved', is_draft: false,
  registration_required: true, organiser_id: organiser.id, coordinator_id: coordinator.id };
let server;
let base;

/** Signs a request as the selected role so real authentication and route guards are exercised. */
function token(user) { return jwt.sign({ sub: user.id, role: user.role, email: user.email, authVersion: 0 }, process.env.JWT_SECRET); }

/** Sends one request to the local API and parses its JSON result. */
async function request(path, { user = organiser, method = 'GET' } = {}) {
  const response = await fetch(`${base}${path}`, { method,
    headers: { Authorization: `Bearer ${token(user)}`, 'Content-Type': 'application/json' } });
  return { status: response.status, body: await response.json() };
}

/** Mocks locked cancellation writes while recording commit order, notifications, and post-commit email recipients. */
function mockCancellationTransaction({ context = event, recipients = attendees, supportStaff = [], failNotifications = false, updateMissed = false } = {}) {
  const statements = [];
  const client = {
    release() { this.released = true; },
    async query(sql, values = []) {
      const normalized = sql.trim();
      statements.push({ sql: normalized, values });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normalized)) return { rows: [] };
      if (normalized.includes('FROM events e') && normalized.includes('FOR UPDATE OF e')) {
        const ownsOrCoordinates = values[1] === organiser.id || values[1] === coordinator.id;
        return { rows: context && ownsOrCoordinates ? [context] : [] };
      }
      if (normalized.startsWith('UPDATE events SET status=\'cancelled\'')) {
        return { rows: updateMissed ? [] : [{ id: context.id, name: context.name, status: 'cancelled' }] };
      }
      if (normalized.includes('FROM registrations') && normalized.includes('attendee_id')) return { rows: recipients };
      // Technical Support assignment lookup for cancellation notices; most scenarios have none assigned.
      if (normalized.includes('FROM event_technical_support_assignments')) return { rows: supportStaff };
      // Existing cancellation scenarios have no assigned Venue Staff; this keeps their attendee-only oracle focused.
      if (normalized.includes('FROM venue_staff_assignments')) return { rows: [] };
      if (normalized.includes('INSERT INTO notifications')) {
        if (failNotifications) throw new Error('notification store unavailable');
        return { rows: values[0].map((userId, index) => ({ id: index + 1, user_id: userId,
          title: values[4][index], message: values[5][index], email: `attendee${userId}@example.com` })) };
      }
      throw new Error(`Unexpected transaction query: ${normalized}`);
    },
  };
  mock.method(pool, 'connect', async () => client);
  return { statements, client, find: (fragment) => statements.filter(({ sql }) => sql.includes(fragment)) };
}

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/events`;
});
afterEach(() => mock.restoreAll());
after(async () => { await new Promise(resolve => server.close(resolve)); await pool.end(); });

test('AC4 - an organiser cancels their event and active attendees receive in-app and email notifications', async () => {
  // Arrange: the event is published and the active registration query returns two recipients.
  mock.method(pool, 'query', async (sql) => sql.includes('FROM users WHERE') ? { rows: [organiser] } : { rows: [] });
  const tx = mockCancellationTransaction();
  const sendEmail = mock.method(emailService, 'sendNotificationEmail', async () => {});
  // Act
  const result = await request('/101/cancel', { method: 'POST' });
  // Assert: status and attendee notification are stored in one commit; email follows that commit.
  assert.equal(result.status, 200);
  assert.equal(result.body.event.status, 'cancelled');
  assert.deepEqual(tx.find('UPDATE events SET status')[0].values, [101]);
  const [userIds, eventIds, , types, titles, messages] = tx.find('INSERT INTO notifications')[0].values;
  assert.deepEqual([userIds, eventIds, types], [[41, 42], [101, 101], ['event_cancelled', 'event_cancelled']]);
  assert.deepEqual(titles, ['Event cancelled: Community Workshop', 'Event cancelled: Community Workshop']);
  assert.ok(messages.every(message => /Community Workshop has been cancelled/.test(message)));
  assert.match(tx.find('FROM registrations')[0].sql, /status IN \('registered', 'waitlisted'\)/);
  assert.deepEqual(tx.statements.filter(({ sql }) => ['BEGIN', 'COMMIT'].includes(sql)).map(({ sql }) => sql), ['BEGIN', 'COMMIT']);
  assert.deepEqual(sendEmail.mock.calls.map(call => call.arguments[0]), ['attendee41@example.com', 'attendee42@example.com']);
});

test('AC4 - the assigned coordinator can cancel the event and notify its attendees', async () => {
  mock.method(pool, 'query', async (sql) => sql.includes('FROM users WHERE') ? { rows: [coordinator] } : { rows: [] });
  const tx = mockCancellationTransaction();
  mock.method(emailService, 'sendNotificationEmail', async () => {});
  const result = await request('/101/cancel', { user: coordinator, method: 'POST' });
  assert.equal(result.status, 200);
  assert.match(tx.find('FROM events e')[0].sql, /e\.coordinator_id\s*=\s*\$2/);
});

test('AC4 - cancellation with no active registrations creates no misleading notification', async () => {
  mock.method(pool, 'query', async (sql) => sql.includes('FROM users WHERE') ? { rows: [organiser] } : { rows: [] });
  const tx = mockCancellationTransaction({ recipients: [] });
  const sendEmail = mock.method(emailService, 'sendNotificationEmail', async () => {});
  const result = await request('/101/cancel', { method: 'POST' });
  assert.equal(result.status, 200);
  assert.equal(result.body.notifiedCount, 0);
  assert.equal(tx.find('INSERT INTO notifications').length, 0);
  assert.equal(sendEmail.mock.callCount(), 0);
});

test('AC5 - a status change that loses a race is not reported as cancelled', async () => {
  mock.method(pool, 'query', async (sql) => sql.includes('FROM users WHERE') ? { rows: [organiser] } : { rows: [] });
  const tx = mockCancellationTransaction({ updateMissed: true });
  const sendEmail = mock.method(emailService, 'sendNotificationEmail', async () => {});
  const result = await request('/101/cancel', { method: 'POST' });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'EVENT_STATUS_CHANGED');
  assert.equal(tx.find('INSERT INTO notifications').length, 0);
  assert.equal(sendEmail.mock.callCount(), 0);
});

test('AC4 AC6 - a notification storage failure rolls back cancellation and sends no email', async () => {
  mock.method(pool, 'query', async (sql) => sql.includes('FROM users WHERE') ? { rows: [organiser] } : { rows: [] });
  const tx = mockCancellationTransaction({ failNotifications: true });
  const sendEmail = mock.method(emailService, 'sendNotificationEmail', async () => {});
  const result = await request('/101/cancel', { method: 'POST' });
  assert.equal(result.status, 500);
  assert.deepEqual(tx.statements.filter(({ sql }) => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)).map(({ sql }) => sql), ['BEGIN', 'ROLLBACK']);
  assert.equal(sendEmail.mock.callCount(), 0);
});

test('AC3 AC6 - an unassigned organiser cannot cancel another event', async () => {
  const otherOrganiser = { ...organiser, id: 13 };
  mock.method(pool, 'query', async (sql) => sql.includes('FROM users WHERE') ? { rows: [otherOrganiser] } : { rows: [] });
  const tx = mockCancellationTransaction({ context: null });
  assert.equal((await request('/101/cancel', { user: otherOrganiser, method: 'POST' })).status, 404);
  assert.equal(tx.find('UPDATE events').length, 0);
});

test('AC4 - a non-attendee-facing planning event cannot be cancelled through the public event workflow', async () => {
  const planning = { ...event, status: 'planning' };
  mock.method(pool, 'query', async (sql) => sql.includes('FROM users WHERE') ? { rows: [organiser] } : { rows: [] });
  const tx = mockCancellationTransaction({ context: planning });
  const result = await request('/101/cancel', { method: 'POST' });
  assert.equal(result.status, 409);
  assert.equal(tx.find('UPDATE events').length, 0);
});

test('AC3 AC6 - attendees and invalid event IDs cannot invoke staff cancellation', async () => {
  mock.method(pool, 'query', async (sql) => sql.includes('FROM users WHERE') ? { rows: [{ ...organiser, role: 'attendee' }] } : { rows: [] });
  const attendeeAttempt = await request('/101/cancel', { user: { ...organiser, role: 'attendee' }, method: 'POST' });
  assert.equal(attendeeAttempt.status, 403);
  mock.restoreAll();
  mock.method(pool, 'query', async (sql) => sql.includes('FROM users WHERE') ? { rows: [organiser] } : { rows: [] });
  const invalidId = await request('/abc/cancel', { method: 'POST' });
  assert.equal(invalidId.status, 400);
});

for (const [label, changes] of [
  ['a draft', { is_draft: true }],
  ['an event without attendee registration', { registration_required: false }],
]) {
  test(`AC1 AC6 - cancellation refuses ${label}`, async () => {
    mock.method(pool, 'query', async (sql) => sql.includes('FROM users WHERE') ? { rows: [organiser] } : { rows: [] });
    const tx = mockCancellationTransaction({ context: { ...event, ...changes } });
    const result = await request('/101/cancel', { method: 'POST' });
    assert.equal(result.status, 409);
    assert.equal(tx.find('UPDATE events').length, 0);
  });
}

// SCRUM-86 AC2 - cancelling an event notifies every Technical Support Staff member assigned to support it, so they
// know their on-site assignment is no longer required. The notice names the event and routes to the tech-support
// dashboard via the tech_support_assignment_cancelled type.
test('AC2 - cancellation notifies assigned Technical Support Staff that their on-site assignment ended', async () => {
  // Arrange: the event has two assigned Technical Support Staff (ids 61, 62) and no active attendees, so the only
  // notifications are the support cancellations — a faulty impl that skipped support staff would store nothing.
  mock.method(pool, 'query', async (sql) => sql.includes('FROM users WHERE') ? { rows: [organiser] } : { rows: [] });
  const tx = mockCancellationTransaction({ recipients: [], supportStaff: [{ staff_id: 61 }, { staff_id: 62 }] });
  const sendEmail = mock.method(emailService, 'sendNotificationEmail', async () => {});

  // Act
  const result = await request('/101/cancel', { method: 'POST' });

  // Assert: both assigned staff receive a tech_support_assignment_cancelled notice whose first message line names the event.
  assert.equal(result.status, 200);
  const supportInsert = tx.find('INSERT INTO notifications').at(-1);
  const [userIds, eventIds, , types, titles, messages] = supportInsert.values;
  assert.deepEqual(userIds, [61, 62]);
  assert.deepEqual(eventIds, [101, 101]);
  assert.deepEqual(types, ['tech_support_assignment_cancelled', 'tech_support_assignment_cancelled']);
  assert.ok(titles.every(title => title === 'On-site support cancelled: Community Workshop'));
  assert.ok(messages.every(message => message.split('\n')[0].includes('Community Workshop')));
  // The assignment lookup is scoped to the cancelled event.
  assert.deepEqual(tx.find('FROM event_technical_support_assignments')[0].values, [101]);
});

// SCRUM-86 AC2 - an event with no assigned Technical Support Staff stores no support notifications on cancellation.
test('AC2 - cancellation stores no support notice when no Technical Support Staff are assigned', async () => {
  mock.method(pool, 'query', async (sql) => sql.includes('FROM users WHERE') ? { rows: [organiser] } : { rows: [] });
  const tx = mockCancellationTransaction({ recipients: [], supportStaff: [] });
  mock.method(emailService, 'sendNotificationEmail', async () => {});

  const result = await request('/101/cancel', { method: 'POST' });

  // Assert: the assignment lookup ran, but with no rows no notification insert was attempted (no empty/phantom notice).
  assert.equal(result.status, 200);
  assert.equal(tx.find('FROM event_technical_support_assignments').length, 1);
  assert.equal(tx.find('INSERT INTO notifications').length, 0);
});
