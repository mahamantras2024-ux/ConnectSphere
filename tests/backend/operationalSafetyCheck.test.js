// File: Tests the Operational Feasibility Check story through the real API with mocked database and email boundaries.
// Test scope: Real routes, auth/role middleware, controllers, rules and services; pool.query, the transaction client and
// email are replaced. AC1 the officer sees the safety facts; AC2 approve/reject/request changes; AC3 a change request
// returns the event to the named planning stages; AC4 another check is needed after changes; AC5 no approval to
// proceed until the check passes. The real SQL of each write is exercised in eventDecisionPostgres.test.js.
const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('../../backend/node_modules/jsonwebtoken');
process.env.JWT_SECRET = 'operational-safety-check-secret';
process.env.NODE_ENV = 'test';
const { pool } = require('../../backend/src/config/db');
const emailService = require('../../backend/src/services/emailService');
const app = require('../../backend/src/index');
let server, base;

const organiser = { id: 12, email: 'olivia@example.com', role: 'event_organiser', auth_version: 0 };
const coordinator = { id: 30, email: 'chris@example.com', role: 'event_coordinator', auth_version: 0 };
const safetyOfficer = { id: 50, email: 'sam@example.com', role: 'safety_officer', auth_version: 0 };
// Event 101: venue confirmed, a projector confirmed by Technical Support, nothing outstanding, no safety check yet.
const readyContext = {
  id: 101, name: 'Workshop', organiser_id: 12, coordinator_id: 30, status: 'submitted', is_draft: false,
  equipment_items: [{ item: 'Projector', quantity: 1 }], technical_support_required: false, video_conferencing_required: false,
  equipment_notes: null, equipment_confirmed_at: '2030-01-01T00:00:00Z', decision_reason: null, decided_at: null,
  decided_by_name: null, pending_clarifications: 0, bookings: [{ status: 'approved', hold_expires_at: null }],
  safety_changes_open: [], latest_safety_check: null,
};
// The same event after the Safety Officer asked for venue and event-detail changes.
const sentBack = {
  ...readyContext, safety_changes_open: ['venue', 'event_details'],
  latest_safety_check: { outcome: 'changes_requested', notes: 'Second exit needed', change_areas: ['venue', 'event_details'], safety_officer_name: 'Sam' },
};

// Signs a test-only JWT for the supplied user and current session version.
function token(user) { return jwt.sign({ sub: user.id, email: user.email, authVersion: 0 }, process.env.JWT_SECRET); }
// Calls the local test HTTP server and returns status plus JSON.
async function request(path, { user = coordinator, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(user)}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
}
// Answers authentication; `other` answers every remaining pool query (fails loudly by default).
function mockPool(user, other = (sql) => { throw new Error(`Unexpected pool query: ${sql}`); }) {
  const queries = [];
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('FROM users WHERE')) return { rows: [user] };
    queries.push({ sql, values });
    return other(sql, values);
  });
  return queries;
}
/**
 * Mocks the safety transaction and records every statement in order. `context` is the locked event (null = missing or
 * not assigned). The stage-completion UPDATE answers with the open stages minus the completed one, as PostgreSQL's
 * array_remove would; the live test checks the real statement.
 */
