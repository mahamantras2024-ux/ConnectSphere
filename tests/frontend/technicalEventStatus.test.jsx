// Technical Support event status AC1-AC6: drive the real assigned-event cards and refresh/release controls.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../frontend/src/api/client';
import { MemoryRouter } from 'react-router-dom';
import { useAuth } from '../../frontend/src/context/AuthContext';
import TechSupportDashboard from '../../frontend/src/pages/tech-support/TechSupportDashboard';
import OnSiteSupportSection from '../../frontend/src/pages/tech-support/OnSiteSupportSection';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn() } }));
vi.mock('../../frontend/src/context/AuthContext', () => ({ useAuth: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const event = { id: 7, name: 'Support workshop', status: 'approved', proposed_date: '2030-11-01',
  proposed_start_time: '09:00:00', proposed_end_time: '11:00:00', venue_name: 'Confirmed hall',
  equipment_items: [{ item: 'Projector', quantity: 2 }], technical_support_details: 'Set up sound',
  technical_specifications: 'HDMI and two microphones', video_conferencing_required: true,
  equipment_notes: 'Bring spare cables', expected_attendance: 45 };

it.each([['submitted', 'Planning'], ['approved', 'Confirmed'], ['confirmed', 'Confirmed'],
  ['completed', 'Completed'], ['cancelled', 'Cancelled']])('TS status AC1/AC2 - presents %s as %s', async (status, label) => {
  // Arrange/Act: persisted approval and intermediate planning states use staff-facing lifecycle labels.
  api.get.mockResolvedValue({ events: [{ ...event, status }] });
  render(<OnSiteSupportSection token="staff-token" />);
  const card = await screen.findByRole('article', { name: event.name });
  // Assert: raw internal states do not substitute for the required preparation stage.
  expect(within(card).getByText(label)).toBeTruthy();
});

it('TS status AC3 - refreshes the latest confirmed schedule and technical preparation information', async () => {
  // Arrange: the approved event changes after the initial read; the component must fetch rather than reuse a snapshot.
  api.get.mockResolvedValueOnce({ events: [event] }).mockResolvedValue({ events: [{ ...event,
    venue_name: 'Updated confirmed hall', technical_specifications: 'USB-C and four microphones' }] });
  render(<OnSiteSupportSection token="staff-token" />);
  expect(await screen.findByText('HDMI and two microphones')).toBeTruthy();
  expect(screen.getByText('Video conferencing required')).toBeTruthy();
  expect(screen.getByText('Bring spare cables')).toBeTruthy();
  expect(screen.getByText('45')).toBeTruthy();
  // Act/Assert: explicit refresh reads the current confirmed values using the authenticated session.
  fireEvent.click(screen.getByRole('button', { name: 'Refresh event statuses' }));
  expect(await screen.findByText('Updated confirmed hall')).toBeTruthy();
  expect(screen.getByText('USB-C and four microphones')).toBeTruthy();
  expect(screen.queryByText('HDMI and two microphones')).toBeNull();
  expect(api.get).toHaveBeenLastCalledWith('/events/on-site-support', 'staff-token');
});

it('TS status AC4 - displays cancellation guidance and releases only an active reservation', async () => {
  // Arrange: an already-released allocation must not offer a second release.
  api.get.mockResolvedValueOnce({ events: [{ ...event, status: 'cancelled', reservations: [
    { id: 91, status: 'reserved' }, { id: 92, status: 'cancelled' }] }] })
    .mockResolvedValue({ events: [{ ...event, status: 'cancelled', reservations: [] }] });
  const onRelease = vi.fn().mockResolvedValue({});
  render(<OnSiteSupportSection token="staff-token" onRelease={onRelease} />);
  const card = await screen.findByRole('article', { name: event.name });
  expect(within(card).getByText(/Preparations are no longer required/)).toBeTruthy();
  expect(within(card).queryByRole('button', { name: 'Release equipment reservation 92' })).toBeNull();
  // Act/Assert: the existing audited release workflow gets the actual allocation and refreshes the card.
  fireEvent.click(within(card).getByRole('button', { name: 'Release equipment reservation 91' }));
  await waitFor(() => expect(onRelease).toHaveBeenCalledWith(expect.objectContaining({ id: 91, event_name: event.name })));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Release equipment reservation 91' })).toBeNull());
});

it('TS status AC4 - keeps a failed release actionable and displays the failure', async () => {
  // Arrange/Act: a server-side eligibility change must not be presented as a successful release.
  api.get.mockResolvedValue({ events: [{ ...event, status: 'cancelled', reservations: [{ id: 91, status: 'reserved' }] }] });
  render(<OnSiteSupportSection token="staff-token" onRelease={vi.fn().mockRejectedValue(new Error('Reservation changed. Refresh.'))} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Release equipment reservation 91' }));
  // Assert: retry stays possible and the real error remains visible.
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Reservation changed. Refresh.');
  expect(screen.getByRole('button', { name: 'Release equipment reservation 91' }).disabled).toBe(false);
});

it('TS status AC6 - removes previous event details when a refreshed session is denied access', async () => {
  // Arrange: revoking involvement must remove previously rendered preparation facts.
  api.get.mockResolvedValueOnce({ events: [event] }).mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));
  render(<OnSiteSupportSection token="staff-token" />);
  await screen.findByRole('article', { name: event.name });
  // Act/Assert: the shared live resource clears private data on authorization failure.
  fireEvent.click(screen.getByRole('button', { name: 'Refresh event statuses' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Forbidden');
  expect(screen.queryByRole('article', { name: event.name })).toBeNull();
});

it('TS status AC3/AC5 - opening a status notification refreshes the dashboard preparation facts', async () => {
  // Arrange: real dashboard and router; only authenticated API responses are external boundaries.
  useAuth.mockReturnValue({ token: 'staff-token', user: { id: 41, role: 'technical_support' } });
  let status = 'submitted';
  api.get.mockImplementation(async endpoint => {
    if (endpoint === '/events/on-site-support') return { events: [{ ...event, status }] };
    if (endpoint === '/events/equipment-inventory') return { inventory: [] };
    if (endpoint === '/events/equipment-reservations') return { requests: [], reservations: [] };
    if (endpoint === '/events/equipment-reservation-issues') return { affectedReservations: [] };
    if (endpoint === '/notifications') return { notifications: [{ id: 81, event_id: event.id,
      type: 'event_details_changed', title: 'Technical support: Confirmed - Support workshop',
      message: 'Support workshop is now confirmed. Review the latest preparation information.',
      created_at: '2026-10-26T09:00:00Z', read_at: '2026-10-26T09:01:00Z' }], unreadCount: 0 };
    return { requests: [] };
  });
  render(<MemoryRouter initialEntries={['/tech-support/dashboard']}><TechSupportDashboard /></MemoryRouter>);
  expect(await screen.findByText('Planning')).toBeTruthy();
  // Act/Assert: navigating a notification onto the same route reads the new confirmed status.
  status = 'approved';
  fireEvent.click(screen.getByRole('button', { name: 'Technical support: Confirmed - Support workshop' }));
  expect(await screen.findByText('Confirmed')).toBeTruthy();
  expect(screen.getByText('HDMI and two microphones')).toBeTruthy();
});

it('TS status AC4 - prevents duplicate release clicks and supplies an actionable fallback failure', async () => {
  // Arrange: a stalled release must disable actions until its actual result arrives.
  api.get.mockResolvedValue({ events: [{ ...event, status: 'cancelled', reservations: [{ id: 91, status: 'reserved' }] }] });
  let rejectRelease;
  const onRelease = vi.fn(() => new Promise((_, reject) => { rejectRelease = reject; }));
  render(<OnSiteSupportSection token="staff-token" onRelease={onRelease} />);
  const button = await screen.findByRole('button', { name: 'Release equipment reservation 91' });
  fireEvent.click(button);
  expect(button.disabled).toBe(true);
  expect(button.textContent).toBe('Releasing equipment…');
  fireEvent.click(button);
  expect(onRelease).toHaveBeenCalledTimes(1);
  // Act/Assert: an empty server message still explains the failure and restores the eligible action.
  rejectRelease(new Error(''));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Unable to release this equipment reservation.');
  expect(onRelease).toHaveBeenCalledTimes(1);
  expect(button.disabled).toBe(false);
});

it('TS status AC4 - explains cancellation without inventing a release action when no reservations exist', async () => {
  // Arrange: older/current API records may omit an empty allocation list; cancellation must still render safely.
  api.get.mockResolvedValue({ events: [{ ...event, status: 'cancelled' }] });
  const onRelease = vi.fn();
  render(<OnSiteSupportSection token="staff-token" onRelease={onRelease} />);
  // Act/Assert: the clear lifecycle guidance is present, but there is no fictitious allocation to release.
  expect(await screen.findByText('Cancelled')).toBeTruthy();
  expect(screen.getByText(/Preparations are no longer required/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Release equipment reservation/ })).toBeNull();
  expect(onRelease).not.toHaveBeenCalled();
});
