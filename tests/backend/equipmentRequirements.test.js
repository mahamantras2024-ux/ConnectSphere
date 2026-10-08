// File: Tests the Specify Equipment & Technical Support Requirements story through the real event API with mocked queries.
// Test scope: Real routes, auth middleware, controllers and validation; only PostgreSQL (pool.query) is replaced.
// AC1 items/quantities/support needs; AC2 special technical specifications; AC3 updates before confirmation; AC4 confirmation message.
const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('../../backend/node_modules/jsonwebtoken');
process.env.JWT_SECRET = 'equipment-tests-secret';
process.env.NODE_ENV = 'test';
const { pool } = require('../../backend/src/config/db');
const app = require('../../backend/src/index');
let server, base;

const organiser = { id: 12, email: 'alice@example.com', full_name: 'Alice', role: 'event_organiser', auth_version: 0 };
// Event as stored before Technical Support confirms anything; coordinator 30 is assigned.
const storedEvent = { id: 101, organiser_id: 12, coordinator_id: 30, name: 'Workshop', status: 'submitted',
  equipment_items: [{ item: 'Wireless microphone', quantity: 2 }, { item: 'Projector', quantity: 1 }],
  technical_support_required: false, technical_support_details: null, video_conferencing_required: false,
  technical_specifications: null, equipment_confirmed: false };
const fullEquipment = {
  equipmentItems: [{ item: 'Wireless microphone', quantity: 2 }, { item: 'Projector', quantity: 1 }],
  technicalSupportRequired: true, technicalSupportDetails: 'On-site AV technician 09:00-12:00',
  videoConferencingRequired: true, technicalSpecifications: 'Zoom link for 50 remote participants; record the keynote',
};

// Signs a test-only JWT for the supplied user and current session version.
function token(user = organiser) { return jwt.sign({ sub: user.id, role: user.role, email: user.email, authVersion: user.auth_version }, process.env.JWT_SECRET); }
// Calls the local test HTTP server with the requested payload/session and returns status plus JSON.
async function request(path, { user = organiser, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(user)}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
}
// Mocks the database for event creation: the auth lookup returns `user`, and INSERT echoes a saved row.
// Returns the recorded INSERT values so tests can assert exactly what would be persisted.
function mockCreate(user = organiser) {
  const inserts = [];
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('FROM users WHERE')) return { rows: [user] };
    inserts.push(values);
    return { rows: [{ id: 101, name: values[1], is_draft: values[16] }] };
  });
  return inserts;
}
// Mocks the database for PUT /equipment: the auth lookup, the scoped event read, then whichever write the handler issues.
// `event` null simulates a non-owned/missing event; `writeResult` null simulates a guarded write that matched no row.
function mockUpdate({ event = storedEvent, writeResult = { ...storedEvent } } = {}) {
  const writes = [];
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('FROM users WHERE')) return { rows: [organiser] };
    if (sql.includes('FROM events e') && sql.includes('JOIN users organiser')) return { rows: event ? [event] : [] };
    writes.push({ sql, values });
    return { rows: writeResult ? [writeResult] : [] };
  });
  return writes;
}
const create = (body) => request('/api/events', { method: 'POST', body: { name: 'Workshop', proposedDate: '2030-10-15', proposedStartTime: '09:00', proposedEndTime: '12:00', expectedAttendance: 50, isDraft: false, ...body } });
const updateEquipment = (body, id = 101) => request(`/api/events/${id}/equipment`, { method: 'PUT', body });