function mockTransaction(context) {
  // Clone mutable stage state so a transaction simulation cannot alter fixtures shared by later tests.
  context = context && { ...context, safety_changes_open: [...(context.safety_changes_open || [])] };
  const statements = [];
  mock.method(pool, 'connect', async () => ({
    release() {},
    async query(sql, values) {
      statements.push({ sql: sql.trim(), values });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql.trim())) return { rows: [] };
      if (sql.includes('AS pending_clarifications')) return { rows: context ? [context] : [] };
      if (sql.includes('INSERT INTO event_safety_checks')) return { rows: [{ id: 9, event_id: values[0], outcome: values[2], notes: values[3], change_areas: values[4] }] };
      if (sql.includes('array_remove(safety_changes_open')) {
        context.safety_changes_open = context.safety_changes_open.filter((area) => area !== values[1]);
        return { rows: [{ safety_changes_open: context.safety_changes_open }] };
      }
      if (sql.includes('UPDATE event_equipment_reservations')) return {rows:[]};
      if (sql.includes('UPDATE events SET safety_changes_open = $2')) return { rows: [] };
      if (/FROM users\s+WHERE role=\$1/.test(sql)) return { rows: [{ id: 50 }] };
      if (sql.includes('INSERT INTO notifications')) {
        return { rows: values[0].map((userId, index) => ({ id: index + 1, user_id: userId, title: values[4][index], message: values[5][index], email: `user${userId}@example.com` })) };
      }
      throw new Error(`Unexpected transaction statement: ${sql}`);
    },
  }));
  return {
    statements,
    find: (text) => statements.filter((statement) => statement.sql.includes(text)),
    words: () => statements.map((statement) => statement.sql).filter((sql) => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)),
  };
}
const recordCheck = (body, id = 101) => request(`/api/events/${id}/safety-checks`, { method: 'POST', body, user: safetyOfficer });
const resolve = (body, { id = 101, user = coordinator } = {}) => request(`/api/events/${id}/safety-changes/resolve`, { method: 'POST', body, user });

