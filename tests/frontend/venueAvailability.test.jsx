import React from 'react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../frontend/src/context/AuthContext';
import ProtectedRoute from '../../frontend/src/components/ProtectedRoute';
import CoordinatorDashboard from '../../frontend/src/pages/coordinator/CoordinatorDashboard';
import VenueList from '../../frontend/src/pages/venues/VenueList';
import VenueSchedule from '../../frontend/src/pages/venues/VenueSchedule';
import { api } from '../../frontend/src/api/client';

// Only network I/O is mocked; authentication state, catalogue, profile and schedule remain real.
vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
const date = '2030-10-10';
const expiry = Date.parse('2030-10-09T12:00:00+08:00');
const venue = { id: 7, name: 'Hall A', setup_minutes: 30, turnaround_minutes: 15 };
const hold = {
  id: 20, kind: 'booking', status: 'pending', label: 'Workshop',
  start_datetime: `${date}T10:00:00+08:00`, end_datetime: `${date}T11:00:00+08:00`,
  hold_expires_at: '2030-10-09T12:00:00+08:00',
};

afterEach(() => {
  // Clean up while fake timers still exist so effects can cancel their scheduled callbacks.
  cleanup(); vi.useRealTimers(); vi.resetAllMocks(); localStorage.clear();
});

/** Restores a real coordinator session and provides distinct venue schedules at the network boundary. */
function coordinatorNetwork() {
  localStorage.setItem('cs_token', 'coordinator-token');
  api.get.mockImplementation(async path => {
    if (path === '/auth/me') return { user: { id: 1, role: 'event_coordinator', full_name: 'Coordinator' } };
    if (path === '/events') return { events: [] };
    if (path === '/venues') return [venue, { ...venue, id: 8, name: 'Hall B' }];
    if (path.startsWith('/venues/7/schedule?')) return [];
    if (path.startsWith('/venues/8/schedule?')) return [{ ...hold, status: 'approved', label: 'Hall B booking' }];
    throw new Error(`Unexpected API read: ${path}`);
  });
}

it('AC1 - coordinator dashboard exposes venue selection alongside assigned events', async () => {
  // Arrange: restore the actual session instead of mocking a permission boolean.
  coordinatorNetwork();
  render(<MemoryRouter><AuthProvider><ProtectedRoute roles={['event_coordinator']}><CoordinatorDashboard /></ProtectedRoute></AuthProvider></MemoryRouter>);
  // Act: wait for the real dashboard's assigned-event data.
  await screen.findByText('No assigned events yet.');
  // Assert: a coordinator must be able to discover the venue availability entry point.
  expect(await screen.findByText('Hall A')).toBeVisible();
  expect(screen.getAllByRole('button', { name: /View details/ })).toHaveLength(2);
});

