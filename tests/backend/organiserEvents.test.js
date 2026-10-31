// File: Tests event ownership, creation validation, role restrictions, and external audience login with mocked queries.
// Test scope: Uses real handlers/services with controlled database/email/provider boundaries where configured.
const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('../../backend/node_modules/jsonwebtoken');
process.env.JWT_SECRET = 'event-tests-secret';
process.env.NODE_ENV = 'test';
const { pool } = require('../../backend/src/config/db');
const emailService = require('../../backend/src/services/emailService');
const app = require('../../backend/src/index');
let server, base;
const organiser = { id: 12, email: 'alice@example.com', full_name: 'Alice', role: 'event_organiser', auth_version: 0 };
const details = { id: 101, organiser_id: 12, name: 'Workshop', purpose: 'Community learning', description: 'Learn together',
  proposed_date: '2026-10-15', proposed_start_time: '09:00:00', proposed_end_time: '12:00:00', expected_attendance: 40,
  programme_details: '09:00 Welcome\n10:00 Workshop', room_layout_preference: 'classroom', accessibility_requirements: ['wheelchair access'],
  equipment_notes: 'Two microphones', registration_required: true, registration_capacity: 40,
  special_arrangements: 'Vegetarian lunch', organiser_name: 'Alice', status: 'submitted' };
