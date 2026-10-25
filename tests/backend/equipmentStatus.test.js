// File: Tests Event Coordinator Tracks Equipment Request Status through real routes with the database mocked.
// Test scope: Real routes, auth/role middleware, controllers, rules and services; pool.query, the transaction client and
// email are replaced. AC1 statuses on the event; AC2 the coordinator is notified of status changes; AC3 affected items.
const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('../../backend/node_modules/jsonwebtoken');
process.env.JWT_SECRET = 'equipment-status-test-secret';
process.env.NODE_ENV = 'test';
const { pool } = require('../../backend/src/config/db');
const emailService = require('../../backend/src/services/emailService');
const app = require('../../backend/src/index');
let server, base;

const coordinator = { id: 30, email: 'chris@example.com', role: 'event_coordinator', auth_version: 0 };
const support = { id: 41, email: 'taylor@example.com', role: 'technical_support', auth_version: 0 };
const organiser = { id: 12, email: 'olivia@example.com', role: 'event_organiser', auth_version: 0 };
// Event 101 at request version 2: 4 microphones and on-site support, coordinated by user 30.
const request101 = { id: 101, name: 'Gala', organiser_id: 12, coordinator_id: 30, equipment_requirements_version: 2,
  equipment_items: [{ item: 'Microphone', quantity: 4 }], technical_support_required: true, video_conferencing_required: false,
  technical_specifications: null, equipment_notes: null };

// Signs a test-only JWT for the supplied user.
function token(user) { return jwt.sign({ sub: user.id, email: user.email, authVersion: 0 }, process.env.JWT_SECRET); }
// Calls the local test HTTP server and returns status plus JSON.
async function request(path, { user = coordinator, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(user)}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
}
/** Mocks the non-transactional reads: authentication, the coordinator-scoped request and its reviews. */
function mockReads({ user = coordinator, found = request101, reviews = [] } = {}) {
  const queries = [];
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('FROM users WHERE')) return { rows: [user] };
    queries.push({ sql, values });
    if (sql.includes('WHERE e.id = $1 AND e.coordinator_id = $2')) return { rows: found ? [found] : [] };
    if (sql.includes('FROM event_equipment_reviews r LEFT JOIN users reviewer')) return { rows: reviews };
    throw new Error(`Unexpected query: ${sql}`);
  });
  return queries;
}
/**
 * Mocks the review/resubmission transaction and records each statement in order. `locked` is the request as locked
 * (with `reviewed`), `reviewRows` the review CTE result, `updated` the organiser's guarded UPDATE result.
 */
function mockTransaction({ locked = { ...request101, reviewed: false }, reviewRows, updated = { ...request101, equipment_requirements_version: 3 }, failNotifications = false } = {}) {
  const statements = [];
  mock.method(pool, 'connect', async () => ({
    release() {},
    async query(sql, values) {
      statements.push({ sql: sql.trim(), values });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql.trim())) return { rows: [] };
      if (sql.includes('FOR UPDATE OF e')) return { rows: locked ? [locked] : [] };
      if (sql.includes('INSERT INTO event_equipment_reviews')) return { rows: reviewRows };
      // Safety-check readiness (parent notification system): no decision context here, so the event is not ready.
      if (sql.includes('AS pending_clarifications')) return { rows: [] };
      if (sql.includes('UPDATE events SET equipment_items')) return { rows: updated ? [updated] : [] };
      if (sql.includes('INSERT INTO notifications')) {
        if (failNotifications) throw new Error('database unavailable');
        return { rows: values[0].map((userId, index) => ({ id: index + 1, user_id: userId, title: values[4][index], message: values[5][index], email: `user${userId}@example.com` })) };
      }
      throw new Error(`Unexpected transaction statement: ${sql}`);
    },
  }));
  return {
    statements, find: (text) => statements.filter((statement) => statement.sql.includes(text)),
    words: () => statements.map((statement) => statement.sql).filter((sql) => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)),
  };
}
// Technical Support authenticates through pool.query; everything else happens in the transaction.
const authAs = (user) => mock.method(pool, 'query', async (sql) => {
  if (sql.includes('FROM users WHERE')) return { rows: [user] };
  throw new Error(`Unexpected pool query: ${sql}`);
});
const review = (body) => request('/api/events/101/equipment-reviews', { method: 'POST', body: { requestVersion: 2, ...body }, user: support });
const storedReview = (outcome, reason = null) => [{ id: 9, event_id: 101, request_version: 2, outcome, reason, reviewed_by: 41, reviewed_at: '2030-01-02T03:00:00.000Z' }];

