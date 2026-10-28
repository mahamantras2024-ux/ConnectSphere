// File: Verifies unavailable status transitions, reservation impact recording, and migration support.
const { test, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../../backend/src/config/db');
const notificationService = require('../../backend/src/services/notificationService');
const workflow = require('../../backend/src/services/equipmentReservationUnavailability');
const controller = require('../../backend/src/controllers/equipmentReservationUnavailabilityController');

afterEach(() => mock.restoreAll());

function createDatabase({
  equipmentRows = [{
    id: 92,
    asset_code: 'MIC-001',
    name: 'Microphone',
    availability_status: 'Unavailable',
  }],
  affectedRows = [],
} = {}) {
  const queries = [];
  let nextIssueId = 71;
  const client = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (/UPDATE equipments/.test(sql)) return { rows: equipmentRows };
      if (/FROM equipment_status_history/.test(sql)) {
        return {
          rows: [{
            id: 4,
            status: 'Unavailable',
            note: 'Battery failed inspection',
            changed_at: '2026-10-18T11:00:00.000Z',
            changed_by_name: 'Taylor Support',
          }],
        };
      }
      if (/SELECT reservation\.id AS reservation_id/.test(sql)) return { rows: affectedRows };
      if (/INSERT INTO equipment_reservation_unavailability/.test(sql)) return { rows: [{ id: nextIssueId++ }] };
      return { rows: [] };
    },
    release() {},
  };
  return { client, queries };
}

async function callController(request, handler = controller.markUnavailable) {
  const response = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  let nextError;
  handler(request, response, error => { nextError = error; });
  await new Promise(resolve => setImmediate(resolve));
  if (nextError) throw nextError;
  return response;
}

// AC1 - Invalid reasons and equipment identifiers are rejected at the API boundary.
test('AC1 - validates equipment IDs and unavailability reasons', async () => {
  // Arrange
  const markUnavailable = mock.method(workflow, 'markUnavailable', async () => ({}));
  const invalidRequests = [
    { params: { id: '0' }, body: { reason: 'Damaged' }, user: { id: 9 } },
    { params: { id: '92' }, body: { reason: '   ' }, user: { id: 9 } },
    { params: { id: '92' }, body: { reason: 'Damaged', extra: true }, user: { id: 9 } },
    { params: { id: '92' }, body: { reason: 'x'.repeat(501) }, user: { id: 9 } },
  ];

  // Act and assert: every invalid request must fail before the workflow writes inventory or history.
  for (const request of invalidRequests) {
    const response = await callController(request);
    assert.equal(response.statusCode, 400);
  }
  assert.equal(markUnavailable.mock.callCount(), 0);
});

// AC1 - The API trims valid reasons and reports a concurrent status conflict as a client-visible 409.
test('AC1 - trims valid reasons and returns the workflow conflict status', async () => {
  // Arrange
  const conflict = Object.assign(new Error('Equipment status changed.'), { status: 409 });
  let callCount = 0;
  const markUnavailable = mock.method(workflow, 'markUnavailable', async () => {
    callCount += 1;
    if (callCount === 2) throw conflict;
    return { equipment: { id: 92, availability_status: 'Unavailable' }, affectedIssues: [] };
  });
  const validResponse = await callController({
    params: { id: '92' },
    body: { reason: '  Battery failed  ' },
    user: { id: 9 },
  });

  // Act: a conflict status from the transaction must remain an explicit API response.
  const conflictResponse = await callController({
    params: { id: '92' },
    body: { reason: 'Battery failed' },
    user: { id: 9 },
  });

  // Assert: accepted text is trimmed and stale selections do not look successful.
  assert.equal(validResponse.statusCode, 200);
  assert.deepEqual(markUnavailable.mock.calls[0].arguments.slice(0, 3), [92, 'Battery failed', 9]);
  assert.equal(conflictResponse.statusCode, 409);
  assert.equal(conflictResponse.body.message, 'Equipment status changed.');
});

