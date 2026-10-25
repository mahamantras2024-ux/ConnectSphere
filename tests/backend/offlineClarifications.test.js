// File: Tests "Record Offline Clarifications and Apply Agreed Amendments" through the real API with the database and email
// boundaries replaced: offline clarification records (AC1), resolution with history kept (AC2), amendments the coordinator
// applies (AC3-AC5) and attendee deadline changes (AC6).
const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('../../backend/node_modules/jsonwebtoken');
process.env.JWT_SECRET = 'offline-clarifications-tests-secret';
process.env.NODE_ENV = 'test';
const { pool } = require('../../backend/src/config/db');
const emailService = require('../../backend/src/services/emailService');
const app = require('../../backend/src/index');
let server, base;

const organiser = { id: 12, email: 'olivia@example.com', role: 'event_organiser', auth_version: 0 };
const coordinator = { id: 30, email: 'chris@example.com', role: 'event_coordinator', auth_version: 0 };
const lead = { id: 40, email: 'lee@example.com', role: 'event_coordinator_lead', auth_version: 0 };
// A submitted event assigned to coordinator 30, starting 15 Oct 2030 18:00 Singapore time.
const event = { id: 101, organiser_id: 12, coordinator_id: 30, name: 'Gala', status: 'submitted', is_draft: false, proposed_date: '2030-10-15',
  proposed_start_time: '18:00:00', proposed_end_time: '20:00:00', expected_attendance: 60, description: 'Annual dinner', attachments: {},
  equipment_items: [], registration_deadline: null, withdrawal_deadline: '2030-10-14T10:00:00.000Z' };

