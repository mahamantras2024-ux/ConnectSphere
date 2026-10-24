// File: Tests the Venue Staff status panel and reminder preference through accessible UI controls.
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../frontend/src/context/AuthContext';
import VenueEventStatusPanel from '../../frontend/src/pages/venue/VenueEventStatusPanel';
import VenueReminderPreferences from '../../frontend/src/pages/venue/VenueReminderPreferences';
import { api } from '../../frontend/src/api/client';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), put: vi.fn() } }));

const events = [
  { bookingId: 1, eventId: 11, name: 'Planning workshop', status: 'planning', venueName: 'Hall A', startDatetime: '2031-10-20T02:00:00Z', endDatetime: '2031-10-20T03:00:00Z', expectedAttendance: 20, roomLayout: 'Seminar', accessibility: ['Ramp'] },
  { bookingId: 2, eventId: 12, name: 'Confirmed workshop', status: 'confirmed', venueName: 'Hall A', startDatetime: '2031-10-21T02:00:00Z', endDatetime: '2031-10-21T03:00:00Z', expectedAttendance: 30, roomLayout: 'Theatre', accessibility: [] },
  { bookingId: 3, eventId: 13, name: 'Completed workshop', status: 'completed', venueName: 'Hall A', startDatetime: '2031-10-22T02:00:00Z', endDatetime: '2031-10-22T03:00:00Z', expectedAttendance: 40, roomLayout: null, accessibility: [] },
  { bookingId: 4, eventId: 14, name: 'Cancelled workshop', status: 'cancelled', venueName: 'Hall A', startDatetime: '2031-10-23T02:00:00Z', endDatetime: '2031-10-23T03:00:00Z', expectedAttendance: 50, roomLayout: null, accessibility: [] },
];

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.setItem('cs_token', 'staff-token');
  api.get.mockImplementation(async path => path === '/auth/me' ? { user: { id: 7, role: 'venue_staff' } }
    : path === '/venues/relevant-events' ? { events }
      : { preference: { dailyPendingReminders: false } });
});
afterEach(() => { cleanup(); localStorage.clear(); });

function renderWithSession(component) { return render(<AuthProvider>{component}</AuthProvider>); }

it('AC1 AC2 AC3 AC4 - displays relevant lifecycle states, confirmed preparation details, and a cancellation instruction', async () => {
  // Arrange / Act: the authenticated Venue Staff member opens the status panel.
  renderWithSession(<VenueEventStatusPanel />);

  // Assert: each business state is visible, confirmed data remains specific, and cancellation is unmistakable.
  expect(await screen.findByText('Planning')).toBeVisible();
  expect(screen.getByText('Confirmed')).toBeVisible();
  expect(screen.getByText('Completed')).toBeVisible();
  expect(screen.getByText('Cancelled')).toBeVisible();
  expect(screen.getByText('Theatre')).toBeVisible();
  expect(screen.getByText(/will no longer proceed/i)).toBeVisible();
});

it('AC5 - renders only the server-authorized relevant events and never renders internal information', async () => {
  // Arrange: the response models a scoped API result; an unrelated/internal record is absent by design.
  renderWithSession(<VenueEventStatusPanel />);

  // Act / Assert: a faulty UI that invents or retains prior private data fails these absence checks.
  await screen.findByText('Confirmed workshop');
  expect(screen.queryByText('Unrelated secret event')).not.toBeInTheDocument();
  expect(screen.queryByText('Do not disclose')).not.toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith('/venues/relevant-events', 'staff-token');
});

it('AC1 AC2 - labels unknown lifecycle data safely and distinguishes empty and failed relevant-event reads', async () => {
  // Arrange / Act: exercise the data-contract fallback, then separate empty and unavailable responses.
  api.get.mockImplementation(async path => path === '/auth/me' ? { user: { id: 7, role: 'venue_staff' } }
    : path === '/venues/relevant-events' ? { events: [{ ...events[0], status: 'unexpected', expectedAttendance: null, roomLayout: '', accessibility: [] }] }
      : { preference: { dailyPendingReminders: false } });
  const unknown = renderWithSession(<VenueEventStatusPanel />);
  expect(await screen.findByText('Status unavailable')).toBeVisible();
  expect(screen.getAllByText('Not specified')).toHaveLength(2);
  expect(screen.getByText('None recorded')).toBeVisible();
  unknown.unmount();
  api.get.mockImplementation(async path => path === '/auth/me' ? { user: { id: 7, role: 'venue_staff' } }
    : path === '/venues/relevant-events' ? { events: [] }
      : { preference: { dailyPendingReminders: false } });
  const empty = renderWithSession(<VenueEventStatusPanel />);
  expect(await screen.findByText(/no events are currently linked/i)).toBeVisible();
  empty.unmount();
  api.get.mockImplementation(async path => path === '/auth/me' ? { user: { id: 7, role: 'venue_staff' } }
    : path === '/venues/relevant-events' ? Promise.reject(new Error('Status service unavailable'))
      : { preference: { dailyPendingReminders: false } });
  renderWithSession(<VenueEventStatusPanel />);

  // Assert: a UI that presents stale data as authoritative or hides a malformed status fails these visible oracles.
  expect(await screen.findByRole('alert')).toHaveTextContent('Status service unavailable');
});

