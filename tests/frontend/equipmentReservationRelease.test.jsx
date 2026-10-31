// @vitest-environment jsdom
// Story: Technical Support staff release equipment allocations when an event changes.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
// The dashboard reads the router location (it re-reads its queues when a notification is opened onto it).
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TechSupportDashboard from '../../frontend/src/pages/tech-support/TechSupportDashboard';
import { api } from '../../frontend/src/api/client';

vi.mock('../../frontend/src/context/AuthContext', () => ({
  useAuth: () => ({ token: 'support-token', user: { id: 41, role: 'technical_support' } }),
}));
vi.mock('../../frontend/src/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../frontend/src/components/NotificationsPanel', () => ({
  default: () => null,
}));

const cancelledEventReservation = {
  id: 901,
  event_name: 'Cancelled Community Workshop',
  event_status: 'cancelled',
  event_schedule_changed: false,
  status: 'reserved',
  event_date: '2026-10-20',
  start_time: '09:00:00',
  end_time: '12:00:00',
  venue_name: 'Innovation Hall',
  reserved_at: '2026-10-10T12:00:00.000Z',
  reserved_by_name: 'Taylor Support',
  items: [{ assetCode: 'PROJ-001', name: 'Projector', specification: 'Full HD', quantity: 1 }],
};

const rescheduledEventReservation = {
  ...cancelledEventReservation,
  id: 902,
  event_name: 'Postponed Community Workshop',
  event_status: 'planning',
  event_schedule_changed: true,
};

const replacementEventRequest = {
  id: 502,
  name: 'Replacement Community Workshop',
  proposed_date: '2026-10-20',
  proposed_start_time: '09:00:00',
  proposed_end_time: '12:00:00',
  equipment_items: [{ item: 'Projector', quantity: 1 }],
  review_outcome: 'fully_fulfillable',
};

const availableEquipment = {
  event: { id: 502, name: replacementEventRequest.name },
  items: [{
    item: 'Projector',
    requestedQuantity: 1,
    availableQuantity: 1,
    availableAssets: [{
      id: 31,
      asset_code: 'PROJ-001',
      name: 'Projector',
      specification: 'Full HD',
      available_quantity: 1,
    }],
  }],
};

function reservationsResponse(reservations) {
  return { requests: [replacementEventRequest], reservations };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation(async (path) => {
    if (path === '/events/equipment-requests') return { requests: [] };
    if (path === '/events/equipment-inventory') return { inventory: [] };
    // The dashboard also fetches assigned events; keep the unrelated panel in its empty state.
    if (path === '/events/on-site-support') return { events: [] };
    if (path === '/tech-support/reminder-preference') return { preference: { dailyPendingReminders: false, reminderFrequencyDays: 1 } };
    if (path === '/events/equipment-reservation-issues') return { affectedReservations: [] };
    if (path === '/events/equipment-reservations') {
      return reservationsResponse([cancelledEventReservation, rescheduledEventReservation]);
    }
    if (path === '/events/502/equipment-availability') {
      return { availability: availableEquipment };
    }
    throw new Error(`Unexpected GET ${path}`);
  });
  api.delete.mockResolvedValue({ message: 'Equipment reservation released.' });
});

afterEach(() => {
  cleanup();
});

// Arrange dashboard reservations for an event cancellation and a changed event schedule.
// Act by using each row's release action as Technical Support.
// Assert the authenticated API is called for both associated reservations.
it('AC1 - lets staff release reservations for cancelled and rescheduled events', async () => {
  render(<MemoryRouter><TechSupportDashboard /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('tab', { name: 'Reservations' }));

  const cancelledRelease = await screen.findByRole('button', {
    name: 'Release reservation for Cancelled Community Workshop',
  });
  const rescheduledRelease = await screen.findByRole('button', {
    name: 'Release reservation for Postponed Community Workshop',
  });
  expect(cancelledRelease).toBeTruthy();
  expect(rescheduledRelease).toBeTruthy();
  expect(screen.getByText('Event postponed or rescheduled')).toBeTruthy();
  expect(screen.getByText('Event cancelled')).toBeTruthy();

  fireEvent.click(cancelledRelease);
  await waitFor(() => expect(api.delete).toHaveBeenCalledWith(
    '/events/equipment-reservations/901',
    'support-token',
  ));
  fireEvent.click(await screen.findByRole('button', {
    name: 'Release reservation for Postponed Community Workshop',
  }));
  await waitFor(() => expect(api.delete).toHaveBeenNthCalledWith(
    2,
    '/events/equipment-reservations/902',
    'support-token',
  ));
});

