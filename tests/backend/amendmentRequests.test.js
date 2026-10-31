// File: Tests "Request All Post-Submission Amendments Through the Coordinator" through the real API with the database and
// email boundaries replaced.
// AC1 no direct edits after submission; AC2 amendment request with proposed changes and an explanation;
// AC3 accepted information unchanged while the request awaits review; AC4 assigned coordinator notified and can review.
const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('../../backend/node_modules/jsonwebtoken');
process.env.JWT_SECRET = 'amendment-requests-tests-secret';
process.env.NODE_ENV = 'test';
const { pool } = require('../../backend/src/config/db');
const emailService = require('../../backend/src/services/emailService');
const app = require('../../backend/src/index');
let server, base;

const organiser = { id: 12, email: 'olivia@example.com', role: 'event_organiser', auth_version: 0 };
const coordinator = { id: 30, email: 'chris@example.com', role: 'event_coordinator', auth_version: 0 };
// A submitted request assigned to coordinator 30 (the stored row as findAccessibleById returns it).
const submitted = { id: 101, organiser_id: 12, coordinator_id: 30, name: 'Gala', purpose: 'Fundraising', status: 'submitted',
  is_draft: false, proposed_date: '2030-10-15', proposed_start_time: '18:00:00', proposed_end_time: '20:00:00',
  expected_attendance: 60, room_layout_preference: 'Theatre', accessibility_requirements: ['Ramp'], attachments: {},
  equipment_items: [{ item: 'Projector', quantity: 1 }], technical_support_required: false, technical_support_details: null,
  video_conferencing_required: false, technical_specifications: null };
// The complete equipment block as stored above; amendment requests send it whole.
const storedEquipment = { equipmentItems: [{ item: 'Projector', quantity: 1 }], technicalSupportRequired: false,
  technicalSupportDetails: null, videoConferencingRequired: false, technicalSpecifications: null };

