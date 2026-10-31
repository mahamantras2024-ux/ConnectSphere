// File: Tests the Technical Support ReminderPreference control (AC4). The control mirrors the Venue Staff reminder UI,
// so these tests follow venueEventStatus.test.jsx: a real AuthProvider with only the api client mocked, save-on-change
// behavior, a status confirmation, and an error that rolls the cadence back on a failed save.
// Test scope: ReminderPreference rendered under AuthProvider; the api client is the only replaced boundary.
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../frontend/src/context/AuthContext';
import ReminderPreference from '../../frontend/src/pages/tech-support/ReminderPreference';
import { api } from '../../frontend/src/api/client';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), put: vi.fn() } }));

const ENDPOINT = '/tech-support/reminder-preference';
// The authenticated member every test signs in as; the control reads the token from AuthContext.
const authMe = { user: { id: 60, role: 'technical_support' } };

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.setItem('cs_token', 'staff-token');
});
afterEach(() => { cleanup(); localStorage.clear(); });

// Renders the control inside a real AuthProvider so it resolves the session token the way the app does.
function renderWithSession() { return render(<AuthProvider><ReminderPreference /></AuthProvider>); }
// Stubs GET /auth/me (for AuthProvider) and the reminder-preference GET with the supplied stored preference.
function stubLoad(preference) {
  api.get.mockImplementation(async path => path === '/auth/me' ? authMe : { preference });
}
const toggle = () => screen.getByRole('checkbox', { name: /periodic reminders for pending technical support and equipment requests/i });
const frequency = () => screen.getByRole('combobox', { name: 'frequency' });

// AC4.1: the control reflects the member's stored enabled flag and cadence once loaded.
it('TS AC4.1 - reflects the stored enabled flag and cadence', async () => {
  // Arrange: a stored, enabled, weekly (7-day) preference.
  stubLoad({ dailyPendingReminders: true, reminderFrequencyDays: 7 });
  // Act
  renderWithSession();
  // Assert: a control that ignored the stored values would not show enabled + weekly.
  await waitFor(() => expect(toggle()).toBeChecked());
  expect(frequency()).toHaveValue('7');
});

// AC4.1 boundary: an incomplete/empty preference payload shows the safe default (disabled, daily).
it('TS AC4.1 - shows the disabled daily default when no preference is stored', async () => {
  // Arrange: an empty payload, as a never-configured member would receive.
  api.get.mockImplementation(async path => path === '/auth/me' ? authMe : {});
  renderWithSession();
  await waitFor(() => expect(toggle()).not.toBeChecked());
  expect(frequency()).toHaveValue('1');
});

// AC4.1 error: a failed load surfaces an alert rather than presenting a guessed preference as current.
it('TS AC4.1 - a failed preference load shows an alert', async () => {
  api.get.mockImplementation(async path => path === '/auth/me' ? authMe : Promise.reject(new Error('Preference unavailable.')));
  renderWithSession();
  expect(await screen.findByRole('alert')).toHaveTextContent('Preference unavailable.');
});

// AC4.2 / AC4.6: enabling persists the opt-in and cadence immediately (save-on-change), with a confirmation.
it('TS AC4.2 - enabling persists the opt-in with its cadence and confirms', async () => {
  // Arrange: begins disabled; the save endpoint confirms the enabled value.
  stubLoad({ dailyPendingReminders: false, reminderFrequencyDays: 1 });
  api.put.mockResolvedValue({ preference: { dailyPendingReminders: true, reminderFrequencyDays: 1 } });
  renderWithSession();
  await waitFor(() => expect(toggle()).not.toBeChecked());
  // Act: opt in.
  fireEvent.click(toggle());
  // Assert: the exact payload is persisted (a UI-only toggle or an inverted boolean would fail) and confirmed.
  await waitFor(() => expect(api.put).toHaveBeenCalledWith(ENDPOINT, { dailyPendingReminders: true, reminderFrequencyDays: 1 }, 'staff-token'));
  expect(await screen.findByRole('status')).toHaveTextContent(/daily.*enabled/i);
  expect(toggle()).toBeChecked();
});

// AC4.3: changing the cadence while enabled persists the chosen number of days.
it('TS AC4.3 - changing the cadence while enabled persists the chosen days', async () => {
  // Arrange: enabled daily; the API accepts a weekly cadence.
  stubLoad({ dailyPendingReminders: true, reminderFrequencyDays: 1 });
  api.put.mockResolvedValue({ preference: { dailyPendingReminders: true, reminderFrequencyDays: 7 } });
  renderWithSession();
  await waitFor(() => expect(toggle()).toBeChecked());
  // Act: pick Weekly.
  fireEvent.change(frequency(), { target: { value: '7' } });
  // Assert: the selected cadence is persisted, not merely shown.
  await waitFor(() => expect(api.put).toHaveBeenCalledWith(ENDPOINT, { dailyPendingReminders: true, reminderFrequencyDays: 7 }, 'staff-token'));
  expect(await screen.findByRole('status')).toHaveTextContent(/weekly.*enabled/i);
});