// Ordinary upcoming events must keep their reservations; only cancellation or schedule changes make them releasable.
// Arrange a reserved event whose proposed slot still matches its allocation.
// Act by opening its reservation in the dashboard.
// Assert no release action is exposed for the unchanged event.
it('AC1 - keeps reservations for unchanged events protected from release', async () => {
  api.get.mockImplementation(async (path) => {
    if (path === '/events/equipment-requests') return { requests: [] };
    if (path === '/events/equipment-inventory') return { inventory: [] };
    if (path === '/events/on-site-support') return { events: [] };
    if (path === '/tech-support/reminder-preference') return { preference: { dailyPendingReminders: false, reminderFrequencyDays: 1 } };
    if (path === '/events/equipment-reservation-issues') return { affectedReservations: [] };
    if (path === '/events/equipment-reservations') {
      return reservationsResponse([{
        ...cancelledEventReservation,
        event_status: 'planning',
        event_schedule_changed: false,
      }]);
    }
    throw new Error(`Unexpected GET ${path}`);
  });

  render(<MemoryRouter><TechSupportDashboard /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('tab', { name: 'Reservations' }));

  expect(screen.getByText('Reserved')).toBeTruthy();
  expect(screen.queryByRole('button', {
    name: 'Release reservation for Cancelled Community Workshop',
  })).toBeNull();
});