before(async () => {
  // Starts a local test HTTP server on a free port.
  await new Promise((resolve, reject) => { server = app.listen(0, '127.0.0.1', resolve); server.on('error', reject); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() => mock.restoreAll());
after(async () => { if (server?.listening) await new Promise((resolve) => server.close(resolve)); await pool.end(); });

for (const isDraft of [true, false]) {
  // Test case: Saves a draft and a submitted request with items, quantities and a support need; checks persisted values and the confirmation.
  test(`EQ AC1/AC4 - ${isDraft ? 'draft' : 'submitted'} request persists equipment items, quantities and technical support needs`, async () => {
    // Arrange
    const inserts = mockCreate();
    // Act
    const result = await create({ ...fullEquipment, isDraft });
    // Assert: values 18-22 are the new equipment columns; the owner still comes from the session.
    assert.equal(result.status, 201);
    assert.equal(result.body.message, isDraft ? 'Draft saved.' : 'Event request submitted.');
    const values = inserts[0];
    assert.equal(values[0], 12);
    assert.deepEqual(JSON.parse(values[18]), fullEquipment.equipmentItems);
    assert.deepEqual(values.slice(19, 23), [true, 'On-site AV technician 09:00-12:00', true, fullEquipment.technicalSpecifications]);
  });
}

// Test case: Submits a request without any equipment fields; equipment is optional so it saves an empty, no-support requirement.
test('EQ AC1 - equipment is optional: omitted fields save no items and no technical support', async () => {
  const inserts = mockCreate();
  const result = await create({});
  assert.equal(result.status, 201);
  assert.deepEqual([JSON.parse(inserts[0][18]), ...inserts[0].slice(19, 23)], [[], false, null, false, null]);
});

// Quantity must be a whole number of units from 1 to 9999 (agreed implementation guard).
// Probes just below/at/above both ends, plus values a careless implementation might coerce.
for (const [quantity, expectedStatus] of [[0, 400], [1, 201], [2, 201], [9998, 201], [9999, 201], [10000, 400], [-1, 400], [1.5, 400], ['2', 400], [null, 400]]) {
  // Test case: Submits one item with the boundary quantity and checks it is saved exactly or rejected without an insert.
  test(`EQ AC1 - quantity ${JSON.stringify(quantity)} is ${expectedStatus === 201 ? 'accepted' : 'rejected'}`, async () => {
    const inserts = mockCreate();
    const result = await create({ equipmentItems: [{ item: 'Projector', quantity }] });
    assert.equal(result.status, expectedStatus);
    if (expectedStatus === 201) assert.deepEqual(JSON.parse(inserts[0][18]), [{ item: 'Projector', quantity }]);
    else { assert.equal(inserts.length, 0); assert.match(result.body.message, /Quantity for Projector must be a whole number from 1 to 9999/); }
  });
}

// Item names are required, trimmed and limited to 255 characters.
for (const [label, item, expected] of [['blank', '', 400], ['whitespace-only', '   ', 400], ['missing', undefined, 400],
  ['255 characters', 'x'.repeat(255), 201], ['256 characters', 'x'.repeat(256), 400]]) {
  // Test case: Submits an item name at the validation boundary and checks the outcome.
  test(`EQ AC1 - ${label} item name is ${expected === 201 ? 'accepted' : 'rejected'}`, async () => {
    const inserts = mockCreate();
    const result = await create({ equipmentItems: [{ item, quantity: 1 }] });
    assert.equal(result.status, expected);
    assert.equal(inserts.length, expected === 201 ? 1 : 0);
  });
}

// Test case: Pads an item name with spaces and checks the stored name is trimmed.
test('EQ AC1 - item names are stored trimmed', async () => {
  const inserts = mockCreate();
  await create({ equipmentItems: [{ item: '  Lectern  ', quantity: 1 }] });
  assert.deepEqual(JSON.parse(inserts[0][18]), [{ item: 'Lectern', quantity: 1 }]);
});

// Test case: Lists the same item twice with different case/spacing; it would double-count stock, so it is rejected.
test('EQ AC1 - an item repeated with different case or spacing is rejected', async () => {
  const inserts = mockCreate();
  const result = await create({ equipmentItems: [{ item: 'Projector', quantity: 1 }, { item: ' projector ', quantity: 2 }] });
  assert.equal(result.status, 400);
  assert.match(result.body.message, /listed once/);
  assert.equal(inserts.length, 0);
});

// Up to 50 distinct items are accepted; 51 or a non-list are rejected.
for (const [label, equipmentItems, expected] of [
  ['50 items', Array.from({ length: 50 }, (_, index) => ({ item: `Item ${index}`, quantity: 1 })), 201],
  ['51 items', Array.from({ length: 51 }, (_, index) => ({ item: `Item ${index}`, quantity: 1 })), 400],
  ['a non-list value', { item: 'Projector', quantity: 1 }, 400],
  ['a null entry', [null], 400],
]) {
  // Test case: Submits an item list at or past the size/shape boundary and checks the outcome.
  test(`EQ AC1 - equipment list with ${label} is ${expected === 201 ? 'accepted' : 'rejected'}`, async () => {
    const inserts = mockCreate();
    assert.equal((await create({ equipmentItems })).status, expected);
    assert.equal(inserts.length, expected === 201 ? 1 : 0);
  });
}

// Technical support needs: details are required when support is requested and contradict the flag otherwise.
for (const [label, fields, expected, message] of [
  ['required with blank details', { technicalSupportRequired: true, technicalSupportDetails: '' }, 400, /Describe the technical support/],
  ['required with whitespace details', { technicalSupportRequired: true, technicalSupportDetails: '   ' }, 400, /Describe the technical support/],
  ['required without details', { technicalSupportRequired: true }, 400, /Describe the technical support/],
  ['not required but details given', { technicalSupportRequired: false, technicalSupportDetails: 'Technician' }, 400, /apply only when technical support is required/],
  ['flag sent as text', { technicalSupportRequired: 'true', technicalSupportDetails: 'Technician' }, 400, /technicalSupportRequired must be true or false/],
  ['details sent as a list', { technicalSupportRequired: true, technicalSupportDetails: ['Technician'] }, 400, /technicalSupportDetails must be text/],
  ['10000-character details', { technicalSupportRequired: true, technicalSupportDetails: 'x'.repeat(10000) }, 201],
  ['10001-character details', { technicalSupportRequired: true, technicalSupportDetails: 'x'.repeat(10001) }, 400, /at most 10000/],
]) {
  // Test case: Submits a technical-support combination and checks it is saved or rejected with a relevant message.
  test(`EQ AC1 - technical support ${label} is ${expected === 201 ? 'accepted' : 'rejected'}`, async () => {
    const inserts = mockCreate();
    const result = await create(fields);
    assert.equal(result.status, expected);
    if (message) assert.match(result.body.message, message);
    assert.equal(inserts.length, expected === 201 ? 1 : 0);
  });
}

// Special technical specifications (AC2): a video-conferencing/hybrid flag plus free-text specification.
for (const [label, fields, expected] of [
  ['hybrid flag with 10000-character specification', { videoConferencingRequired: true, technicalSpecifications: 'x'.repeat(10000) }, 201],
  ['10001-character specification', { technicalSpecifications: 'x'.repeat(10001) }, 400],
  ['specification sent as an object', { technicalSpecifications: { platform: 'Zoom' } }, 400],
  ['hybrid flag sent as text', { videoConferencingRequired: 'yes' }, 400],
]) {
  // Test case: Submits a technical specification at a boundary and checks it is stored or rejected.
  test(`EQ AC2 - ${label} is ${expected === 201 ? 'accepted' : 'rejected'}`, async () => {
    const inserts = mockCreate();
    assert.equal((await create(fields)).status, expected);
    if (expected === 201) assert.deepEqual(inserts[0].slice(21, 23), [true, 'x'.repeat(10000)]);
    else assert.equal(inserts.length, 0);
  });
}

// Test case: Reads an event and checks the detail query selects every equipment field and the confirmation state.
test('EQ AC1/AC2 - event details include equipment items, support needs, specifications and confirmation state', async () => {
  mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM users WHERE')) return { rows: [organiser] };
    for (const column of ['e.equipment_items', 'e.technical_support_required', 'e.technical_support_details',
      'e.video_conferencing_required', 'e.technical_specifications', 'equipment_confirmed_at IS NOT NULL AS equipment_confirmed']) {
      assert.ok(sql.includes(column), `detail query selects ${column}`);
    }
    return { rows: [storedEvent] };
  });
  const result = await request('/api/events/101');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.event.equipment_items, storedEvent.equipment_items);
});

