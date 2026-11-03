// Schedule AC4: test the real availability calculation and production CSS, without substituting business rules.
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import VenueTimeline from '../../frontend/src/pages/venues/VenueTimeline';
let style;
afterEach(() => { cleanup(); style?.remove(); style = null; });
const date = '2030-10-10', at = time => `${date}T${time}:00+08:00`;
const now = Date.parse(at('09:00'));
const booking = { id: 1, kind: 'booking', status: 'approved', label: 'Conference', start_datetime: at('10:00'), end_datetime: at('11:00') };
/** Only visual cases load CSS; the renderer retains the real date, buffers, and hold-expiration logic. */
function timeline(records, visual = false, periods = []) {
  if (visual) { style = document.createElement('style'); style.textContent = readFileSync('src/index.css', 'utf8'); document.head.append(style); }
  render(<VenueTimeline venueName="Hall" records={records} periods={periods} date={date} now={now} operatingHours="08:00 - 22:00" canEdit={false} />);
}

it('Schedule AC4 - uses red unavailable occupancy and grey non-operating hours with a keyboard-accessible reason', () => {
  // Arrange: the recorded label is the reason this period cannot be booked.
  timeline([booking], true);
  const occupied = screen.getByRole('gridcell', { name: /10:00–11:00.*Unavailable.*Conference/ });
  const closed = screen.getByRole('gridcell', { name: /00:00–08:00.*Outside operating hours/ });
  // Assert: color is supplementary to readable status and reason, not the only distinction.
  expect(getComputedStyle(occupied).backgroundColor).toBe('rgb(253, 228, 223)');
  expect(getComputedStyle(closed).backgroundColor).toBe('rgb(227, 228, 224)');
  expect(document.querySelector('.venue-timeline-locked')).toHaveTextContent('Unavailable');
  expect(getComputedStyle(document.querySelector('.venue-timeline-locked')).backgroundColor).toBe('rgb(161, 45, 36)');
  expect(occupied).toHaveAttribute('title', expect.stringContaining('Conference'));
  expect(getComputedStyle(occupied).pointerEvents).toBe('auto');
  // Act / Assert: keyboard focus reveals the same reason available on hover.
  act(() => occupied.focus());
  expect(occupied).toHaveFocus();
  expect(occupied).toHaveAccessibleDescription(expect.stringContaining('Conference'));
  expect(occupied.querySelector('[role="tooltip"]')).toHaveTextContent('Unavailable');
  expect(style.textContent).toContain('.venue-timeline-segment:hover .venue-timeline-tooltip');
});

it.each(['unavailable', 'available'])('Schedule AC4 - labels read-only scheduled %s time while retaining its recorded reason', status => {
  // Arrange: staff-created periods keep their stored description without exposing editing controls to coordinators.
  timeline([{ ...booking, kind: 'schedule', status, label: 'Cleaning window' }], false,
    [{ id: 1, start: '10:00', end: '11:00', status, label: 'Cleaning window' }]);
  const block = document.querySelector('.venue-timeline-block');
  // Assert: Unavailable is the verdict; hover/focus still reveals why, while available descriptions remain intact.
  expect(block.querySelector('.venue-timeline-block-label')).toHaveTextContent(status === 'unavailable' ? 'Unavailable' : 'Cleaning window');
  expect(block).toHaveAttribute('title', 'Cleaning window 10:00–11:00');
  expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
});

it.each([
  ['approved', null, true], ['confirmed', null, true],
  ['pending', -1, false], ['pending', 0, false], ['pending', 1, true],
  ['tentative', -1, false], ['tentative', 0, false], ['tentative', 1, true],
  ['rejected', null, false], ['cancelled', null, false],
])('Schedule AC4 - presents booking %s at expiry offset %s as blocked=%s', (status, offset, blocked) => {
  // Arrange: one millisecond below/at/above expiration proves styling does not extend a released hold.
  timeline([{ ...booking, status, hold_expires_at: offset === null ? null : new Date(now + offset).toISOString() }]);
  const cell = screen.getByRole('gridcell', { name: /10:00–11:00/ });
  // Assert: old availability rules remain authoritative, including exact expiration.
  expect(cell).toHaveClass(blocked ? 'blocked' : 'available');
  expect(cell).toHaveAttribute('aria-label', expect.stringContaining(blocked ? 'Unavailable' : 'Available'));
});

it('Schedule AC4 - retains maintenance reasons and exact setup/turnaround boundaries', () => {
  // Arrange: a buffered booking and a separate maintenance closure have distinct recorded reasons.
  timeline([{ ...booking, setup_minutes: 30, turnaround_minutes: 30 }, { id: 2, kind: 'unavailability', label: 'Air-conditioning repair', start_datetime: at('12:00'), end_datetime: at('13:00') }]);
  // Assert: only the expanded booking window is red; adjacent free and closed-hour boundaries remain correct.
  expect(screen.getByRole('gridcell', { name: /09:30–11:30.*Unavailable.*Conference/ })).toHaveClass('blocked');
  expect(screen.getByRole('gridcell', { name: /08:00–09:30.*Available/ })).toHaveClass('available');
  expect(screen.getByRole('gridcell', { name: /11:30–12:00.*Available/ })).toHaveClass('available');
  expect(screen.getByRole('gridcell', { name: /12:00–13:00.*Air-conditioning repair/ })).toHaveClass('blocked');
  expect(screen.getByRole('gridcell', { name: /13:00–22:00.*Available/ })).toHaveClass('available');
  expect(screen.getByRole('gridcell', { name: /22:00–24:00.*Outside operating hours/ })).toHaveClass('outside-hours');
});

it.each([
  ['opening', '07:59', '08:01', '07:59–08:00', '08:00–08:01'],
  ['closing', '21:59', '22:01', '22:00–22:01', '21:59–22:00'],
])('Schedule AC4 - distinguishes just below/at/above the %s boundary', (boundary, start, end, closedRange, occupiedRange) => {
  // Arrange: a booking spanning one minute on either side of the exact boundary must not recolor closed hours red.
  timeline([{ ...booking, start_datetime: at(start), end_datetime: at(end) }], true);
  // Assert: half-open operating intervals define precisely where red occupancy becomes grey closure.
  expect(screen.getByRole('gridcell', { name: new RegExp(closedRange) })).toHaveClass('outside-hours');
  expect(screen.getByRole('gridcell', { name: new RegExp(occupiedRange) })).toHaveClass('blocked');
  expect(getComputedStyle(document.querySelector('.venue-timeline-closed')).zIndex).toBe('3');
});
