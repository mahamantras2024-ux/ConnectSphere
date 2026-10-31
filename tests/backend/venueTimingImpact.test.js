// SCRUM-105: exercise real occupied-window rules with raw bookings, not a mocked conflict calculator.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { affectedBookings } = require('../../backend/src/services/venueImpact');
const { hasConflict } = require('../../backend/src/services/venueAvailability');

const now = Date.parse('2030-10-09T00:00:00Z');
const at = time => `2030-10-10T${time}:00+08:00`;
const before = {
  setup_minutes: 0, turnaround_minutes: 0, capacity: 100, facilities: ['Wi-Fi'],
  accessibility_features: ['Ramp'], supported_layouts: ['Theatre'], location: 'Hall',
  operating_hours: '00:00 - 23:59', availability_status: 'Available',
};
const unchanged = {
  setupMinutes: 0, turnaroundMinutes: 0, capacity: 100, facilities: ['Wi-Fi'],
  accessibilityFeatures: ['Ramp'], supportedLayouts: ['Theatre'], location: 'Hall',
  operatingHours: '00:00 - 23:59', availabilityStatus: 'Available',
};

/** Supplies a raw persisted booking; its one-hour event duration is independent of any buffer calculation. */
function booking(id, start, end, extra = {}) {
  return { id, booking_id: id, kind: 'booking', event_name: `Event ${id}`, status: 'confirmed',
    start_datetime: at(start), end_datetime: at(end), ...extra };
}

