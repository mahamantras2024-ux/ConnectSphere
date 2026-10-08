// File: Tests the Event Coordinator Review & Process Change Requests story through the real API with mocked database and email boundaries.
// Test scope: Real routes, auth/role middleware, controllers and services; pool.query, the pool's transaction client and Gmail are replaced.
// AC1 view requested changes; AC2 coordinator notified on submission; AC3 apply/reject and notify relevant personnel immediately.
const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('../../backend/node_modules/jsonwebtoken');
process.env.JWT_SECRET = 'change-review-tests-secret';
process.env.NODE_ENV = 'test';
const { pool } = require('../../backend/src/config/db');
const emailService = require('../../backend/src/services/emailService');
const nodemailer = require('../../backend/node_modules/nodemailer');
const app = require('../../backend/src/index');
let server, base;

const organiser = { id: 12, email: 'alice@example.com', full_name: 'Alice', role: 'event_organiser', auth_version: 0 };
const coordinator = { id: 30, email: 'chris@example.com', full_name: 'Chris', role: 'event_coordinator', auth_version: 0 };
// Event 101 as stored (to_jsonb form): confirmed 10:00-12:00 Singapore time with equipment needs.
const event = { id: 101, name: 'Workshop', organiser_id: 12, coordinator_id: 30, proposed_date: '2026-10-15',
  proposed_start_time: '10:00:00', proposed_end_time: '12:00:00', expected_attendance: 80, equipment_notes: 'Two microphones' };
const pendingRequest = { id: 501, event_id: 101, organiser_id: 12, coordinator_id: 30, status: 'pending',
  requested_changes: { expectedAttendance: 150, proposedEndTime: '12:30' }, event };
// Approved booking at a 100-seat venue, decided by Venue Staff member 41.
const booking = { id: 9, venue_id: 5, venue_name: 'Hall A', status: 'approved', decision_by: 41, capacity: 100,
  supported_layouts: ['Theatre'], setup_minutes: 30, turnaround_minutes: 45,
  start_datetime: '2030-10-15T02:00:00.000Z', end_datetime: '2030-10-15T04:00:00.000Z' };

// Signs a test-only JWT for the supplied user and current session version.
function token(user) { return jwt.sign({ sub: user.id, role: user.role, email: user.email, authVersion: user.auth_version }, process.env.JWT_SECRET); }
// Calls the local test HTTP server with the requested payload/session and returns status plus JSON.
async function request(path, { user = coordinator, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${token(user)}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
}
// Authentication reads the session user through pool.query; everything else for decisions goes through the transaction client.
function mockAuth(user = coordinator) {
  return mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM users WHERE')) return { rows: [user] };
    assert.fail(`Unexpected pool query outside the decision transaction: ${sql}`);
  });
}
/**
 * Mocks the decision transaction. Each SQL statement is recorded so tests can assert what was written and in which order.
 * Options model the database state: the locked request (or none), bookings, role members, and failures.
 */
// `updatedEvent` is the event row the database returns after applying the approved changes (literal per scenario).
function mockTransaction({ lockedRequest = pendingRequest, bookings = [booking], roleMembers = { venue_staff: [41, 42], technical_support: [61] },
  failNotifications = false, updatedEvent = { ...event, expected_attendance: 150, proposed_end_time: '12:30:00' } } = {}) {
  const statements = [];
  const client = {
    released: false,
    release() { this.released = true; },
    async query(sql, values) {
      statements.push({ sql: sql.trim(), values });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql.trim())) return { rows: [] };
      if (sql.includes('FROM event_change_requests r JOIN events e')) return { rows: lockedRequest ? [lockedRequest] : [] };
      if (sql.includes('UPDATE events SET')) return { rows: [{ event: updatedEvent }] };
      if (sql.includes('FROM venue_bookings vb JOIN venues')) return { rows: bookings };
      if (sql.includes('UNION ALL')) return { rows: [] };
      if (sql.includes('SELECT id FROM users')) return { rows: (roleMembers[values[0]] || []).map((id) => ({ id })) };
      if (sql.includes('UPDATE event_change_requests')) return { rows: [{ id: values[0], status: values[1], reviewed_by: values[2], decision_reason: values[3] }] };
      if (sql.includes('INSERT INTO notifications')) {
        if (failNotifications) throw new Error('database unavailable');
        return { rows: values[0].map((userId, index) => ({ id: index + 1, user_id: userId, title: values[4][index], message: values[5][index], email: `user${userId}@example.com` })) };
      }
      throw new Error(`Unexpected transaction statement: ${sql}`);
    },
  };
  mock.method(pool, 'connect', async () => client);
  return { statements, client, find: (text) => statements.filter((statement) => statement.sql.includes(text)) };
}
const decide = (body, id = 501, user = coordinator) => request(`/api/events/change-requests/${id}/decision`, { method: 'POST', body, user });

