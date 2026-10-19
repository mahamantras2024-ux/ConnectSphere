const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateScheduleInput, affectedBookings } = require('../../backend/src/services/venueScheduleRules');

const date = '2030-10-10';
const period = (start, end, status = 'available') => ({ start, end, status });

test('AC3 AC4 - opening and closing endpoints are permitted while either outside neighbor is rejected', () => {
  // Arrange: the recorded operating window is 08:00–22:00.
  const hours = '08:00 - 22:00';
  // Act / Assert: both exact endpoints pass; one minute below and above fail with the permitted hours.
  assert.equal(validateScheduleInput({ date, periods: [period('08:00', '22:00')] }, hours).periods.length, 1);
  for (const candidate of [period('07:59', '09:00'), period('21:00', '22:01')]) {
    assert.throws(() => validateScheduleInput({ date, periods: [candidate] }, hours), /08:00.*22:00/);
  }
});

test('AC5 - missing date or period information and zero or negative duration are rejected', () => {
  // Arrange / Act / Assert: each invalid value violates one required schedule field.
  for (const input of [
    { date: '', periods: [] },
    { date: 42, periods: [] },
    { date: '2030-02-30', periods: [] },
    { date },
    null,
    { date, periods: [period('', '10:00')] },
    { date, periods: [period('10:00', '')] },
    { date, periods: [period('10:00', '10:00')] },
    { date, periods: [period('10:01', '10:00')] },
    { date, periods: [{ start: '09:00', end: '10:00' }] },
    { date, periods: [period('25:00', '26:00')] },
    { date, periods: [period('09:00', 42)] },
  ]) assert.throws(() => validateScheduleInput(input, '08:00 - 22:00'));
});

test('AC3 AC5 - absent or malformed operating hours cannot produce a saved schedule', () => {
  // Arrange / Act / Assert: missing, impossible, and reversed windows must all fail before any periods are persisted.
  for (const hours of [undefined, '25:00 - 26:00', '22:00 - 08:00']) {
    assert.throws(() => validateScheduleInput({ date, periods: [] }, hours), /valid operating hours/);
  }
});

test('AC5 - overlapping entries fail while adjacent entries remain valid', () => {
  // Arrange / Act / Assert: time intersections are ambiguous, but sharing only an endpoint is valid.
  assert.throws(() => validateScheduleInput({ date, periods: [period('10:00', '11:00'), period('10:59', '12:00')] }, '08:00 - 22:00'), /cannot overlap/);
  assert.deepEqual(validateScheduleInput({ date, periods: [period('11:00', '12:00'), period('10:00', '11:00')] }, '08:00 - 22:00').periods.map(item => item.start), ['10:00', '11:00']);
});

test('AC1 AC5 - optional labels are trimmed or safely omitted', () => {
  // Arrange / Act / Assert: labels are descriptive, not required booking rules.
  const saved = validateScheduleInput({ date, periods: [
    { ...period('08:00', '09:00'), label: '  Open house  ' },
    { ...period('09:00', '10:00'), label: 42 },
  ] }, '08:00 - 22:00');
  assert.deepEqual(saved.periods.map(item => item.label), ['Open house', '']);
});

test('AC6 - unavailable time intersecting a confirmed booking is blocked while adjacency and availability are allowed', () => {
  // Arrange: a confirmed booking occupies 10:00–11:00; status approved is the persisted confirmed state.
  const bookings = [{ booking_id: 4, status: 'approved', start_datetime: `${date}T10:00:00+08:00`, end_datetime: `${date}T11:00:00+08:00` }];
  const make = periods => validateScheduleInput({ date, periods }, '08:00 - 22:00');
  // Act / Assert: a one-minute overlap matters; touching either endpoint does not.
  assert.deepEqual(affectedBookings(make([period('09:59', '10:01', 'unavailable')]), bookings, '08:00 - 22:00').map(b => b.booking_id), [4]);
  assert.deepEqual(affectedBookings(make([period('09:00', '10:00', 'unavailable')]), bookings, '08:00 - 22:00'), []);
  assert.deepEqual(affectedBookings(make([period('11:00', '12:00', 'unavailable')]), bookings, '08:00 - 22:00'), []);
  assert.deepEqual(affectedBookings(make([period('10:00', '11:00')]), bookings, '08:00 - 22:00'), []);
  // Pending holds do not count as confirmed bookings under AC6; their later approval still rechecks availability.
  assert.deepEqual(affectedBookings(make([period('10:00', '11:00', 'unavailable')]), [{ ...bookings[0], status: 'pending' }]), []);
});

test('AC6 - booked setup and turnaround remain protected at their exact boundaries', () => {
  // Arrange: the 10:00–11:00 confirmed event occupies 09:30–11:15 after venue buffers.
  const bookings = [{ booking_id: 5, status: 'approved', start_datetime: `${date}T10:00:00+08:00`,
    end_datetime: `${date}T11:00:00+08:00`, setup_minutes: 30, turnaround_minutes: 15 }];
  const impact = (start, end) => affectedBookings(validateScheduleInput({ date,
    periods: [period(start, end, 'unavailable')] }, '08:00 - 22:00'), bookings).length;
  // Act / Assert: one minute before the occupied start and exactly at its end are free; one-minute intersections fail.
  assert.equal(impact('09:29', '09:30'), 0);
  assert.equal(impact('09:29', '09:31'), 1);
  assert.equal(impact('11:14', '11:16'), 1);
  assert.equal(impact('11:15', '11:16'), 0);
});
