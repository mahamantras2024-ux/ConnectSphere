// File: Tests the Event Coordinator Approves/Rejects Event story through the real API with mocked database and email boundaries.
// Test scope: Real routes, auth/role middleware, controllers, rules and services; pool.query, the transaction client and Gmail are replaced.
// AC1 decide after arrangements + safety check; AC2 failed safety blocks approval; AC3 rejection reason; AC4 status updated;
// AC5 outcome retained; AC6 organiser notified and can view it; AC7 outstanding clarification blocks decisions.
const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('../../backend/node_modules/jsonwebtoken');
process.env.JWT_SECRET = 'event-decision-tests-secret';
process.env.NODE_ENV = 'test';
const { pool } = require('../../backend/src/config/db');
const emailService = require('../../backend/src/services/emailService');
const nodemailer = require('../../backend/node_modules/nodemailer');
const app = require('../../backend/src/index');
let server, base;

const organiser = { id: 12, email: 'olivia@example.com', role: 'event_organiser', auth_version: 0 };
const coordinator = { id: 30, email: 'chris@example.com', role: 'event_coordinator', auth_version: 0 };
const safetyOfficer = { id: 50, email: 'sam@example.com', role: 'safety_officer', auth_version: 0 };
// Decision context of event 101 with every requirement met (confirmed venue, nothing technical, passed safety check).
const readyContext = {
  id: 101, name: 'Workshop', organiser_id: 12, coordinator_id: 30, status: 'submitted', is_draft: false,
  equipment_items: [], technical_support_required: false, video_conferencing_required: false, equipment_notes: null,
  equipment_confirmed_at: null, decision_reason: null, decided_at: null, decided_by_name: null, pending_clarifications: 0,
  bookings: [{ status: 'approved', hold_expires_at: null }],
  latest_safety_check: { outcome: 'approved', notes: null, checked_at: '2030-01-01T00:00:00Z', safety_officer_name: 'Sam' },
};

// Signs a test-only JWT for the supplied user and current session version.
function token(user) { return jwt.sign({ sub: user.id, role: user.role, email: user.email, authVersion: 0 }, process.env.JWT_SECRET); }
// Calls the local test HTTP server and returns status plus JSON.
async function request(path, { user = coordinator, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(user)}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
}
// Mocks non-transactional reads: authentication, the scoped event-detail access check and the decision context.
function mockReads({ user = coordinator, accessible = true, context = readyContext } = {}) {
  const queries = [];
  mock.method(pool, 'query', async (sql, values) => {
    queries.push({ sql, values });
    if (sql.includes('FROM users WHERE')) return { rows: [user] };
    if (sql.includes('JOIN users organiser ON organiser.id = e.organiser_id')) return { rows: accessible ? [{ id: 101 }] : [] };
    if (sql.includes('AS pending_clarifications')) return { rows: [context] };
    throw new Error(`Unexpected query: ${sql}`);
  });
  return queries;
}
/**
 * Mocks the decision/safety transaction. Every statement is recorded so tests can check what was written and in which
 * order; `context` is the locked event (null = not found / not assigned); `failNotifications` simulates a database error.
 */
function mockTransaction({ context = readyContext, failNotifications = false } = {}) {
  const statements = [];
  const client = {
    released: false,
    release() { this.released = true; },
    async query(sql, values) {
      statements.push({ sql: sql.trim(), values });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql.trim())) return { rows: [] };
      if (sql.includes('AS pending_clarifications')) return { rows: context ? [context] : [] };
      if (sql.includes('UPDATE events SET status')) {
        return { rows: [{ id: values[0], name: context.name, status: values[1], organiser_id: context.organiser_id, decision_reason: values[2], decided_at: '2030-01-02T03:04:05.000Z' }] };
      }
      if (sql.includes('INSERT INTO event_safety_checks')) return { rows: [{ id: 9, event_id: values[0], outcome: values[2], notes: values[3] }] };
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
// Authentication only (decision/safety writes use the transaction client).
function mockAuth(user = coordinator) {
  mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM users WHERE')) return { rows: [user] };
    throw new Error(`Unexpected pool query outside the transaction: ${sql}`);
  });
}
const decide = (body, id = 101, user = coordinator) => request(`/api/events/${id}/decision`, { method: 'POST', body, user });
const recordCheck = (body, id = 101) => request(`/api/events/${id}/safety-checks`, { method: 'POST', body, user: safetyOfficer });
const transactionWords = (tx) => tx.statements.map((statement) => statement.sql).filter((sql) => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql));