// Direct edits apply only to a draft; a submitted request changes through an amendment request
// (Request All Post-Submission Amendments AC1/AC2).
const draft = { ...details, status: 'draft', is_draft: true };
const amendment = (changes) => ({ method: 'POST', body: { changes, explanation: 'Our plans changed.' } });
// Signs a test-only JWT for the supplied user and current session version.
function token(user = organiser) { return jwt.sign({ sub: user.id, role: user.role, email: user.email, authVersion: user.auth_version }, process.env.JWT_SECRET); }
// Calls the local test HTTP server with the requested payload/session and returns status plus JSON.
async function request(path, { user = organiser, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${token(user)}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
}
before(async () => {
  // Initializes clean test state, fixtures, mocks, or a local HTTP server before the test cases.

  await new Promise((resolve, reject) => {
    // Starts a local test HTTP server and resolves/rejects on startup.
     server = app.listen(0, '127.0.0.1', resolve); server.on('error', reject); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() => // Cleans up test state, mocks, mounted components, or local server/database resources.

      // Handles this operation using the surrounding screen or request state.
      mock.restoreAll());
after(async () => {
  // Cleans up test state, mocks, mounted components, or local server/database resources.
   if (server?.listening) await new Promise((resolve) => // Resolves when the test HTTP server finishes closing.

      // Handles this operation using the surrounding screen or request state.
      server.close(resolve)); await pool.end(); });

// Test case: Reads an accessible event and checks submitted fields and a query restricted to the authenticated organiser.
test('authorised organiser detail returns all submitted fields using a scoped SQL query', async () => {

  mock.method(pool, 'query', async (sql, values) => {
    // Supplies controlled query behavior for this regression case, including its expected result or failure.

    if (sql.includes('FROM users WHERE')) return { rows: [organiser] };
    assert.match(sql, /e\.id = \$1 AND e\.organiser_id = \$2/);
    assert.deepEqual(values, ['101', 12]);
    assert.doesNotMatch(sql, /SELECT \*/);
    assert.match(sql, /programme_details/); assert.match(sql, /special_arrangements/);
    return { rows: [details] };
  });
  const result = await request('/api/events/101');
  assert.equal(result.status, 200); assert.deepEqual(result.body.event, details);
});
// Test case: Lists My Events with a forged owner parameter and checks the query still uses the session identity.
test('My Events filters by authenticated organiser, ignoring supplied owner query parameters', async () => {

  mock.method(pool, 'query', async (sql, values) => {
    // Supplies controlled query behavior for this regression case, including its expected result or failure.

    if (sql.includes('FROM users WHERE')) return { rows: [organiser] };
    assert.match(sql, /WHERE organiser_id = \$1/); assert.deepEqual(values, [12]);
    return { rows: [details] };
  });
  const result = await request('/api/events?organiser_id=27');
  assert.equal(result.status, 200); assert.deepEqual(result.body.events, [details]);
});
for (const id of ['102', '999']) {
  // Test case: Requests another organiser event or an absent ID and checks neither exposes a record.
  test(`another organiser's event and missing events are unavailable: ${id}`, async () => {

    mock.method(pool, 'query', async (sql, values) => {
      // Supplies controlled query behavior for this regression case, including its expected result or failure.

      if (sql.includes('FROM users WHERE')) return { rows: [organiser] };
      assert.match(sql, /AND e\.organiser_id = \$2/); assert.equal(values[1], 12);
      return { rows: [] };
    });
    assert.deepEqual(await request(`/api/events/${id}`), { status: 404, body: { message: 'Event not found.' } });
  });
}
for (const path of ['/api/events', '/api/events/101']) {
  // Test case: Calls each private event-read endpoint without authentication and checks access denial.
  test(`unauthenticated read is denied: ${path}`, async () => {

    const query = mock.method(pool, 'query', async () => {
      // Supplies controlled query behavior for this regression case, including its expected result or failure.
       throw new Error('Unexpected query'); });
    assert.equal((await request(path, { user: null })).status, 401); assert.equal(query.mock.callCount(), 0);
  });
}
for (const id of ['0', '-1', 'abc', '1.5', '2147483648', '1%20OR%201=1']) {
  // Test case: Supplies malformed event IDs and checks validation rejects them.
  test(`invalid event ID is rejected: ${id}`, async () => {

    const query = mock.method(pool, 'query', async () => (// Supplies controlled query behavior for this regression case, including its expected result or failure.

      // Handles this operation using the surrounding screen or request state.
      { rows: [organiser] }));
    assert.equal((await request(`/api/events/${id}`)).status, 400); assert.equal(query.mock.callCount(), 1);
  });
}
for (const role of ['attendee', 'venue_staff', 'technical_support']) {
  // Test case: Tries each unsupported role against organiser details and checks the role guard denies access.
  test(`${role} cannot read organiser event details`, async () => {

    const user = { ...organiser, role };
    const query = mock.method(pool, 'query', async () => (// Supplies controlled query behavior for this regression case, including its expected result or failure.

      // Handles this operation using the surrounding screen or request state.
      { rows: [user] }));
    assert.equal((await request('/api/events/101', { user })).status, 403); assert.equal(query.mock.callCount(), 1);
  });
}
// Test case: Reads an assigned event as coordinator and checks its complete submitted fields.
test('coordinator retains access to assigned events with the same response fields', async () => {

  const user = { ...organiser, id: 30, role: 'event_coordinator' };
  mock.method(pool, 'query', async (sql, values) => {
    // Supplies controlled query behavior for this regression case, including its expected result or failure.

    if (sql.includes('FROM users WHERE')) return { rows: [user] };
    assert.match(sql, /AND e\.coordinator_id = \$2/); assert.equal(values[1], 30); return { rows: [details] };
  });
  assert.deepEqual((await request('/api/events/101', { user })).body.event, details);
});
const submission = { name: 'Workshop', purpose: details.purpose, proposedDate: '2026-10-15', proposedStartTime: '09:00', proposedEndTime: '12:00',
  expectedAttendance: 40, programmeDetails: details.programme_details, roomLayoutPreference: 'classroom', accessibilityRequirements: details.accessibility_requirements,
  equipmentNotes: details.equipment_notes, registrationRequired: false, registrationCapacity: 0, specialArrangements: details.special_arrangements, isDraft: false };
for (const isDraft of [true, false]) {
  // Test case: Creates draft and submitted requests and checks fields, server-assigned ownership and their appropriate states.
  test(`Workflow AC2 - creation saves fields and server-assigned owner (draft: ${isDraft})`, async () => {

    mock.method(pool, 'query', async (sql, values) => {
      // Supplies controlled query behavior for this regression case, including its expected result or failure.

      if (sql.includes('FROM users WHERE')) return { rows: [organiser] };
      assert.match(sql, /INSERT INTO events/);
      assert.equal(values[0], 12); assert.equal(values[8], isDraft ? 0 : 40); assert.equal(values[9], submission.programmeDetails);
      assert.equal(values[11], JSON.stringify(submission.accessibilityRequirements)); assert.equal(values[12], submission.equipmentNotes);
      assert.equal(values[13], false); assert.equal(values[14], 0); assert.equal(values[15], submission.specialArrangements);
      assert.equal(values[16], isDraft); assert.equal(values[17], isDraft ? 'draft' : 'submitted');
      return { rows: [{ ...details, is_draft: isDraft }] };
    });
    // Submitting runs in a transaction with the Coordinator Lead notification: route it to this mock, with no Leads.
    mock.method(pool, 'connect', async () => ({ release() {}, query: (sql, values) => (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql.trim())
      || /FROM users\s+WHERE role=\$1/.test(sql) ? { rows: [] } : pool.query(sql, values)) }));
    assert.equal((await request('/api/events', { method: 'POST', body: { ...submission, expectedAttendance: isDraft ? 0 : 40, isDraft, organiserId: 27, organiser_id: 27, status: 'approved' } })).status, 201);
  });
}
for (const invalid of [{ name: '' }, { programmeDetails: {} }, { specialArrangements: 'x'.repeat(10001) }, { expectedAttendance: -1 }, { proposedDate: '2026-02-30' }, { proposedStartTime: '26:00' }, { accessibilityRequirements: [{}] }, { registrationRequired: 'false' }]) {
  // Test case: Tries each invalid event payload and checks rejection without an insert.
  test(`invalid submission ${Object.keys(invalid)[0]} is rejected without an insert`, async () => {

    const query = mock.method(pool, 'query', async () => (// Supplies controlled query behavior for this regression case, including its expected result or failure.

      // Handles this operation using the surrounding screen or request state.
      { rows: [organiser] }));
    assert.equal((await request('/api/events', { method: 'POST', body: { ...submission, ...invalid } })).status, 400);
    assert.equal(query.mock.callCount(), 1);
  });
}
// Test case: Attempts organiser event creation as attendee and checks it is forbidden.
test('attendees cannot create organiser requests', async () => {

  const user = { ...organiser, role: 'attendee' };
  mock.method(pool, 'query', async () => (// Supplies controlled query behavior for this regression case, including its expected result or failure.

      // Handles this operation using the surrounding screen or request state.
      { rows: [user] }));
  assert.equal((await request('/api/events', { user, method: 'POST', body: submission })).status, 403);
});

// Test case: AC1 / AM AC1 - the organiser's own draft is updated directly, including critical fields.
test('AC1 / AM AC1 - a draft is updated directly, including critical fields', async () => {
  const updated = { ...draft, name: 'Renamed Workshop', updated_at: new Date() };
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('FROM users WHERE')) return { rows: [organiser] };
    if (sql.includes('FROM events e')) return { rows: [draft] };
    // The draft condition is part of the UPDATE, so an edit racing the submission cannot change the submitted request.
    assert.match(sql, /UPDATE events SET name=\$1/);
    assert.match(sql, /WHERE id=\$2 AND organiser_id=\$3 AND is_draft=true AND status='draft'/);
    assert.deepEqual(values, ['Renamed Workshop', '101', 12]);
    return { rows: [updated] };
  });
  const result = await request('/api/events/101/non-critical', { method: 'PUT', body: { name: 'Renamed Workshop' } });
  assert.equal(result.status, 200);
  assert.equal(result.body.message, 'Event information saved.');
});