// AC1/AC3 - The selected unavailable state is audited and each affected future reservation is recorded and notified.
test('AC1/AC3 - records unavailable status and flags its future reservations', async () => {
  // Arrange
  const affectedRows = [{
    reservation_id: 301,
    event_id: 401,
    event_name: 'Town Hall',
    coordinator_id: 5,
    event_date: '2026-11-18',
    start_time: '09:00:00',
    end_time: '12:00:00',
    quantity: 2,
    support_ids: [6],
  }, {
    reservation_id: 302,
    event_id: 402,
    event_name: 'Community Fair',
    coordinator_id: 7,
    event_date: '2026-11-19',
    start_time: '13:00:00',
    end_time: '16:00:00',
    quantity: 1,
    support_ids: [8],
  }];
  const { client, queries } = createDatabase({ affectedRows });
  const notifications = [];
  mock.method(pool, 'connect', async () => client);
  mock.method(notificationService, 'insertNotifications', async (_db, notes) => {
    notifications.push(...notes);
    return [{ id: 1 }];
  });
  mock.method(notificationService, 'emailNotifications', async () => 2);

  // Act
  const result = await workflow.markUnavailable(92, 'Battery failed inspection', 9);

  // Assert: the database and recipients retain the reason and reservation identity.
  assert.equal(result.equipment.availability_status, 'Unavailable');
  assert.equal(result.equipment.status_history[0].changed_at, '2026-10-18T11:00:00.000Z');
  assert.deepEqual(result.affectedIssues.map(issue => issue.reservationId), [301, 302]);
  assert.deepEqual(result.affectedIssues.map(issue => issue.noAlternativeAvailable), [true, true]);
  assert.deepEqual(notifications.map(note => note.userId), [6, 5, 8, 7]);
  assert.ok(notifications.every(note => note.type === 'equipment_reservation_affected'));
  assert.deepEqual(notifications.map(note => note.details.issueId), [71, 71, 72, 72]);
  assert.equal(queries.filter(({ sql }) => /SET suggestion_status='no_alternative'/.test(sql)).length, 2);
  assert.ok(queries.some(({ sql, values }) => /equipment_status_history/.test(sql) &&
    values[1] === 'Battery failed inspection'));
  assert.ok(queries.findIndex(({ sql }) => sql === 'BEGIN') <
    queries.findIndex(({ sql }) => /UPDATE equipments/.test(sql)));
  assert.ok(queries.findIndex(({ sql }) => /UPDATE equipments/.test(sql)) <
    queries.findIndex(({ sql }) => /SELECT reservation\.id AS reservation_id/.test(sql)));
  assert.equal(queries.at(-1).sql, 'COMMIT');
});

const replacementIssue = overrides => ({
  id: 71,
  reservation_id: 301,
  inventory_id: 92,
  reason: 'Battery failed inspection',
  status: 'open',
  suggestion_status: 'awaiting_staff',
  suggested_inventory_id: null,
  event_id: 401,
  event_date: '2026-11-18',
  start_time: '09:00:00',
  end_time: '12:00:00',
  quantity: 2,
  original_asset_code: 'MIC-001',
  original_name: 'Wireless Microphone',
  event_name: 'Town Hall',
  coordinator_id: 5,
  support_ids: [6],
  ...overrides,
});

function createWorkflowDatabase({ issue = replacementIssue({}), alternatives = [] } = {}) {
  const statements = [];
  const client = {
    async query(sql, values) {
      statements.push({ sql, values });
      if (/FROM equipment_reservation_unavailability impact/.test(sql)) return { rows: [issue] };
      if (/FROM equipments stock/.test(sql)) return { rows: alternatives };
      return { rows: [] };
    },
    release() {},
  };
  return { client, statements };
}