before(async () => {
  await new Promise((resolve, reject) => { server = app.listen(0, '127.0.0.1', resolve); server.on('error', reject); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() => mock.restoreAll());
after(async () => { if (server?.listening) await new Promise((resolve) => server.close(resolve)); await pool.end(); });

// ---------- Viewing the review (AC1, AC5, AC6) ----------

// Test case: The organiser views a rejected request: outcome, reason, decider and time - and nothing internal.
test('AR AC5/AC6 - the organiser can view the retained outcome and reason, but not internal readiness or safety notes', async () => {
  // Arrange
  const queries = mockReads({ user: organiser, context: { ...readyContext, status: 'rejected', decision_reason: 'Hall unavailable', decided_at: '2030-01-02T03:04:05.000Z', decided_by_name: 'Chris',
    latest_safety_check: { outcome: 'rejected', notes: 'Fire exit blocked', safety_officer_name: 'Sam' } } });
  // Act
  const result = await request('/api/events/101/decision', { user: organiser });
  // Assert: exactly the public view; access was checked with the organiser's own scoped read.
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { status: 'rejected', outcome: { decision: 'rejected', reason: 'Hall unavailable', decidedAt: '2030-01-02T03:04:05.000Z', decidedBy: 'Chris' } });
  assert.deepEqual(queries.find((query) => query.sql.includes('JOIN users organiser')).values, ['101', 12]);
});

// Test case: Before a decision, the organiser sees that the outcome is pending.
test('AR AC6 - the organiser sees no outcome while the decision is pending', async () => {
  mockReads({ user: organiser });
  assert.deepEqual((await request('/api/events/101/decision', { user: organiser })).body, { status: 'submitted', outcome: null });
});

// Test case: The assigned coordinator sees every requirement, which decisions are allowed and why approval is blocked.
test('AR AC1 - the coordinator sees readiness, allowed decisions and the latest safety check', async () => {
  const pendingSafety = { ...readyContext, latest_safety_check: null };
  mockReads({ context: pendingSafety });
  const result = await request('/api/events/101/decision');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.readiness.map((item) => [item.name, item.met]),
    [['clarificationsResolved', true], ['venueConfirmed', true], ['technicalConfirmed', true], ['safetyPassed', false]]);
  assert.deepEqual(result.body.allowed, { approved: false, rejected: true });
  assert.equal(result.body.blocked.approved.code, 'SAFETY_NOT_COMPLETED');
  assert.equal(result.body.blocked.rejected, null);
  assert.equal(result.body.safetyCheck, null);
});

// Test case: An event outside the user's ownership/assignment is reported missing without reading its decision data.
test('AR AC6 - users cannot view the review of an event they do not own or coordinate', async () => {
  const queries = mockReads({ user: organiser, accessible: false });
  assert.equal((await request('/api/events/101/decision', { user: organiser })).status, 404);
  assert.equal(queries.some((query) => query.sql.includes('AS pending_clarifications')), false);
});

// ---------- Deciding (AC1-AC7) ----------

// Test case: All requirements met; approving updates the status, records who decided, and notifies the organiser in the same commit.
test('AR AC1/AC4/AC5/AC6 - approving records the decision on the event and notifies the organiser', async () => {
  // Arrange
  mockAuth();
  const tx = mockTransaction();
  const send = mock.method(emailService, 'sendNotificationEmail', async () => {});
  // Act
  const result = await decide({ decision: 'approved' });
  // Assert: response
  assert.equal(result.status, 200);
  assert.equal(result.body.message, 'Event approved. The organiser has been notified.');
  assert.deepEqual(result.body.outcome, { decision: 'approved', reason: null, decidedAt: '2030-01-02T03:04:05.000Z' });
  // Assert: the event is locked for this coordinator, then updated with status, reason, decider.
  const lock = tx.find('AS pending_clarifications')[0];
  assert.match(lock.sql, /e\.coordinator_id = \$2 FOR UPDATE OF e/);
  assert.deepEqual(lock.values, [101, 30]);
  assert.deepEqual(tx.find('UPDATE events SET status')[0].values, [101, 'approved', null, 30]);
  // Assert: one organiser notification, committed with the decision, emailed after commit.
  const [userIds, eventIds, , types, titles, messages] = tx.find('INSERT INTO notifications')[0].values;
  assert.deepEqual([userIds, eventIds, types, titles], [[12], [101], ['event_approved'], ['Event approved: Workshop']]);
  assert.equal(messages[0], 'Your event request Workshop has been approved by the Event Coordinator and can proceed.');
  assert.deepEqual(transactionWords(tx), ['BEGIN', 'COMMIT']);
  assert.deepEqual(send.mock.calls.map((call) => call.arguments[0]), ['user12@example.com']);
  assert.equal(tx.client.released, true);
});

// Test case: Agreed rule - the coordinator can reject when arrangements are not confirmed, with a reason the organiser receives.
test('AR AC3/AC4/AC6 - rejecting with unconfirmed arrangements stores the trimmed reason and tells the organiser why', async () => {
  mockAuth();
  const tx = mockTransaction({ context: { ...readyContext, bookings: [], latest_safety_check: null } });
  mock.method(emailService, 'sendNotificationEmail', async () => {});
  const result = await decide({ decision: 'rejected', reason: '  The venue could not be secured.  ' });
  assert.equal(result.status, 200);
  assert.equal(result.body.message, 'Event rejected. The organiser has been notified.');
  assert.deepEqual(tx.find('UPDATE events SET status')[0].values, [101, 'rejected', 'The venue could not be secured.', 30]);
  const [, , , types, titles, messages] = tx.find('INSERT INTO notifications')[0].values;
  assert.deepEqual([types, titles], [['event_rejected'], ['Event request not approved: Workshop']]);
  assert.equal(messages[0], 'Your event request Workshop was not approved by the Event Coordinator.\nReason: The venue could not be secured.');
});

// Test case: A rejection without a reason is allowed (AC3 "can provide") and the message omits the reason line.
test('AR AC3 - a rejection without a reason is accepted and the notification has no reason line', async () => {
  mockAuth();
  const tx = mockTransaction();
  mock.method(emailService, 'sendNotificationEmail', async () => {});
  assert.equal((await decide({ decision: 'rejected' })).status, 200);
  assert.equal(tx.find('UPDATE events SET status')[0].values[2], null);
  assert.equal(tx.find('INSERT INTO notifications')[0].values[5][0], 'Your event request Workshop was not approved by the Event Coordinator.');
});

// AC1/AC2: each single unmet requirement blocks approval with its own reason, writes nothing and rolls back.
for (const [label, changes, code] of [
  ['no confirmed venue', { bookings: [] }, 'VENUE_NOT_CONFIRMED'],
  ['a second venue still on hold', { bookings: [{ status: 'approved' }, { status: 'pending', hold_expires_at: '2999-01-01T00:00:00Z' }] }, 'VENUE_PENDING'],
  ['unconfirmed technical support', { technical_support_required: true }, 'TECHNICAL_NOT_CONFIRMED'],
  ['no safety check yet', { latest_safety_check: null }, 'SAFETY_NOT_COMPLETED'],
  ['a failed safety check', { latest_safety_check: { outcome: 'rejected' } }, 'SAFETY_FAILED'],
  ['safety changes requested', { latest_safety_check: { outcome: 'changes_requested' } }, 'SAFETY_CHANGES_REQUESTED'],
]) {
  // Test case: Approves with one requirement unmet and checks the refusal, the reason code and that nothing is written.
  test(`AR AC1/AC2 - approval is refused with ${label}`, async () => {
    mockAuth();
    const tx = mockTransaction({ context: { ...readyContext, ...changes } });
    const result = await decide({ decision: 'approved' });
    assert.equal(result.status, 409);
    assert.equal(result.body.code, code);
    assert.equal(tx.find('UPDATE events').length + tx.find('INSERT INTO notifications').length, 0);
    assert.deepEqual(transactionWords(tx), ['BEGIN', 'ROLLBACK']);
  });
}

// Test case: AC2 explicitly - a failed safety check blocks approval but the coordinator can still reject.
test('AR AC2 - after a failed safety check the event can be rejected', async () => {
  mockAuth();
  mockTransaction({ context: { ...readyContext, latest_safety_check: { outcome: 'rejected' } } });
  mock.method(emailService, 'sendNotificationEmail', async () => {});
  assert.equal((await decide({ decision: 'rejected', reason: 'Failed safety check' })).status, 200);
});

// Test case: AC7 - while a clarification is outstanding neither decision is possible.
test('AR AC7 - an outstanding clarification blocks both approval and rejection', async () => {
  for (const decision of ['approved', 'rejected']) {
    mockAuth();
    const tx = mockTransaction({ context: { ...readyContext, pending_clarifications: 1 } });
    const result = await decide({ decision });
    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'CLARIFICATION_OUTSTANDING');
    assert.equal(tx.find('UPDATE events').length, 0);
    mock.restoreAll();
  }
});