// Test case: Replaces the stored list before confirmation; the removed projector must not survive and the organiser sees a confirmation.
test('EQ AC3/AC4 - before confirmation an update replaces the whole equipment list and confirms the save', async () => {
  // Arrange: stored list is microphone x2 + projector x1.
  const replacement = { equipmentItems: [{ item: 'Wireless microphone', quantity: 3 }, { item: 'Laptop', quantity: 1 }],
    videoConferencingRequired: true, technicalSpecifications: 'Hybrid panel' };
  const writes = mockUpdate({ writeResult: { ...storedEvent, equipment_items: replacement.equipmentItems } });
  // Act
  const result = await updateEquipment(replacement);
  // Assert: one guarded UPDATE carries exactly the new list (no merge with the stored projector).
  assert.equal(result.status, 200);
  assert.equal(result.body.message, 'Equipment requirements saved.');
  assert.equal(writes.length, 1);
  assert.match(writes[0].sql, /UPDATE events SET equipment_items=\$3::jsonb/);
  assert.match(writes[0].sql, /equipment_requirements_version=equipment_requirements_version\+1/);
  assert.match(writes[0].sql, /organiser_id=\$2 AND equipment_confirmed_at IS NULL/);
  assert.deepEqual(writes[0].values, ['101', 12, JSON.stringify(replacement.equipmentItems), false, null, true, 'Hybrid panel']);
  assert.deepEqual(result.body.event.equipment_items, replacement.equipmentItems);
});

// Test case: Technical Support confirms between the organiser's read and write; the guarded update matches nothing and reports a conflict.
test('EQ AC3 - a confirmation that lands mid-edit rejects the update instead of overwriting confirmed arrangements', async () => {
  const writes = mockUpdate({ writeResult: null });
  const result = await updateEquipment({ equipmentItems: [{ item: 'Laptop', quantity: 1 }] });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'ARRANGEMENT_CHANGED');
  assert.equal(writes.length, 1);
});

