// SCRUM-54 AC3: real inventory filters must aggregate split schedules without hiding gaps or stock shortages.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import EquipmentInventorySection from '../../frontend/src/pages/tech-support/EquipmentInventorySection';

afterEach(cleanup);

const selectedDate = '2026-11-01';
// Explicit schedule metadata distinguishes coverage from synthetic reservation-only stock reductions.
const segment = (startTime, endTime, availableQuantity, extra = {}) => ({
  date: selectedDate, startTime, endTime, availableQuantity,
  status: availableQuantity > 0 ? 'Available' : 'Reserved', isScheduled: true, ...extra,
});

// Use accessible controls and the catalogue table; keep the actual component and business logic real.
function searchInterval(windows, date = selectedDate) {
  render(<EquipmentInventorySection inventory={[{
    id: 1, asset_code: 'PROJ-001', name: 'Projector', quantity: 3,
    specification: 'Full HD', availabilities: windows,
  }]} error="" />);
  fireEvent.change(screen.getByLabelText('Filter equipment by date'), { target: { value: date } });
  fireEvent.change(screen.getByLabelText('Available from'), { target: { value: '09:00' } });
  fireEvent.change(screen.getByLabelText('Available to'), { target: { value: '11:00' } });
}

it.each([
  ['adjacent segments', '10:00:00', 2, true],
  ['overlapping segments', '09:59:00', 2, true],
  ['a one-minute schedule gap', '10:01:00', 2, false],
  ['one remaining unit', '10:00:00', 1, true],
  ['an exhausted segment', '10:00:00', 0, true],
])('SCRUM-54 AC3 - handles %s using minimum interval stock', (_, secondStart, remaining, visible) => {
  // Arrange/Act: unsorted segments require ordering; stock at 11:00 is outside this half-open interval.
  searchInterval([
    segment('11:00:00', '17:00:00', 0),
    segment(secondStart, '11:00:00', remaining),
    segment('09:00:00', '10:00:00', 3),
  ]);

  // Assert: missing coverage excludes the row; continuous coverage exposes even a zero-stock bottleneck.
  if (visible) {
    const row = screen.getByRole('row', { name: /PROJ-001 Projector/ });
    expect(within(row).getAllByRole('cell')[3].textContent).toBe(String(remaining));
  } else {
    expect(screen.queryByRole('row', { name: /PROJ-001 Projector/ })).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('No equipment matches');
  }
});

it.each([
  ['a late start', '09:01:00', '11:00:00'],
  ['an early finish', '09:00:00', '10:59:00'],
])('SCRUM-54 AC3 - rejects %s even with reservation-only coverage', (_, start, end) => {
  // Arrange/Act: synthetic stock windows must not fill gaps in a real schedule.
  searchInterval([
    segment(start, end, 2),
    segment('09:00:00', '11:00:00', 1, { isScheduled: false }),
  ]);

  // Assert: overlap alone cannot establish full schedule coverage.
  expect(screen.queryByRole('row', { name: /PROJ-001 Projector/ })).toBeNull();
});

it('SCRUM-54 AC3 - does not join partial schedules on different dates', () => {
  // Arrange/Act: each day covers only half of a time-only search.
  searchInterval([
    segment('09:00:00', '10:00:00', 3),
    segment('10:00:00', '11:00:00', 3, { date: '2026-11-02' }),
  ], '');

  // Assert: no single date can supply the requested continuous interval.
  expect(screen.queryByRole('row', { name: /PROJ-001 Projector/ })).toBeNull();
});

it('SCRUM-54 AC3 - excludes time-only ranges with an exhausted segment', () => {
  // Arrange/Act: one available hour cannot compensate for a fully reserved hour.
  searchInterval([segment('09:00:00', '10:00:00', 3), segment('10:00:00', '11:00:00', 0)], '');

  // Assert: a time-only availability search requires stock throughout the interval.
  expect(screen.queryByRole('row', { name: /PROJ-001 Projector/ })).toBeNull();
});

it('SCRUM-54 AC3 - keeps nested coverage and ignores stock on another date', () => {
  // Arrange/Act: a contained low-stock segment must not rewind the coverage cursor.
  searchInterval([
    segment('09:00:00', '10:30:00', 3),
    segment('09:30:00', '10:00:00', 1),
    segment('10:30:00', '11:00:00', 2),
    segment('09:00:00', '11:00:00', 0, { date: '2026-11-02' }),
  ]);

  // Assert: the selected date's bottleneck is one unit, independent of the other date.
  const row = screen.getByRole('row', { name: /PROJ-001 Projector/ });
  expect(within(row).getAllByRole('cell')[3].textContent).toBe('1');
});

it('SCRUM-54 AC3 - finds a complete stocked date in a time-only search', () => {
  // Arrange/Act: one date has a gap, but another independently covers the entire request.
  searchInterval([
    segment('09:00:00', '10:00:00', 3),
    segment('09:00:00', '10:00:00', 2, { date: '2026-11-02' }),
    segment('10:00:00', '11:00:00', 1, { date: '2026-11-02' }),
  ], '');

  // Assert: a valid complete day suffices without combining quantities across days.
  expect(screen.getByRole('row', { name: /PROJ-001 Projector/ })).toBeTruthy();
});

it('SCRUM-54 AC3 - rejects equal endpoints while searching a calendar asset', () => {
  // Arrange: include an active search so calendar matching also evaluates the invalid interval.
  searchInterval([segment('09:00:00', '11:00:00', 3)]);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'PROJ-001' } });

  // Act/Assert: a zero-duration interval is invalid, not a bookable continuous range.
  fireEvent.change(screen.getByLabelText('Available to'), { target: { value: '09:00' } });
  expect(screen.getByRole('alert').textContent).toContain('must be later');
  expect(screen.queryByRole('row', { name: /PROJ-001 Projector/ })).toBeNull();
});
