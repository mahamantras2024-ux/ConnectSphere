// File: Unit tests for applying an agreed amendment (Record Offline Clarifications and Apply Agreed Amendments): the
// before -> after record (AC3), who is told (AC4) and which venue, technical and safety checks are reopened (AC5).
// Test scope: the real service and model SQL builders against a recording fake transaction client (no database).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyAmendment, amendmentRecipients, amendmentNotifications } = require('../../backend/src/services/agreedAmendments');

// Event 101 runs 10:00-12:00 Singapore time with a confirmed booking at Hall A (venue 5, decided by Venue Staff 41).
const event = { id: 101, name: 'Gala', organiser_id: 12, status: 'submitted', proposed_date: '2030-10-15', proposed_start_time: '10:00:00',
  proposed_end_time: '12:00:00', expected_attendance: 60, room_layout_preference: 'Theatre', accessibility_requirements: ['Ramp'],
  description: 'Annual dinner', special_arrangements: null, equipment_items: [], equipment_notes: null, technical_support_required: false,
  video_conferencing_required: false };
const approvedBooking = { id: 9, venue_id: 5, venue_name: 'Hall A', status: 'approved', decision_by: 41, capacity: 100,
  supported_layouts: ['Theatre', 'Banquet'], setup_minutes: 0, turnaround_minutes: 0,
  start_datetime: '2030-10-15T02:00:00.000Z', end_datetime: '2030-10-15T04:00:00.000Z' };

/**
 * A fake transaction client: answers the statements applyAmendment and amendmentRecipients send and records them.
 * `after` is the event the database returns once the changes are applied.
 */
function fakeClient({ after, bookings = [approvedBooking], safetyChecked = false, reread = after, venueAssignments = {},
  technicalAssignments = [], roles = {}, attendees = [] } = {}) {
  const statements = [];
  const query = async (sql, values) => {
    statements.push({ sql, values });
    if (sql.includes('RETURNING to_jsonb(events.*) AS event')) return { rows: [{ event: after }] };
    if (sql.includes('FROM venue_bookings vb JOIN venues v')) return { rows: bookings };
    if (sql.includes('UNION ALL')) return { rows: [] };
    if (sql.includes('FROM event_safety_checks')) return { rows: [], rowCount: safetyChecked ? 1 : 0 };
    if (sql.includes('SELECT to_jsonb(events.*) AS event FROM events')) return { rows: [{ event: reread }] };
    if (sql.includes('FROM venue_staff_assignments')) return { rows: (venueAssignments[values[0]] || []).map((id) => ({ staff_user_id: id })) };
    if (sql.includes('FROM event_technical_support_assignments')) return { rows: technicalAssignments.map((id) => ({ staff_id: id })) };
    if (sql.includes('SELECT id FROM users')) return { rows: (roles[values[0]] || []).map((id) => ({ id })) };
    if (sql.includes('FROM registrations')) return { rows: attendees.map((id) => ({ attendee_id: id })) };
    return { rows: [] };
  };
  return { query, statements, find: (text) => statements.filter((statement) => statement.sql.includes(text)) };
}

// ---------- AC3: what changed ----------

// Test case: The before -> after record lists only real changes, labelled; an unknown field is refused, not half-applied.
test('OC AC3 - applying records each real change before -> after and refuses fields it cannot store', async () => {
  const client = fakeClient({ after: { ...event, description: 'Gala dinner' } });
  const result = await applyAmendment(client, event, { description: 'Gala dinner', name: 'Gala' });
  assert.deepEqual(result.changes, [{ field: 'description', label: 'Description', current: 'Annual dinner', requested: 'Gala dinner' }]);
  await assert.rejects(applyAmendment(fakeClient({ after: event }), event, { venue: 'Hall B' }),
    { status: 409, code: 'UNSUPPORTED_CHANGE', message: 'This change request includes changes that cannot be applied yet: venue.' });
});

// ---------- AC5: which checks are reopened ----------