// Test case: Edits equipment after Technical Support confirmed it; the event is not changed and a change request goes to the assigned coordinator.
test('EQ AC3 - after confirmation an edit becomes a change request and confirmed equipment stays in effect', async () => {
  // Arrange
  const changes = { equipmentItems: [{ item: 'Wireless microphone', quantity: 4 }] };
  const changeRequest = { id: 7, event_id: 101, status: 'pending' };
  const writes = mockUpdate({ event: { ...storedEvent, equipment_confirmed: true }, writeResult: changeRequest });
  // Act
  const result = await updateEquipment(changes);
  // Assert: only an INSERT into change requests, gated on confirmation, addressed to coordinator 30.
  assert.equal(result.status, 202);
  assert.deepEqual(result.body.changeRequest, changeRequest);
  assert.match(result.body.message, /Change request submitted\. The confirmed equipment arrangements remain in effect/);
  assert.equal(writes.length, 1);
  assert.match(writes[0].sql, /INSERT INTO event_change_requests/);
  assert.match(writes[0].sql, /equipment_confirmed_at IS NOT NULL/);
  assert.doesNotMatch(writes[0].sql, /UPDATE events/);
  assert.deepEqual(writes[0].values.slice(0, 3), ['101', 12, 30]);
  assert.deepEqual(JSON.parse(writes[0].values[3]), { equipmentItems: changes.equipmentItems,
    technicalSupportRequired: false, technicalSupportDetails: null, videoConferencingRequired: false, technicalSpecifications: null });
});

// Test case: Confirmed equipment but no coordinator yet; there is nobody to review a change request, so nothing is written.
test('EQ AC3 - a confirmed edit without an assigned coordinator is refused without writing', async () => {
  const writes = mockUpdate({ event: { ...storedEvent, equipment_confirmed: true, coordinator_id: null } });
  const result = await updateEquipment({ equipmentItems: [] });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'COORDINATOR_NOT_ASSIGNED');
  assert.equal(writes.length, 0);
});

// Test case: The guarded change-request insert matches nothing (assignment changed mid-request) and the organiser is asked to refresh.
test('EQ AC3 - a change request whose event changed mid-request is reported as a conflict', async () => {
  mockUpdate({ event: { ...storedEvent, equipment_confirmed: true }, writeResult: null });
  const result = await updateEquipment({ equipmentItems: [] });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'ARRANGEMENT_CHANGED');
});

// Test case: Updates another organiser's (or a missing) event; the scoped read finds nothing and no write is attempted.
test('EQ AC3 - organisers cannot update equipment on events they do not own', async () => {
  const writes = mockUpdate({ event: null });
  const result = await updateEquipment({ equipmentItems: [] }, 2147483647);
  assert.equal(result.status, 404);
  assert.equal(writes.length, 0);
});

// Test case: Sends an invalid equipment body; validation fails before any event read or write.
test('EQ AC3 - invalid equipment updates are rejected before reading or writing the event', async () => {
  const writes = mockUpdate();
  const result = await updateEquipment({ equipmentItems: [{ item: 'Projector', quantity: 0 }] });
  assert.equal(result.status, 400);
  assert.equal(writes.length, 0);
});

// Event IDs must be positive integers within PostgreSQL's INTEGER range.
for (const id of ['0', '-1', 'abc', '2147483648']) {
  // Test case: Uses an invalid event ID and checks the update is rejected without database access beyond authentication.
  test(`EQ AC3 - invalid event ID ${id} is rejected`, async () => {
    const writes = mockUpdate();
    assert.equal((await updateEquipment({ equipmentItems: [] }, id)).status, 400);
    assert.equal(writes.length, 0);
  });
}

// Only the organiser who owns the request may specify its equipment.
for (const role of ['attendee', 'event_coordinator', 'technical_support', 'venue_staff']) {
  // Test case: Attempts the equipment update with another role and checks it is forbidden.
  test(`EQ AC1 - ${role} cannot specify equipment requirements`, async () => {
    const user = { ...organiser, role };
    mock.method(pool, 'query', async () => ({ rows: [user] }));
    assert.equal((await request('/api/events/101/equipment', { user, method: 'PUT', body: { equipmentItems: [] } })).status, 403);
  });
}

// Merge regression: equipment and uploaded evidence must occupy separate persisted columns.
test('EQ AC1 / Workflow AC5 - one event persists equipment and its question attachment together', async () => {
  // Arrange an actual PDF signature; the attachment validator remains real.
  const inserts = mockCreate();
  const file = { name: 'programme.pdf', data: Buffer.from('%PDF-1.4\nProgramme').toString('base64') };
  // Act through the authenticated event route.
  const result = await create({ ...fullEquipment, attachments: { technicalSpecifications: file } });
  // Assert independent business values, catching either feature overwriting the other in the INSERT.
  assert.equal(result.status, 201);
  assert.deepEqual(JSON.parse(inserts[0][18]), fullEquipment.equipmentItems);
  assert.deepEqual(JSON.parse(inserts[0][23]).technicalSpecifications, { ...file, type: 'application/pdf', size: Buffer.from('%PDF-1.4\nProgramme').length });
});