// AC4: a decided, draft or closed event cannot be decided again.
for (const [label, changes, code] of [['already approved', { status: 'approved' }, 'ALREADY_DECIDED'],
  ['already rejected', { status: 'rejected' }, 'ALREADY_DECIDED'], ['a draft', { status: 'draft', is_draft: true }, 'NOT_DECIDABLE']]) {
  // Test case: Tries to decide an event in a non-decidable state.
  test(`AR AC4 - an event that is ${label} cannot be decided`, async () => {
    mockAuth();
    mockTransaction({ context: { ...readyContext, ...changes } });
    const result = await decide({ decision: 'rejected' });
    assert.equal(result.status, 409);
    assert.equal(result.body.code, code);
  });
}

// Test case: Another coordinator's (or a reassigned) event is not found by the assignment-scoped lock; nothing changes.
test('AR AC1 - only the assigned coordinator can decide', async () => {
  mockAuth();
  const tx = mockTransaction({ context: null });
  const result = await decide({ decision: 'approved' }, 2147483647);
  assert.equal(result.status, 404);
  assert.deepEqual(tx.find('AS pending_clarifications')[0].values, [2147483647, 30]);
  assert.deepEqual(transactionWords(tx), ['BEGIN', 'ROLLBACK']);
});

// AC3 boundaries and input validation: refused before any transaction starts.
for (const [label, body, id, status] of [
  ['a 4000-character reason', { decision: 'rejected', reason: 'x'.repeat(4000) }, 101, 200],
  ['a 4001-character reason', { decision: 'rejected', reason: 'x'.repeat(4001) }, 101, 400],
  ['a numeric reason', { decision: 'rejected', reason: 42 }, 101, 400],
  ['a reason on an approval', { decision: 'approved', reason: 'Looks good' }, 101, 400],
  ['decision "approve"', { decision: 'approve' }, 101, 400], ['decision "Approved"', { decision: 'Approved' }, 101, 400],
  ['a missing decision', {}, 101, 400], ['event id 0', { decision: 'approved' }, '0', 400], ['event id -1', { decision: 'approved' }, '-1', 400],
  ['event id abc', { decision: 'approved' }, 'abc', 400], ['event id 2147483648', { decision: 'approved' }, '2147483648', 400],
]) {
  // Test case: Sends one boundary or malformed decision and checks it is accepted or refused before writing.
  test(`AR AC3 - ${label} is ${status === 200 ? 'accepted' : 'refused'}`, async () => {
    mockAuth();
    const tx = mockTransaction();
    mock.method(emailService, 'sendNotificationEmail', async () => {});
    const result = await decide(body, id);
    assert.equal(result.status, status);
    if (status === 200) assert.equal(tx.find('UPDATE events SET status')[0].values[2], 'x'.repeat(4000));
    else assert.equal(tx.statements.length, 0);
  });
}

