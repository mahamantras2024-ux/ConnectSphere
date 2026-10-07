// File: Unit tests for the pure change-request review rules: field differences, affected arrangements and notification recipients.
// Test scope: Pure functions only; expected values come from the user story ACs and the Week 7 customer changes, not from the code.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  describeChanges, applyToEvent, assessArrangements, recipientsFor, changeLines,
} = require('../../backend/src/services/changeRequestReview');

const NOW = Date.parse('2026-10-01T00:00:00Z');
// Event 101 is confirmed 10:00-12:00 Singapore time (02:00-04:00 UTC) on 15 Oct 2026.
const event = { id: 101, organiser_id: 12, name: 'Workshop', proposed_date: '2026-10-15', proposed_start_time: '10:00:00',
  proposed_end_time: '12:00:00', expected_attendance: 80, room_layout_preference: 'Theatre', equipment_notes: 'Two microphones',
  registration_required: false, accessibility_requirements: ['Wheelchair access'] };
// Venue 5 (Week 7 example): 30 minutes setup, 45 minutes turnaround, capacity 100.
const venue = { venue_id: 5, venue_name: 'Hall A', capacity: 100, supported_layouts: ['Theatre', 'Classroom'], setup_minutes: 30, turnaround_minutes: 45 };
const ownBooking = { ...venue, id: 1, status: 'approved', decision_by: 41,
  start_datetime: '2026-10-15T02:00:00.000Z', end_datetime: '2026-10-15T04:00:00.000Z' };
// The next confirmed booking at the same venue starts 13:30, so its setup begins at 13:00 Singapore time.
const nextBooking = { id: 2, kind: 'booking', status: 'approved', start_datetime: '2026-10-15T05:30:00.000Z', end_datetime: '2026-10-15T07:00:00.000Z' };
// Recorded periods carry kind 'booking' exactly as the venue_bookings query returns them; that is how the event's own booking is excluded.
const ownPeriod = { ...ownBooking, kind: 'booking' };
const CONFLICT = 'The new time conflicts with another booking or closure at this venue, including setup and turnaround time.';

// Assesses a requested change against the given bookings exactly as the review endpoints do.
function assess(changes, bookings) {
  const changed = describeChanges(event, changes).map((change) => change.field);
  return assessArrangements(applyToEvent(event, changes), changed, bookings, NOW);
}

// Test case: Requests a mix of changed and unchanged fields; only real changes appear, each with current and requested values.
test('CR AC1 - change details list only fields whose value really changes, with current and requested values', () => {
  const changes = describeChanges(event, { expectedAttendance: 150, proposedStartTime: '10:00', registrationRequired: true,
    accessibilityRequirements: ['Wheelchair access'], proposedDate: '2026-10-16' });
  assert.deepEqual(changes, [
    { field: 'expectedAttendance', label: 'Expected attendance', current: 80, requested: 150 },
    { field: 'registrationRequired', label: 'Registration required', current: false, requested: true },
    { field: 'proposedDate', label: 'Date', current: '2026-10-15', requested: '2026-10-16' },
  ]);
});

// Test case: Zero, false and empty values are real values; changing to or from them must be reported, not dropped.
test('CR AC1 - zero, false and missing values are reported as genuine changes', () => {
  assert.deepEqual(describeChanges({ expected_attendance: null, registration_capacity: 0 }, { expectedAttendance: 0, registrationCapacity: null }), [
    { field: 'expectedAttendance', label: 'Expected attendance', current: null, requested: 0 },
    { field: 'registrationCapacity', label: 'Registration capacity', current: 0, requested: null },
  ]);
  assert.deepEqual(changeLines([{ label: 'Expected attendance', current: null, requested: 0 }, { label: 'Registration required', current: false, requested: true },
    { label: 'Accessibility needs', current: [], requested: ['Ramp'] }]),
  ['Expected attendance: Not specified → 0', 'Registration required: No → Yes', 'Accessibility needs: None → Ramp']);
});

// Test case: A field from a newer client has no known column; it is still shown to the coordinator under its own name.
test('CR AC1 - fields this release cannot store are still shown by name', () => {
  assert.deepEqual(describeChanges(event, { equipmentItems: [{ item: 'Projector', quantity: 1 }] }),
    [{ field: 'equipmentItems', label: 'equipmentItems', current: null, requested: [{ item: 'Projector', quantity: 1 }] }]);
});

// Week 7 #1: 30 min setup / 45 min turnaround. The next booking's occupancy starts at 13:00.
// New end 12:14 or 12:15 keeps our turnaround before 13:00 (half-open intervals); 12:16 overlaps by one minute.
for (const [endTime, conflicts] of [['12:14', false], ['12:15', false], ['12:16', true]]) {
  // Test case: Extends the event end time at the buffered boundary and checks only overlaps are reported as conflicts.
  test(`CR AC3 - extending the event to ${endTime} ${conflicts ? 'conflicts' : 'does not conflict'} once setup and turnaround are included`, () => {
    const [arrangement] = assess({ proposedEndTime: endTime }, [{ ...ownBooking, periods: [ownPeriod, nextBooking] }]);
    // The booking itself is never moved, so the mismatch is always reported for review.
    assert.equal(arrangement.reasons[0], `This booking still reserves 2026-10-15 10:00 to 2026-10-15 12:00; the event now runs 2026-10-15 10:00 to 2026-10-15 ${endTime}.`);
    assert.equal(arrangement.reasons.includes(CONFLICT), conflicts);
  });
}