// AC2 - Technical Support can offer only currently eligible stock for the affected event slot.
test('AC2 - records an eligible replacement offer and notifies the assigned coordinator', async () => {
  // Arrange
  const alternative = {
    id: 93,
    asset_code: 'MIC-002',
    name: 'Wireless Microphone',
    available_quantity: 2,
  };
  const { client, statements } = createWorkflowDatabase({ alternatives: [alternative] });
  const notifications = [];
  mock.method(pool, 'connect', async () => client);
  mock.method(notificationService, 'insertNotifications', async (_db, notes) => {
    notifications.push(...notes);
    return [{ id: 10 }];
  });
  mock.method(notificationService, 'emailNotifications', async () => 1);

  // Act
  const result = await workflow.suggestAlternative(71, 93, 9);

  // Assert: the exact offered asset is stored, the coordinator receives its details, and the transaction commits.
  assert.deepEqual(result, { issueId: 71, alternative });
  assert.deepEqual(notifications.map(note => note.userId), [5]);
  assert.match(notifications[0].message, /MIC-002/);
  const lockIndex = statements.findIndex(({ sql }) => /FROM equipments WHERE id=ANY/.test(sql));
  const availabilityIndex = statements.findIndex(({ sql }) => /FROM equipments stock/.test(sql));
  const update = statements.find(({ sql }) => /SET suggested_inventory_id/.test(sql));
  assert.ok(lockIndex < availabilityIndex && availabilityIndex < statements.indexOf(update));
  const availabilityQuery = statements[availabilityIndex].sql;
  assert.match(availabilityQuery, /stock\.status='operational' AND stock\.availability_status='Available'/);
  assert.match(availabilityQuery, /availability\.id IS NOT NULL OR NOT EXISTS/);
  assert.match(availabilityQuery, /schedule\.start_time <= \$3::time/);
  assert.match(availabilityQuery, /schedule\.end_time >= \$4::time/);
  assert.match(availabilityQuery, /reservation\.start_time < \$4::time AND reservation\.end_time > \$3::time/);
  assert.match(availabilityQuery, /stock\.quantity - COALESCE\(booked\.quantity, 0\) >= \$5/);
  assert.deepEqual(update.values, [71, 93, 9]);
  assert.equal(statements.at(-1).sql, 'COMMIT');
});

// AC2 - An offer is refused if replacement stock became unavailable before the support submission.
test('AC2 - rolls back a replacement offer when the selected asset no longer covers the slot', async () => {
  // Arrange
  const { client, statements } = createWorkflowDatabase();
  mock.method(pool, 'connect', async () => client);
  mock.method(notificationService, 'insertNotifications', async () => []);
  mock.method(notificationService, 'emailNotifications', async () => 0);

  // Act and assert
  await assert.rejects(
    workflow.suggestAlternative(71, 93, 9),
    error => error.status === 409,
  );
  assert.equal(statements.some(({ sql }) => /SET suggested_inventory_id/.test(sql)), false);
  assert.equal(statements.at(-1).sql, 'ROLLBACK');
});

// AC2/AC3 - Suggestion endpoints reject malformed payloads before starting any workflow transaction.
test('AC2/AC3 - validates replacement suggestion and decision payloads', async () => {
  // Arrange
  const suggestAlternative = mock.method(workflow, 'suggestAlternative', async () => ({}));
  const decideAlternative = mock.method(workflow, 'decideAlternative', async () => ({}));

  // Act and assert: invalid IDs, arrays, extra properties, and unsupported outcomes fail at the HTTP boundary.
  const invalidSuggestionRequests = [
    { params: { issueId: '0' }, body: { alternativeInventoryId: 93 }, user: { id: 9 } },
    { params: { issueId: '71' }, body: { alternativeInventoryId: 93, extra: true }, user: { id: 9 } },
    { params: { issueId: '71' }, body: [], user: { id: 9 } },
  ];
  for (const request of invalidSuggestionRequests) {
    assert.equal((await callController(request, controller.suggestAlternative)).statusCode, 400);
  }
  const invalidDecisionRequests = [
    { params: { eventId: '401', issueId: '71' }, body: { outcome: 'accepted', extra: true }, user: { id: 5 } },
    { params: { eventId: '401', issueId: '71' }, body: [], user: { id: 5 } },
    { params: { eventId: '401', issueId: '71' }, body: { outcome: 'deferred' }, user: { id: 5 } },
  ];
  for (const request of invalidDecisionRequests) {
    assert.equal((await callController(request, controller.decideAlternative)).statusCode, 400);
  }
  assert.equal(suggestAlternative.mock.callCount(), 0);
  assert.equal(decideAlternative.mock.callCount(), 0);
});