// Test case: A whitespace-only reason is treated as no reason.
test('AR AC3 - a blank rejection reason is stored as no reason', async () => {
  mockAuth();
  const tx = mockTransaction();
  mock.method(emailService, 'sendNotificationEmail', async () => {});
  await decide({ decision: 'rejected', reason: '   ' });
  assert.equal(tx.find('UPDATE events SET status')[0].values[2], null);
});

// Test case: Gmail is down after commit; the decision and in-app notification stand.
test('AR AC6 - an email failure does not undo the decision', async () => {
  mockAuth();
  const tx = mockTransaction();
  mock.method(emailService, 'sendNotificationEmail', async () => { throw new Error('SMTP down'); });
  mock.method(console, 'error', () => {});
  assert.equal((await decide({ decision: 'approved' })).status, 200);
  assert.deepEqual(transactionWords(tx), ['BEGIN', 'COMMIT']);
});

// Test case: Storing the organiser notification fails; the decision rolls back so the status never changes silently.
test('AR AC4/AC6 - a failure while notifying rolls the decision back', async () => {
  mockAuth();
  const tx = mockTransaction({ failNotifications: true });
  const send = mock.method(emailService, 'sendNotificationEmail', async () => {});
  mock.method(console, 'error', () => {});
  assert.equal((await decide({ decision: 'approved' })).status, 500);
  assert.deepEqual(transactionWords(tx), ['BEGIN', 'ROLLBACK']);
  assert.equal(send.mock.callCount(), 0);
  assert.equal(tx.client.released, true);
});