// A server-side conflict must be visible and must leave the active reservation available for retry.
// Arrange an API failure representing a concurrent release by another staff member.
// Act by requesting the same release from this dashboard.
// Assert the failure is shown instead of silently presenting success.
it('AC1 - surfaces a release conflict without hiding the active reservation', async () => {
  api.delete.mockRejectedValueOnce(new Error('This equipment reservation is no longer active.'));
  render(<MemoryRouter><TechSupportDashboard /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('tab', { name: 'Reservations' }));
  fireEvent.click(await screen.findByRole('button', {
    name: 'Release reservation for Cancelled Community Workshop',
  }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/no longer active/i);
  expect(screen.getByRole('button', {
    name: 'Release reservation for Cancelled Community Workshop',
  })).toBeTruthy();
});

// Some fetch failures have no server message; the action must still explain why it did not finish.
// Arrange an empty error message from the release boundary.
// Act by releasing the reservation.
// Assert the component shows its user-facing fallback rather than a blank alert.
it('AC1 - displays a useful fallback when a release error has no message', async () => {
  api.delete.mockRejectedValueOnce(new Error(''));
  render(<MemoryRouter><TechSupportDashboard /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('tab', { name: 'Reservations' }));
  fireEvent.click(await screen.findByRole('button', {
    name: 'Release reservation for Cancelled Community Workshop',
  }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Unable to release this equipment reservation.',
  );
});

// Only one release request may be in flight because the component tracks one action's pending state.
// Arrange a deferred API response and render two actionable reservations.
// Act by starting the first release without resolving it.
// Assert its progress is announced and the second action cannot race the shared state.
it('AC1 - disables competing release actions while one reservation is being released', async () => {
  let finishRelease;
  api.delete.mockImplementation(() => new Promise((resolve) => {
    finishRelease = resolve;
  }));

  render(<MemoryRouter><TechSupportDashboard /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('tab', { name: 'Reservations' }));
  const cancelledRelease = await screen.findByRole('button', {
    name: 'Release reservation for Cancelled Community Workshop',
  });
  const rescheduledRelease = screen.getByRole('button', {
    name: 'Release reservation for Postponed Community Workshop',
  });
  fireEvent.click(cancelledRelease);

  expect(cancelledRelease).toHaveTextContent('Releasing…');
  expect(rescheduledRelease).toBeDisabled();
  await act(async () => finishRelease({ message: 'Equipment reservation released.' }));
});

// A plausible SQL regression that counts cancelled allocations would deny stock to the replacement event.
// Arrange an active allocation, release it, then ask the replacement event to check the same time slot.
// Act through the dashboard's release and availability controls.
// Assert the fresh availability result makes the released unit selectable again.
it('AC2 - shows released equipment as available during a subsequent availability check', async () => {
  let reservationFetchCount = 0;
  api.get.mockImplementation(async (path) => {
    if (path === '/events/equipment-requests') return { requests: [] };
    if (path === '/events/equipment-inventory') return { inventory: [] };
    if (path === '/events/on-site-support') return { events: [] };
    if (path === '/tech-support/reminder-preference') return { preference: { dailyPendingReminders: false, reminderFrequencyDays: 1 } };
    if (path === '/events/equipment-reservation-issues') return { affectedReservations: [] };
    if (path === '/events/equipment-reservations') {
      reservationFetchCount += 1;
      return reservationsResponse(reservationFetchCount === 1
        ? [cancelledEventReservation]
        : [{
          ...cancelledEventReservation,
          status: 'cancelled',
          released_by_name: 'Taylor Support',
          released_at: '2026-10-17T11:00:00.000Z',
        }]);
    }
    if (path === '/events/502/equipment-availability') return { availability: availableEquipment };
    throw new Error(`Unexpected GET ${path}`);
  });

  render(<MemoryRouter><TechSupportDashboard /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('tab', { name: 'Reservations' }));
  fireEvent.click(await screen.findByRole('button', {
    name: 'Release reservation for Cancelled Community Workshop',
  }));
  fireEvent.click(await screen.findByRole('button', { name: 'Check availability' }));

  expect(await screen.findByText(/Projector: 1 of 1 requested available/)).toBeTruthy();
  expect(api.get).toHaveBeenCalledWith('/events/502/equipment-availability', 'support-token');
});

// The release row is no longer actionable, but its returned audit fields remain visible.
// This assertion fails if the server drops either the staff identity or persisted release time.
it('AC3 - displays who released the reservation and when for audit', async () => {
  let reservationFetchCount = 0;
  const releasedAt = '2026-10-17T11:00:00.000Z';
  api.get.mockImplementation(async (path) => {
    if (path === '/events/equipment-requests') return { requests: [] };
    if (path === '/events/equipment-inventory') return { inventory: [] };
    if (path === '/events/on-site-support') return { events: [] };
    if (path === '/tech-support/reminder-preference') return { preference: { dailyPendingReminders: false, reminderFrequencyDays: 1 } };
    if (path === '/events/equipment-reservation-issues') return { affectedReservations: [] };
    if (path === '/events/equipment-reservations') {
      reservationFetchCount += 1;
      return reservationsResponse(reservationFetchCount === 1
        ? [cancelledEventReservation]
        : [{
          ...cancelledEventReservation,
          status: 'cancelled',
          released_by_name: 'Taylor Support',
          released_at: releasedAt,
        }]);
    }
    throw new Error(`Unexpected GET ${path}`);
  });

  render(<MemoryRouter><TechSupportDashboard /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('tab', { name: 'Reservations' }));
  fireEvent.click(await screen.findByRole('button', {
    name: 'Release reservation for Cancelled Community Workshop',
  }));

  expect(await screen.findByText(/Released by Taylor Support/)).toHaveTextContent(
    new Date(releasedAt).toLocaleString(),
  );
  expect(screen.queryByRole('button', {
    name: 'Release reservation for Cancelled Community Workshop',
  })).toBeNull();
});

// Older cancelled rows predate the release-audit migration and must not be presented as audited releases.
// Arrange a legacy cancelled reservation with no releasing staff or timestamp.
// Act by opening its reservation row.
// Assert the row remains labelled as cancelled and does not invent an audit entry.
it('AC3 - distinguishes a legacy cancelled reservation with no release audit', async () => {
  api.get.mockImplementation(async (path) => {
    if (path === '/events/equipment-requests') return { requests: [] };
    if (path === '/events/equipment-inventory') return { inventory: [] };
    if (path === '/events/on-site-support') return { events: [] };
    if (path === '/tech-support/reminder-preference') return { preference: { dailyPendingReminders: false, reminderFrequencyDays: 1 } };
    if (path === '/events/equipment-reservation-issues') return { affectedReservations: [] };
    if (path === '/events/equipment-reservations') {
      return reservationsResponse([{
        ...cancelledEventReservation,
        status: 'cancelled',
        released_by_name: null,
        released_at: null,
      }]);
    }
    throw new Error(`Unexpected GET ${path}`);
  });

  render(<MemoryRouter><TechSupportDashboard /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('tab', { name: 'Reservations' }));

  expect(screen.getByText('Cancelled')).toBeTruthy();
  expect(screen.queryByText(/Released by/)).toBeNull();
});