// AC3 - Accepting an offer transfers the affected quantity and resolves the original issue.
test('AC3 - accepts a still-available offer and transfers the reservation quantity', async () => {
  // Arrange
  const issue = replacementIssue({ suggestion_status: 'pending', suggested_inventory_id: 93 });
  const { client, statements } = createWorkflowDatabase({
    issue,
    alternatives: [{ id: 93, asset_code: 'MIC-002', available_quantity: 2 }],
  });
  mock.method(pool, 'connect', async () => client);
  const supportNotifications = [];
  const emailedNotifications = [];
  mock.method(notificationService, 'insertNotifications', async (_db, notes) => {
    supportNotifications.push(...notes);
    return notes.map(note => ({ id: 11, email: 'support@example.test', ...note }));
  });
  mock.method(notificationService, 'emailNotifications', async stored => {
    assert.equal(statements.at(-1).sql, 'COMMIT');
    emailedNotifications.push(...stored);
    return stored.length;
  });

  // Act
  const result = await workflow.decideAlternative(401, 71, 5, 'accepted');

  // Assert: the old allocation is removed, quantity is merged onto the replacement, and the issue is resolved.
  assert.deepEqual(result, { issueId: 71, outcome: 'accepted' });
  const queries = statements.map(({ sql }) => sql);
  assert.ok(queries.findIndex(sql => /FROM equipments WHERE id=ANY/.test(sql)) <
    queries.findIndex(sql => /FROM equipments stock/.test(sql)));
  assert.deepEqual(statements.find(({ sql }) => /DELETE FROM event_equipment_reservation_items/.test(sql)).values, [301, 92]);
  assert.deepEqual(statements.find(({ sql }) => /INSERT INTO event_equipment_reservation_items/.test(sql)).values, [301, 93, 2]);
  assert.match(statements.find(({ sql }) => /suggestion_status='accepted'/.test(sql)).sql, /status='resolved'/);
  assert.equal(statements.at(-1).sql, 'COMMIT');
  assert.deepEqual(supportNotifications, [{
    userId: 6,
    eventId: 401,
    changeRequestId: null,
    type: 'equipment_reservation_affected',
    title: 'Replacement accepted: Town Hall',
    message: 'The coordinator accepted the replacement for MIC-001. The reservation has been updated.',
    details: { issueId: 71, reservationId: 301, outcome: 'accepted' },
  }]);
  assert.deepEqual(emailedNotifications, [{
    id: 11,
    email: 'support@example.test',
    ...supportNotifications[0],
  }]);
});

// AC3/AC4 - Rejection keeps the issue open and notifies assigned Technical Support Staff.
test('AC3/AC4 - rejects an offer, preserves the reservation, and notifies assigned support staff', async () => {
  // Arrange
  const issue = replacementIssue({ suggestion_status: 'pending', suggested_inventory_id: 93 });
  const { client, statements } = createWorkflowDatabase({ issue });
  const supportNotifications = [];
  const emailedNotifications = [];
  mock.method(pool, 'connect', async () => client);
  mock.method(notificationService, 'insertNotifications', async (_db, notes) => {
    supportNotifications.push(...notes);
    return notes.map(note => ({ id: 12, email: 'support@example.test', ...note }));
  });
  mock.method(notificationService, 'emailNotifications', async stored => {
    assert.equal(statements.at(-1).sql, 'COMMIT');
    emailedNotifications.push(...stored);
    return stored.length;
  });

  // Act
  const result = await workflow.decideAlternative(401, 71, 5, 'rejected');

  // Assert: rejection changes only offer decision metadata and leaves the issue eligible for staff follow-up.
  assert.deepEqual(result, { issueId: 71, outcome: 'rejected' });
  assert.equal(statements.some(({ sql }) => /DELETE FROM event_equipment_reservation_items/.test(sql)), false);
  assert.equal(statements.some(({ sql }) => /INSERT INTO event_equipment_reservation_items/.test(sql)), false);
  assert.match(statements.find(({ sql }) => /suggestion_status='rejected'/.test(sql)).sql, /WHERE id=\$1/);
  assert.doesNotMatch(statements.find(({ sql }) => /suggestion_status='rejected'/.test(sql)).sql, /status='resolved'/);
  assert.equal(statements.at(-1).sql, 'COMMIT');
  assert.deepEqual(supportNotifications, [{
    userId: 6,
    eventId: 401,
    changeRequestId: null,
    type: 'equipment_reservation_affected',
    title: 'Replacement rejected: Town Hall',
    message: 'The coordinator rejected the replacement for MIC-001. Follow up with the coordinator.',
    details: { issueId: 71, reservationId: 301, outcome: 'rejected' },
  }]);
  assert.deepEqual(emailedNotifications, [{
    id: 12,
    email: 'support@example.test',
    ...supportNotifications[0],
  }]);
});