before(async () => {
  await new Promise((resolve, reject) => { server = app.listen(0, '127.0.0.1', resolve); server.on('error', reject); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() => mock.restoreAll());
after(async () => { if (server?.listening) await new Promise((resolve) => server.close(resolve)); await pool.end(); });

// ---------- AC1: view changes ----------

// Test case: Lists a pending request whose end time moves; the coordinator sees current vs requested values and the affected booking.
test('CR AC1 - the coordinator sees each changed field with its current and requested value, plus affected bookings', async () => {
  // Arrange: the listing query, then the event's bookings, then recorded periods at that venue.
  const queries = [];
  mock.method(pool, 'query', async (sql, values) => {
    queries.push({ sql, values });
    if (sql.includes('FROM users WHERE')) return { rows: [coordinator] };
    if (sql.includes('FROM event_change_requests r')) {
      // The inbox follows the event's current coordinator, so requests move with a Lead reassignment.
      assert.match(sql, /WHERE e\.coordinator_id=\$1 AND r\.status='pending'/);
      assert.doesNotMatch(sql, /r\.coordinator_id=\$1/);
      return { rows: [{ id: 501, event_id: 101, event_name: 'Workshop', organiser_id: 12, organiser_name: 'Alice', status: 'pending',
        requested_changes: { proposedEndTime: '12:30', name: 'Workshop' }, event_record: { ...event, proposed_date: '2030-10-15' } }] };
    }
    if (sql.includes('FROM venue_bookings vb JOIN venues')) return { rows: [booking] };
    if (sql.includes('UNION ALL')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  // Act
  const result = await request('/api/events/change-requests');
  // Assert: the unchanged name is omitted; the booking keeps its old time and is flagged for review.
  assert.equal(result.status, 200);
  const [listed] = result.body.changeRequests;
  assert.deepEqual(listed.changes, [{ field: 'proposedEndTime', label: 'End time', current: '12:00:00', requested: '12:30:00' }]);
  assert.equal(listed.event_record, undefined);
  assert.deepEqual(listed.arrangements.map((item) => [item.venueName, item.reasons.length]), [['Hall A', 1]]);
  assert.deepEqual(queries.find((query) => query.sql.includes('UNION ALL')).values, [[5]]);
});

// Only coordinators review change requests; organisers and other staff are refused before any data is read.
for (const role of ['event_organiser', 'attendee', 'venue_staff', 'technical_support', 'event_coordinator_lead']) {
  // Test case: Uses another role on both the list and the decision endpoint and checks both are forbidden.
  test(`CR AC1/AC3 - ${role} cannot list or decide change requests`, async () => {
    const user = { ...organiser, role };
    mock.method(pool, 'query', async () => ({ rows: [user] }));
    const connect = mock.method(pool, 'connect', async () => assert.fail('No transaction may start.'));
    assert.equal((await request('/api/events/change-requests', { user })).status, 403);
    assert.equal((await decide({ decision: 'approved' }, 501, user)).status, 403);
    assert.equal(connect.mock.callCount(), 0);
  });
}

// ---------- AC2: notified when a change request is made ----------

// Organiser submission fixture: event 101 with an approved venue, assigned to coordinator 30.
const submittedEvent = { ...event, venue_confirmed: true, expected_attendance: 40 };
// Mocks the organiser's submission path and returns the recorded INSERT so its notification payload can be checked.
function mockSubmission({ coordinatorId = 30 } = {}) {
  const inserts = [];
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('FROM users WHERE')) return { rows: [organiser] };
    // Checked before the event read because the insert also selects FROM events.
    if (sql.includes('INSERT INTO event_change_requests')) {
      inserts.push({ sql, values });
      return { rows: [{ id: 501, event_id: 101, coordinator_id: 30, status: 'pending', coordinator_email: 'chris@example.com' }] };
    }
    if (sql.includes('FROM events e')) return { rows: [{ ...submittedEvent, coordinator_id: coordinatorId }] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  return inserts;
}

// Test case: Submits a critical change; the request and the coordinator's notification are written in one statement and an email follows.
test('CR AC2 - submitting a change request notifies the assigned coordinator in the same write and by email', async () => {
  // Arrange
  const inserts = mockSubmission();
  const send = mock.method(emailService, 'sendNotificationEmail', async () => {});
  // Act
  const result = await request('/api/events/101/non-critical', { user: organiser, method: 'PUT', body: { expectedAttendance: 55 } });
  // Assert: one atomic statement holds both inserts; the notification targets the request's coordinator.
  assert.equal(result.status, 202);
  assert.equal(inserts.length, 1);
  assert.match(inserts[0].sql, /INSERT INTO event_change_requests[\s\S]*INSERT INTO notifications[\s\S]*SELECT cr\.coordinator_id/);
  assert.match(inserts[0].sql, /'change_request_submitted'/);
  const [, , , , title, message, details] = inserts[0].values;
  assert.equal(title, 'New change request: Workshop');
  assert.equal(message, 'The Event Organiser requested changes to Workshop.\nExpected attendance: 40 → 55');
  assert.deepEqual(JSON.parse(details).changes, [{ field: 'expectedAttendance', label: 'Expected attendance', current: 40, requested: 55 }]);
  assert.deepEqual(send.mock.calls.map((call) => call.arguments), [['chris@example.com', title, message]]);
  assert.equal(result.body.changeRequest.coordinator_email, undefined);
});

// Test case: Gmail is unavailable; the change request and in-app notification are already stored, so the organiser still gets 202.
test('CR AC2 - an email failure does not fail a submitted change request', async () => {
  mockSubmission();
  mock.method(emailService, 'sendNotificationEmail', async () => { throw new Error('SMTP down'); });
  const logged = mock.method(console, 'error', () => {});
  const result = await request('/api/events/101/non-critical', { user: organiser, method: 'PUT', body: { expectedAttendance: 55 } });
  assert.equal(result.status, 202);
  assert.deepEqual(logged.mock.calls.map((call) => call.arguments[0]), ['Notification email delivery failed for 1 of 1 recipients.']);
});

// Test case: No coordinator is assigned yet; there is nobody to notify, so nothing is written.
test('CR AC2 - without an assigned coordinator no request or notification is created', async () => {
  const inserts = mockSubmission({ coordinatorId: null });
  const result = await request('/api/events/101/non-critical', { user: organiser, method: 'PUT', body: { expectedAttendance: 55 } });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'COORDINATOR_NOT_ASSIGNED');
  assert.equal(inserts.length, 0);
});

// ---------- AC3: process the request and notify relevant personnel ----------

// Test case: Approves a request raising attendance to 150 at a 100-seat venue; the change is applied and every relevant person is notified at once.
test('CR AC3 - approving applies the exact changes and notifies the organiser, the booking decision-maker and Technical Support', async () => {
  // Arrange
  mockAuth();
  const tx = mockTransaction();
  const send = mock.method(emailService, 'sendNotificationEmail', async () => {});
  // Act
  const result = await decide({ decision: 'approved' });
  // Assert: response
  assert.equal(result.status, 200);
  assert.equal(result.body.message, 'Change approved and applied. Relevant staff have been notified.');
  assert.deepEqual(result.body.notified, { organiser: [12], venueStaff: [41], technicalSupport: [61] });
  assert.deepEqual(result.body.changes.map((change) => [change.field, change.current, change.requested]),
    [['proposedEndTime', '12:00:00', '12:30:00'], ['expectedAttendance', 80, 150]]);
  assert.deepEqual(result.body.arrangements[0].reasons.at(-1), '150 expected guests exceed the venue capacity of 100.');
  // Assert: writes - the event gets exactly the requested values; the request records the reviewer.
  assert.deepEqual(tx.find('UPDATE events SET')[0].values, [101, 150, '12:30']);
  assert.match(tx.find('FROM event_change_requests r JOIN events e')[0].sql, /WHERE r\.id=\$1 AND e\.coordinator_id=\$2[\s\S]*FOR UPDATE OF r, e/);
  // Decided by the event's current coordinator: a request inherited at reassignment is not tied to its original recipient.
  assert.doesNotMatch(tx.find('FROM event_change_requests r JOIN events e')[0].sql, /r\.coordinator_id=\$2/);
  assert.deepEqual(tx.find('UPDATE event_change_requests')[0].values, [501, 'approved', 30, null]);
  // Booking 9 has a decision-maker, so the all-Venue-Staff list is never needed.
  assert.deepEqual(tx.find('SELECT id FROM users').map((statement) => statement.values[0]), ['technical_support']);
  const [userIds, , , types, , messages] = tx.find('INSERT INTO notifications')[0].values;
  assert.deepEqual(userIds, [12, 41, 61]);
  assert.deepEqual(types, ['change_request_approved', 'event_details_changed', 'event_details_changed']);
  assert.match(messages[0], /were approved and applied\.\nEnd time: 12:00:00 → 12:30:00\nExpected attendance: 80 → 150/);
  assert.match(messages[1], /Hall A: .*150 expected guests exceed the venue capacity of 100\./);
  // Assert: notifications commit with the decision ("immediately"), and emails go out only afterwards.
  assert.deepEqual(tx.statements.map((statement) => statement.sql.split(/\s+/)[0]).filter((word) => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(word)), ['BEGIN', 'COMMIT']);
  assert.ok(tx.statements.findIndex((statement) => statement.sql.includes('INSERT INTO notifications')) < tx.statements.findIndex((statement) => statement.sql === 'COMMIT'));
  // Each stored notification is emailed to its own recipient (addresses come from the users join in the insert).
  assert.deepEqual(send.mock.calls.map((call) => call.arguments[0]), ['user12@example.com', 'user41@example.com', 'user61@example.com']);
  assert.equal(tx.client.released, true);
});

// Test case: Approves a rename with a note on an event without equipment needs or affected bookings; only the organiser is told.
test('CR AC3 - a change that affects no arrangements notifies only the organiser, including the coordinator note', async () => {
  // Arrange: no equipment notes and nothing booked, so no staff group is relevant and no role lists are read.
  mockAuth();
  const unequipped = { ...event, equipment_notes: null };
  const tx = mockTransaction({ lockedRequest: { ...pendingRequest, requested_changes: { name: 'Community Workshop' }, event: unequipped },
    bookings: [], updatedEvent: { ...unequipped, name: 'Community Workshop' } });
  mock.method(emailService, 'sendNotificationEmail', async () => {});
  // Act
  const result = await decide({ decision: 'approved', reason: 'Approved as discussed.' });
  // Assert
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.notified, { organiser: [12], venueStaff: [], technicalSupport: [] });
  assert.equal(tx.find('SELECT id FROM users').length, 0);
  const [userIds, , , , , messages] = tx.find('INSERT INTO notifications')[0].values;
  assert.deepEqual(userIds, [12]);
  assert.equal(messages[0], 'Your requested changes to Workshop were approved and applied.\nEvent name: Workshop → Community Workshop\nNote: Approved as discussed.');
});

// Test case: Sends a notification email through a captured Gmail transport; it uses the configured sender, links to the app and closes.
test('CR AC2/AC3 - notification emails go from the configured sender with a link back to ConnectSphere', async () => {
  // Arrange: private Gmail settings for this test only (restored afterwards).
  const saved = { GMAIL_USER: process.env.GMAIL_USER, GMAIL_APP_PASSWORD: process.env.GMAIL_APP_PASSWORD, PUBLIC_APP_URL: process.env.PUBLIC_APP_URL };
  Object.assign(process.env, { GMAIL_USER: 'sender@gmail.com', GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop', PUBLIC_APP_URL: 'https://events.example.test/app' });
  const sent = [];
  let closed = false;
  mock.method(nodemailer, 'createTransport', (config) => {
    assert.deepEqual([config.host, config.port, config.secure, config.auth.pass], ['smtp.gmail.com', 465, true, 'abcdefghijklmnop']);
    return { sendMail: async (message) => { sent.push(message); }, close: () => { closed = true; } };
  });
  try {
    // Act
    await emailService.sendNotificationEmail('chris@example.com', 'New change request: Workshop', 'Expected attendance: 80 → 150');
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
  // Assert
  assert.deepEqual(sent, [{ from: 'Event Portal <sender@gmail.com>', to: 'chris@example.com', subject: 'New change request: Workshop',
    text: 'Expected attendance: 80 → 150\n\nOpen ConnectSphere to review: https://events.example.test/' }]);
  assert.equal(closed, true);
});

// Test case: The only affected booking is still pending (no decision-maker), so every Venue Staff account is told.
test('CR AC3 - an affected pending booking notifies all Venue Staff', async () => {
  mockAuth();
  const hold = { ...booking, status: 'pending', decision_by: null, hold_expires_at: '2099-01-01T00:00:00.000Z' };
  mockTransaction({ bookings: [hold] });
  mock.method(emailService, 'sendNotificationEmail', async () => {});
  const result = await decide({ decision: 'approved' });
  assert.deepEqual(result.body.notified.venueStaff, [41, 42]);
});

// Test case: Rejects with a reason; the event is untouched, the reason is stored, and only the organiser is told.
test('CR AC3 - rejecting keeps the event unchanged, stores the reason and notifies the organiser', async () => {
  mockAuth();
  const tx = mockTransaction();
  mock.method(emailService, 'sendNotificationEmail', async () => {});
  const result = await decide({ decision: 'rejected', reason: '  Hall A cannot seat 150.  ' });
  assert.equal(result.status, 200);
  assert.equal(result.body.message, 'Change request rejected. The organiser has been notified.');
  assert.equal(tx.find('UPDATE events SET').length, 0);
  assert.equal(tx.find('FROM venue_bookings').length, 0);
  assert.deepEqual(tx.find('UPDATE event_change_requests')[0].values, [501, 'rejected', 30, 'Hall A cannot seat 150.']);
  const [userIds, , , types, , messages] = tx.find('INSERT INTO notifications')[0].values;
  assert.deepEqual([userIds, types], [[12], ['change_request_rejected']]);
  assert.equal(messages[0], 'Your requested changes to Workshop were not approved. The confirmed details remain in effect.\nReason: Hall A cannot seat 150.');
});

// Reasons are optional and at most 4000 characters; blank reasons are stored as no reason.
for (const [label, reason, status, stored] of [['4000 characters', 'x'.repeat(4000), 200, 'x'.repeat(4000)],
  ['4001 characters', 'x'.repeat(4001), 400], ['whitespace only', '   ', 200, null], ['a number', 123, 400]]) {
  // Test case: Rejects with a reason at the validation boundary and checks it is stored or refused before any transaction.
  test(`CR AC3 - a rejection reason of ${label} is ${status === 200 ? 'accepted' : 'refused'}`, async () => {
    mockAuth();
    const tx = mockTransaction();
    mock.method(emailService, 'sendNotificationEmail', async () => {});
    const result = await decide({ decision: 'rejected', reason });
    assert.equal(result.status, status);
    if (status === 200) assert.equal(tx.find('UPDATE event_change_requests')[0].values[3], stored);
    else assert.equal(tx.statements.length, 0);
  });
}

// Only the two exact decision values are accepted, and IDs must be positive 32-bit integers.
for (const [label, body, id] of [['decision "approve"', { decision: 'approve' }, 501], ['decision "Approved"', { decision: 'Approved' }, 501],
  ['a missing decision', {}, 501], ['id 0', { decision: 'approved' }, '0'], ['id -1', { decision: 'approved' }, '-1'],
  ['id abc', { decision: 'approved' }, 'abc'], ['id 2147483648', { decision: 'approved' }, '2147483648']]) {
  // Test case: Sends an invalid decision or request id and checks it is refused before any transaction starts.
  test(`CR AC3 - ${label} is refused`, async () => {
    mockAuth();
    const tx = mockTransaction();
    assert.equal((await decide(body, id)).status, 400);
    assert.equal(tx.statements.length, 0);
  });
}

// Test case: The request belongs to another coordinator or its event was reassigned; the lock finds nothing and nothing changes.
test('CR AC3 - a coordinator cannot process a request outside their current assignment', async () => {
  mockAuth();
  const tx = mockTransaction({ lockedRequest: null });
  const result = await decide({ decision: 'approved' }, 2147483647);
  assert.equal(result.status, 404);
  assert.deepEqual(tx.find('FROM event_change_requests r')[0].values, [2147483647, 30]);
  assert.equal(tx.find('UPDATE events SET').length + tx.find('UPDATE event_change_requests').length, 0);
  assert.equal(tx.statements.at(-1).sql, 'ROLLBACK');
});

// Test case: A second decision (e.g. a double click or another tab) finds the request already decided and changes nothing.
test('CR AC3 - an already decided request cannot be processed again', async () => {
  mockAuth();
  const tx = mockTransaction({ lockedRequest: { ...pendingRequest, status: 'approved' } });
  const result = await decide({ decision: 'rejected' });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'ALREADY_DECIDED');
  assert.equal(tx.find('INSERT INTO notifications').length, 0);
  assert.equal(tx.statements.at(-1).sql, 'ROLLBACK');
});

// Test case: The request contains a field this release cannot store; approval is refused instead of half-applying it.
test('CR AC3 - a request with changes this release cannot apply is not half-applied', async () => {
  mockAuth();
  const tx = mockTransaction({ lockedRequest: { ...pendingRequest, requested_changes: { expectedAttendance: 150, futureField: 'x' } } });
  const result = await decide({ decision: 'approved' });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'UNSUPPORTED_CHANGE');
  assert.match(result.body.message, /futureField/);
  assert.equal(tx.find('UPDATE events SET').length, 0);
});

// Test case: Storing notifications fails; the whole decision rolls back so no one is told about an unapplied change, and no email is sent.
test('CR AC3 - a failure while notifying rolls back the applied change', async () => {
  mockAuth();
  const tx = mockTransaction({ failNotifications: true });
  const send = mock.method(emailService, 'sendNotificationEmail', async () => {});
  mock.method(console, 'error', () => {});
  const result = await decide({ decision: 'approved' });
  assert.equal(result.status, 500);
  assert.equal(tx.statements.at(-1).sql, 'ROLLBACK');
  assert.equal(tx.find('COMMIT').length, 0);
  assert.equal(send.mock.callCount(), 0);
  assert.equal(tx.client.released, true);
});

// Test case: Gmail fails after commit; the decision and in-app notifications stand.
test('CR AC3 - an email failure after commit does not undo the decision', async () => {
  mockAuth();
  const tx = mockTransaction();
  mock.method(emailService, 'sendNotificationEmail', async () => { throw new Error('SMTP down'); });
  mock.method(console, 'error', () => {});
  const result = await decide({ decision: 'approved' });
  assert.equal(result.status, 200);
  assert.equal(tx.find('COMMIT').length, 1);
});

// ---------- Notifications API ----------

// Test case: Lists notifications; the query is scoped by the session user and returns the unread count.
test('CR AC2 - users read only their own notifications with an unread count', async () => {
  const stored = [{ id: 3, title: 'New change request: Workshop', read_at: null }];
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('FROM users WHERE')) return { rows: [coordinator] };
    assert.deepEqual(values, [30]);
    if (sql.includes('count(*)')) return { rows: [{ unread: 1 }] };
    assert.match(sql, /WHERE user_id=\$1 ORDER BY created_at DESC, id DESC LIMIT 50/);
    return { rows: stored };
  });
  const result = await request('/api/notifications?userId=12');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { notifications: stored, unreadCount: 1 });
});

// Test case: Marks notifications read; only the user's own one matches, another user's is reported missing, invalid ids are refused.
test('CR AC2 - users can mark only their own notifications as read', async () => {
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('FROM users WHERE')) return { rows: [coordinator] };
    assert.match(sql, /WHERE id=\$1 AND user_id=\$2/);
    return { rows: values[0] === 3 && values[1] === 30 ? [{ id: 3, read_at: '2026-10-07T00:00:00.000Z' }] : [] };
  });
  assert.equal((await request('/api/notifications/3/read', { method: 'POST' })).status, 200);
  assert.equal((await request('/api/notifications/4/read', { method: 'POST' })).status, 404);
  assert.equal((await request('/api/notifications/abc/read', { method: 'POST' })).status, 400);
  assert.equal((await request('/api/notifications', { user: null })).status, 401);
});

