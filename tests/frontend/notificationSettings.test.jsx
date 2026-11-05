// Notification settings AC1–AC4: real role dashboards, navbar, dialog and preferences; only HTTP is mocked.
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import App from '../../frontend/src/App';
import { AuthProvider } from '../../frontend/src/context/AuthContext';
import { api } from '../../frontend/src/api/client';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }));
const endpoints = {
  event_coordinator: '/notifications/coordinator-preferences',
  venue_staff: '/venues/notification-preferences',
  technical_support: '/tech-support/reminder-preference',
};
const roles = ['event_organiser', 'event_coordinator', 'event_coordinator_lead', 'attendee', 'venue_staff', 'technical_support', 'safety_officer'];
let role;
let stored;
/** Preserve each existing API's payload contract while exercising real forms and authenticated routing. */
function payload(selectedRole, enabled = false, days = 1) {
  return selectedRole === 'event_coordinator' ? { enabled, frequencyDays: days }
    : { dailyPendingReminders: enabled, reminderFrequencyDays: days };
}
/** Resolve authentication and initial dashboard reads before interacting with the shared navbar. */
async function open(selectedRole = 'event_coordinator') {
  role = selectedRole;
  localStorage.setItem('cs_token', 'settings-session');
  await act(async () => {
    render(<MemoryRouter initialEntries={['/']}><AuthProvider><App /></AuthProvider></MemoryRouter>);
  });
}
/** Open the bell and activate its gear with actual focus, so close behavior can restore focus correctly. */
async function settings() {
  fireEvent.click(screen.getByRole('button', { name: /^Notifications/ }));
  const gear = await screen.findByRole('button', { name: 'Notification settings' });
  gear.focus();
  fireEvent.click(gear);
  return screen.findByRole('dialog', { name: 'Notification settings' });
}
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  role = 'event_coordinator';
  stored = Object.fromEntries(Object.keys(endpoints).map(key => [key, payload(key)]));
  api.get.mockImplementation(async path => {
    if (path === '/auth/me') return { user: { id: 8, full_name: 'Casey Staff', role,
      roles: ['event_coordinator', 'technical_support'].includes(role) ? ['event_coordinator', 'technical_support'] : [role] } };
    if (path === '/notifications') return { notifications: [], unreadCount: 0 };
    if (path === '/venues') return [];
    const preferenceRole = Object.keys(endpoints).find(key => endpoints[key] === path);
    if (preferenceRole) return { preference: stored[preferenceRole] };
    return { events: [], requests: [], reservations: [], registrations: [], inventory: [], changeRequests: [], staff: [], coordinators: [] };
  });
  api.post.mockImplementation(async (_path, body) => {
    role = body.role;
    return { token: 'switched-session', user: { id: 8, full_name: 'Casey Staff', role, roles: ['event_coordinator', 'technical_support'] } };
  });
  api.put.mockImplementation(async (path, body) => {
    const preferenceRole = Object.keys(endpoints).find(key => endpoints[key] === path);
    stored[preferenceRole] = body;
    return { preference: body };
  });
});
afterEach(() => { cleanup(); localStorage.clear(); });

// AC1: every dashboard loses its inline settings; unsupported roles receive an honest empty state, not fake controls.
it.each(roles)('Notification settings AC1 - %s opens role-appropriate settings from the bell without an inline panel', async selectedRole => {
  await open(selectedRole);
  expect(screen.queryByRole('checkbox', { name: /periodic reminders/ })).not.toBeInTheDocument();
  expect(api.get.mock.calls.some(([path]) => Object.values(endpoints).includes(path))).toBe(false);

  const dialog = await settings();

  if (endpoints[selectedRole]) {
    expect(await within(dialog).findByRole('checkbox')).not.toBeChecked();
    expect(within(dialog).getByRole('combobox')).toBeDisabled();
    expect(api.get).toHaveBeenCalledWith(endpoints[selectedRole], 'settings-session');
  } else {
    expect(within(dialog).getByText('There are no reminder preferences for this workspace.')).toBeVisible();
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(api.get.mock.calls.some(([path]) => Object.values(endpoints).includes(path))).toBe(false);
  }
});