// Test case: AM AC1 - after submission nothing is edited directly: critical or non-critical, venue confirmed or not.
for (const [field, value] of [['name', 'Updated title'], ['programmeDetails', 'Updated agenda'], ['registrationCapacity', 30]]) {
  for (const venueConfirmed of [false, true]) {
    test(`AM AC1 - a submitted request's ${field} cannot be edited directly (venue confirmed ${venueConfirmed})`, async () => {
      // Arrange: any write (update or change request) fails the test.
      const query = mock.method(pool, 'query', async (sql) => {
        if (sql.includes('FROM users WHERE')) return { rows: [organiser] };
        if (sql.includes('FROM events e')) return { rows: [{ ...details, coordinator_id: 30, venue_confirmed: venueConfirmed }] };
        assert.fail(`A submitted request must not be written directly: ${sql}`);
      });
      // Act
      const result = await request('/api/events/101/non-critical', { method: 'PUT', body: { [field]: value } });
      // Assert: refused with the amendment route; only the session and event reads ran.
      assert.equal(result.status, 409);
      assert.equal(result.body.code, 'AMENDMENT_REQUIRED');
      assert.match(result.body.message, /Request an amendment for your Event Coordinator to review/);
      assert.equal(query.mock.callCount(), 2);
    });
  }
}