// Test case: A detail that only matters to the organiser and attendees (description) reopens no check and tells no staff.
test('OC AC5 - an unrelated change reopens no venue, technical or safety check', async () => {
  const client = fakeClient({ after: { ...event, description: 'Gala dinner' }, safetyChecked: true });
  const { rechecks } = await applyAmendment(client, event, { description: 'Gala dinner' });
  assert.deepEqual(rechecks, { venueBookings: [], technical: false, safety: false, returnedToPlanning: false });
  assert.equal(client.find('venue_bookings').length + client.find('equipment_confirmed_at').length + client.find('safety_recheck').length, 0);
});

// Test case: Each venue-relevant detail flags the confirmed booking with the reason found, or a general reason.
for (const [label, changes, after, reason] of [
  ['more guests than the venue holds', { expectedAttendance: 150 }, { expected_attendance: 150 }, '150 expected guests exceed the venue capacity of 100.'],
  ['an unsupported layout', { roomLayoutPreference: 'Classroom' }, { room_layout_preference: 'Classroom' }, 'The Classroom layout is not supported at this venue.'],
  ['a size the venue still fits', { expectedAttendance: 90 }, { expected_attendance: 90 }, 'Event details relevant to the venue changed: Expected attendance.'],
  ['new accessibility needs', { accessibilityRequirements: ['Ramp', 'Lift'] }, { accessibility_requirements: ['Ramp', 'Lift'] }, 'Event details relevant to the venue changed: Accessibility needs.'],
]) {
  test(`OC AC5 - ${label} sends the confirmed booking back to Venue Staff`, async () => {
    const client = fakeClient({ after: { ...event, ...after } });
    const { rechecks } = await applyAmendment(client, event, changes);
    assert.deepEqual(rechecks.venueBookings, [{ bookingId: 9, venueId: 5, venueName: 'Hall A', decisionBy: 41, reason }]);
    assert.deepEqual(client.find('UPDATE venue_bookings SET recheck_required_at')[0].values, [9, reason]);
  });
}
// Test case: A booking confirmed before decisions were recorded has no decision-maker; all Venue Staff are then told.
test('OC AC4 AC5 - a flagged booking without a decision-maker is sent to every Venue Staff account', async () => {
  const client = fakeClient({ after: { ...event, expected_attendance: 90 }, bookings: [{ ...approvedBooking, decision_by: null }], roles: { venue_staff: [41, 42] } });
  const applied = await applyAmendment(client, event, { expectedAttendance: 90 });
  assert.equal(applied.rechecks.venueBookings[0].decisionBy, null);
  assert.deepEqual((await amendmentRecipients(client, applied.event, applied)).venueStaff, [41, 42]);
});
// Test case: Only confirmed bookings are flagged; a still-pending request is decided by Venue Staff anyway.
test('OC AC5 - a pending booking is not flagged for re-confirmation', async () => {
  const pending = { ...approvedBooking, id: 10, status: 'pending', hold_expires_at: '2099-01-01T00:00:00Z' };
  const client = fakeClient({ after: { ...event, expected_attendance: 90 }, bookings: [pending] });
  const { rechecks } = await applyAmendment(client, event, { expectedAttendance: 90 });
  assert.deepEqual(rechecks.venueBookings, []);
});

// Test case: Technical arrangements are reviewed again when equipment changes, or the time/audience of an event with
// technical needs changes - but not for a time change on an event that needs nothing technical.
for (const [label, before, changes, after, technical] of [
  ['an equipment change', event, { equipmentItems: [{ item: 'Projector', quantity: 1 }] }, { equipment_items: [{ item: 'Projector', quantity: 1 }] }, true],
  ['a new time for an event with technical needs', { ...event, equipment_items: [{ item: 'Projector', quantity: 1 }] }, { proposedEndTime: '13:00' },
    { equipment_items: [{ item: 'Projector', quantity: 1 }], proposed_end_time: '13:00:00' }, true],
  ['a new time for an event with no technical needs', event, { proposedEndTime: '13:00' }, { proposed_end_time: '13:00:00' }, false],
]) {
  test(`OC AC5 - ${label} ${technical ? 'reopens' : 'does not reopen'} the technical review`, async () => {
    const client = fakeClient({ after: { ...before, ...after }, bookings: [] });
    const { rechecks } = await applyAmendment(client, before, changes);
    assert.equal(rechecks.technical, technical);
    assert.equal(client.find('equipment_requirements_version = equipment_requirements_version + 1').length, technical ? 1 : 0);
  });
}