// AC3 - Acceptance is refused when inventory changes after a coordinator receives the offer.
test('AC3 - rejects acceptance if the replacement is no longer available', async () => {
  // Arrange
  const issue = replacementIssue({ suggestion_status: 'pending', suggested_inventory_id: 93 });
  const { client, statements } = createWorkflowDatabase({ issue });
  mock.method(pool, 'connect', async () => client);

  // Act and assert
  await assert.rejects(
    workflow.decideAlternative(401, 71, 5, 'accepted'),
    error => error.status === 409,
  );
  assert.equal(statements.some(({ sql }) => /DELETE FROM event_equipment_reservation_items/.test(sql)), false);
  assert.equal(statements.at(-1).sql, 'ROLLBACK');
});

// AC3 - Only the coordinator assigned to the event can decide its pending replacement offer.
test('AC3 - refuses a replacement decision from a different event coordinator', async () => {
  // Arrange
  const issue = replacementIssue({
    coordinator_id: 8,
    suggestion_status: 'pending',
    suggested_inventory_id: 93,
  });
  const { client, statements } = createWorkflowDatabase({ issue });
  mock.method(pool, 'connect', async () => client);

  // Act and assert: an unassigned coordinator cannot change the offer or reservation.
  await assert.rejects(
    workflow.decideAlternative(401, 71, 5, 'accepted'),
    error => error.status === 404,
  );
  assert.equal(statements.some(({ sql }) => /DELETE FROM event_equipment_reservation_items/.test(sql)), false);
  assert.equal(statements.some(({ sql }) => /suggestion_status='accepted'/.test(sql)), false);
  assert.equal(statements.at(-1).sql, 'ROLLBACK');
});

// AC1 - A stale dropdown selection cannot overwrite equipment already transitioned by another staff member.
test('AC1 - rolls back when equipment is no longer Available', async () => {
  // Arrange
  const { client, queries } = createDatabase({ equipmentRows: [] });
  mock.method(pool, 'connect', async () => client);
  mock.method(notificationService, 'insertNotifications', async () => []);
  mock.method(notificationService, 'emailNotifications', async () => 0);

  // Act
  await assert.rejects(
    workflow.markUnavailable(92, 'Battery failed inspection', 9),
    error => error.status === 409,
  );

  // Assert: the conflict aborts before audit or reservation writes.
  assert.ok(queries.some(({ sql }) => sql === 'ROLLBACK'));
  assert.equal(queries.some(({ sql }) =>
    /equipment_status_history|equipment_reservation_unavailability/.test(sql)), false);
});

// AC3 - The migration persists impact records and allows notifications through every rerunnable type constraint.
test('AC3 - creates protected reservation-impact records and permits impact notifications', () => {
  // Arrange
  const migration = fs.readFileSync(
    path.join(__dirname, '../../backend/src/db/migrations/014-equipment-reservation-unavailability.sql'),
    'utf8',
  );

  // Assert: missing the issue table, access controls, or notification type breaks the full transition flow.
  assert.match(migration, /CREATE TABLE IF NOT EXISTS equipment_reservation_unavailability/);
  assert.match(migration, /ALTER TABLE equipment_reservation_unavailability ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /'equipment_reservation_affected'/);
});