// Test case: AC2 - a different organiser cannot update an event they do not own.
test('AC2 - non-owner event updates return not found without writing', async () => {
  const other = { ...organiser, id: 27 };
  const query = mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM users WHERE')) return { rows: [other] };
    if (sql.includes('FROM events e')) return { rows: [] };
    assert.fail('An event without an ownership match must not be updated.');
  });
  const result = await request('/api/events/101/non-critical', { user: other, method: 'PUT', body: { description: 'x' } });
  assert.equal(result.status, 404);
  assert.equal(query.mock.callCount(), 2);
});

// Test case: AM AC1 - a draft submitted between the read and the write is not changed by the direct edit.
test('AM AC1 - a direct edit racing the submission is rejected without applying the change', async () => {
  mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM users WHERE')) return { rows: [organiser] };
    if (sql.includes('FROM events e')) return { rows: [draft] };
    assert.match(sql, /is_draft=true AND status='draft'/);
    return { rows: [] };
  });
  const result = await request('/api/events/101/non-critical', { method: 'PUT', body: { name: 'Workshop v2' } });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'AMENDMENT_REQUIRED');
});

// Test case: AC3 - the assigned coordinator receives pending critical change requests in the dashboard inbox.
test('AC3 - pending critical changes are listed only for the assigned Event Coordinator', async () => {
  const coordinator = { ...organiser, id: 30, role: 'event_coordinator' };
  const pending = { id: 501, event_id: 101, event_name: 'Workshop', organiser_id: 12, organiser_name: 'Alice',
    requested_changes: { expectedAttendance: 55 }, status: 'pending' };
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('FROM users WHERE')) return { rows: [coordinator] };
    if (sql.includes('FROM venue_bookings vb JOIN venues')) return { rows: [] };
    assert.match(sql, /e\.coordinator_id=\$1 AND r\.status='pending'/);
    assert.deepEqual(values, [30]);
    return { rows: [{ ...pending, event_record: { expected_attendance: 40 } }] };
  });
  const result = await request('/api/events/change-requests', { user: coordinator });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.changeRequests, [{ ...pending,
    changes: [{ field: 'expectedAttendance', label: 'Expected attendance', current: 40, requested: 55 }], arrangements: [] }]);
});

// Test case: AC1/AC2 - coordinator fields and question are stored on the event and directed to its organiser.
test('AC1/AC2 - assigned coordinator sends a clarification request identifying incomplete information', async () => {
  const coordinator = { ...organiser, id: 30, role: 'event_coordinator' };
  const clarificationRequest = { id: 601, event_id: 101, coordinator_id: 30, organiser_id: 12,
    information_needed: ['expected_attendance', 'proposed_date'], message: 'Please confirm the count and date.', status: 'pending' };
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('FROM users WHERE')) return { rows: [coordinator] };
    assert.match(sql, /INSERT INTO event_clarification_requests/);
    assert.match(sql, /WHERE e\.id=\$1 AND e\.coordinator_id=\$2/);
    assert.deepEqual(values, ['101', 30, JSON.stringify(clarificationRequest.information_needed), clarificationRequest.message]);
    return { rows: [clarificationRequest] };
  });
  const result = await request('/api/events/101/clarifications', { user: coordinator, method: 'POST', body: { informationNeeded: clarificationRequest.information_needed, message: clarificationRequest.message } });
  assert.equal(result.status, 201);
  assert.deepEqual(result.body.clarificationRequest, clarificationRequest);
  assert.match(result.body.message, /sent to the Event Organiser/);
});

// Test case: AC1 - malformed or unselected clarification fields are rejected before any database write.
test('AC1 - clarification request requires valid identified information and a clear question', async () => {
  const coordinator = { ...organiser, id: 30, role: 'event_coordinator' };
  let writes = 0;
  mock.method(pool, 'query', async (sql) => { if (sql.includes('FROM users WHERE')) return { rows: [coordinator] }; writes += 1; return { rows: [] }; });
  for (const body of [{ informationNeeded: [], message: 'Please clarify.' }, { informationNeeded: ['unlisted'], message: 'Please clarify.' }, { informationNeeded: ['name'], message: ' ' }]) {
    const result = await request('/api/events/101/clarifications', { user: coordinator, method: 'POST', body });
    assert.equal(result.status, 400);
  }
  assert.equal(writes, 0);
});