// Test case: A recorded safety check stops counting once the arrangements change. An approved or a confirmed event goes
// back to planning (reviewer regression: confirmed events stayed confirmed); one still being planned stays as it is.
for (const [status, returned] of [['approved', true], ['confirmed', true], ['planning', false], ['submitted', false]]) {
  test(`OC AC5 - a ${status} event with a recorded safety check needs a new check${returned ? ' and returns to planning' : ''}`, async () => {
    const before = { ...event, status };
    const client = fakeClient({ after: { ...before, special_arrangements: 'Fireworks' }, safetyChecked: true, bookings: [] });
    const result = await applyAmendment(client, before, { specialArrangements: 'Fireworks' });
    assert.deepEqual([result.rechecks.safety, result.rechecks.returnedToPlanning], [true, returned]);
    assert.deepEqual(client.find('SET safety_recheck_required_at = now()')[0].values, [101]);
    const moved = client.find("UPDATE events SET status = $2");
    assert.deepEqual(moved.map((statement) => statement.values), returned ? [[101, 'planning', ['approved', 'confirmed']]] : []);
  });
}
// Test case: A confirmed event whose booking must be re-confirmed returns to planning even before any safety check exists.
test('OC AC5 - a confirmed event whose venue booking is reopened returns to planning', async () => {
  const before = { ...event, status: 'confirmed' };
  const client = fakeClient({ after: { ...before, expected_attendance: 90 }, safetyChecked: false });
  const result = await applyAmendment(client, before, { expectedAttendance: 90 });
  assert.deepEqual([result.rechecks.venueBookings.length, result.rechecks.safety, result.rechecks.returnedToPlanning], [1, false, true]);
  assert.equal(client.find("UPDATE events SET status = $2").length, 1);
});
// Test case: A change that reopens nothing leaves a confirmed event confirmed.
test('OC AC5 - a confirmed event stays confirmed after a change that reopens no check', async () => {
  const before = { ...event, status: 'confirmed' };
  const client = fakeClient({ after: { ...before, description: 'Gala dinner' }, safetyChecked: true });
  const result = await applyAmendment(client, before, { description: 'Gala dinner' });
  assert.equal(result.rechecks.returnedToPlanning, false);
  assert.equal(client.find('UPDATE events SET status').length, 0);
});
// Test case: An event never safety checked is simply still due a check, so nothing is reset.
test('OC AC5 - an event without a recorded safety check needs no re-check', async () => {
  const client = fakeClient({ after: { ...event, special_arrangements: 'Fireworks' }, safetyChecked: false, bookings: [] });
  const { rechecks } = await applyAmendment(client, event, { specialArrangements: 'Fireworks' });
  assert.equal(rechecks.safety, false);
  assert.equal(client.find('safety_recheck').length, 0);
});

// ---------- AC4: who is told ----------