// AC4.5 boundary: changing the cadence while disabled does NOT persist, because there is nothing to reschedule.
it('TS AC4.3 - changing the cadence while disabled does not persist', async () => {
  stubLoad({ dailyPendingReminders: false, reminderFrequencyDays: 1 });
  renderWithSession();
  await waitFor(() => expect(toggle()).not.toBeChecked());
  // Act: change cadence while opted out.
  fireEvent.change(frequency(), { target: { value: '3' } });
  // Assert: the selection updates locally but no save is sent while disabled.
  expect(frequency()).toHaveValue('3');
  expect(api.put).not.toHaveBeenCalled();
});

// AC4.4 / AC4.5: disabling persists the explicit opt-out.
it('TS AC4.4 - disabling persists the explicit opt-out', async () => {
  stubLoad({ dailyPendingReminders: true, reminderFrequencyDays: 1 });
  api.put.mockResolvedValue({ preference: { dailyPendingReminders: false, reminderFrequencyDays: 1 } });
  renderWithSession();
  await waitFor(() => expect(toggle()).toBeChecked());
  // Act: opt out.
  fireEvent.click(toggle());
  // Assert: the opt-out is persisted (false sent) and confirmed as disabled.
  await waitFor(() => expect(api.put).toHaveBeenCalledWith(ENDPOINT, { dailyPendingReminders: false, reminderFrequencyDays: 1 }, 'staff-token'));
  expect(await screen.findByRole('status')).toHaveTextContent(/disabled/i);
  expect(toggle()).not.toBeChecked();
});

// AC4.2 error: a failed save shows an error, restores the previous cadence, and does not claim success.
it('TS AC4.2 - a failed cadence save shows an error and restores the previous cadence', async () => {
  // Arrange: enabled daily; changing to weekly fails.
  stubLoad({ dailyPendingReminders: true, reminderFrequencyDays: 1 });
  api.put.mockRejectedValue(new Error('Frequency save failed'));
  renderWithSession();
  await waitFor(() => expect(frequency()).toHaveValue('1'));
  // Act: attempt to switch to weekly.
  fireEvent.change(frequency(), { target: { value: '7' } });
  // Assert: the error surfaces, no success status appears, and the cadence rolls back to daily.
  expect(await screen.findByRole('alert')).toHaveTextContent('Frequency save failed');
  expect(screen.queryByRole('status')).toBeNull();
  await waitFor(() => expect(frequency()).toHaveValue('1'));
});

// AC4.3 boundary: the middle cadence (every 3 days) persists and is confirmed with its own label.
it('TS AC4.3 - selecting the every-3-days cadence persists and confirms that label', async () => {
  // Arrange: enabled daily; the API accepts the 3-day cadence.
  stubLoad({ dailyPendingReminders: true, reminderFrequencyDays: 1 });
  api.put.mockResolvedValue({ preference: { dailyPendingReminders: true, reminderFrequencyDays: 3 } });
  renderWithSession();
  await waitFor(() => expect(toggle()).toBeChecked());
  // Act: pick Every 3 days.
  fireEvent.change(frequency(), { target: { value: '3' } });
  // Assert: the 3-day cadence is persisted and labelled distinctly from Daily/Weekly.
  await waitFor(() => expect(api.put).toHaveBeenCalledWith(ENDPOINT, { dailyPendingReminders: true, reminderFrequencyDays: 3 }, 'staff-token'));
  expect(await screen.findByRole('status')).toHaveTextContent(/every 3 days.*enabled/i);
});

// AC4.1: a load resolving after the control unmounts must not update state (stale-response guard).
it('TS AC4.1 - a load resolving after unmount does not update state', async () => {
  // Arrange: a deferred reminder-preference read so we can unmount before it resolves.
  let resolvePref;
  api.get.mockImplementation(async path => path === '/auth/me' ? authMe
    : new Promise(resolve => { resolvePref = resolve; }));
  const { unmount } = renderWithSession();
  // Act: unmount, then let the late read resolve.
  unmount();
  await act(async () => { resolvePref({ preference: { dailyPendingReminders: true, reminderFrequencyDays: 7 } }); });
  // Assert: nothing from the unmounted tree is present (no error thrown by a stale state update).
  expect(screen.queryByRole('checkbox')).toBeNull();
});