for (const [minutes, expected] of [[29, false], [30, false], [31, true]]) {
  for (const field of ['setupMinutes', 'turnaroundMinutes']) {
    test(`SCRUM-105 AC2 AC3 - ${field} ${minutes} leaves a gap, touches, or overlaps another buffered booking`, () => {
      // Arrange: events are 60 minutes apart; the other buffer uses 30 minutes of that gap.
      const bookings = [booking(1, '10:00', '11:00'), booking(2, '12:00', '13:00')];
      const next = { ...unchanged, setupMinutes: 30, turnaroundMinutes: 30, [field]: minutes };
      // Act: availability and change-impact checks must agree on the same half-open intervals.
      const conflict = hasConflict(bookings[0], [bookings[1]], {
        setup_minutes: next.setupMinutes, turnaround_minutes: next.turnaroundMinutes,
      }, now);
      const affected = affectedBookings(before, next, bookings, [], now);
      // Assert: at 30 + 30 the occupied edges meet, while a 31-minute buffer creates one minute of overlap.
      assert.equal(conflict, expected);
      assert.deepEqual(affected.map(row => row.booking_id), expected ? [1, 2] : []);
      if (expected) assert.match(affected[0].reasons.join(' '), /booking #2/i);
    });
  }
}

for (const [field, start, end] of [
  ['setupMinutes', '09:00', '09:30'], ['turnaroundMinutes', '11:30', '12:00'],
]) {
  for (const [minutes, expected] of [[29, false], [30, false], [31, true]]) {
    test(`SCRUM-105 AC2 AC3 - ${field} ${minutes} checks unavailable time without buffering the closure`, () => {
      // Arrange: maintenance has its own complete window, exactly 30 minutes from the event.
      const bookings = [booking(1, '10:00', '11:00')];
      const closure = { id: 1, kind: 'unavailability', label: 'Floor maintenance',
        start_datetime: at(start), end_datetime: at(end) };
      // Act: a maintenance ID equal to a booking ID must still be checked.
      const affected = affectedBookings(before, { ...unchanged, [field]: minutes }, bookings, [closure], now);
      // Assert: expanding closures as if they were bookings would incorrectly warn below the boundary.
      assert.equal(affected.length, expected ? 1 : 0);
      if (expected) assert.match(affected[0].reasons.join(' '), /Floor maintenance/);
    });
  }
}

test('SCRUM-105 AC3 - identifies only new conflicts and preserves raw booking records', () => {
  // Arrange: one distant booking, one cancelled row and one expired hold must not become follow-up items.
  const bookings = [booking(1, '10:00', '11:00'), booking(2, '12:00', '13:00'), booking(3, '16:00', '17:00'),
    booking(4, '10:00', '11:00', { status: 'cancelled' }),
    booking(5, '10:00', '11:00', { status: 'pending', hold_expires_at: new Date(now).toISOString() })];
  const original = structuredClone(bookings);
  // Act
  const affected = affectedBookings(before, { ...unchanged, setupMinutes: 31, turnaroundMinutes: 30 }, bookings, [], now);
  // Assert: no blanket warning, cancellation or mutation of inputs is allowed.
  assert.deepEqual(affected.map(row => row.booking_id), [1, 2]);
  assert.deepEqual(bookings, original);
  assert.deepEqual(affected.map(row => row.status), ['confirmed', 'confirmed']);
});

test('SCRUM-105 AC3 - timing decreases do not report conflicts already present before the change', () => {
  // Arrange: these occupied windows already overlapped with 60-minute buffers.
  const bookings = [booking(1, '10:00', '11:00'), booking(2, '12:00', '13:00')];
  // Act / Assert: reducing both to 40 still overlaps, but does not introduce a new conflict.
  assert.deepEqual(affectedBookings({ ...before, setup_minutes: 60, turnaround_minutes: 60 },
    { ...unchanged, setupMinutes: 40, turnaroundMinutes: 40 }, bookings, [], now), []);
});

for (const [remaining, expected] of [[-1, 0], [0, 0], [1, 2]]) {
  test(`SCRUM-105 AC3 - a pending hold ${remaining}ms before its deadline is included only while active`, () => {
    // Arrange: a new buffer would overlap the confirmed event and this pending request.
    const bookings = [booking(1, '10:00', '11:00'), booking(2, '12:00', '13:00', {
      status: 'pending', hold_expires_at: new Date(now + remaining).toISOString(),
    })];
    // Act / Assert: exactly at expiry the hold releases its occupied time.
    assert.equal(affectedBookings(before, { ...unchanged, setupMinutes: 31, turnaroundMinutes: 30 }, bookings, [], now).length, expected);
  });
}

test('SCRUM-105 AC2 AC3 - setup can introduce a conflict with maintenance on the previous day', () => {
  // Arrange: 00:15 minus 30 minutes is 23:45 on the previous local day.
  const bookings = [booking(1, '00:15', '01:00')];
  const closure = { id: 7, kind: 'unavailability', start_datetime: '2030-10-09T23:30:00+08:00',
    end_datetime: '2030-10-09T23:50:00+08:00' };
  // Act / Assert: day-based comparisons would miss the five-minute occupied overlap.
  const affected = affectedBookings(before, { ...unchanged, setupMinutes: 30 }, bookings, [closure], now);
  assert.equal(affected.length, 1);
  assert.match(affected[0].reasons.join(' '), /unavailable/i);
});

test('SCRUM-105 AC1 AC3 - legacy missing buffers act as zero when calculating a new conflict', () => {
  // Arrange: older catalogue rows can omit timing fields, but a newly saved 30-minute setup still applies.
  const bookings = [booking(1, '10:00', '11:00')];
  const closure = { id: 8, kind: 'unavailability', start_datetime: at('09:00'), end_datetime: at('09:45') };
  // Act / Assert: treating absent previous buffers as NaN would lose the distinction between old and new overlaps.
  assert.equal(affectedBookings({ ...before, setup_minutes: null, turnaround_minutes: null },
    { ...unchanged, setupMinutes: 30 }, bookings, [closure], now).length, 1);
});

test('SCRUM-105 AC2 AC3 - turnaround can introduce a conflict with a closure on the following day', () => {
  // Arrange: the event ends at 23:45; a 30-minute reset occupies the next day until 00:15.
  const bookings = [booking(1, '23:00', '23:45')];
  const closure = { id: 8, kind: 'unavailability', start_datetime: '2030-10-11T00:10:00+08:00',
    end_datetime: '2030-10-11T01:00:00+08:00' };
  // Act / Assert: clipping to the event's date would miss this five-minute reset overlap.
  assert.equal(affectedBookings(before, { ...unchanged, turnaroundMinutes: 30 }, bookings, [closure], now).length, 1);
});