// Only coordinators decide; only organisers, coordinators and the Lead may read a review; only Safety Officers record checks.
for (const [role, path, method, body] of [
  ['event_organiser', '/api/events/101/decision', 'POST', { decision: 'approved' }],
  ['event_coordinator_lead', '/api/events/101/decision', 'POST', { decision: 'approved' }],
  ['safety_officer', '/api/events/101/decision', 'POST', { decision: 'approved' }],
  ['venue_staff', '/api/events/101/decision', 'GET'], ['attendee', '/api/events/101/decision', 'GET'],
  ['event_coordinator', '/api/events/101/safety-checks', 'POST', { outcome: 'approved' }],
  ['event_coordinator', '/api/safety/checks', 'GET'],
]) {
  // Test case: Calls one endpoint with a role that must be refused before any data is read or written.
  test(`AR AC1 - ${role} cannot ${method} ${path}`, async () => {
    const user = { ...organiser, role };
    mock.method(pool, 'query', async () => ({ rows: [user] }));
    const connect = mock.method(pool, 'connect', async () => assert.fail('No transaction may start.'));
    assert.equal((await request(path, { user, method, body })).status, 403);
    assert.equal(connect.mock.callCount(), 0);
  });
}

// Test case: Reading a review with a malformed event id is refused.
test('AR AC6 - a malformed event id is refused when viewing a review', async () => {
  mockReads();
  assert.equal((await request('/api/events/abc/decision')).status, 400);
});

// ---------- Operational Safety Check (Week 7 change 6, prerequisite for AC1/AC2) ----------

// Test case: The queue shows only events whose venue and technical arrangements are confirmed, without internal fields.
test('AR AC1 - the safety queue lists only events whose venue and technical arrangements are confirmed', async () => {
  const candidate = (id, changes) => ({ id, name: `Event ${id}`, status: 'submitted', is_draft: false, equipment_items: [], technical_support_required: false,
    video_conferencing_required: false, equipment_notes: null, equipment_confirmed_at: null, bookings: [{ status: 'approved' }],
    venues: [{ name: 'Hall A', capacity: 100 }], latest_safety_check: null, ...changes });
  mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM users WHERE')) return { rows: [safetyOfficer] };
    // The query itself pre-filters to events with a confirmed venue (the rules module then applies the full prerequisite).
    assert.match(sql, /AND EXISTS \(SELECT 1 FROM venue_bookings vb WHERE vb\.event_id = e\.id AND vb\.status = 'approved'\)/);
    return { rows: [candidate(1, {}), candidate(2, { technical_support_required: true }),
      candidate(3, { bookings: [{ status: 'approved' }, { status: 'pending', hold_expires_at: '2999-01-01T00:00:00Z' }] }),
      candidate(4, { equipment_items: [{ item: 'Projector', quantity: 1 }], equipment_confirmed_at: '2030-01-01T00:00:00Z' })] };
  });
  const result = await request('/api/safety/checks', { user: safetyOfficer });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.events.map((event) => event.id), [1, 4]);
  // The facts the Safety Officer reviews are kept; internal gating fields are removed.
  const [first] = result.body.events;
  assert.deepEqual([first.name, first.venues, first.latest_safety_check], ['Event 1', [{ name: 'Hall A', capacity: 100 }], null]);
  for (const internal of ['bookings', 'status', 'is_draft', 'equipment_confirmed_at']) assert.equal(internal in first, false, `${internal} is not exposed`);
});

