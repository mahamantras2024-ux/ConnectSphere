// File: Tests the Venue Staff event-status read model and daily reminder rules at their database boundary.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  listRelevantVenueEvents,
  updateVenueReminderPreference,
  isDailyReminderDue,
  isReminderDue,
  notifyVenueStaffOfEventStatus,
  sendDailyPendingVenueReminders,
} = require('../../backend/src/services/venueEventStatus');

test('AC1 AC2 AC3 AC4 - returns only safe preparation details with Pending, Approved, Rejected and Cancelled booking statuses', async () => {
  // Arrange: database rows deliberately include an internal note that Venue Staff must never receive.
  const queries = [];
  const db = { query: async (sql, values) => {
    queries.push({ sql, values });
    return { rows: [
      { booking_id: 1, event_id: 11, event_name: 'Pending workshop', booking_status: 'pending', event_status: 'planning', venue_name: 'Hall A', start_datetime: '2031-10-20T02:00:00Z', end_datetime: '2031-10-20T03:00:00Z', expected_attendance: 20, room_layout: 'Seminar', accessibility: ['Ramp'], internal_notes: 'Do not disclose' },
      { booking_id: 2, event_id: 12, event_name: 'Approved workshop', booking_status: 'approved', event_status: 'confirmed', venue_name: 'Hall A', start_datetime: '2031-10-21T02:00:00Z', end_datetime: '2031-10-21T03:00:00Z', expected_attendance: 30, room_layout: 'Theatre', accessibility: [], internal_notes: 'Do not disclose' },
      { booking_id: 3, event_id: 13, event_name: 'Rejected workshop', booking_status: 'rejected', event_status: 'planning', venue_name: 'Hall A', start_datetime: '2031-10-22T02:00:00Z', end_datetime: '2031-10-22T03:00:00Z', expected_attendance: 40, room_layout: null, accessibility: null },
      { booking_id: 4, event_id: 14, event_name: 'Cancelled workshop', booking_status: 'approved', event_status: 'cancelled', venue_name: 'Hall A', start_datetime: '2031-10-23T02:00:00Z', end_datetime: '2031-10-23T03:00:00Z', expected_attendance: 50, room_layout: null, accessibility: null },
    ] };
  } };

  // Act.
  const events = await listRelevantVenueEvents(db, 7);

  // Assert: the booking decision is the staff-facing status, and private columns are excluded.
  assert.deepEqual(events.map(event => [event.name, event.status]), [
    ['Pending workshop', 'pending'], ['Approved workshop', 'approved'], ['Rejected workshop', 'rejected'], ['Cancelled workshop', 'approved'],
  ]);
  assert.deepEqual(events[1], { bookingId: 2, eventId: 12, name: 'Approved workshop', status: 'approved', venueName: 'Hall A', startDatetime: '2031-10-21T02:00:00Z', endDatetime: '2031-10-21T03:00:00Z', expectedAttendance: 30, roomLayout: 'Theatre', accessibility: [], eventStatus: 'confirmed' });
  assert.match(queries[0].sql, /venue_staff_assignments/);
  assert.deepEqual(queries[0].values, [7]);
});

test('AC5 - scopes the event read to assigned venues and omits unrelated event and internal information', async () => {
  // Arrange: an unassigned staff member receives no rows even though another venue has an event.
  let executed;
  const db = { query: async (sql, values) => { executed = { sql, values }; return { rows: [] }; } };

  // Act.
  const events = await listRelevantVenueEvents(db, 99);

  // Assert: a plausible missing assignment join would fail this SQL and empty-result oracle.
  assert.deepEqual(events, []);
  assert.match(executed.sql, /assignment\.staff_user_id=\$1/);
  assert.doesNotMatch(executed.sql, /internal_notes/);
  assert.deepEqual(executed.values, [99]);
});

test('AC1 AC2 - includes an approved booking decided by the viewing Venue Staff member', async () => {
  // Arrange: approval removes the booking from the pending queue, but the approver remains responsible for its arrangement.
  let executed;
  const db = { query: async (sql, values) => {
    executed = { sql, values };
    return { rows: [{
      booking_id: 20, event_id: 44, event_name: 'Graduation party', booking_status: 'approved',
      event_status: 'confirmed',
      venue_name: 'Hall A', start_datetime: '2031-10-20T02:00:00Z', end_datetime: '2031-10-20T03:00:00Z',
      expected_attendance: 100, room_layout: 'Theatre', accessibility: [],
    }] };
  } };

  // Act.
  const events = await listRelevantVenueEvents(db, 9);

  // Assert: a query that only retains venue assignments would drop the approved booking after approval.
  assert.deepEqual(events, [{
    bookingId: 20, eventId: 44, name: 'Graduation party', status: 'approved', venueName: 'Hall A',
    startDatetime: '2031-10-20T02:00:00Z', endDatetime: '2031-10-20T03:00:00Z',
    expectedAttendance: 100, roomLayout: 'Theatre', accessibility: [], eventStatus: 'confirmed',
  }]);
  assert.match(executed.sql, /booking\.decision_by=\$1/);
  assert.deepEqual(executed.values, [9]);
});