it('AC1 - coordinator selects another venue and date without receiving staff edit controls', async () => {
  // Arrange: render the catalogue through real authentication and the real profile drawer.
  coordinatorNetwork();
  render(<AuthProvider><VenueList /></AuthProvider>);
  // Act
  fireEvent.click((await screen.findAllByRole('button', { name: /View details/ }))[0]);
  fireEvent.click(screen.getByRole('button', { name: 'View schedule' }));
  // Assert: schedule access is independent of permission to edit or deactivate venues.
  expect(await screen.findByRole('heading', { name: 'Hall A schedule' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Edit venue' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Deactivate venue' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  fireEvent.click(screen.getAllByRole('button', { name: /View details/ })[1]);
  fireEvent.click(screen.getByRole('button', { name: 'View schedule' }));
  fireEvent.change(screen.getByLabelText('Schedule date'), { target: { value: date } });
  expect(await screen.findByText(/Hall B booking/)).toBeVisible();
  expect(api.get).toHaveBeenCalledWith(`/venues/8/schedule?date=${date}`, 'coordinator-token');
  expect(screen.queryByRole('heading', { name: 'Hall A schedule' })).not.toBeInTheDocument();
});

it('AC4 AC6 - displays independently buffered occupancy using the selected venue configuration', async () => {
  // Arrange: passing the correct venue settings to the interval utility is observable in the agenda.
  api.get.mockResolvedValue([{ ...hold, status: 'approved' }]);
  render(<VenueSchedule venue={venue} initialDate={date} />);
  // Act
  const agenda = await screen.findByRole('list', { name: 'Daily availability' });
  // Assert: catches a correct utility that the component calls without its buffer configuration.
  expect(within(agenda).getByText(/00:00–09:30.*Available/)).toBeVisible();
  expect(within(agenda).getByText(/11:15–24:00.*Available/)).toBeVisible();
  expect(agenda).toHaveTextContent('Booked');
});

it('AC3 AC4 AC7 - active holds and maintenance have distinct textual slot statuses', async () => {
  // Arrange: control only the checking clock and server records.
  vi.useFakeTimers(); vi.setSystemTime(expiry - 1000);
  api.get.mockResolvedValue([hold, {
    id: 30, kind: 'unavailability', label: 'Lift repair',
    start_datetime: `${date}T12:00:00+08:00`, end_datetime: `${date}T13:00:00+08:00`,
  }]);
  render(<VenueSchedule venue={{ ...venue, setup_minutes: 0, turnaround_minutes: 0 }} initialDate={date} />);
  // Act: flush the resolved network promise without waiting on real time.
  await act(async () => {});
  // Assert: both unavailable reasons must be readable without interpreting colour.
  expect(screen.getByText(/Workshop/).closest('li')).toHaveTextContent(/10:00–11:00.*Temporary Hold/);
  expect(screen.getByText(/Lift repair/).closest('li')).toHaveTextContent(/12:00–13:00.*Under Maintenance/);
  expect(screen.getByText(/11:00–12:00.*Available/)).toBeVisible();
});

it('AC8 AC9 - an open agenda releases a hold exactly at expiry without manual refresh or confirmation', async () => {
  // Arrange: hold expiry is 1,000 ms away; the API keeps returning the same historical record.
  vi.useFakeTimers(); vi.setSystemTime(expiry - 1000);
  api.get.mockResolvedValue([hold]);
  render(<VenueSchedule venue={{ ...venue, setup_minutes: 0, turnaround_minutes: 0 }} initialDate={date} />);
  await act(async () => {});
  // Act / Assert: all three deadline probes are deterministic and visibly distinguish hold from free time.
  await act(async () => { vi.advanceTimersByTime(999); });
  expect(screen.getByText(/Workshop/).closest('li')).toHaveTextContent('Temporary Hold');
  await act(async () => { vi.advanceTimersByTime(1); });
  expect(screen.queryByText(/Temporary Hold/)).not.toBeInTheDocument();
  expect(screen.getByText(/(?:00:00–24:00|10:00–11:00).*Available/)).toBeVisible();
  expect(screen.queryByText(/Booked|Confirmed booking/)).not.toBeInTheDocument();
  await act(async () => { vi.advanceTimersByTime(1); });
  expect(screen.queryByText(/Temporary Hold|Booked|Confirmed booking/)).not.toBeInTheDocument();
});

it('AC5 AC8 - returning to the browser revalidates a hold that was approved while the page was inactive', async () => {
  // Arrange: another user approves the request after the initial read.
  api.get.mockResolvedValueOnce([{ ...hold, hold_expires_at: '2099-01-01T00:00:00Z' }])
    .mockResolvedValue([{ ...hold, status: 'approved' }]);
  render(<VenueSchedule venue={venue} initialDate={date} />);
  await screen.findByText(/Workshop/);
  // Act
  fireEvent(window, new Event('focus'));
  // Assert: the server's confirmation must replace the stale temporary state.
  expect(await screen.findByText(/Confirmed booking: Workshop/)).toBeVisible();
  expect(screen.queryByText(/Temporary Hold/)).not.toBeInTheDocument();
});

it('AC5 AC8 AC9 - expiration revalidates a stale hold so a staff-approved booking never becomes available', async () => {
  // Arrange: approval happens on the server after loading, while the same agenda stays open through the old deadline.
  vi.useFakeTimers(); vi.setSystemTime(expiry - 1000);
  api.get.mockResolvedValueOnce([hold]).mockResolvedValue([{ ...hold, status: 'approved' }]);
  render(<VenueSchedule venue={{ ...venue, setup_minutes: 0, turnaround_minutes: 0 }} initialDate={date} />);
  await act(async () => {});
  expect(screen.getByText(/Workshop/).closest('li')).toHaveTextContent('Temporary Hold');
  // Act: the old hold deadline passes without a manual refresh or focus event.
  await act(async () => { vi.advanceTimersByTime(1000); });
  // Assert: relying solely on the old pending snapshot would incorrectly free this booked slot.
  expect(screen.getByText(/Confirmed booking: Workshop/).closest('li')).toHaveTextContent(/10:00–11:00.*Unavailable.*Booked/);
  expect(screen.queryByText(/10:00–11:00.*Available/)).not.toBeInTheDocument();
});