const noRechecks = { venueBookings: [], technical: false, safety: false, returnedToPlanning: false };
// A change attendees never see (the expected audience is a planning figure).
const internal = [{ field: 'expectedAttendance', label: 'Expected attendance', current: 60, requested: 90 }];
// Test case: The organiser always hears; no staff group is involved when no check was reopened.
test('OC AC4 - only the organiser hears about an amendment that reopens no check', async () => {
  const client = fakeClient({ after: event });
  assert.deepEqual(await amendmentRecipients(client, event, { changes: internal, arrangements: [], rechecks: noRechecks }),
    { organiser: [12], venueStaff: [], technicalSupport: [], safetyOfficers: [], attendees: [] });
  assert.equal(client.statements.length, 0);
});
// Test case: Venue Staff: the venue's assigned staff first, then whoever decided the booking, then every Venue Staff account.
for (const [label, assignments, decisionBy, expected] of [
  ['assigned staff', { 5: [44, 45] }, 41, [44, 45]], ['the booking\'s decision-maker', {}, 41, [41]], ['every Venue Staff account', {}, null, [41, 42]],
]) {
  test(`OC AC4 - a booking to re-confirm is sent to ${label}`, async () => {
    const client = fakeClient({ after: event, venueAssignments: assignments, roles: { venue_staff: [41, 42] } });
    const rechecks = { ...noRechecks, venueBookings: [{ bookingId: 9, venueId: 5, venueName: 'Hall A', decisionBy, reason: 'x' }] };
    assert.deepEqual((await amendmentRecipients(client, event, { changes: internal, arrangements: [], rechecks })).venueStaff, expected);
  });
}
// Test case: A pending booking the change affects is also brought to Venue Staff's attention.
test('OC AC4 - Venue Staff also hear about an affected pending booking', async () => {
  const client = fakeClient({ after: event, roles: { venue_staff: [41, 42] } });
  const arrangements = [{ bookingId: 10, venueId: 6, venueName: 'Room B', decisionBy: null, reasons: ['Too small'] }];
  assert.deepEqual((await amendmentRecipients(client, event, { changes: internal, arrangements, rechecks: noRechecks })).venueStaff, [41, 42]);
});
// Test case: Technical Support: the staff assigned to the event, else every Technical Support account; Safety Officers on a re-check.
for (const [label, assigned, expected] of [['assigned staff', [61], [61]], ['everyone when nobody is assigned', [], [61, 62]]]) {
  test(`OC AC4 - a reopened technical review goes to ${label}, and a safety re-check to Safety Officers`, async () => {
    const client = fakeClient({ after: event, technicalAssignments: assigned, roles: { technical_support: [61, 62], safety_officer: [50] } });
    const recipients = await amendmentRecipients(client, event, { changes: internal, arrangements: [], rechecks: { ...noRechecks, technical: true, safety: true } });
    assert.deepEqual([recipients.technicalSupport, recipients.safetyOfficers], [expected, [50]]);
  });
}