// Test case: The booking already matches the event's new date; a time-field change alone must not raise a false alarm.
test('CR AC3 - a booking that already matches the changed event period is not flagged', () => {
  const booking = { ...ownBooking, start_datetime: '2026-10-16T02:00:00.000Z', end_datetime: '2026-10-16T04:00:00.000Z', periods: [] };
  assert.deepEqual(assess({ proposedDate: '2026-10-16' }, [booking]), []);
});

// Test case: Removing the date leaves no period to check; the booking is flagged for re-confirmation instead of guessed.
test('CR AC3 - an incomplete new date or time asks for the booking to be re-confirmed', () => {
  const [arrangement] = assess({ proposedDate: null }, [{ ...ownBooking, periods: [] }]);
  assert.deepEqual(arrangement.reasons, ['The event date or time changed; this booking needs to be re-confirmed.']);
});

// Capacity 100: 99 and 100 fit; 101 exceeds it.
for (const [attendance, flagged] of [[99, false], [100, false], [101, true]]) {
  // Test case: Changes attendance around the venue capacity and checks only an overflow is flagged.
  test(`CR AC3 - attendance ${attendance} at a 100-capacity venue is ${flagged ? '' : 'not '}flagged`, () => {
    const result = assess({ expectedAttendance: attendance }, [{ ...ownBooking }]);
    assert.deepEqual(result.map((item) => item.reasons), flagged ? [['101 expected guests exceed the venue capacity of 100.']] : []);
  });
}

// Test case: Layout names are compared case-insensitively after trimming; only an unsupported layout is flagged.
test('CR AC3 - only layouts the venue does not support are flagged', () => {
  assert.deepEqual(assess({ roomLayoutPreference: ' classroom ' }, [{ ...ownBooking }]), []);
  assert.deepEqual(assess({ roomLayoutPreference: 'Banquet' }, [{ ...ownBooking }])[0].reasons, ['The Banquet layout is not supported at this venue.']);
  // A venue with no recorded layouts gives no evidence of support, so the booking is still flagged for review.
  assert.deepEqual(assess({ roomLayoutPreference: 'Classroom' }, [{ ...ownBooking, supported_layouts: null }])[0].reasons, ['The Classroom layout is not supported at this venue.']);
});

// Week 7 #4: an expired hold no longer reserves the venue, so it needs no review; a live hold still does.
for (const [label, holdExpiresAt, flagged] of [['expired', '2026-09-30T23:59:59.999Z', false], ['live', '2026-10-01T00:00:00.001Z', true]]) {
  // Test case: Changes attendance on an event whose only booking is a pending hold either side of its deadline.
  test(`CR AC3 - a ${label} pending hold is ${flagged ? '' : 'not '}reviewed`, () => {
    const hold = { ...ownBooking, status: 'pending', decision_by: null, hold_expires_at: holdExpiresAt };
    assert.equal(assess({ expectedAttendance: 101 }, [hold]).length, flagged ? 1 : 0);
  });
}

// Test case: Week 7 #3 - with two venues, a later booking blocks only venue B; venue A has no conflict.
test('CR AC3 - each venue booking is checked independently', () => {
  const venueA = { ...ownBooking, periods: [ownPeriod] };
  const venueB = { ...ownBooking, id: 3, venue_id: 6, venue_name: 'Room B', periods: [nextBooking] };
  const result = assess({ proposedEndTime: '12:16' }, [venueA, venueB]);
  assert.deepEqual(result.map((item) => [item.venueName, item.reasons.includes(CONFLICT)]), [['Hall A', false], ['Room B', true]]);
});

// Test case: Routes approved-change notifications to the booking's decision-maker, all staff for an undecided booking, and Technical Support.
test('CR AC3 - relevant personnel are the organiser, each booking decision-maker or all Venue Staff, and Technical Support', () => {
  const arrangements = [{ decisionBy: 41 }, { decisionBy: null }, { decisionBy: 41 }];
  assert.deepEqual(recipientsFor({ event, changedFields: ['proposedEndTime'], arrangements, venueStaffIds: [41, 42], technicalSupportIds: [61, 61] }),
    { organiser: [12], venueStaff: [41, 42], technicalSupport: [61] });
});

// Technical Support only needs to hear about time/attendance changes on events that have equipment needs.
for (const [label, changedFields, equipmentNotes, expected] of [
  ['an attendance change with equipment needs', ['expectedAttendance'], 'Two microphones', [61]],
  ['a time change without equipment needs', ['proposedDate'], '   ', []],
  ['a name change with equipment needs', ['name'], 'Two microphones', []],
]) {
  // Test case: Applies the Technical Support routing rule to one combination of change and equipment needs.
  test(`CR AC3 - Technical Support ${expected.length ? 'is' : 'is not'} notified for ${label}`, () => {
    const recipients = recipientsFor({ event: { ...event, equipment_notes: equipmentNotes }, changedFields, arrangements: [], venueStaffIds: [], technicalSupportIds: [61] });
    assert.deepEqual(recipients.technicalSupport, expected);
    assert.deepEqual(recipients.venueStaff, []);
  });
}