/** Signs a test-only session for the user. */
function token(user) { return jwt.sign({ sub: user.id, email: user.email, authVersion: 0 }, process.env.JWT_SECRET); }
/** Calls the local test server and returns status plus JSON. */
async function call(path, { user = organiser, method = 'POST', body } = {}) {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(user)}` },
    body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
}
const amend = (changes, explanation = 'Ticket sales are higher than expected.', id = 101) =>
  call(`/api/events/${id}/amendment-requests`, { body: { changes, explanation } });
/**
 * Mocks the database: the session user, the event read (`event`, or none) and the guarded amendment insert, which echoes
 * its values unless `inserted` is null. Every other statement is recorded so tests can prove nothing else was written.
 */
function mockDatabase({ user = organiser, event = submitted, inserted = 'echo' } = {}) {
  const statements = [];
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('FROM users WHERE')) return { rows: [user] };
    // Checked before the event read because the insert also selects FROM events.
    if (sql.includes('INSERT INTO event_change_requests')) {
      statements.push({ sql, values });
      if (inserted === null) return { rows: [] };
      return { rows: [{ id: 501, event_id: 101, organiser_id: 12, coordinator_id: 30, requested_changes: JSON.parse(values[3]),
        explanation: values[4], status: 'pending', submitted_at: '2030-01-01T00:00:00.000Z', coordinator_email: 'chris@example.com' }] };
    }
    if (sql.includes('FROM events e')) return { rows: event ? [event] : [] };
    statements.push({ sql, values });
    return { rows: [] };
  });
  mock.method(pool, 'connect', async () => assert.fail('No transaction is expected.'));
  return { statements, inserts: () => statements.filter((s) => s.sql.includes('INSERT INTO event_change_requests')) };
}

before(async () => {
  await new Promise((resolve, reject) => { server = app.listen(0, '127.0.0.1', resolve); server.on('error', reject); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() => mock.restoreAll());
after(async () => { if (server?.listening) await new Promise((done) => server.close(done)); await pool.end(); });

// ---------- AC1: no direct edits once submitted ----------

// Test case: Every non-draft status refuses direct information and equipment edits without writing anything.
for (const status of ['submitted', 'under_review', 'approved', 'confirmed']) {
  test(`AM AC1 - a ${status} event refuses direct information and equipment edits`, async () => {
    // Arrange
    const db = mockDatabase({ event: { ...submitted, status } });
    // Act
    const information = await call('/api/events/101/non-critical', { method: 'PUT', body: { description: 'New' } });
    const equipment = await call('/api/events/101/equipment', { method: 'PUT', body: storedEquipment });
    // Assert: both refused with the amendment route; nothing was written.
    assert.deepEqual([information.status, information.body.code, equipment.status, equipment.body.code],
      [409, 'AMENDMENT_REQUIRED', 409, 'AMENDMENT_REQUIRED']);
    assert.equal(db.statements.length, 0);
  });
}

// ---------- AC2 + AC3 + AC4: an amendment request with changes and an explanation ----------

// Test case: Several fields, the equipment block and an attachment are requested together; only real changes are stored,
// the event is not updated, and the assigned coordinator's notification is written in the same statement.
test('AM AC2 AC3 AC4 - a combined amendment stores only the changes and explanation and notifies the coordinator', async () => {
  // Arrange
  const db = mockDatabase();
  const sent = mock.method(emailService, 'sendNotificationEmail', async () => {});
  const file = { name: 'floorplan.pdf', data: Buffer.from('%PDF-floor').toString('base64') };
  // Act: attendance and layout change, purpose is resent unchanged, the projector count doubles, a file is added.
  const result = await amend({ expectedAttendance: 90, roomLayoutPreference: 'Banquet', purpose: 'Fundraising',
    ...storedEquipment, equipmentItems: [{ item: 'Projector', quantity: 2 }], attachments: { purpose: file } }, '  Ticket sales are higher than expected.  ');
  // Assert: accepted (202) and pending; the coordinator's address is not returned to the organiser.
  assert.equal(result.status, 202);
  assert.equal(result.body.amendmentRequest.status, 'pending');
  assert.equal(result.body.amendmentRequest.coordinator_email, undefined);
  assert.match(result.body.message, /current event information stays in effect/);
  // AC2: only the values that differ are proposed, and the trimmed explanation is stored with them.
  const [insert] = db.inserts();
  const [eventId, organiserId, coordinatorId, proposed, explanation, title, message, details, closed] = insert.values;
  assert.deepEqual([eventId, organiserId, coordinatorId], ['101', 12, 30]);
  const stored = JSON.parse(proposed);
  assert.deepEqual(Object.keys(stored).sort(), ['attachments', 'equipmentItems', 'expectedAttendance', 'roomLayoutPreference']);
  assert.deepEqual([stored.expectedAttendance, stored.roomLayoutPreference, stored.equipmentItems], [90, 'Banquet', [{ item: 'Projector', quantity: 2 }]]);
  assert.equal(stored.attachments.purpose.name, 'floorplan.pdf');
  assert.equal(explanation, 'Ticket sales are higher than expected.');
  // AC3: the event row is never updated; the insert itself is guarded to submitted, open events of this coordinator.
  assert.equal(db.statements.filter((s) => /UPDATE events/.test(s.sql)).length, 0);
  assert.match(insert.sql, /e\.coordinator_id=\$3\s+AND e\.is_draft=false AND e\.status <> ALL\(\$9::text\[\]\)/);
  assert.deepEqual(closed, ['cancelled', 'completed', 'draft']);
  // AC4: the coordinator's notification is part of the same statement and names the changes and the explanation.
  assert.match(insert.sql, /INSERT INTO notifications[\s\S]*SELECT cr\.coordinator_id, cr\.event_id, cr\.id, 'change_request_submitted'/);
  assert.equal(title, 'New amendment request: Gala');
  assert.equal(message, ['The Event Organiser requested amendments to Gala.', 'Expected attendance: 60 → 90',
    'Layout requirements: Theatre → Banquet', 'Attachments: None → floorplan.pdf', 'Equipment items: Projector × 1 → Projector × 2',
    'Explanation: Ticket sales are higher than expected.'].join('\n'));
  assert.equal(JSON.parse(details).explanation, 'Ticket sales are higher than expected.');
  assert.deepEqual(sent.mock.calls.map((c) => c.arguments), [['chris@example.com', title, message]]);
});

// Test case: Explanation boundaries - required, 1 to 2000 characters after trimming.
for (const [label, explanation, status] of [['missing', undefined, 400], ['empty', '', 400], ['whitespace only', '   ', 400],
  ['not text', 42, 400], ['1 character', 'x', 202], ['2000 characters', 'x'.repeat(2000), 202], ['2001 characters', 'x'.repeat(2001), 400]]) {
  test(`AM AC2 - an explanation that is ${label} is ${status === 202 ? 'accepted' : 'refused'}`, async () => {
    const db = mockDatabase();
    mock.method(emailService, 'sendNotificationEmail', async () => {});
    // A missing explanation is sent as a body without the field (the helper's default would otherwise fill it in).
    const result = explanation === undefined
      ? await call('/api/events/101/amendment-requests', { body: { changes: { expectedAttendance: 90 } } })
      : await amend({ expectedAttendance: 90 }, explanation);
    assert.equal(result.status, status);
    assert.equal(db.inserts().length, status === 202 ? 1 : 0);
    if (status === 400) assert.equal(result.body.message, 'Explain the amendment in 1 to 2000 characters.');
  });
}

// Test case: Requests that propose nothing usable are refused before anything is written.
for (const [label, changes, message] of [
  ['no changes object', undefined, 'Include the changes you are requesting.'],
  ['a list instead of changes', [{ expectedAttendance: 90 }], 'Include the changes you are requesting.'],
  ['an empty set of changes', {}, 'Choose valid event information to update.'],
  ['an unknown field', { venue: 'Hall B' }, 'Choose valid event information to update.'],
  ['only unchanged values', { expectedAttendance: 60, proposedStartTime: '18:00' }, 'Change at least one detail before requesting an amendment.'],
  ['a partial equipment block', { equipmentItems: [] }, 'Send the complete equipment requirements.'],
  ['an invalid equipment quantity', { ...storedEquipment, equipmentItems: [{ item: 'Projector', quantity: 0 }] }, 'Quantity for Projector must be a whole number from 1 to 9999.'],
  ['an impossible date', { proposedDate: '2030-02-30' }, 'Enter a valid event date.'],
  ['an end before the start', { proposedEndTime: '17:00' }, 'End time must be later than start time.'],
  ['a cleared event name', { name: '  ' }, 'name must be text of at most 255 characters.'],
  ['a blank accessibility entry', { accessibilityRequirements: ['Ramp', ' '] }, 'Accessibility requirements must be a list of non-empty text entries.'],
  ['a negative attendance', { expectedAttendance: -1 }, 'expectedAttendance must be a non-negative whole number.'],
  ['a text registration flag', { registrationRequired: 'yes' }, 'registrationRequired must be true or false.'],
  ['an impossible time', { proposedStartTime: '25:00' }, 'Enter a valid event time.'],
]) {
  test(`AM AC2 - an amendment with ${label} is refused without writing`, async () => {
    const db = mockDatabase();
    const result = await amend(changes);
    assert.deepEqual([result.status, result.body.message], [400, message]);
    assert.equal(db.inserts().length, 0);
  });
}

// Test case: Accepted values are stored in their normalised form (trimmed list entries, real booleans and numbers).
test('AM AC2 - accepted values are normalised before they are proposed', async () => {
  // Arrange: a recorded registration capacity, so clearing it is a real change.
  const db = mockDatabase({ event: { ...submitted, registration_capacity: 50 } });
  mock.method(emailService, 'sendNotificationEmail', async () => {});
  // Act: trimmed list entries, a real boolean, a cleared optional text and a cleared number.
  const result = await amend({ accessibilityRequirements: [' Ramp ', 'Lift'], registrationRequired: true, purpose: '  ', registrationCapacity: null });
  // Assert: cleared values are proposed as null (no value), not as blank text.
  assert.equal(result.status, 202);
  assert.deepEqual(JSON.parse(db.inserts()[0].values[3]), { purpose: null, accessibilityRequirements: ['Ramp', 'Lift'], registrationRequired: true, registrationCapacity: null });
});

// Test case: Event states that cannot take an amendment are refused with a reason; open states are accepted.
for (const [label, event, status, code] of [
  ['a draft', { ...submitted, status: 'draft', is_draft: true }, 409, 'USE_DRAFT_EDIT'],
  ['a cancelled event', { ...submitted, status: 'cancelled' }, 409, 'AMENDMENT_CLOSED'],
  ['a completed event', { ...submitted, status: 'completed' }, 409, 'AMENDMENT_CLOSED'],
  ['a corrected rejected request', { ...submitted, status: 'rejected' }, 202, undefined],
  ['an event with no coordinator', { ...submitted, coordinator_id: null }, 409, 'COORDINATOR_NOT_ASSIGNED'],
  ['an event under review', { ...submitted, status: 'under_review' }, 202, undefined],
  ['an approved event', { ...submitted, status: 'approved' }, 202, undefined],
  ['a confirmed event', { ...submitted, status: 'confirmed' }, 202, undefined],
]) {
  test(`AM AC2 AC4 - an amendment for ${label} returns ${status}`, async () => {
    const db = mockDatabase({ event });
    mock.method(emailService, 'sendNotificationEmail', async () => {});
    const result = await amend({ expectedAttendance: 90 });
    assert.deepEqual([result.status, result.body.code], [status, code]);
    assert.equal(db.inserts().length, status === 202 ? 1 : 0);
  });
}

// Test case: The guarded insert stores nothing when the event changed after the read (e.g. the coordinator was replaced).
test('AM AC4 - an amendment overtaken by a reassignment or decision is reported as a conflict and not emailed', async () => {
  mockDatabase({ inserted: null });
  const sent = mock.method(emailService, 'sendNotificationEmail', async () => {});
  const result = await amend({ expectedAttendance: 90 });
  assert.deepEqual([result.status, result.body.code], [409, 'ARRANGEMENT_CHANGED']);
  assert.equal(sent.mock.callCount(), 0);
});

// Test case: Only the owning organiser can request an amendment.
test('AM AC2 - access is limited to the owning organiser and valid event ids', async () => {
  mockDatabase({ event: null });
  assert.equal((await amend({ expectedAttendance: 90 })).status, 404);
  assert.equal((await amend({ expectedAttendance: 90 }, 'Why', 'abc')).status, 400);
  assert.equal((await amend({ expectedAttendance: 90 }, 'Why', '2147483648')).status, 400);
  mock.restoreAll();
  mockDatabase({ user: coordinator });
  assert.equal((await call('/api/events/101/amendment-requests', { user: coordinator, body: { changes: { expectedAttendance: 90 }, explanation: 'Why' } })).status, 403);
});

// ---------- AC3: the organiser sees each request awaiting review ----------

// Test case: The organiser's list shows each request's proposal, explanation and outcome, scoped to their own requests.
test('AM AC3 / OC AC3 - the amendment history lists each proposal, its status and what an applied one changed', async () => {
  // Arrange
  const reads = [];
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('FROM users WHERE')) return { rows: [organiser] };
    if (sql.includes('FROM event_change_requests r')) {
      reads.push({ sql, values });
      return { rows: [
        { id: 502, requested_changes: { expectedAttendance: 90, proposedStartTime: '18:30:00', equipmentItems: [{ item: 'Projector', quantity: 2 }], legacyField: 'x' },
          explanation: 'More guests.', status: 'pending', submitted_at: '2030-01-02T00:00:00.000Z', reviewed_at: null, decision_reason: null },
        { id: 501, requested_changes: { name: 'Gala Night' }, explanation: null, status: 'rejected', submitted_at: '2030-01-01T00:00:00.000Z',
          reviewed_at: '2030-01-01T05:00:00.000Z', decision_reason: 'The name is already printed.' },
        // Record Offline AC3: an applied amendment keeps what it changed, before -> after.
        { id: 500, requested_changes: { expectedAttendance: 70 }, applied_changes: [{ field: 'expectedAttendance', label: 'Expected attendance', before: 60, after: 70 }],
          explanation: 'Agreed by phone.', status: 'approved', source: 'coordinator_agreed', submitted_at: '2029-12-31T00:00:00.000Z' },
      ] };
    }
    if (sql.includes('FROM events e')) return { rows: [submitted] };
    assert.fail(`Unexpected query: ${sql}`);
  });
  // Act
  const result = await call('/api/events/101/amendment-requests', { method: 'GET' });
  // Assert: the event's whole history, newest first (access was checked on the event), with labelled readable values.
  assert.equal(result.status, 200);
  assert.deepEqual(reads[0].values, ['101']);
  assert.match(reads[0].sql, /WHERE r\.event_id=\$1\s+ORDER BY r\.submitted_at DESC/);
  const [pending, rejected, applied] = result.body.amendmentRequests;
  assert.deepEqual(applied.changes, [{ field: 'expectedAttendance', label: 'Expected attendance', before: 60, after: 70 }]);
  assert.equal(applied.source, 'coordinator_agreed');
  assert.deepEqual(pending.changes, [
    { field: 'proposedStartTime', label: 'Start time', requested: '18:30:00' },
    { field: 'expectedAttendance', label: 'Expected attendance', requested: 90 },
    { field: 'equipmentItems', label: 'Equipment items', requested: ['Projector × 2'] },
    { field: 'legacyField', label: 'legacyField', requested: 'x' },
  ]);
  assert.deepEqual([pending.status, pending.explanation, rejected.status, rejected.decision_reason],
    ['pending', 'More guests.', 'rejected', 'The name is already printed.']);
  assert.equal(pending.requested_changes, undefined);
});

// Test case: The history is for the event's authorised users: its organiser, assigned coordinator and Coordinator Lead.
test('AM AC3 / OC AC3 - the history refuses other organisers, unrelated roles and invalid ids', async () => {
  mockDatabase({ event: null });
  assert.equal((await call('/api/events/101/amendment-requests', { method: 'GET' })).status, 404);
  assert.equal((await call('/api/events/x/amendment-requests', { method: 'GET' })).status, 400);
  mock.restoreAll();
  const attendee = { id: 80, email: 'ada@example.com', role: 'attendee', auth_version: 0 };
  mockDatabase({ user: attendee });
  assert.equal((await call('/api/events/101/amendment-requests', { user: attendee, method: 'GET' })).status, 403);
});

// ---------- AC4: the coordinator can review the request ----------

// Test case: The coordinator's inbox carries the organiser's explanation for each pending request.
test('AM AC4 - the coordinator inbox includes the organiser explanation', async () => {
  mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM users WHERE')) return { rows: [coordinator] };
    if (sql.includes('FROM event_change_requests r')) {
      assert.match(sql, /r\.requested_changes, r\.explanation, r\.status/);
      return { rows: [{ id: 501, event_id: 101, event_name: 'Gala', organiser_id: 12, organiser_name: 'Olivia',
        requested_changes: { expectedAttendance: 90 }, explanation: 'More guests.', status: 'pending', submitted_at: '2030-01-01T00:00:00.000Z',
        event_record: submitted }] };
    }
    return { rows: [] };
  });
  const result = await call('/api/events/change-requests', { user: coordinator, method: 'GET' });
  assert.equal(result.status, 200);
  assert.equal(result.body.changeRequests[0].explanation, 'More guests.');
  assert.deepEqual(result.body.changeRequests[0].changes, [{ field: 'expectedAttendance', label: 'Expected attendance', current: 60, requested: 90 }]);
});