// Test case: AC3/AC4/AC5 - organiser response is retained, visible to coordinator, and resolves the outstanding indicator.
test('AC3/AC4/AC5 - organiser response is retained and clears clarification outstanding state', async () => {
  const responded = { id: 601, event_id: 101, coordinator_id: 30, organiser_id: 12, information_needed: ['expected_attendance'],
    message: 'Please confirm the count.', status: 'responded', organiser_response: 'The expected attendance is 45.', responded_at: '2026-10-06T00:00:00Z' };
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('FROM users WHERE')) return { rows: [organiser] };
    if (sql.includes('UPDATE event_clarification_requests')) {
      assert.match(sql, /question.organiser_id=\$3 AND question.status='pending'/);
      assert.deepEqual(values, ['101', '601', 12, responded.organiser_response]);
      return { rows: [responded] };
    }
    // The outstanding flag is computed in SQL: only clarifications still pending may count, so a responded one clears it.
    assert.match(sql, /EXISTS \(SELECT 1 FROM event_clarification_requests cr WHERE cr\.event_id=e\.id AND cr\.status='pending'\) AS clarification_outstanding/);
    return { rows: [{ ...details, clarification_outstanding: false, clarification_requests: [responded] }] };
  });
  const result = await request('/api/events/101/clarifications/601/respond', { method: 'POST', body: { response: responded.organiser_response } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.clarificationRequest, responded);
  assert.equal(result.body.clarificationOutstanding, false);
});


// Test case: Returns no assigned record for a coordinator lookup and checks a scoped query plus a 404 with no event data.
test('Coordinator AC3 - missing or unassigned event details are unavailable',async()=>{
  const user={...organiser,id:30,role:'event_coordinator'};
  mock.method(pool,'query',async(sql,values)=>{if(sql.includes('FROM users WHERE'))return {rows:[user]};assert.match(sql,/AND e\.coordinator_id = \$2/);assert.deepEqual(values,['999',30]);return {rows:[]};});
  assert.deepEqual(await request('/api/events/999',{user}),{status:404,body:{message:'Event not found.'}});
});

// AC1/AC2: real route middleware must keep lead queue and assignment decisions private.
test('Lead AC1 AC2 - non-lead roles cannot review or change coordinator assignments', async () => {
  for (const role of ['event_organiser','event_coordinator','venue_staff','attendee','technical_support']) {
    mock.method(pool, 'query', async sql => {
      assert.match(sql, /FROM users WHERE/);
      return { rows: [{ ...organiser, role }] };
    });
    assert.equal((await request('/api/events/assignments', { user: { ...organiser, role } })).status, 403);
    assert.equal((await request('/api/events/101/assignment', { user: { ...organiser, role }, method: 'PUT', body: { coordinatorId: 30, expectedCoordinatorId: null } })).status, 403);
    mock.restoreAll();
  }
  assert.equal((await request('/api/events/assignments', { user: null })).status, 401);
});

// AC6/AC7: lead review is restricted to active submitted records and includes recorded organiser email.
test('Lead AC2 AC6 AC7 - lead can open active event details with organiser email', async () => {
  const user = { ...organiser, role: 'event_coordinator_lead' };
  mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('FROM users WHERE')) return { rows: [user] };
    assert.deepEqual(values, ['101']);
    assert.match(sql, /e.is_draft=false AND e.status NOT IN \('draft','cancelled','completed'\)/);
    assert.match(sql, /organiser.email AS organiser_email/);
    return { rows: [{ ...details, organiser_email: 'alice@example.com' }] };
  });
  const result = await request('/api/events/101', { user });
  assert.equal(result.status, 200); assert.equal(result.body.event.organiser_email, 'alice@example.com');
});