test('AC6 - creates one venue-arrangement notification per assigned staff member and none when no staff are assigned', async () => {
  // Arrange: two staff members are assigned to the affected venue.
  const calls = [];
  const db = { query: async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes('venue_staff_assignments')) return { rows: [{ staff_user_id: 7 }, { staff_user_id: 8 }] };
    if (sql.includes('INSERT INTO notifications')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  } };

  // Act.
  await notifyVenueStaffOfEventStatus(db, { id: 11, name: 'Workshop', status: 'cancelled' });

  // Assert: cancellation text is actionable for venue arrangements and a missing recipient cannot create a phantom write.
  const insert = calls.find(call => call.sql.includes('INSERT INTO notifications'));
  assert.deepEqual(insert.values[0], [7, 8]);
  assert.deepEqual(insert.values[3], ['venue_event_status_changed', 'venue_event_status_changed']);
  assert.match(insert.values[5][0], /will no longer proceed/);
  const noAssignments = { query: async () => ({ rows: [] }) };
  await notifyVenueStaffOfEventStatus(noAssignments, { id: 11, name: 'Workshop', status: 'confirmed' });
});

test('AC3 AC4 AC6 - exposes the current event lifecycle and sends a confirmation notice separately from booking approval', async () => {
  // Arrange: the venue booking remains approved while the event is cancelled, then a later event confirmation is sent.
  const calls = [];
  const db = { query: async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes('venue_staff_assignments')) return { rows: [{ staff_user_id: 7 }] };
    if (sql.includes('INSERT INTO notifications')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  } };

  // Act.
  await notifyVenueStaffOfEventStatus(db, { id: 11, name: 'Workshop', status: 'approved' }, 'confirmed');

  // Assert: the event lifecycle value is retained in the notification rather than inferred from booking status.
  const insert = calls.find(call => call.sql.includes('INSERT INTO notifications'));
  assert.equal(insert.values[3][0], 'venue_event_status_changed');
  assert.equal(JSON.parse(insert.values[6][0]).status, 'confirmed');
  assert.match(insert.values[5][0], /now confirmed/i);
});

test('AC7 - persists the opt-in preference and evaluates the daily boundary just below, at and above 24 hours', async () => {
  // Arrange: a Venue Staff member enables reminders; the timestamps are one second around the agreed daily cadence.
  const writes = [];
  const db = { query: async (sql, values) => { writes.push({ sql, values }); return { rows: [{ daily_pending_reminders: true, reminder_frequency_days: 3 }] }; } };
  const now = Date.parse('2031-10-02T00:00:00Z');

  // Act.
  const preference = await updateVenueReminderPreference(db, 7, true, 3);

  // Assert: a plausible implementation that stores the wrong user/value or uses a strict daily comparison fails here.
  assert.deepEqual(preference, { dailyPendingReminders: true, reminderFrequencyDays: 3 });
  assert.deepEqual(writes[0].values, [7, true, 3]);
  assert.equal(isDailyReminderDue('2031-10-01T00:00:01Z', now), false);
  assert.equal(isDailyReminderDue('2031-10-01T00:00:00Z', now), true);
  assert.equal(isDailyReminderDue('2030-09-30T23:59:59Z', now), true);
  assert.equal(isReminderDue('2031-09-29T00:00:01Z', 3, now), false);
  assert.equal(isReminderDue('2031-09-29T00:00:00Z', 3, now), true);
});

test('AC7 - sends one due daily pending-request reminder and records its send time', async () => {
  // Arrange: one opted-in staff member is exactly due, one is one second early, and the query supplies their pending counts.
  const calls = [];
  const now = Date.parse('2031-10-02T00:00:00Z');
  const db = { query: async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes('GROUP BY preference.user_id')) return { rows: [
      { user_id: 7, last_pending_reminder_at: '2031-09-29T00:00:00Z', reminder_frequency_days: 3, pending_count: 2 },
      { user_id: 8, last_pending_reminder_at: '2031-10-01T00:00:01Z', pending_count: 1 },
    ] };
    if (sql.includes('INSERT INTO notifications')) return { rows: [{ id: 1 }] };
    if (sql.includes('UPDATE venue_notification_preferences')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  } };

  // Act.
  await sendDailyPendingVenueReminders(db, now);

  // Assert: a faulty <=/</duplicate-recipient implementation fails the exact-boundary recipient and timestamp checks.
  const insert = calls.find(call => call.sql.includes('INSERT INTO notifications'));
  const update = calls.find(call => call.sql.includes('UPDATE venue_notification_preferences'));
  assert.deepEqual(insert.values[0], [7]);
  assert.match(insert.values[5][0], /2 pending venue booking requests/);
  assert.deepEqual(update.values, [[7], now]);
});
