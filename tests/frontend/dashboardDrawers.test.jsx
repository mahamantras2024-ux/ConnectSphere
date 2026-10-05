// File: Tests record drawers against the requested dashboard navigation and Sprint 1 privacy criteria.
// Test scope: Uses real components/utilities with controlled API/provider responses where configured; live service delivery is outside this scope.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../../frontend/src/App';
import { AuthProvider } from '../../frontend/src/context/AuthContext';
import { api } from '../../frontend/src/api/client';
vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
let user, registrations;
const event = { id: 19, name: 'Neighbourhood gathering', purpose: 'Connect our community', status: 'submitted' };
beforeEach(() => {
  // Arrange a real session and routing; replace only the API boundary.
  localStorage.clear(); localStorage.setItem('cs_token', 'drawer-session'); vi.clearAllMocks();
  user = { id: 7, role: 'event_organiser', full_name: 'Avery' };
  registrations = [{ id: 1, event_id: 19, event_name: 'Community afternoon', status: 'confirmed', proposed_date: '2026-10-20', proposed_start_time: '14:00:00' }];
  api.get.mockImplementation(async path => path === '/auth/me' ? { user } : path === '/events' ? { events: [event] } : path === '/registrations/mine' ? { registrations } : { event });
});
afterEach(cleanup);
// Opens the complete application so history, protection and accessible dialogs stay real.
function open(path) { render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>); }

// Test case: Opens organiser/coordinator event drawers and checks closing returns to the originating dashboard list.
it.each([
  ['event_organiser', '/organizer/dashboard', 'Event Organiser Dashboard'],
  ['event_coordinator', '/coordinator/dashboard', 'Event Coordinator Dashboard'],
])('UI1 / Organiser AC1 / Coordinator AC1 - %s details close back to the originating dashboard', async (role, path, heading) => {
  user.role = role; open(path);
  await screen.findByRole('heading', { name: heading });
  const trigger = await screen.findByRole('link', { name: 'View details' }); trigger.focus();
  fireEvent.click(trigger);
  const drawer = await screen.findByRole('dialog', { name: 'Event details' });
  expect(await within(drawer).findByRole('heading', { name: event.name })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: heading })).toBeNull();
  expect(document.body.style.overflow).toBe('hidden');
  fireEvent.click(within(drawer).getByRole('button', { name: 'Close dialog' }));
  expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(document.body.style.overflow).not.toBe('hidden');
});
// Test case: Opens organiser details and checks Escape and Back dismiss the drawer without leaving its list.
it('UI1 / Organiser AC1 - Escape and Back dismiss event details without leaving the event list', async () => {
  open('/organizer/events');
  fireEvent.click(await screen.findByRole('link', { name: 'View details' }));
  await screen.findByRole('dialog'); fireEvent.keyDown(document, { key: 'Escape' });
  expect(await screen.findByRole('heading', { name: 'My Events' })).toBeTruthy();
  fireEvent.click(screen.getByRole('link', { name: 'View details' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Back to list' }));
  expect(await screen.findByRole('heading', { name: 'My Events' })).toBeTruthy();
});
// Test case: Fails detail retrieval and checks no private data appears and Close still works.
it('UI1 / Organiser AC4 - failed details retain a working close control and reveal no record', async () => {
  api.get.mockImplementation(async path => {
    if (path === '/auth/me') return { user };
    if (path === '/events') return { events: [event] };
    throw new Error('Event not found.');
  });
  open('/organizer/dashboard'); fireEvent.click(await screen.findByRole('link', { name: 'View details' }));
  const drawer = await screen.findByRole('dialog');
  expect((await within(drawer).findByRole('alert')).textContent).toBe('Event not found.');
  expect(within(drawer).queryByText(event.purpose)).toBeNull();
  fireEvent.click(within(drawer).getByRole('button', { name: 'Close dialog' }));
  expect(await screen.findByRole('heading', { name: 'Event Organiser Dashboard' })).toBeTruthy();
});
// Test case: Opens attendee details from a personal registration and checks no additional event request is made.
it('UI1 / External AC7-8 - attendee details use only personal registrations and close without another event request', async () => {
  user.role = 'attendee'; open('/attendee/dashboard');
  const trigger = await screen.findByRole('button', { name: 'View registration' }); trigger.focus(); fireEvent.click(trigger);
  const drawer = screen.getByRole('dialog', { name: 'Registration details' });
  for (const text of ['Community afternoon', 'confirmed', '2026-10-20', '14:00']) expect(within(drawer).getByText(text)).toBeTruthy();
  expect(api.get.mock.calls.map(call => call[0])).toEqual(['/auth/me', '/registrations/mine']);
  fireEvent.click(within(drawer).getByRole('button', { name: 'Back to list' }));
  expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger); fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
// Test case: Opens sparse registration data and checks unavailable labels instead of invented details.
it('UI1 / External AC7 - missing registration data is labelled unavailable rather than fabricated', async () => {
  user.role = 'attendee'; registrations = [{ id: 2, event_id: 20 }]; open('/registrations');
  fireEvent.click(await screen.findByRole('button', { name: 'View registration' }));
  const drawer = screen.getByRole('dialog');
  expect(within(drawer).getByRole('heading', { name: 'Event #20' })).toBeTruthy();
  expect(within(drawer).getByText('Date not specified')).toBeTruthy();
  expect(within(drawer).getAllByText('Not specified')).toHaveLength(2);
  fireEvent.keyDown(document, { key: 'Escape' }); expect(screen.queryByRole('dialog')).toBeNull();
});