// AC3/AC4: outstanding critical-change requests follow current responsibility, not the historical recipient.
test('Lead AC3 AC4 - critical change inbox follows the current event coordinator', async () => {
  const model = require('../../backend/src/models/eventModel');
  mock.method(pool, 'query', async (sql, values) => {
    assert.match(sql, /WHERE e.coordinator_id=\$1 AND r.status='pending'/);
    assert.deepEqual(values, [30]);
    return { rows: [{ id: 501, event_id: 101 }] };
  });
  assert.deepEqual(await model.listPendingChangeRequests(30), [{ id: 501, event_id: 101 }]);
});

// Workflow AC2: every required submission value is enforced through the HTTP route, not only the helper.
for (const field of ['name','proposedDate','proposedStartTime','proposedEndTime','expectedAttendance']) {
  test(`Workflow AC2 - HTTP submission rejects missing ${field} before insertion`, async () => {
    mock.method(pool,'query',async sql=>{assert.match(sql,/FROM users WHERE/);return {rows:[organiser]};});
    const result=await request('/api/events',{method:'POST',body:{...submission,[field]:null}});
    assert.equal(result.status,400);
  });
}
// Workflow AC2: submitted requirements cannot be cleared, now through an amendment request (AM AC2).
for (const [field,value] of [['proposedDate',null],['proposedStartTime',null],['proposedEndTime',null],['expectedAttendance',0]]) {
  test(`Workflow AC2 / AM AC2 - an amendment cannot clear submitted ${field}`,async()=>{
    mock.method(pool,'query',async sql=>{if(sql.includes('FROM users WHERE'))return {rows:[organiser]};assert.match(sql,/SELECT/);return {rows:[{...details,coordinator_id:30}]};});
    const result=await request('/api/events/101/amendment-requests',amendment({[field]:value}));
    assert.equal(result.status,400);assert.equal(result.body.message,'Name, date, times and attendance cannot be cleared on submitted requests.');
  });
}
// Workflow AC5: controller integration must not bypass attachment validation on creation, draft update or amendment.
for (const route of ['create','draft update','amendment'])for (const attachments of [null,{accessibilityRequirements:null},{purpose:{name:'fake.pdf',data:Buffer.from('not a PDF').toString('base64')}}]) {
  test(`Workflow AC5 / AM AC2 - ${route} rejects invalid attachments ${JSON.stringify(attachments)}`,async()=>{
    const stored=route==='draft update'?draft:{...details,coordinator_id:30};
    mock.method(pool,'query',async sql=>{if(sql.includes('FROM users WHERE'))return {rows:[organiser]};assert.match(sql,/SELECT/);return {rows:[stored]};});
    const result=route==='create'?await request('/api/events',{method:'POST',body:{...submission,attachments}})
      :route==='draft update'?await request('/api/events/101/non-critical',{method:'PUT',body:{attachments}})
        :await request('/api/events/101/amendment-requests',amendment({attachments}));
    assert.equal(result.status,400);
  });
}
// Workflow AC5 / AM AC2: after submission an attachment replacement is an amendment awaiting coordinator review.
test('Workflow AC5 / AM AC2 - attachment replacement on a submitted request awaits coordinator review',async()=>{
  const file={name:'purpose.pdf',data:Buffer.from('%PDF-purpose').toString('base64')};
  mock.method(emailService,'sendNotificationEmail',async()=>{});
  mock.method(pool,'query',async(sql,values)=>{
    if(sql.includes('FROM users WHERE'))return {rows:[organiser]};
    if(sql.includes('INSERT INTO event_change_requests')){assert.equal(JSON.parse(values[3]).attachments.purpose.name,file.name);return {rows:[{id:1,status:'pending',coordinator_email:'chris@example.com'}]};}
    assert.match(sql,/SELECT/);return {rows:[{...details,venue_confirmed:true,coordinator_id:30}]};
  });
  const result=await request('/api/events/101/amendment-requests',amendment({attachments:{purpose:file}}));
  assert.equal(result.status,202);assert.equal(result.body.amendmentRequest.status,'pending');
});
// Workflow AC2: a completely blank draft is intentional and must retain an empty (non-null) stored name.
test('Workflow AC2 - HTTP creation saves an entirely incomplete draft',async()=>{
  mock.method(pool,'query',async(sql,values)=>{
    if(sql.includes('FROM users WHERE'))return {rows:[organiser]};
    assert.match(sql,/INSERT INTO events/);assert.equal(values[1],'');assert.equal(values[5],null);assert.equal(values[8],null);
    assert.equal(values[16],true);assert.equal(values[17],'draft');assert.equal(values[23],'{}');
    return {rows:[{id:101,name:'',is_draft:true,status:'draft',attachments:{}}]};
  });
  assert.equal((await request('/api/events',{method:'POST',body:{isDraft:true}})).status,201);
});
// Workflow AC5: replacing/removing a draft attachment uses JSONB and preserves unrelated files.
for(const removing of [false,true])test(`Workflow AC5 - draft attachment ${removing?'removal':'replacement'} persists without losing other files`,async()=>{
  const keep={name:'keep.pdf',data:Buffer.from('%PDF-keep').toString('base64'),type:'application/pdf',size:9};
  const incoming={name:'equipment.pdf',data:Buffer.from('%PDF-equipment').toString('base64')};
  const current={...draft,attachments:{purpose:keep,equipmentNotes:keep}};
  mock.method(pool,'query',async(sql,values)=>{
    if(sql.includes('FROM users WHERE'))return {rows:[organiser]};
    if(sql.includes('UPDATE events')){
      assert.match(sql,/attachments=\$1::jsonb/);const files=JSON.parse(values[0]);assert.deepEqual(files.purpose,keep);
      if(removing)assert.equal(Object.hasOwn(files,'equipmentNotes'),false);else assert.equal(files.equipmentNotes.name,'equipment.pdf');
      return {rows:[{...current,attachments:files}]};
    }
    assert.match(sql,/SELECT/);return {rows:[current]};
  });
  const result=await request('/api/events/101/non-critical',{method:'PUT',body:{attachments:{equipmentNotes:removing?null:incoming}}});
  assert.equal(result.status,200);assert.equal(result.body.event.attachments.purpose.name,'keep.pdf');
});
// Workflow AC2: editing an incomplete draft can clear its name without violating the NOT NULL column.
test('Workflow AC2 - draft update permits an empty name',async()=>{
 mock.method(pool,'query',async(sql,values)=>{
  if(sql.includes('FROM users WHERE'))return {rows:[organiser]};
  if(sql.includes('UPDATE events')){assert.equal(values[0],'');return {rows:[{...details,name:'',status:'draft',is_draft:true}]};}
  return {rows:[{...details,status:'draft',is_draft:true}]};
 });
 const result=await request('/api/events/101/non-critical',{method:'PUT',body:{name:''}});
 assert.equal(result.status,200);assert.equal(result.body.event.name,'');
});