// Test case: Recording a passed check stores it and tells the assigned coordinator, in one commit.
test('AR AC1 - the Safety Officer records a passed check and the coordinator is notified', async () => {
  mockAuth(safetyOfficer);
  const tx = mockTransaction({ context: { ...readyContext, latest_safety_check: null } });
  mock.method(emailService, 'sendNotificationEmail', async () => {});
  const result = await recordCheck({ outcome: 'approved' });
  assert.equal(result.status, 201);
  assert.equal(result.body.message, 'Safety check recorded. The Event Coordinator has been notified.');
  assert.deepEqual(tx.find('INSERT INTO event_safety_checks')[0].values, [101, 50, 'approved', null]);
  assert.match(tx.find('AS pending_clarifications')[0].sql, /WHERE e\.id = \$1 FOR UPDATE OF e/);
  const [userIds, , , types, titles, messages] = tx.find('INSERT INTO notifications')[0].values;
  assert.deepEqual([userIds, types, titles], [[30], ['safety_check_recorded'], ['Safety check passed: Workshop']]);
  assert.equal(messages[0], 'The Safety Officer recorded the operational safety check for Workshop: passed.');
  assert.deepEqual(transactionWords(tx), ['BEGIN', 'COMMIT']);
});

// Test case: A failed check with notes is stored and the notes reach the coordinator.
test('AR AC2 - a failed safety check is recorded with its notes for the coordinator', async () => {
  mockAuth(safetyOfficer);
  const tx = mockTransaction({ context: { ...readyContext, latest_safety_check: null } });
  mock.method(emailService, 'sendNotificationEmail', async () => {});
  assert.equal((await recordCheck({ outcome: 'rejected', notes: '  Fire exit blocked  ' })).status, 201);
  assert.deepEqual(tx.find('INSERT INTO event_safety_checks')[0].values, [101, 50, 'rejected', 'Fire exit blocked']);
  assert.equal(tx.find('INSERT INTO notifications')[0].values[5][0], 'The Safety Officer recorded the operational safety check for Workshop: failed.\nNotes: Fire exit blocked');
});

// Test case: An event without a coordinator still gets its check; there is nobody to notify.
test('AR AC1 - a check on an unassigned event is recorded without a notification', async () => {
  mockAuth(safetyOfficer);
  const tx = mockTransaction({ context: { ...readyContext, coordinator_id: null } });
  const result = await recordCheck({ outcome: 'changes_requested', notes: 'Widen the aisles' });
  assert.equal(result.status, 201);
  assert.equal(result.body.message, 'Safety check recorded.');
  assert.equal(tx.find('INSERT INTO notifications').length, 0);
});

// The safety check needs confirmed arrangements and an undecided event; the event must exist.
for (const [label, context, status, code] of [
  ['before the venue is confirmed', { ...readyContext, bookings: [] }, 409, 'VENUE_NOT_CONFIRMED'],
  ['before technical arrangements are confirmed', { ...readyContext, equipment_notes: 'Two microphones' }, 409, 'TECHNICAL_NOT_CONFIRMED'],
  ['on an already decided event', { ...readyContext, status: 'approved' }, 409, 'NOT_REVIEWABLE'],
  ['on a missing event', null, 404, undefined],
]) {
  // Test case: Tries to record a check when the prerequisite is not met and checks nothing is written.
  test(`AR AC1 - a safety check ${label} is refused`, async () => {
    mockAuth(safetyOfficer);
    const tx = mockTransaction({ context });
    const result = await recordCheck({ outcome: 'approved' });
    assert.equal(result.status, status);
    assert.equal(result.body.code, code);
    assert.equal(tx.find('INSERT INTO event_safety_checks').length, 0);
    assert.deepEqual(transactionWords(tx), ['BEGIN', 'ROLLBACK']);
  });
}

