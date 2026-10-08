import React from 'react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import VenueSchedule from '../../frontend/src/pages/venues/VenueSchedule';
import VenueDetail from '../../frontend/src/pages/venues/VenueDetail';
import { buildSchedule } from '../../frontend/src/pages/venues/schedule';
import { api } from '../../frontend/src/api/client';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn() } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const date = '2030-10-10';
// Fixtures use explicit Singapore offsets so expectations do not depend on the machine timezone.
const at = time => `${date}T${time}:00+08:00`;
const booking = { id: 1, kind: 'booking', label: 'Conference', status: 'approved', start_datetime: at('10:00'), end_datetime: at('11:00') };
const maintenance = { id: 2, kind: 'unavailability', label: 'Maintenance', start_datetime: at('12:00'), end_datetime: at('13:00') };

it('AC1 - opens the selected venue schedule from its profile', async () => {
  // Arrange: a real profile and schedule; only the network boundary is controlled.
  api.get.mockResolvedValue([]);
  render(<VenueDetail venue={{ id: 7, name: 'Hall A' }} canManage token="staff" onClose={() => {}} />);
  // Act
  fireEvent.click(screen.getByRole('button', { name: 'View schedule' }));
  // Assert
  expect(await screen.findByRole('heading', { name: 'Hall A schedule' })).toBeVisible();
  await waitFor(() => expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/^\/venues\/7\/schedule\?date=/), 'staff'));
});

it('AC2 AC3 AC4 - shows booking times, other unavailable periods and available gaps', async () => {
  // Arrange
  api.get.mockResolvedValue([booking, maintenance]);
  render(<VenueSchedule venue={{ id: 7, name: 'Hall A' }} token="staff" initialDate={date} />);
  // Act: wait for the selected day's records.
  await screen.findByText(/Conference/);
  // Assert: textual labels make availability understandable without relying on colour.
  expect(screen.getByText(/Conference/).closest('li')).toHaveTextContent(/10:00–11:00.*Unavailable.*Confirmed booking.*Conference/);
  expect(screen.getByText(/Maintenance/).closest('li')).toHaveTextContent(/12:00–13:00.*Unavailable.*Other unavailable.*Maintenance/);
  expect(screen.getByText(/11:00–12:00.*Available/)).toBeTruthy();
});

it('AC1 AC4 - changes dates, shows empty availability and fails closed on network errors', async () => {
  // Arrange
  api.get.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce([booking]);
  render(<VenueSchedule venue={{ id: 7, name: 'Hall' }} initialDate={date} />);
  expect(screen.getByRole('status').textContent).toBe('Loading schedule…');
  expect(await screen.findByText(/00:00–24:00.*Available/)).toBeTruthy();
  // Act
  fireEvent.change(screen.getByLabelText('Schedule date'), { target: { value: '2030-10-11' } });
  // Assert: a failed request must not leave yesterday's availability visible.
  expect((await screen.findByRole('alert')).textContent).toContain('Offline');
  expect(screen.queryByText(/00:00–24:00.*Available/)).toBeNull();
  fireEvent.change(screen.getByLabelText('Schedule date'), { target: { value: date } });
  await screen.findByText(/Conference/);
  fireEvent.change(screen.getByLabelText('Schedule date'), { target: { value: '' } });
  expect(screen.getByText('Choose a date to view the schedule.')).toBeTruthy();
});

it('AC1 - ignores obsolete success and failure responses after changing venue', async () => {
  // Arrange: deliberately settle requests in the wrong order.
  let resolveOld, rejectOld;
  api.get.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValueOnce([]);
  const view = render(<VenueSchedule venue={{ id: 1, name: 'Old' }} initialDate={date} />);
  // Act
  view.rerender(<VenueSchedule venue={{ id: 2, name: 'New' }} initialDate={date} />);
  await screen.findByText(/00:00–24:00.*Available/);
  await act(async () => resolveOld([booking]));
  // Assert
  expect(screen.queryByText(/Conference/)).toBeNull();
  // A late failure for a venue no longer shown must not replace the newer venue's schedule with an error.
  api.get.mockImplementationOnce(() => new Promise((resolve, reject) => { rejectOld = reject; })).mockResolvedValueOnce([]);
  view.rerender(<VenueSchedule venue={{ id: 3, name: 'Previous' }} initialDate={date} />);
  view.rerender(<VenueSchedule venue={{ id: 4, name: 'Current' }} initialDate={date} />);
  await screen.findByText(/00:00–24:00.*Available/);
  await act(async () => rejectOld(new Error('Late failure')));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText(/00:00–24:00.*Available/)).toBeTruthy();
});

it.each([
  ['09:59', false], ['10:00', true], ['10:01', true],
  ['10:59', true], ['11:00', false], ['11:01', false],
])('AC5 - at %s confirmed booking unavailability is %s', (time, unavailable) => {
  // Arrange: use an independent expected truth table around both endpoints.
  const segments = buildSchedule(date, [{ ...booking, status: 'confirmed' }]);
  // Act: locate the minute in the displayed half-open intervals.
  const instant = Date.parse(at(time));
  const segment = segments.find(item => item.start <= instant && instant < item.end);
  // Assert
  expect(segment.blocked).toBe(unavailable);
});

it('AC2 AC3 AC4 AC5 - clips overnight records, merges overlaps and does not block pending or cancelled bookings', () => {
  // Arrange: reversed input order proves chronological output is independent of server ordering.
  const records = [maintenance, booking, { ...booking, id: 3, status: 'pending' },
    { ...booking, id: 4, status: 'cancelled', start_datetime: at('14:00'), end_datetime: at('15:00') },
    { ...maintenance, id: 5, start_datetime: '2030-10-09T23:00:00+08:00', end_datetime: at('10:30') },
    { ...maintenance, id: 6, start_datetime: at('23:00'), end_datetime: '2030-10-11T01:00:00+08:00' },
    { ...booking, id: 7, start_datetime: '2030-10-11T10:00:00+08:00', end_datetime: '2030-10-11T11:00:00+08:00' }];
  // Act
  const segments = buildSchedule(date, records);
  // Assert: free gaps are calculated from all blockers, including overlapping maintenance.
  // Informational bookings may divide free gaps into rows; their combined duration must remain eleven hours.
  expect(segments.filter(s => !s.blocked).reduce((total, s) => total + s.end - s.start, 0)).toBe(11 * 3600000);
  expect(segments.find(s => s.start === Date.parse(at('14:00'))).blocked).toBe(false);
  expect(segments[0].start).toBe(Date.parse(at('00:00')));
  expect(segments.at(-1).end).toBe(Date.parse('2030-10-11T00:00:00+08:00'));
});

it('AC2 AC5 - refreshing a pending booking after confirmation makes its period unavailable', async () => {
  // Arrange: confirmation occurs at the network boundary between the two reads.
  api.get.mockResolvedValueOnce([{ ...booking, status: 'pending' }]).mockResolvedValueOnce([{ ...booking, status: 'confirmed' }]);
  render(<VenueSchedule venue={{ id: 7, name: 'Hall' }} initialDate={date} />);
  expect((await screen.findByText(/Booking \(pending\)/)).closest('li').textContent).toMatch(/10:00–11:00 · Available/);
  // Act
  fireEvent.click(screen.getByRole('button', { name: 'Refresh schedule' }));
  // Assert: verifies the same interval changes classification, not just its label.
  expect((await screen.findByText(/Confirmed booking: Conference/)).closest('li').textContent).toMatch(/10:00–11:00 · Unavailable/);
});