before(async () => {
  await new Promise((resolve, reject) => { server = app.listen(0, '127.0.0.1', resolve); server.on('error', reject); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() => mock.restoreAll());
after(async () => { if (server?.listening) await new Promise((resolve) => server.close(resolve)); await pool.end(); });

// ---------- AC1/AC3: the coordinator's status view ----------

// Test case: A partial review of the current version: overall status, each item's status, affected quantity, earlier reviews.
test('ES AC1/AC3 - the assigned coordinator sees the request status, each item\'s status and the affected items', async () => {
  // Arrange: version 2 was partially fulfillable (2 of 4 microphones); version 1 had been fully fulfillable.
  const queries = mockReads({ reviews: [
    { request_version: 2, outcome: 'partially_fulfillable', reason: 'Two microphones are under repair.', affected_items: [{ key: 'equipment:0', availableQuantity: 2 }], reviewed_at: '2030-01-02T03:00:00.000Z', reviewed_by_name: 'Taylor' },
    { request_version: 1, outcome: 'fully_fulfillable', reason: null, affected_items: [], reviewed_at: '2030-01-01T03:00:00.000Z', reviewed_by_name: 'Taylor' },
  ] });
  // Act
  const result = await request('/api/events/101/equipment-status');
  // Assert
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    status: 'partially_available', version: 2,
    review: { outcome: 'partially_fulfillable', reason: 'Two microphones are under repair.', reviewedAt: '2030-01-02T03:00:00.000Z', reviewedBy: 'Taylor' },
    items: [
      { key: 'equipment:0', label: 'Microphone', quantity: 4, status: 'affected', availableQuantity: 2 },
      { key: 'technical_support', label: 'On-site technical support', quantity: null, status: 'available', availableQuantity: null },
    ],
    history: [{ version: 1, status: 'confirmed', outcome: 'fully_fulfillable', reason: null, reviewedAt: '2030-01-01T03:00:00.000Z', reviewedBy: 'Taylor', affectedCount: 0 }],
  });
  assert.deepEqual(queries[0].values, [101, 30]);
});
// Test case: Reviews of earlier versions do not count for the current one, which is pending.
test('ES AC1 - a request whose current version has not been reviewed is pending', async () => {
  mockReads({ reviews: [{ request_version: 1, outcome: 'not_fulfillable', reason: 'No stock', affected_items: [], reviewed_at: '2030-01-01T03:00:00.000Z', reviewed_by_name: 'Taylor' }] });
  const result = await request('/api/events/101/equipment-status');
  assert.deepEqual([result.body.status, result.body.review, result.body.items.map((item) => item.status)], ['pending', null, ['pending', 'pending']]);
  assert.deepEqual(result.body.history.map((entry) => entry.status), ['unavailable']);
});
// Test case: An event that asked for nothing technical says so.
test('ES AC1 - an event without technical needs reports that no equipment was requested', async () => {
  mockReads({ found: { ...request101, equipment_items: [], technical_support_required: false } });
  const result = await request('/api/events/101/equipment-status');
  assert.deepEqual([result.body.status, result.body.items], ['not_requested', []]);
});
// Access: only the assigned coordinator.
test('ES AC1 - a coordinator not assigned to the event gets "not found"', async () => {
  const queries = mockReads({ found: null });
  assert.equal((await request('/api/events/101/equipment-status')).status, 404);
  assert.equal(queries.some((query) => query.sql.includes('event_equipment_reviews')), false);
});
for (const role of ['event_organiser', 'event_coordinator_lead', 'technical_support', 'venue_staff', 'safety_officer', 'attendee']) {
  test(`ES AC1 - a ${role} cannot open the coordinator's equipment status`, async () => {
    const user = { id: 70, email: `${role}@example.com`, role, auth_version: 0 };
    const queries = mockReads({ user });
    assert.equal((await request('/api/events/101/equipment-status', { user })).status, 403);
    assert.equal(queries.length, 0);
  });
}
test('ES AC1 - an invalid event id is refused', async () => {
  mockReads();
  assert.equal((await request('/api/events/0/equipment-status')).status, 400);
});

// ---------- AC2/AC3: reviews notify the coordinator ----------

// Each outcome stores the review and tells the coordinator the new status in the same transaction.
for (const [outcome, body, status, lines] of [
  ['fully_fulfillable', {}, 'confirmed', []],
  ['partially_fulfillable', { reason: 'Two microphones are under repair.', affectedItems: [{ key: 'equipment:0', availableQuantity: 2 }] }, 'partially available',
    ['Affected items: Microphone × 4 (2 available).', 'Reason: Two microphones are under repair.']],
  ['not_fulfillable', { reason: 'No technician that day.' }, 'unavailable', ['Reason: No technician that day.']],
]) {
  test(`ES AC2/AC3 - a ${outcome} review notifies the coordinator that the request is ${status}`, async () => {
    // Arrange
    authAs(support);
    const tx = mockTransaction({ reviewRows: storedReview(outcome, body.reason ?? null) });
    const sent = [];
    mock.method(emailService, 'sendNotificationEmail', async (to, title) => { sent.push([to, title]); });
    // Act
    const result = await review({ outcome, ...body });
    // Assert: review stored with its affected items, notification inserted before commit, then emailed.
    assert.equal(result.status, 201);
    assert.equal(result.body.message, 'Review saved. The Event Coordinator has been notified.');
    assert.equal(tx.find('INSERT INTO event_equipment_reviews')[0].values[5], JSON.stringify(body.affectedItems || []));
    const [userIds, , , types, titles, messages] = tx.find('INSERT INTO notifications')[0].values;
    assert.deepEqual([userIds, types, titles], [[30], ['equipment_status_changed'], [`Equipment request ${status}: Gala`]]);
    assert.equal(messages[0], [`The equipment request for Gala is now ${status}.`, ...lines].join('\n'));
    assert.deepEqual(tx.words(), ['BEGIN', 'COMMIT']);
    assert.deepEqual(sent, [['user30@example.com', `Equipment request ${status}: Gala`]]);
  });
}
// Test case: Without an assigned coordinator the review is stored with nobody to notify.
test('ES AC2 - a review of an unassigned event is saved without a notification', async () => {
  authAs(support);
  const tx = mockTransaction({ locked: { ...request101, coordinator_id: null, reviewed: false }, reviewRows: storedReview('fully_fulfillable') });
  const result = await review({ outcome: 'fully_fulfillable' });
  assert.deepEqual([result.status, result.body.message], [201, 'Review saved.']);
  assert.equal(tx.find('INSERT INTO notifications').length, 0);
});
// Test case: A notification failure rolls the review back, so the status never changes silently.
test('ES AC2 - if the notification cannot be stored the review is rolled back', async () => {
  authAs(support);
  mock.method(console, 'error', () => {});
  const tx = mockTransaction({ reviewRows: storedReview('fully_fulfillable'), failNotifications: true });
  assert.equal((await review({ outcome: 'fully_fulfillable' })).status, 500);
  assert.deepEqual(tx.words(), ['BEGIN', 'ROLLBACK']);
});
// AC3: affected items are required on a partial review, validated against this version, and refused otherwise.
for (const [label, body, message, startsTransaction] of [
  ['a partial review without affected items', { outcome: 'partially_fulfillable', reason: 'Short' }, 'Choose which requested items cannot be fully provided.', true],
  ['a partial review naming an item that was not requested', { outcome: 'partially_fulfillable', reason: 'Short', affectedItems: [{ key: 'video_conferencing' }] },
    'Choose each affected item once from the requested items.', true],
  ['affected items on a full review', { outcome: 'fully_fulfillable', affectedItems: [{ key: 'equipment:0' }] }, 'Affected items can only be chosen for a partially fulfillable request.', false],
  ['affected items on an unavailable review', { outcome: 'not_fulfillable', reason: 'None', affectedItems: [] }, 'Affected items can only be chosen for a partially fulfillable request.', false],
]) {
  test(`ES AC3 - ${label} is refused and nothing is stored`, async () => {
    authAs(support);
    const tx = mockTransaction({ reviewRows: storedReview('partially_fulfillable') });
    const result = await review(body);
    assert.deepEqual([result.status, result.body.message], [400, message]);
    assert.equal(tx.find('INSERT').length, 0);
    assert.deepEqual(tx.words(), startsTransaction ? ['BEGIN', 'ROLLBACK'] : []);
  });
}
// Test case: A review for an event that no longer exists is refused like any request that left the queue.
test('ES AC2 - a review of a missing event is refused without writing or notifying', async () => {
  authAs(support);
  const tx = mockTransaction({ locked: null, reviewRows: storedReview('fully_fulfillable') });
  assert.equal((await review({ outcome: 'fully_fulfillable' })).status, 409);
  assert.equal(tx.find('INSERT').length, 0);
});
// Test case: A review against an outdated version is refused before writing (the request changed meanwhile).
test('ES AC2 - a review of an outdated request version is refused without writing', async () => {
  authAs(support);
  const tx = mockTransaction({ reviewRows: storedReview('fully_fulfillable') });
  const result = await review({ outcome: 'fully_fulfillable', requestVersion: 1 });
  assert.equal(result.status, 409);
  assert.equal(tx.find('INSERT').length, 0);
});

// ---------- AC2: an organiser's edit sends a reviewed request back to pending ----------

// Organiser edits go through the existing event read, then the transaction.
const organiserEdit = () => request('/api/events/101/equipment', { method: 'PUT', user: organiser, body: { equipmentItems: [{ item: 'Microphone', quantity: 2 }] } });
const mockOrganiserRead = () => mock.method(pool, 'query', async (sql) => {
  if (sql.includes('FROM users WHERE')) return { rows: [organiser] };
  if (sql.includes('JOIN users organiser')) return { rows: [{ ...request101, equipment_confirmed: false }] };
  throw new Error(`Unexpected pool query: ${sql}`);
});
test('ES AC2 - editing a reviewed request notifies the coordinator that it is pending again', async () => {
  mockOrganiserRead();
  const tx = mockTransaction({ locked: { ...request101, reviewed: true } });
  mock.method(emailService, 'sendNotificationEmail', async () => {});
  assert.equal((await organiserEdit()).status, 200);
  const [userIds, , , , titles, messages] = tx.find('INSERT INTO notifications')[0].values;
  assert.deepEqual([userIds, titles], [[30], ['Equipment request pending: Gala']]);
  assert.equal(messages[0], 'The equipment request for Gala is now pending.\nThe organiser changed the requirements, so Technical Support will review them again.');
  assert.ok(tx.statements.indexOf(tx.find('UPDATE events SET equipment_items')[0]) < tx.statements.indexOf(tx.find('INSERT INTO notifications')[0]));
});
test('ES AC2 - editing a request that was never reviewed sends no notification (it was already pending)', async () => {
  mockOrganiserRead();
  const tx = mockTransaction({ locked: { ...request101, reviewed: false } });
  assert.equal((await organiserEdit()).status, 200);
  assert.equal(tx.find('INSERT INTO notifications').length, 0);
});
test('ES AC2 - an edit overtaken by a confirmation is refused and nothing is notified', async () => {
  mockOrganiserRead();
  const tx = mockTransaction({ locked: { ...request101, reviewed: true }, updated: null });
  assert.equal((await organiserEdit()).status, 409);
  assert.equal(tx.find('INSERT INTO notifications').length, 0);
});