for(const mailFails of [false,true])test(`Clarification reply AC1 AC4 - committed reply notifies coordinator and tolerates mail failure=${mailFails}`,async()=>{
  // Only database and SMTP boundaries are controlled; real route, model and notification delivery remain intact.
  let saved=false;
  mock.method(pool,'query',async(sql)=>{
    if(sql.includes('FROM users WHERE'))return {rows:[organiser]};
    if(sql.includes('UPDATE event_clarification_requests')){
      assert.match(sql,/FOR UPDATE/);assert.match(sql,/INSERT INTO notifications/);
      assert.match(sql,/target.coordinator_id/);
      saved=true;
      return {rows:[{id:601,event_id:101,status:'responded',organiser_response:'45 guests',delivery_records:[{email:'current@example.test',title:'Clarification reply received: Workshop',message:'45 guests'}]}]};
    }
    return {rows:[{...details,clarification_outstanding:false}]};
  });
  const email=mock.method(emailService,'sendNotificationEmail',async()=>{
    assert.equal(saved,true,'email must follow the successful atomic SQL statement');
    if(mailFails)throw new Error('SMTP unavailable');
  });
  mock.method(console,'error',()=>{});
  const result=await request('/api/events/101/clarifications/601/respond',{method:'POST',body:{response:'45 guests'}});
  assert.equal(result.status,200);assert.equal(email.mock.callCount(),1);
  assert.equal(result.body.clarificationRequest.status,'responded');
  assert.equal('delivery_records' in result.body.clarificationRequest,false);
  assert.equal(JSON.stringify(result.body).includes('current@example.test'),false);
});