it('AC7 - lets Venue Staff enable daily pending-request reminders with an explicit persisted preference', async () => {
  // Arrange: the preference begins disabled and the save endpoint confirms the enabled value.
  api.put.mockResolvedValue({ preference: { dailyPendingReminders: true, reminderFrequencyDays: 3 } });
  renderWithSession(<VenueReminderPreferences />);

  // Act.
  const checkbox = await screen.findByRole('checkbox', { name: /periodic reminders for pending venue requests/i });
  fireEvent.click(checkbox);

  // Assert: a plausible implementation that only changes local UI state or sends the inverse boolean fails.
  expect(await screen.findByRole('status')).toHaveTextContent(/every 3 days.*enabled/i);
  expect(api.put).toHaveBeenCalledWith('/venues/notification-preferences', { dailyPendingReminders: true, reminderFrequencyDays: 1 }, 'staff-token');
  expect(checkbox).toBeChecked();
});

it('AC7 - saves a changed reminder frequency for an enabled preference', async () => {
  // Arrange: the stored preference is enabled daily and the API accepts a weekly cadence.
  api.get.mockImplementation(async path => path === '/auth/me' ? { user: { id: 7, role: 'venue_staff' } }
    : { preference: { dailyPendingReminders: true, reminderFrequencyDays: 1 } });
  api.put.mockResolvedValue({ preference: { dailyPendingReminders: true, reminderFrequencyDays: 7 } });
  renderWithSession(<VenueReminderPreferences />);

  // Act.
  const frequency = await screen.findByRole('combobox', { name: 'frequency' });
  fireEvent.change(frequency, { target: { value: '7' } });

  // Assert: the selected cadence is persisted rather than only changing local UI state.
  expect(await screen.findByRole('status')).toHaveTextContent(/weekly.*enabled/i);
  expect(api.put).toHaveBeenCalledWith('/venues/notification-preferences', { dailyPendingReminders: true, reminderFrequencyDays: 7 }, 'staff-token');
});

it('AC7 - restores the persisted frequency when a cadence update fails', async () => {
  // Arrange: the persisted cadence is daily and changing it to weekly fails.
  api.get.mockImplementation(async path => path === '/auth/me' ? { user: { id: 7, role: 'venue_staff' } }
    : { preference: { dailyPendingReminders: true, reminderFrequencyDays: 1 } });
  api.put.mockRejectedValue(new Error('Frequency save failed'));
  renderWithSession(<VenueReminderPreferences />);
  const frequency = await screen.findByRole('combobox', { name: 'frequency' });

  // Act.
  fireEvent.change(frequency, { target: { value: '7' } });

  // Assert: failed cadence changes must not leave an unpersisted selection visible.
  expect(await screen.findByRole('alert')).toHaveTextContent('Frequency save failed');
  expect(frequency).toHaveValue('1');
});

it('AC7 - defaults an incomplete preference safely and restores the persisted opt-in after a failed update', async () => {
  // Arrange: an older response omits preference data, then the enabled save fails.
  api.get.mockImplementation(async path => path === '/auth/me' ? { user: { id: 7, role: 'venue_staff' } } : {});
  api.put.mockRejectedValue(new Error('Preference save failed'));
  renderWithSession(<VenueReminderPreferences />);
  const checkbox = await screen.findByRole('checkbox', { name: /periodic reminders for pending venue requests/i });
  expect(checkbox).not.toBeChecked();

  // Act.
  fireEvent.click(checkbox);

  // Assert: a plausible optimistic-only implementation would leave an unpersisted opt-in selected or suppress the failure.
  expect(await screen.findByRole('alert')).toHaveTextContent('Preference save failed');
  expect(checkbox).not.toBeChecked();
});

it('AC7 - confirms when an enabled daily reminder is disabled', async () => {
  // Arrange: the stored preference is enabled and the API accepts an explicit opt-out.
  api.get.mockImplementation(async path => path === '/auth/me' ? { user: { id: 7, role: 'venue_staff' } }
    : { preference: { dailyPendingReminders: true, reminderFrequencyDays: 1 } });
  api.put.mockResolvedValue({ preference: { dailyPendingReminders: false, reminderFrequencyDays: 1 } });
  renderWithSession(<VenueReminderPreferences />);
  const checkbox = await screen.findByRole('checkbox', { name: /periodic reminders for pending venue requests/i });

  // Act.
  fireEvent.click(checkbox);

  // Assert: a faulty client that reports every successful update as enabled fails this persisted-state message.
  expect(await screen.findByRole('status')).toHaveTextContent(/disabled/i);
  expect(checkbox).not.toBeChecked();
});