/** Signs a test-only session for the user. */
function token(user) { return jwt.sign({ sub: user.id, email: user.email, authVersion: 0 }, process.env.JWT_SECRET); }
/** Calls the local test server and returns status plus JSON. */
async function call(path, { user = coordinator, method = 'POST', body } = {}) {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(user)}` },
    body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
}
/**
 * Mocks pool.query: the session user, the event read (or none), a clarification read (or none) and the clarification
 * writes, which echo their values. Every statement is recorded.
 */
function mockDatabase({ user = coordinator, current = event, clarification = null, resolved = 'echo' } = {}) {
  const statements = [];
  mock.method(pool, 'query', async (sql, values) => {
    statements.push({ sql, values });
    if (sql.includes('FROM users WHERE')) return { rows: [user] };
    if (sql.includes('INSERT INTO event_clarification_requests')) {
      return { rows: [{ id: 601, event_id: 101, source: 'offline', status: values[7] ? 'resolved' : 'responded', organiser_response: values[4],
        outcome: values[5], coordinator_comments: values[6], information_needed: JSON.parse(values[2]), message: values[3] }] };
    }
    if (sql.includes('UPDATE event_clarification_requests')) {
      return { rows: resolved === null ? [] : [{ ...clarification, status: 'resolved', outcome: values[3] ?? clarification.outcome, coordinator_comments: values[4] }] };
    }
    if (sql.includes('FROM event_clarification_requests cr JOIN events e')) return { rows: clarification ? [clarification] : [] };
    if (sql.includes('FROM events e')) return { rows: current ? [current] : [] };
    return { rows: [] };
  });
  return { statements, find: (text) => statements.filter((statement) => statement.sql.includes(text)) };
}

before(async () => {
  await new Promise((resolve, reject) => { server = app.listen(0, '127.0.0.1', resolve); server.on('error', reject); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() => mock.restoreAll());
after(async () => { if (server?.listening) await new Promise((done) => server.close(done)); await pool.end(); });

// ---------- AC1: record an offline clarification ----------

const offline = (body) => call('/api/events/101/clarifications/offline', { body: { informationNeeded: ['expected_attendance'],
  message: 'How many guests now?', response: 'About 90.', ...body } });

// Test case: The question, the organiser's answer, the outcome and comments are all recorded against the event.
test('OC AC1 - the assigned coordinator records an offline clarification with its answer, outcome and comments', async () => {
  // Arrange
  const db = mockDatabase();
  // Act
  const result = await offline({ outcome: '  Raise attendance to 90.  ', comments: 'Phone call with Olivia.' });
  // Assert: stored as an answered offline record for this coordinator's event (trimmed), not yet resolved.
  assert.equal(result.status, 201);
  assert.equal(result.body.message, 'Offline clarification recorded.');
  const [insert] = db.find('INSERT INTO event_clarification_requests');
  assert.deepEqual(insert.values, ['101', 30, '["expected_attendance"]', 'How many guests now?', 'About 90.', 'Raise attendance to 90.', 'Phone call with Olivia.', false]);
  assert.match(insert.sql, /'offline', CASE WHEN \$8 THEN 'resolved' ELSE 'responded' END/);
  assert.match(insert.sql, /FROM events e WHERE e\.id=\$1 AND e\.coordinator_id=\$2/);
});
// Test case: A record can be resolved straight away; then the outcome alone is enough.
test('OC AC1 AC2 - an offline clarification resolved straight away needs only its outcome', async () => {
  const db = mockDatabase();
  const result = await offline({ response: '', outcome: 'Organiser confirmed by email.', resolve: true });
  assert.deepEqual([result.status, result.body.message, result.body.clarificationRequest.status], [201, 'Offline clarification recorded and resolved.', 'resolved']);
  assert.deepEqual(db.find('INSERT INTO event_clarification_requests')[0].values.slice(4), [null, 'Organiser confirmed by email.', null, true]);
});
// Test case: Missing or invalid parts are refused before anything is written; limits at, and just over, each maximum.
for (const [label, body, status, message] of [
  ['no topic', { informationNeeded: [] }, 400, 'Select one or more valid event fields the clarification was about.'],
  ['an unknown topic', { informationNeeded: ['venue'] }, 400, 'Select one or more valid event fields the clarification was about.'],
  ['a repeated topic', { informationNeeded: ['name', 'name'] }, 400, 'Select one or more valid event fields the clarification was about.'],
  ['an empty question', { message: '   ' }, 400, 'Enter the clarification question in at most 4000 characters.'],
  ['a 4001-character question', { message: 'x'.repeat(4001) }, 400, 'Enter the clarification question in at most 4000 characters.'],
  ['a 4000-character question', { message: 'x'.repeat(4000) }, 201, 'Offline clarification recorded.'],
  ['a 10001-character answer', { response: 'x'.repeat(10001) }, 400, 'The response must be text of at most 10000 characters.'],
  ['a 10000-character answer', { response: 'x'.repeat(10000) }, 201, 'Offline clarification recorded.'],
  ['a 10001-character outcome', { outcome: 'x'.repeat(10001) }, 400, 'The outcome must be text of at most 10000 characters.'],
  ['a 4001-character comment', { comments: 'x'.repeat(4001) }, 400, 'The comments must be text of at most 4000 characters.'],
  ['a 4000-character comment', { comments: 'x'.repeat(4000) }, 201, 'Offline clarification recorded.'],
  ['a non-text answer', { response: 42 }, 400, 'The response must be text of at most 10000 characters.'],
  ['a non-boolean resolve flag', { resolve: 'yes' }, 400, 'Choose whether the clarification is resolved.'],
  ['no answer while unresolved', { response: null, outcome: 'Settled.' }, 400, 'Enter the organiser\'s response, or mark the clarification resolved and record its outcome.'],
  ['neither answer nor outcome when resolving', { response: null, resolve: true }, 400, 'Enter the organiser\'s response or the outcome.'],
]) {
  test(`OC AC1 - an offline clarification with ${label} returns ${status}`, async () => {
    const db = mockDatabase();
    const result = await offline(body);
    assert.deepEqual([result.status, result.body.message], [status, message]);
    assert.equal(db.find('INSERT INTO event_clarification_requests').length, status === 201 ? 1 : 0);
  });
}
// Test case: Only the event's assigned coordinator records clarifications.
test('OC AC1 - other coordinators get 404, other roles 403 and invalid ids 400', async () => {
  // The guarded insert finds no event assigned to this coordinator.
  mock.method(pool, 'query', async (sql) => (sql.includes('FROM users WHERE') ? { rows: [coordinator] } : { rows: [] }));
  assert.equal((await offline({})).status, 404);
  assert.equal((await call('/api/events/x/clarifications/offline', { body: {} })).status, 400);
  mock.restoreAll();
  mockDatabase({ user: organiser });
  assert.equal((await call('/api/events/101/clarifications/offline', { user: organiser, body: {} })).status, 403);
});

// ---------- AC2: mark resolved, keeping the history ----------

const pendingClarification = { id: 601, event_id: 101, status: 'pending', message: 'How many guests?', organiser_response: null, outcome: null };
const resolve = (body = {}, id = 601) => call(`/api/events/101/clarifications/${id}/resolve`, { body });

// Test case: An answered clarification is resolved; only the resolution columns are set, so the question and answer stay.
test('OC AC2 - an answered clarification is marked resolved and keeps its question and answer', async () => {
  const answered = { ...pendingClarification, status: 'responded', organiser_response: 'About 90.' };
  const db = mockDatabase({ clarification: answered });
  const result = await resolve({ comments: 'Confirmed on the phone.' });
  assert.deepEqual([result.status, result.body.message], [200, 'Clarification marked as resolved.']);
  const [update] = db.find('UPDATE event_clarification_requests');
  assert.match(update.sql, /SET status='resolved', resolved_at=now\(\), resolved_by=\$3,\s+outcome=COALESCE\(\$4, cr\.outcome\), coordinator_comments=COALESCE\(\$5, cr\.coordinator_comments\)/);
  assert.doesNotMatch(update.sql, /message=|organiser_response=|responded_at=/);
  assert.match(update.sql, /cr\.status IN \('pending', 'responded'\)/);
  assert.deepEqual(update.values, ['101', '601', 30, null, 'Confirmed on the phone.']);
  assert.equal(result.body.clarificationRequest.organiser_response, 'About 90.');
});
// Test case: Nobody answered a pending question in ConnectSphere, so resolving it requires the outcome.
test('OC AC2 - a pending clarification is resolved only with its outcome', async () => {
  mockDatabase({ clarification: pendingClarification });
  assert.deepEqual([(await resolve()).status], [400]);
  mock.restoreAll();
  const db = mockDatabase({ clarification: pendingClarification });
  const result = await resolve({ outcome: 'Settled offline: 90 guests.' });
  assert.equal(result.status, 200);
  assert.equal(db.find('UPDATE event_clarification_requests')[0].values[3], 'Settled offline: 90 guests.');
});
// Test case: Resolved is final, a missing clarification is not found, and limits apply.
for (const [label, options, body, status, code] of [
  ['already resolved', { clarification: { ...pendingClarification, status: 'resolved' } }, { outcome: 'x' }, 409, 'ALREADY_RESOLVED'],
  ['resolved by someone else meanwhile', { clarification: pendingClarification, resolved: null }, { outcome: 'x' }, 409, 'ALREADY_RESOLVED'],
  ['not found or not assigned', { clarification: null }, { outcome: 'x' }, 404, undefined],
  ['a 10001-character outcome', { clarification: pendingClarification }, { outcome: 'x'.repeat(10001) }, 400, undefined],
  ['a 4001-character comment', { clarification: pendingClarification }, { outcome: 'x', comments: 'x'.repeat(4001) }, 400, undefined],
]) {
  test(`OC AC2 - resolving a clarification ${label} returns ${status}`, async () => {
    mockDatabase(options);
    const result = await resolve(body);
    assert.deepEqual([result.status, result.body.code], [status, code]);
  });
}
test('OC AC2 - resolving with an invalid id returns 400', async () => {
  mockDatabase();
  assert.equal((await resolve({}, 'abc')).status, 400);
});

// ---------- AC3-AC5: an amendment the coordinator applies ----------

/**
 * Mocks the event read (pool.query) and the transaction that applies an agreed amendment: the locked event, the linked
 * clarification check, the recorded amendment and the statements applyAmendment sends.
 */
function mockAgreed({ current = event, linked = true, safetyChecked = false, roles = {} } = {}) {
  mockDatabase({ current });
  const statements = [];
  mock.method(pool, 'connect', async () => ({
    release() {},
    async query(sql, values) {
      statements.push({ sql: sql.trim(), values });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql.trim())) return { rows: [] };
      if (sql.includes('AS pending_clarifications')) return { rows: [] };
      if (sql.includes('SELECT to_jsonb(e) AS event FROM events e')) return { rows: current ? [{ event: current }] : [] };
      if (sql.includes('FROM event_clarification_requests WHERE id')) return { rows: [], rowCount: linked ? 1 : 0 };
      if (sql.includes('INSERT INTO event_change_requests')) {
        return { rows: [{ id: 700, event_id: 101, organiser_id: 12, coordinator_id: 30, requested_changes: JSON.parse(values[3]), explanation: values[4],
          status: 'approved', source: 'coordinator_agreed', clarification_id: values[5] }] };
      }
      if (sql.includes('RETURNING to_jsonb(events.*) AS event')) return { rows: [{ event: { ...current, expected_attendance: 90 } }] };
      if (sql.includes('FROM event_safety_checks')) return { rows: [], rowCount: safetyChecked ? 1 : 0 };
      if (sql.includes('SELECT to_jsonb(events.*) AS event FROM events')) return { rows: [{ event: { ...current, expected_attendance: 90 } }] };
      if (sql.includes('SELECT id FROM users')) return { rows: (roles[values[0]] || []).map((id) => ({ id })) };
      if (sql.includes('INSERT INTO notifications')) {
        return { rows: values[0].map((userId, index) => ({ id: index + 1, user_id: userId, title: values[4][index], message: values[5][index], email: `user${userId}@example.com` })) };
      }
      return { rows: [] };
    },
  }));
  return { statements, find: (text) => statements.filter((statement) => statement.sql.includes(text)) };
}
const agree = (body) => call('/api/events/101/agreed-amendments', { body: { changes: { expectedAttendance: 90 }, explanation: 'Agreed on the phone.', ...body } });

// Test case: The coordinator applies what was agreed: it is recorded as their approved amendment, applied and announced.
test('OC AC3 AC4 - the coordinator applies an agreed amendment linked to its clarification', async () => {
  // Arrange: the event had a safety check, so the change also needs a new one.
  const tx = mockAgreed({ safetyChecked: true, roles: { safety_officer: [50] } });
  const sent = mock.method(emailService, 'sendNotificationEmail', async () => {});
  // Act
  const result = await agree({ clarificationId: 601 });
  // Assert: recorded as an approved coordinator amendment with what was agreed and its clarification.
  assert.equal(result.status, 201);
  assert.equal(result.body.message, 'Agreed amendment applied. The organiser and affected staff have been notified.');
  const [insert] = tx.find('INSERT INTO event_change_requests');
  assert.match(insert.sql, /VALUES \(\$1, \$2, \$3, \$4::jsonb, \$5, 'approved', 'coordinator_agreed', \$6, \$3, now\(\)\)/);
  assert.deepEqual(insert.values, [101, 12, 30, '{"expectedAttendance":90}', 'Agreed on the phone.', 601]);
  // AC3: the history keeps before -> after; AC5: a new safety check is needed.
  const [, applied, rechecks] = tx.find('UPDATE event_change_requests SET applied_changes')[0].values;
  assert.deepEqual(JSON.parse(applied), [{ field: 'expectedAttendance', label: 'Expected attendance', before: 60, after: 90 }]);
  assert.equal(JSON.parse(rechecks).safety, true);
  // AC4: the organiser and the Safety Officer are told in the same transaction, then emailed.
  assert.deepEqual(result.body.notified, { organiser: [12], venueStaff: [], technicalSupport: [], safetyOfficers: [50] });
  const [userIds, , , , titles] = tx.find('INSERT INTO notifications')[0].values;
  assert.deepEqual([userIds, titles], [[12, 50], ['Agreed amendment applied: Gala', 'Event details changed: Gala']]);
  assert.ok(tx.statements.findIndex((s) => s.sql.includes('INSERT INTO notifications')) < tx.statements.findIndex((s) => s.sql === 'COMMIT'));
  assert.equal(sent.mock.callCount(), 2);
});
// Test case: Invalid requests are refused before anything is written; the explanation boundary is 2000 characters.
for (const [label, body, status] of [
  ['no changes', { changes: null }, 400], ['changes as a list', { changes: [] }, 400],
  ['no explanation', { explanation: '  ' }, 400], ['a 2001-character explanation', { explanation: 'x'.repeat(2001) }, 400],
  ['a 2000-character explanation', { explanation: 'x'.repeat(2000) }, 201], ['an explanation that is not text', { explanation: 42 }, 400],
  ['a clarification id that is not a number', { clarificationId: '601' }, 400], ['a clarification id of 0', { clarificationId: 0 }, 400],
  ['no real change', { changes: { expectedAttendance: 60 } }, 400], ['an invalid value', { changes: { expectedAttendance: -5 } }, 400],
  ['a clarification of another event', { clarificationId: 999 }, 400],
]) {
  test(`OC AC3 - applying an agreed amendment with ${label} returns ${status}`, async () => {
    const tx = mockAgreed({ linked: label !== 'a clarification of another event' });
    mock.method(emailService, 'sendNotificationEmail', async () => {});
    const result = await agree(body);
    assert.equal(result.status, status);
    assert.equal(tx.find('INSERT INTO event_change_requests').length, status === 201 ? 1 : 0);
  });
}
// Test case: Only the assigned coordinator applies amendments, and not once the event is closed.
test('OC AC3 - agreed amendments are refused for closed, unassigned or reassigned events and other roles', async () => {
  mockAgreed({ current: { ...event, status: 'cancelled' } });
  assert.deepEqual([(await agree({})).status, (await agree({})).body.code], [409, 'AMENDMENT_CLOSED']);
  mock.restoreAll();
  mockAgreed({ current: null });
  assert.equal((await agree({})).status, 404);
  mock.restoreAll();
  // Read as assigned, but reassigned before the locked read inside the transaction: nothing is applied.
  const tx = mockAgreed();
  mock.method(pool, 'connect', async () => ({ release() {}, async query(sql) {
    tx.statements.push({ sql });
    return { rows: [] };
  } }));
  assert.equal((await agree({})).status, 404);
  assert.equal((await call('/api/events/x/agreed-amendments', { body: {} })).status, 400);
  mock.restoreAll();
  mockDatabase({ user: lead });
  assert.equal((await call('/api/events/101/agreed-amendments', { user: lead, body: {} })).status, 403);
});

// Test case: A database failure while applying rolls everything back and is reported as a server error, not as applied.
test('OC AC3 - a database failure while applying an agreed amendment rolls back and returns 500', async () => {
  const tx = mockAgreed();
  const real = (await pool.connect()).query;
  mock.method(pool, 'connect', async () => ({ release() {}, async query(sql, values) {
    if (sql.includes('INSERT INTO event_change_requests')) throw Object.assign(new Error('connection reset'), { code: '08006' });
    return real(sql, values);
  } }));
  const result = await agree({});
  assert.equal(result.status, 500);
  assert.equal(result.body.code, undefined);
  assert.ok(tx.statements.some((statement) => statement.sql === 'ROLLBACK'));
  assert.equal(tx.statements.some((statement) => statement.sql === 'COMMIT'), false);
});
// Test case: A refusal without a machine-readable code is returned with only its message.
test('OC AC3 - a refusal without a code returns only its message', async () => {
  mockAgreed({ linked: false });
  const result = await agree({ clarificationId: 999 });
  assert.deepEqual(result.body, { message: 'Choose a clarification recorded for this event.' });
});

// ---------- AC6: registration and withdrawal deadlines ----------

/** The organiser requests a deadline change; the guarded insert echoes what would be stored. */
function mockDeadlineRequest() {
  const inserts = [];
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('FROM users WHERE')) return { rows: [organiser] };
    if (sql.includes('INSERT INTO event_change_requests')) {
      inserts.push({ sql, values });
      return { rows: [{ id: 501, status: 'pending', coordinator_email: 'chris@example.com' }] };
    }
    if (sql.includes('FROM events e')) return { rows: [event] };
    return { rows: [] };
  });
  mock.method(emailService, 'sendNotificationEmail', async () => {});
  return inserts;
}
const requestDeadline = (changes) => call('/api/events/101/amendment-requests', { user: organiser, body: { changes, explanation: 'Need more time.' } });

// Test case: A deadline is a Singapore date and time no later than the event start (15 Oct 2030 18:00); exactly at the
// start is allowed, a minute after is not. Stored as the instant, shown to the coordinator in Singapore time.
for (const [label, changes, status, stored, message] of [
  ['a minute before the start', { registrationDeadline: '2030-10-15T17:59' }, 202, '2030-10-15T09:59:00.000Z'],
  ['exactly at the start', { registrationDeadline: '2030-10-15T18:00' }, 202, '2030-10-15T10:00:00.000Z'],
  ['a minute after the start', { registrationDeadline: '2030-10-15T18:01' }, 400, null, 'The registration deadline cannot be after the event starts.'],
  ['after a requested earlier start', { withdrawalDeadline: '2030-10-15T17:00', proposedStartTime: '16:00', proposedEndTime: '20:00' }, 400, null,
    'The withdrawal deadline cannot be after the event starts.'],
  ['an impossible date', { withdrawalDeadline: '2030-02-30T10:00' }, 400, null, 'Enter the withdrawal deadline as a date and time.'],
  ['a month that does not exist', { withdrawalDeadline: '2030-13-01T10:00' }, 400, null, 'Enter the withdrawal deadline as a date and time.'],
  ['a date without a time', { registrationDeadline: '2030-10-10' }, 400, null, 'Enter the registration deadline as a date and time.'],
  ['a number', { registrationDeadline: 20301010 }, 400, null, 'Enter the registration deadline as a date and time.'],
]) {
  test(`OC AC6 - a deadline ${label} returns ${status}`, async () => {
    const inserts = mockDeadlineRequest();
    const result = await requestDeadline(changes);
    assert.equal(result.status, status);
    if (status === 202) assert.equal(Object.values(JSON.parse(inserts[0].values[3]))[0], stored);
    else assert.equal(result.body.message, message);
  });
}
// Test case: Clearing a deadline falls back to the event start; an unchanged deadline is not proposed again.
test('OC AC6 - a deadline can be cleared, and the same moment is not a change', async () => {
  const inserts = mockDeadlineRequest();
  assert.equal((await requestDeadline({ withdrawalDeadline: null })).status, 202);
  assert.deepEqual(JSON.parse(inserts[0].values[3]), { withdrawalDeadline: null });
  assert.match(inserts[0].values[6], /\nWithdrawal deadline: 14 Oct 2030, 6:00 pm \(SGT\) → Not specified\n/);
  // 18:00 Singapore time on 14 Oct is the stored withdrawal deadline (10:00 UTC).
  assert.equal((await requestDeadline({ withdrawalDeadline: '2030-10-14T18:00' })).status, 400);
});
// Test case: Setting a first deadline shows the current one as not set, never as a 1970 date.
test('OC AC6 - a first deadline is shown to the coordinator as replacing none', async () => {
  const inserts = mockDeadlineRequest();
  await requestDeadline({ registrationDeadline: '2030-10-13T12:00' });
  assert.match(inserts[0].values[6], /\nRegistration deadline: Not specified → 13 Oct 2030, 12:00 pm \(SGT\)\n/);
});
// Test case: The coordinator's notice shows the current and proposed deadlines in Singapore time with the explanation.
test('OC AC6 - the coordinator is told the current and proposed deadline and the explanation', async () => {
  const inserts = mockDeadlineRequest();
  await requestDeadline({ withdrawalDeadline: '2030-10-13T12:00' });
  const message = inserts[0].values[6];
  assert.equal(message, 'The Event Organiser requested amendments to Gala.\nWithdrawal deadline: 14 Oct 2030, 6:00 pm (SGT) → 13 Oct 2030, 12:00 pm (SGT)\nExplanation: Need more time.');
});