before(async () => {
  await new Promise((resolveListen, reject) => { server = app.listen(0, '127.0.0.1', resolveListen); server.on('error', reject); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() => mock.restoreAll());
after(async () => { if (server?.listening) await new Promise((done) => server.close(done)); await pool.end(); });

// ---------- AC1: the facts the Operational Safety Check needs ----------

// Test case: The queue carries each venue's safety facts and the event's equipment details, and hides sent-back events.
test('OFC AC1/AC4 - the safety queue shows venue safety facts and equipment details, and omits events awaiting changes', async () => {
  // Arrange: event 1 is ready; event 2 was sent back and still has an open stage.
  const venue = { name: 'Hall A', capacity: 100, supported_layouts: ['Theatre'], accessibility_features: ['Ramp'], operating_hours: '08:00 - 22:00',
    setup_minutes: 30, turnaround_minutes: 15, emergency_access: 'Two exits on Level 1', known_restrictions: 'No open flames' };
  const candidate = (id, changes) => ({ id, name: `Event ${id}`, status: 'submitted', is_draft: false, expected_attendance: 80,
    equipment_items: [{ item: 'Projector', quantity: 1 }], technical_support_required: false, video_conferencing_required: false,
    equipment_notes: null, equipment_confirmed_at: '2030-01-01T00:00:00Z', technical_specifications: 'Projector at the rear',
    bookings: [{ status: 'approved' }], venues: [venue], safety_changes_open: [], latest_safety_check: null, ...changes });
  const queries = mockPool(safetyOfficer, () => ({ rows: [candidate(1, {}), candidate(2, { safety_changes_open: ['venue'] })] }));
  // Act
  const result = await request('/api/safety/checks', { user: safetyOfficer });
  // Assert: only the ready event; its venue facts and placement details arrive intact; gating fields stay internal.
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.events.map((event) => event.id), [1]);
  assert.deepEqual(result.body.events[0].venues, [venue]);
  assert.equal(result.body.events[0].technical_specifications, 'Projector at the rear');
  assert.equal('safety_changes_open' in result.body.events[0], false);
  // The query reads each venue's safety facts and never the organiser's identity.
  assert.match(queries[0].sql, /'emergency_access', v\.emergency_access, 'known_restrictions', v\.known_restrictions/);
  // SCRUM-98 upload AC: the source documents must be selected for the Safety Officer, not just stored on the venue.
  assert.match(queries[0].sql, /'emergency_documents', v\.emergency_documents/);
  assert.doesNotMatch(queries[0].sql, /organiser|email|full_name/);
});

// ---------- AC2/AC3: requesting changes returns the event to planning ----------

// Test case: A change request stores the stages, reopens them in the same transaction and tells coordinator and organiser.
test('OFC AC2/AC3 - requesting technical and event-detail changes reopens both stages and notifies the coordinator and organiser', async () => {
  // Arrange
  mockPool(safetyOfficer);
  const tx = mockTransaction(readyContext);
  const sent = [];
  mock.method(emailService, 'sendNotificationEmail', async (to, title) => { sent.push([to, title]); });
  // Act
  const result = await recordCheck({ outcome: 'changes_requested', notes: ' Move the projector away from the exit ', changeAreas: ['technical', 'event_details'] });
  // Assert: response, stored check and the reopen write.
  assert.equal(result.status, 201);
  assert.equal(result.body.message, 'Safety check recorded. The Event Coordinator has been notified. The event has returned to planning for the requested changes.');
  assert.deepEqual(tx.find('INSERT INTO event_safety_checks')[0].values, [101, 50, 'changes_requested', 'Move the projector away from the exit', ['technical', 'event_details']]);
  const [reopen] = tx.find('UPDATE events SET safety_changes_open = $2');
  assert.deepEqual(reopen.values, [101, ['technical', 'event_details']]);
  // Reopening technical arrangements clears their confirmation and starts a new request version for Technical Support.
  assert.match(reopen.sql, /equipment_confirmed_at = CASE WHEN 'technical' = ANY\(\$2::text\[\]\) THEN NULL/);
  assert.match(reopen.sql, /equipment_requirements_version = equipment_requirements_version \+ CASE WHEN 'technical' = ANY\(\$2::text\[\]\) THEN 1/);
  // Everything happens in one transaction: lock, check, reopen, notifications, commit.
  assert.deepEqual(tx.words(), ['BEGIN', 'COMMIT']);
  assert.ok(tx.statements.indexOf(reopen) > tx.statements.indexOf(tx.find('INSERT INTO event_safety_checks')[0]));
  const [userIds, , , types, titles, messages] = tx.find('INSERT INTO notifications')[0].values;
  assert.deepEqual([userIds, types], [[30, 12], ['safety_check_recorded', 'safety_check_recorded']]);
  assert.deepEqual(titles, ['Safety check needs changes: Workshop', 'Changes needed for your event: Workshop']);
  assert.equal(messages[0], 'The Safety Officer recorded the operational safety check for Workshop: needs changes.\nChanges needed to: technical arrangements, event details.\nNotes: Move the projector away from the exit');
  assert.equal(messages[1], 'The Safety Officer requested changes to Workshop before it can proceed.\nChanges needed to: technical arrangements, event details.\nNotes: Move the projector away from the exit');
  assert.deepEqual(sent, [['user30@example.com', titles[0]], ['user12@example.com', titles[1]]]);
});

// Test case: Reopening only the venue stage stores just that stage; the organiser is still told what is needed.
test('OFC AC3 - requesting venue changes on an unassigned event reopens the venue stage and notifies only the organiser', async () => {
  mockPool(safetyOfficer);
  const tx = mockTransaction({ ...readyContext, coordinator_id: null });
  mock.method(emailService, 'sendNotificationEmail', async () => {});
  const result = await recordCheck({ outcome: 'changes_requested', notes: 'Hall too small', changeAreas: ['venue'] });
  assert.equal(result.status, 201);
  assert.equal(result.body.message, 'Safety check recorded. The event has returned to planning for the requested changes.');
  assert.deepEqual(tx.find('UPDATE events SET safety_changes_open = $2')[0].values, [101, ['venue']]);
  assert.deepEqual(tx.find('INSERT INTO notifications')[0].values[0], [12]);
});

// Test case: Approve and reject reopen nothing and do not involve the organiser (AC2).
for (const [outcome, notes] of [['approved', undefined], ['rejected', 'Fire exit blocked']]) {
  test(`OFC AC2 - a ${outcome} check reopens no planning stage and notifies only the coordinator`, async () => {
    mockPool(safetyOfficer);
    const tx = mockTransaction(readyContext);
    mock.method(emailService, 'sendNotificationEmail', async () => {});
    assert.equal((await recordCheck({ outcome, notes })).status, 201);
    assert.equal(tx.find('UPDATE events SET safety_changes_open').length, 0);
    assert.deepEqual(tx.find('INSERT INTO event_safety_checks')[0].values[4], []);
    assert.deepEqual(tx.find('INSERT INTO notifications')[0].values[0], [30]);
  });
}

// AC3 input rules for the stages: required for a change request, refused otherwise, known values once each.
for (const [label, body, message] of [
  ['no stages', { outcome: 'changes_requested', notes: 'Fix it' }, 'Choose which planning stages need changes.'],
  ['an empty stage list', { outcome: 'changes_requested', notes: 'Fix it', changeAreas: [] }, 'Choose which planning stages need changes.'],
  ['a single stage given as text', { outcome: 'changes_requested', notes: 'Fix it', changeAreas: 'venue' }, 'Choose which planning stages need changes.'],
  ['an unknown stage', { outcome: 'changes_requested', notes: 'Fix it', changeAreas: ['catering'] }, 'Choose each planning stage once: venue arrangements, technical arrangements or event details.'],
  ['an inherited property name', { outcome: 'changes_requested', notes: 'Fix it', changeAreas: ['constructor'] }, 'Choose each planning stage once: venue arrangements, technical arrangements or event details.'],
  ['a repeated stage', { outcome: 'changes_requested', notes: 'Fix it', changeAreas: ['venue', 'venue'] }, 'Choose each planning stage once: venue arrangements, technical arrangements or event details.'],
  ['stages on an approval', { outcome: 'approved', changeAreas: ['venue'] }, 'Planning stages can only be chosen when requesting changes.'],

]) {
  // Test case: One malformed stage selection is refused before the transaction starts.
  test(`OFC AC3 - a safety check with ${label} is refused`, async () => {
    mockPool(safetyOfficer);
    const tx = mockTransaction(readyContext);
    const result = await recordCheck(body);
    assert.deepEqual([result.status, result.body.message], [400, message]);
    assert.equal(tx.statements.length, 0);
  });
}

// Test case: Technical arrangements cannot be reopened for an event that asked for nothing technical.
test('OFC AC3 - reopening technical arrangements on an event with no technical needs is refused and nothing is written', async () => {
  mockPool(safetyOfficer);
  const tx = mockTransaction({ ...readyContext, equipment_items: [], equipment_confirmed_at: null });
  const result = await recordCheck({ outcome: 'changes_requested', notes: 'Add a PA system', changeAreas: ['technical'] });
  assert.deepEqual([result.status, result.body.code], [409, 'TECHNICAL_NOT_REQUESTED']);
  assert.equal(tx.find('INSERT INTO event_safety_checks').length, 0);
  assert.deepEqual(tx.words(), ['BEGIN', 'ROLLBACK']);
});

// ---------- AC4: another check only after the changes ----------

// Test case: While a stage is open the Safety Officer cannot record another check.
test('OFC AC4 - a new safety check is refused while requested changes are outstanding', async () => {
  mockPool(safetyOfficer);
  const tx = mockTransaction(sentBack);
  const result = await recordCheck({ outcome: 'approved' });
  assert.deepEqual([result.status, result.body.code], [409, 'SAFETY_CHANGES_OUTSTANDING']);
  assert.equal(tx.find('INSERT INTO event_safety_checks').length, 0);
});

// Test case: Once a check has passed or failed it is final: the event leaves the queue and another check is refused.
for (const outcome of ['approved', 'rejected']) {
  test(`OFC AC4/AC5 - after a ${outcome} check the event leaves the queue and no further check can be recorded`, async () => {
    // Arrange: event 1 still needs its check; event 2 already has this outcome.
    const candidate = (id, latest) => ({ id, name: `Event ${id}`, status: 'submitted', is_draft: false, equipment_items: [], technical_support_required: false,
      video_conferencing_required: false, equipment_notes: null, equipment_confirmed_at: null, bookings: [{ status: 'approved' }], venues: [],
      safety_changes_open: [], latest_safety_check: latest });
    mockPool(safetyOfficer, () => ({ rows: [candidate(1, null), candidate(2, { outcome, notes: outcome === 'rejected' ? 'Unsafe' : null })] }));
    // Act / Assert: the queue lists only the event still awaiting its check.
    assert.deepEqual((await request('/api/safety/checks', { user: safetyOfficer })).body.events.map((event) => event.id), [1]);
    mock.restoreAll();
    mockPool(safetyOfficer);
    const tx = mockTransaction({ ...readyContext, latest_safety_check: { outcome } });
    const result = await recordCheck({ outcome: 'approved' });
    assert.deepEqual([result.status, result.body.code], [409, 'SAFETY_CHECK_COMPLETE']);
    assert.equal(tx.find('INSERT INTO event_safety_checks').length, 0);
  });
}

// Test case: The assigned coordinator completes one stage; the other stays open.
test('OFC AC3/AC4 - the assigned coordinator marks a completed stage and the rest stay open', async () => {
  // Arrange
  mockPool(coordinator);
  const tx = mockTransaction(sentBack);
  // Act
  const result = await resolve({ area: 'venue' });
  // Assert: scoped to the assigned coordinator under a row lock, and only the venue stage removed.
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { open: ['event_details'], message: 'Stage marked complete.' });
  const [load] = tx.find('AS pending_clarifications');
  assert.deepEqual(load.values, [101, 30]);
  assert.match(load.sql, /AND e\.coordinator_id = \$2 FOR UPDATE OF e/);
  assert.deepEqual(tx.find('array_remove(safety_changes_open')[0].values, [101, 'venue']);
  assert.deepEqual(tx.words(), ['BEGIN', 'COMMIT']);
});

// Test case: Completing the last stage returns the event to the Safety Officer for a re-check.
test('OFC AC4 - completing the last open stage returns the event for another safety check', async () => {
  mockPool(coordinator);
  mockTransaction({ ...sentBack, safety_changes_open: ['event_details'] });
  const result = await resolve({ area: 'event_details' });
  assert.deepEqual(result.body, { open: [], message: 'All requested changes are complete. The event is ready for another safety check.' });
});

// A stage can only be completed when it is open and its arrangement is in place again.
for (const [label, context, area, status, code] of [
  ['a stage that was not reopened', sentBack, 'technical', 409, 'SAFETY_CHANGE_NOT_OPEN'],
  ['the venue stage with no confirmed venue', { ...sentBack, bookings: [] }, 'venue', 409, 'VENUE_NOT_CONFIRMED'],
  ['the technical stage before Technical Support re-confirms', { ...sentBack, safety_changes_open: ['technical'], equipment_confirmed_at: null }, 'technical', 409, 'TECHNICAL_NOT_CONFIRMED'],
  ['event details while a clarification is owed', { ...sentBack, pending_clarifications: 1 }, 'event_details', 409, 'CLARIFICATION_OUTSTANDING'],
  ['an event assigned to someone else', null, 'venue', 404, undefined],
]) {
  // Test case: One refused stage completion; nothing is changed.
  test(`OFC AC4 - completing ${label} is refused`, async () => {
    mockPool(coordinator);
    const tx = mockTransaction(context);
    const result = await resolve({ area });
    assert.deepEqual([result.status, result.body.code], [status, code]);
    assert.equal(tx.find('array_remove').length, 0);
    assert.deepEqual(tx.words(), ['BEGIN', 'ROLLBACK']);
  });
}
// Test case: Malformed stage-completion requests are refused before the transaction starts.
for (const [label, body, id] of [['an unknown stage', { area: 'catering' }, 101], ['an inherited property name', { area: 'toString' }, 101], ['no stage', {}, 101], ['event id 0', { area: 'venue' }, '0']]) {
  test(`OFC AC4 - completing a stage with ${label} is refused`, async () => {
    mockPool(coordinator);
    const tx = mockTransaction(sentBack);
    assert.equal((await resolve(body, { id })).status, 400);
    assert.equal(tx.statements.length, 0);
  });
}
// Test case: Only Event Coordinators complete stages (the organiser, Safety Officer and other staff cannot).
for (const role of ['event_organiser', 'safety_officer', 'event_coordinator_lead', 'technical_support', 'venue_staff']) {
  test(`OFC AC4 - a ${role} cannot mark a requested change complete`, async () => {
    const user = { id: 70, email: `${role}@example.com`, role, auth_version: 0 };
    mockPool(user);
    const tx = mockTransaction(sentBack);
    assert.equal((await resolve({ area: 'venue' }, { user })).status, 403);
    assert.equal(tx.statements.length, 0);
  });
}

// ---------- AC3/AC5: what the event page shows ----------

// Test case: The coordinator sees each open stage and whether it can be completed yet; approval stays blocked (AC5).
test('OFC AC3/AC5 - the coordinator sees the open stages, which can be completed, and that approval is blocked', async () => {
  mockPool(coordinator, (sql) => (sql.includes('AS pending_clarifications') ? { rows: [{ ...sentBack, pending_clarifications: 1 }] } : { rows: [{ id: 101 }] }));
  const result = await request('/api/events/101/decision');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.safetyChanges, {
    open: [{ area: 'venue', blocked: null }, { area: 'event_details', blocked: { code: 'CLARIFICATION_OUTSTANDING', message: 'A clarification from the organiser is still outstanding.' } }],
    notes: 'Second exit needed',
  });
  assert.equal(result.body.allowed.approved, false);
  assert.equal(result.body.blocked.approved.code, 'CLARIFICATION_OUTSTANDING');
});
// Test case: The organiser sees what must change and the officer's notes, without the coordinator's completion detail.
test('OFC AC3 - the organiser sees which stages need changes and the Safety Officer notes', async () => {
  mockPool(organiser, (sql) => (sql.includes('AS pending_clarifications') ? { rows: [sentBack] } : { rows: [{ id: 101 }] }));
  const result = await request('/api/events/101/decision', { user: organiser });
  assert.deepEqual(result.body, { status: 'submitted', outcome: null, safetyChanges: { open: [{ area: 'venue' }, { area: 'event_details' }], notes: 'Second exit needed' } });
});
// Test case: Once the changes are complete the page no longer reports them, but approval still needs a new check (AC5).
test('SCRUM-92 AC6 / OFC AC4/AC5 - final confirmation waits for a new passed check', async () => {
  mockPool(coordinator, (sql) => (sql.includes('AS pending_clarifications') ? { rows: [{ ...sentBack, status: 'planning', safety_changes_open: [] }] } : { rows: [{ id: 101 }] }));
  const result = await request('/api/events/101/decision');
  assert.equal('safetyChanges' in result.body, false);
  assert.equal(result.body.transitions.find(action => action.status === 'confirmed').blocked.code, 'SAFETY_CHANGES_REQUESTED');
});