// Test case: Registered and waitlisted attendees are told about each change they can see or rely on (AC4).
for (const [label, field] of [['a new start time', 'proposedStartTime'], ['a new date', 'proposedDate'], ['an earlier withdrawal deadline', 'withdrawalDeadline'],
  ['a new registration deadline', 'registrationDeadline'], ['a new name', 'name'], ['new accessibility arrangements', 'accessibilityRequirements']]) {
  test(`OC AC4 - ${label} is sent to the event's registered and waitlisted attendees`, async () => {
    const client = fakeClient({ after: event, attendees: [70, 71] });
    const changes = [{ field, label: 'x', current: 'a', requested: 'b' }];
    assert.deepEqual((await amendmentRecipients(client, event, { changes, arrangements: [], rechecks: noRechecks })).attendees, [70, 71]);
    assert.deepEqual(client.find('FROM registrations')[0].values, [101]);
    assert.match(client.find('FROM registrations')[0].sql, /status IN \('registered', 'waitlisted'\)/);
  });
}
// Test case: Planning-only changes (audience size, equipment, layout) are not announced to attendees, so no list is read.
for (const [label, field] of [['the expected attendance', 'expectedAttendance'], ['equipment', 'equipmentItems'], ['the room layout', 'roomLayoutPreference']]) {
  test(`OC AC4 - a change to ${label} is not sent to attendees`, async () => {
    const client = fakeClient({ after: event, attendees: [70] });
    const changes = [{ field, label: 'x', current: 'a', requested: 'b' }];
    assert.deepEqual((await amendmentRecipients(client, event, { changes, arrangements: [], rechecks: noRechecks })).attendees, []);
    assert.equal(client.find('FROM registrations').length, 0);
  });
}
// Test case: Attendees hear only the changes they can see, without internal re-checks or what was agreed.
test('OC AC4 - attendees are told only the changes they can see', () => {
  const changes = [{ field: 'proposedStartTime', label: 'Start time', current: '18:00:00', requested: '19:00:00' },
    { field: 'expectedAttendance', label: 'Expected attendance', current: 60, requested: 90 }];
  const rechecks = { ...noRechecks, safety: true, returnedToPlanning: true };
  const notes = amendmentNotifications({ eventId: 101, changeRequestId: 7, eventName: 'Gala', source: 'coordinator_agreed', reason: null,
    explanation: 'Agreed by phone', changes, arrangements: [], rechecks,
    recipients: { organiser: [12], venueStaff: [], technicalSupport: [], safetyOfficers: [50], attendees: [70, 50] } });
  // Safety Officer 50 already hears as staff, so is not told twice.
  assert.deepEqual(notes.map((note) => note.userId), [12, 50, 70]);
  const attendee = notes[2];
  assert.deepEqual([attendee.type, attendee.title, attendee.changeRequestId], ['event_details_changed', 'Event updated: Gala', null]);
  assert.equal(attendee.message, 'Gala has been updated.\nStart time: 18:00:00 → 19:00:00\nPlease check the event details in ConnectSphere.');
  assert.deepEqual(attendee.details, { changes: [changes[0]] });
});
// Test case: The organiser hears what changed and, for an agreed amendment, what was agreed; staff hear what to re-check.
test('OC AC4 - notices say what changed, what was agreed and which checks must be completed again', () => {
  const changes = [{ field: 'expectedAttendance', label: 'Expected attendance', current: 60, requested: 150 }];
  const rechecks = { venueBookings: [{ bookingId: 9, venueId: 5, venueName: 'Hall A', decisionBy: 41, reason: 'Too many guests.' }],
    technical: true, safety: true, returnedToPlanning: true };
  const arrangements = [{ bookingId: 9, venueName: 'Hall A', reasons: ['Too many guests.'] }, { bookingId: 10, venueName: 'Room B', reasons: ['Held for later.'] }];
  const recipients = { organiser: [12], venueStaff: [41], technicalSupport: [61], safetyOfficers: [50, 41], attendees: [] };
  const [organiser, ...staff] = amendmentNotifications({ eventId: 101, changeRequestId: 7, eventName: 'Gala', source: 'coordinator_agreed',
    reason: null, explanation: 'Agreed by phone', changes, arrangements, rechecks, recipients });
  assert.deepEqual([organiser.userId, organiser.type, organiser.title], [12, 'change_request_approved', 'Agreed amendment applied: Gala']);
  assert.equal(organiser.message, ['The Event Coordinator applied the amendment agreed with you to Gala.', 'Expected attendance: 60 → 150',
    'What was agreed: Agreed by phone', 'Checks to complete again:', 'Venue booking at Hall A must be re-confirmed by Venue Staff: Too many guests.',
    'Technical arrangements must be reviewed again by Technical Support.', 'A new operational safety check is needed.',
    'The event is back in planning until it is approved again.'].join('\n'));
  // Each staff member is told once, even when in two groups; the still-pending booking is listed as needing attention.
  assert.deepEqual(staff.map((note) => note.userId), [41, 61, 50]);
  assert.match(staff[0].message, /^The Event Coordinator applied an agreed amendment to Gala\. Review your arrangements\./);
  assert.match(staff[0].message, /\nArrangements needing attention:\nRoom B: Held for later\.$/);
  // An approved organiser request is worded as such, with the coordinator's note and no re-check text when none apply.
  const [approved] = amendmentNotifications({ eventId: 101, changeRequestId: 8, eventName: 'Gala', source: 'organiser_request',
    reason: 'Fine', explanation: 'More guests', changes, arrangements: [], rechecks: noRechecks, recipients: { ...recipients, venueStaff: [], technicalSupport: [], safetyOfficers: [] } });
  assert.equal(approved.message, 'Your requested changes to Gala were approved and applied.\nExpected attendance: 60 → 150\nNote: Fine');
});