// ---------- Integration with the equipment story (changes after Technical Support confirmation) ----------

// Test case: An equipment change request is approved; the equipment columns are written exactly as requested.
test('CR AC3 - approving an equipment change request applies the new equipment requirements', async () => {
  mockAuth();
  const equipmentRequest = { ...pendingRequest, requested_changes: { equipmentItems: [{ item: 'Projector', quantity: 2 }],
    technicalSupportRequired: true, technicalSupportDetails: 'AV technician' } };
  const tx = mockTransaction({ lockedRequest: equipmentRequest, bookings: [] });
  mock.method(emailService, 'sendNotificationEmail', async () => {});
  const result = await decide({ decision: 'approved' });
  assert.equal(result.status, 200);
  const update = tx.find('UPDATE events SET')[0];
  assert.match(update.sql, /equipment_items=\$2::jsonb, technical_support_required=\$3, technical_support_details=\$4/);
  assert.deepEqual(update.values, [101, JSON.stringify([{ item: 'Projector', quantity: 2 }]), true, 'AV technician']);
});

// Test case: After confirmation an organiser's equipment edit becomes a change request; the coordinator is notified in the
// same statement (AC2) with readable before/after lines, emailed, and the address is not returned to the organiser.
test('CR AC2 - an equipment change request notifies the assigned coordinator', async () => {
  const inserts = [];
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('FROM users WHERE')) return { rows: [organiser] };
    if (sql.includes('INSERT INTO event_change_requests')) {
      inserts.push({ sql, values });
      return { rows: [{ id: 502, event_id: 101, coordinator_id: 30, status: 'pending', coordinator_email: 'chris@example.com' }] };
    }
    if (sql.includes('FROM events e')) return { rows: [{ ...event, equipment_confirmed: true, equipment_items: [{ item: 'Projector', quantity: 1 }],
      technical_support_required: false, technical_support_details: null, video_conferencing_required: false, technical_specifications: null }] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const send = mock.method(emailService, 'sendNotificationEmail', async () => {});
  const result = await request('/api/events/101/equipment', { user: organiser, method: 'PUT', body: { equipmentItems: [{ item: 'Projector', quantity: 2 }] } });
  assert.equal(result.status, 202);
  assert.equal(inserts.length, 1);
  assert.match(inserts[0].sql, /INSERT INTO event_change_requests[\s\S]*INSERT INTO notifications[\s\S]*'change_request_submitted'/);
  const [, , , , title, message] = inserts[0].values;
  assert.equal(title, 'New change request: Workshop');
  assert.equal(message, 'The Event Organiser requested equipment changes to Workshop.\nEquipment items: Projector × 1 → Projector × 2');
  assert.deepEqual(send.mock.calls.map((call) => call.arguments), [['chris@example.com', title, message]]);
  assert.equal(result.body.changeRequest.coordinator_email, undefined);
});