// Regression: a rejected safety check that named revision stages returns to the queue after the final stage is resolved.
test('OFC AC4/AC5 - completing revisions after a rejected check notifies Safety Officers for reassessment', async () => {
  mockPool(coordinator);
  const tx = mockTransaction({ ...readyContext, safety_changes_open: ['venue'], latest_safety_check: {
    outcome: 'rejected', notes: 'Unsafe venue layout', change_areas: ['venue'],
  } });
  mock.method(emailService, 'sendNotificationEmail', async () => {});
  const result = await resolve({ area: 'venue' });
  assert.equal(result.status, 200);
  const safetyInsert = tx.find('INSERT INTO notifications').find(({ values }) => values[3].includes('safety_check_ready'));
  assert.ok(safetyInsert);
  assert.deepEqual(safetyInsert.values[3], ['safety_check_ready']);
  assert.equal(safetyInsert.values[4][0], 'Ready for safety re-review: Workshop');
  assert.equal(JSON.parse(safetyInsert.values[6][0]).requirement, 'reassessment');
});

// Safety stock AC1–AC3: only technical rework invalidates active equipment allocations.
for(const [outcome,areas,releases] of [
 ['rejected',['technical'],true],['changes_requested',['technical'],true],
 ['rejected',['venue'],false],['approved',[],false],
])test(`Safety stock AC1 AC2 - ${outcome} with ${areas.join('/')||'no reopened stages'} releases=${releases}`,async()=>{
 mockPool(safetyOfficer);
 const tx=mockTransaction({...readyContext,latest_safety_check:null});
 mock.method(emailService,'sendNotificationEmail',async()=>{});
 const body={outcome,...(outcome==='approved'?{}:{notes:'Rework the arrangement',changeAreas:areas})};
 assert.equal((await recordCheck(body)).status,201);
 const release=tx.find('UPDATE event_equipment_reservations');
 assert.equal(release.length,releases?1:0);
 if(releases){assert.deepEqual(release[0].values,[101,50]);assert.match(release[0].sql,/status='reserved'/);assert.match(release[0].sql,/released_by=\$2/);assert.match(release[0].sql,/released_at=now\(\)/);}
 assert.deepEqual(tx.words(),['BEGIN','COMMIT']);
});