// AC2: all three forms persist opt-in and every supported cadence, then reload the last confirmed values on reopening.
it.each(Object.keys(endpoints))('Notification settings AC2 - %s saves enable frequency and disable preferences across reopening', async selectedRole => {
  await open(selectedRole);
  let dialog = await settings();
  let toggle = await within(dialog).findByRole('checkbox');
  expect(within(dialog).getByRole('combobox')).toBeDisabled();
  fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: '7' } });
  expect(within(dialog).getByRole('combobox')).toHaveValue('1');
  expect(api.put).not.toHaveBeenCalled();
  fireEvent.click(toggle);
  await waitFor(() => expect(api.put).toHaveBeenCalledWith(endpoints[selectedRole], payload(selectedRole, true), 'settings-session'));
  await waitFor(() => expect(toggle).toBeChecked());
  for (const days of [3, 7]) {
    await waitFor(() => expect(within(dialog).getByRole('combobox')).toBeEnabled());
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: String(days) } });
    await waitFor(() => expect(api.put).toHaveBeenLastCalledWith(endpoints[selectedRole], payload(selectedRole, true, days), 'settings-session'));
  }
  await waitFor(() => expect(toggle).toBeEnabled());
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close dialog' }));
  dialog = await settings();
  toggle = await within(dialog).findByRole('checkbox');
  expect(toggle).toBeChecked();
  expect(within(dialog).getByRole('combobox')).toHaveValue('7');
  fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: '1' } });
  await waitFor(() => expect(api.put).toHaveBeenLastCalledWith(endpoints[selectedRole], payload(selectedRole, true, 1), 'settings-session'));
  await waitFor(() => expect(toggle).toBeEnabled());
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).not.toBeChecked());
  expect(within(dialog).getByRole('combobox')).toBeDisabled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close dialog' }));
  dialog = await settings();
  expect(await within(dialog).findByRole('checkbox')).not.toBeChecked();
  expect(within(dialog).getByRole('combobox')).toHaveValue('1');
});

// AC3: a failed read is visible inside the dialog; a failed write retains the last persisted preference and prevents duplicate writes.
it.each(Object.keys(endpoints))('Notification settings AC3 - %s exposes loading and failures without losing saved choices', async selectedRole => {
  const get = api.get.getMockImplementation();
  let rejectLoad;
  api.get.mockImplementation(path => path === endpoints[selectedRole] ? new Promise((_, reject) => { rejectLoad = reject; }) : get(path));
  await open(selectedRole);
  let dialog = await settings();
  expect(within(dialog).getByRole('status')).toHaveTextContent('Loading reminder preference');
  await act(async () => { rejectLoad(new Error('Preference unavailable')); });
  expect(within(dialog).getByRole('alert')).toHaveTextContent('Preference unavailable');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close dialog' }));
  api.get.mockImplementation(get);
  dialog = await settings();
  const toggle = await within(dialog).findByRole('checkbox');
  let rejectSave;
  api.put.mockImplementation(() => new Promise((_, reject) => { rejectSave = reject; }));
  fireEvent.click(toggle);
  expect(toggle).toBeDisabled();
  fireEvent.click(toggle);
  expect(api.put).toHaveBeenCalledTimes(1);
  await act(async () => { rejectSave(new Error('Save unavailable')); });
  expect(within(dialog).getByRole('alert')).toHaveTextContent('Save unavailable');
  expect(toggle).not.toBeChecked();
});

// AC4: the existing modal provides keyboard dismissal and returns focus to the bell, since the gear's dropdown closes.
it('Notification settings AC4 - Escape closes settings restores bell focus and keeps notification controls usable', async () => {
  await open();
  const bell = screen.getByRole('button', { name: 'Notifications' });
  await settings();
  expect(screen.queryByRole('region', { name: 'Recent notifications' })).not.toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(bell).toHaveFocus();
  fireEvent.click(bell);
  expect(screen.getByRole('region', { name: 'Recent notifications' })).toBeVisible();
});

// AC4: a delayed old-role read must never populate settings after the account changes its active workspace.
it('Notification settings AC4 - role switching reloads the new workspace without applying an old response', async () => {
  const get = api.get.getMockImplementation();
  let finishOld;
  api.get.mockImplementation(path => path === endpoints.event_coordinator
    ? new Promise(resolve => { finishOld = resolve; }) : get(path));
  await open();
  await settings();
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  // Simulate a provisioned role switch through the actual AuthProvider and navbar control.
  stored.technical_support = payload('technical_support', true, 7);
  fireEvent.change(screen.getByRole('combobox', { name: 'Active role' }), { target: { value: 'technical_support' } });
  await screen.findByRole('heading', { name: 'Technical Support Dashboard' });
  const dialog = await settings();
  await act(async () => { finishOld({ preference: payload('event_coordinator', true, 3) }); });
  expect(await within(dialog).findByRole('checkbox')).toBeChecked();
  expect(within(dialog).getByRole('combobox')).toHaveValue('7');
  expect(api.put).not.toHaveBeenCalled();
});
