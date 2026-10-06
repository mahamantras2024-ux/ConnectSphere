import { expect, it } from 'vitest';
import { buildSchedule } from '../../frontend/src/pages/venues/schedule';

// Explicit Singapore timestamps keep each oracle independent of the browser timezone.
const date = '2030-10-10';
const at = time => Date.parse(`${date}T${time}+08:00`);
const now = Date.parse('2030-10-09T12:00:00+08:00');
const booking = {
  id: 1, kind: 'booking', label: 'Conference', status: 'approved',
  start_datetime: '2030-10-10T10:00:00+08:00', end_datetime: '2030-10-10T11:00:00+08:00',
};
const hold = { ...booking, status: 'pending', hold_expires_at: '2030-10-09T12:00:00+08:00' };

/** Looks up one instant in the public schedule output; absence is an assertion failure, never a free slot. */
function segmentAt(records, time, options = {}) {
  const segments = buildSchedule(date, records, { now, ...options });
  const segment = segments.find(item => item.start <= at(time) && at(time) < item.end);
  expect(segment, `The schedule must contain ${time}`).toBeDefined();
  return segment;
}

it.each([
  ['both buffers', 30, 15, '09:30:00', '11:15:00'],
  ['setup only', 30, 0, '09:30:00', '11:00:00'],
  ['turnaround only', 0, 15, '10:00:00', '11:15:00'],
  ['zero buffers', 0, 0, '10:00:00', '11:00:00'],
])('AC6 - independently calculates the occupied window with %s', (_scenario, setupMinutes, turnaroundMinutes, start, end) => {
  // Arrange: asymmetric durations expose swapped buffers and adding both durations on one side.
  const options = { now, setupMinutes, turnaroundMinutes };
  // Act
  const blocked = buildSchedule(date, [booking], options).filter(segment => segment.blocked);
  // Assert: the literal expected endpoints come from the AC, not a duplicate of the calculation.
  expect(blocked[0].start).toBe(at(start));
  expect(blocked.at(-1).end).toBe(at(end));
  expect(blocked.reduce((duration, segment) => duration + segment.end - segment.start, 0)).toBe(at(end) - at(start));
});

it.each([
  ['09:29:59.999', false], ['09:30:00.000', true], ['09:30:00.001', true],
  ['11:14:59.999', true], ['11:15:00.000', false], ['11:15:00.001', false],
])('AC6 - buffered half-open occupancy at %s is %s', (time, blocked) => {
  // Arrange / Act: probe just below, exactly at and just above both buffered endpoints.
  const segment = segmentAt([booking], time, { setupMinutes: 30, turnaroundMinutes: 15 });
  // Assert: catches rounding, exclusive-start and inclusive-end defects.
  expect(segment.blocked).toBe(blocked);
});

it.each([
  ['setup from tomorrow', '2030-10-11T00:15:00+08:00', '2030-10-11T01:00:00+08:00', 30, 0, '23:45:00', '24:00:00'],
  ['turnaround from yesterday', '2030-10-09T22:00:00+08:00', '2030-10-09T23:45:00+08:00', 0, 30, '00:00:00', '00:15:00'],
])('AC5 AC6 - includes %s before clipping to the selected day', (_scenario, start_datetime, end_datetime, setupMinutes, turnaroundMinutes, start, end) => {
  // Arrange: the event itself is wholly outside this day; only its buffer intersects it.
  const record = { ...booking, start_datetime, end_datetime };
  // Act
  const blocked = buildSchedule(date, [record], { now, setupMinutes, turnaroundMinutes }).filter(segment => segment.blocked);
  // Assert: clipping raw event times before expansion would discard this blocker entirely.
  expect(blocked).toHaveLength(1);
  expect(blocked[0]).toMatchObject({ start: at(start), end: at(end) });
});

it.each([
  ['one millisecond before expiry', now - 1, true],
  ['exactly at expiry', now, false],
  ['one millisecond after expiry', now + 1, false],
])('AC7 AC8 AC9 - pending hold %s (clock %s) blocks the slot: %s', (_scenario, instant, blocked) => {
  // Arrange / Act: hold lifetime concerns the checking clock, not the future event's date.
  const segment = segmentAt([hold], '10:30:00', { now: instant });
  // Assert: a pending record must reserve time only while its explicit hold remains valid.
  expect(segment.blocked).toBe(blocked);
});

it('AC6 AC7 - an active temporary hold reserves its setup and turnaround periods', () => {
  // Arrange: this hold has not expired; the event itself still runs 10:00–11:00.
  const options = { now: now - 1, setupMinutes: 30, turnaroundMinutes: 15 };
  // Act / Assert: ignoring hold buffers incorrectly exposes both of these times as free.
  expect(segmentAt([hold], '09:45:00', options).blocked).toBe(true);
  expect(segmentAt([hold], '11:05:00', options).blocked).toBe(true);
});

it.each(['approved', 'confirmed'])('AC2 AC8 AC9 - %s booking stays blocked after its former hold deadline', status => {
  // Arrange: approval replaces the temporary reservation; its old expiry is historical metadata.
  const record = { ...hold, status };
  // Act / Assert: indiscriminately filtering every expired timestamp would release a confirmed booking.
  expect(segmentAt([record], '10:30:00', { now: now + 1 }).blocked).toBe(true);
});

it.each(['rejected', 'cancelled'])('AC2 AC5 AC9 - %s requests do not block even with a future hold deadline', status => {
  // Arrange: status overrides any historical hold metadata.
  const record = { ...hold, status, hold_expires_at: '2030-10-10T12:00:00+08:00' };
  // Act / Assert: treating any unexpired timestamp as a hold would reserve this slot incorrectly.
  expect(segmentAt([record], '10:30:00').blocked).toBe(false);
});

it.each([
  ['maintenance', { ...booking, id: 2, kind: 'unavailability', label: 'Maintenance' }],
  ['confirmed booking', { ...booking, id: 2 }],
  ['another active hold', { ...hold, id: 2, hold_expires_at: '2030-10-10T12:00:00+08:00' }],
])('AC3 AC8 - releasing an expired hold preserves overlapping %s', (_scenario, other) => {
  // Arrange: the other blocker occupies only 10:30–11:00 of the expired hold's 10:00–11:00 slot.
  const blocker = { ...other, start_datetime: '2030-10-10T10:30:00+08:00' };
  // Act / Assert: expiration releases precisely the part no other record reserves.
  expect(segmentAt([hold, blocker], '10:15:00').blocked).toBe(false);
  expect(segmentAt([hold, blocker], '10:45:00').blocked).toBe(true);
});

it('AC3 AC6 - maintenance uses its recorded interval without event setup or turnaround', () => {
  // Arrange: buffers are for events, not extensions of recorded maintenance windows.
  const maintenance = { ...booking, kind: 'unavailability', label: 'Maintenance' };
  // Act
  const blocked = buildSchedule(date, [maintenance], { now, setupMinutes: 30, turnaroundMinutes: 15 }).filter(segment => segment.blocked);
  // Assert: incorrectly applying event buffers to every record would widen this interval.
  expect(blocked).toHaveLength(1);
  expect(blocked[0]).toMatchObject({ start: at('10:00:00'), end: at('11:00:00') });
});