// Safety-check input rules: notes explain a failure or change request; 4000 characters at most.
for (const [label, body, id, status] of [
  ['a rejection without notes', { outcome: 'rejected' }, 101, 400], ['a change request with blank notes', { outcome: 'changes_requested', notes: '   ' }, 101, 400],
  ['4001-character notes', { outcome: 'approved', notes: 'x'.repeat(4001) }, 101, 400], ['numeric notes', { outcome: 'approved', notes: 5 }, 101, 400],
  ['an unknown outcome', { outcome: 'passed' }, 101, 400], ['event id 0', { outcome: 'approved' }, '0', 400],
  ['4000-character notes on a rejection', { outcome: 'rejected', notes: 'x'.repeat(4000) }, 101, 201],
]) {
  // Test case: Sends one boundary or malformed safety check.
  test(`AR AC2 - a safety check with ${label} is ${status === 201 ? 'accepted' : 'refused'}`, async () => {
    mockAuth(safetyOfficer);
    const tx = mockTransaction({ context: { ...readyContext, coordinator_id: null } });
    const result = await recordCheck(body, id);
    assert.equal(result.status, status);
    assert.equal(tx.find('INSERT INTO event_safety_checks').length, status === 201 ? 1 : 0);
  });
}

// ---------- Notifications API used to tell the organiser the outcome (AC6) ----------

// Test case: The organiser lists their notifications; the query is scoped by the session user, never by query input.
test('AR AC6 - the organiser reads only their own notifications, with an unread count', async () => {
  const stored = [{ id: 4, type: 'event_approved', title: 'Event approved: Workshop', read_at: null }];
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('FROM users WHERE')) return { rows: [organiser] };
    assert.deepEqual(values, [12]);
    if (sql.includes('count(*)')) return { rows: [{ unread: 1 }] };
    assert.match(sql, /WHERE user_id=\$1 ORDER BY created_at DESC, id DESC LIMIT 50/);
    return { rows: stored };
  });
  const result = await request('/api/notifications?userId=30', { user: organiser });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { notifications: stored, unreadCount: 1 });
});

// Test case: Marking read only matches the user's own notification; another user's is reported missing; bad ids are refused.
test('AR AC6 - the organiser can mark only their own notification as read', async () => {
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('FROM users WHERE')) return { rows: [organiser] };
    assert.match(sql, /WHERE id=\$1 AND user_id=\$2/);
    return { rows: values[0] === 4 && values[1] === 12 ? [{ id: 4, read_at: '2030-01-02T00:00:00.000Z' }] : [] };
  });
  assert.equal((await request('/api/notifications/4/read', { user: organiser, method: 'POST' })).status, 200);
  assert.equal((await request('/api/notifications/5/read', { user: organiser, method: 'POST' })).status, 404);
  assert.equal((await request('/api/notifications/abc/read', { user: organiser, method: 'POST' })).status, 400);
});

// Test case: The organiser's outcome email goes from the configured Gmail sender with a link back to ConnectSphere, and the transport closes.
test('AR AC6 - decision emails use the configured sender and link back to the portal', async () => {
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
    await emailService.sendNotificationEmail('olivia@example.com', 'Event approved: Workshop', 'Your event request Workshop has been approved.');
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
  // Assert
  assert.deepEqual(sent, [{ from: 'Event Portal <sender@gmail.com>', to: 'olivia@example.com', subject: 'Event approved: Workshop',
    text: 'Your event request Workshop has been approved.\n\nOpen ConnectSphere to review: https://events.example.test/' }]);
  assert.equal(closed, true);
});
