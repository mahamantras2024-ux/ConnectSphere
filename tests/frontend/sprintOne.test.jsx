// File: Tests revised Sprint 1 registration summaries, role switching, access boundaries, and dialog behaviour.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../../frontend/src/App';
import { AuthProvider, useAuth } from '../../frontend/src/context/AuthContext';
import { api } from '../../frontend/src/api/client';
vi.mock('../../frontend/src/api/client', () => (
      // Handles this operation using the surrounding screen or request state.
      { api: { get: vi.fn(), post: vi.fn() } }));
let user;
// Opens the full application with a provisioned test session.
function open(path) { localStorage.setItem('cs_token', 'test-session'); return render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>); }
beforeEach(() => {
  // Resets the test session and supplies authenticated empty-workspace responses.
  localStorage.clear(); api.get.mockReset(); api.post.mockReset();
  user = { id: 8, full_name: 'Test Person', role: 'attendee', roles: ['attendee', 'venue_staff'] };
  api.get.mockImplementation(async path =>
      // Handles this operation using the surrounding screen or request state.
      path === '/auth/me' ? { user } : path === '/registrations/mine' ? { registrations: [] } : path === '/venues' ? [] : { events: [] });
});
afterEach(cleanup);
it('attendee dashboard displays their real registration names and statuses', async () => {
  // Verifies the login dashboard criterion through the complete application route.
  api.get.mockImplementation(async path =>
      // Handles this operation using the surrounding screen or request state.
      path === '/auth/me' ? { user } : { registrations: [{ id: 1, event_id: 17, event_name: 'Community Day', status: 'registered', proposed_date: '2026-10-15', proposed_start_time: '09:00:00' }] });
  open('/attendee/dashboard');
  expect(await screen.findByRole('heading', { name: 'Community Day' })).toBeTruthy();
  expect(screen.getByText('registered')).toBeTruthy();
  expect(api.get).toHaveBeenCalledWith('/registrations/mine', 'test-session');
});
it('registration API failure is shown without claiming that the attendee has no registrations', async () => {
  // Distinguishes an unavailable data source from a genuinely empty result.
  api.get.mockImplementation(async path => {
      // Handles this operation using the surrounding screen or request state.
       if (path === '/auth/me') return { user }; throw new Error('Unable to load registrations.'); });
  open('/registrations');
  expect((await screen.findByRole('alert')).textContent).toBe('Unable to load registrations.');
  expect(screen.queryByText('No registrations yet')).toBeNull();
});
it('role switching replaces the token and opens only the server-approved workspace', async () => {
  // Checks the user-facing role selector, API request, token persistence, and redirect.
  open('/attendee/dashboard');
  await screen.findByRole('heading', { name: 'Attendee Dashboard' });
  api.post.mockImplementation(async () => {
      // Handles this operation using the surrounding screen or request state.
       user = { ...user, role: 'venue_staff' }; return { user, token: 'venue-session' }; });
  fireEvent.change(screen.getByLabelText('Active role'), { target: { value: 'venue_staff' } });
  expect(await screen.findByRole('heading', { name: 'Venue Staff Dashboard' })).toBeTruthy();
  expect(api.post).toHaveBeenCalledWith('/auth/switch-role', { role: 'venue_staff' }, 'test-session');
  expect(localStorage.getItem('cs_token')).toBe('venue-session');
});
it('failed role switching retains the existing workspace and token', async () => {
  // Ensures a denied role grant cannot change client-side authority.
  open('/attendee/dashboard'); await screen.findByRole('heading', { name: 'Attendee Dashboard' });
  api.post.mockRejectedValue(new Error('This role is not assigned to your account.'));
  fireEvent.change(screen.getByLabelText('Active role'), { target: { value: 'venue_staff' } });
  expect((await screen.findByRole('alert')).textContent).toMatch(/not assigned/);
  expect(localStorage.getItem('cs_token')).toBe('test-session');
  expect(screen.getByRole('heading', { name: 'Attendee Dashboard' })).toBeTruthy();
});
it('an inactive provisioned role cannot bypass dashboard guards without switching', async () => {
  // A multi-role attendee must explicitly activate Venue Staff before using its workspace.
  open('/venue/dashboard');
  expect(await screen.findByRole('heading', { name: 'Attendee Dashboard' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Add venue' })).toBeNull();
});
it('a role-switch response arriving after logout cannot restore the session', async () => {
  // Exercises the asynchronous logout race through the real context implementation.
  let resolve;
  api.post.mockImplementation(() =>
      // Handles this operation using the surrounding screen or request state.
      new Promise(done => {
      // Handles this operation using the surrounding screen or request state.
       resolve = done; }));
  // Exposes context actions for controlled asynchronous session testing.
  function Probe() { const auth = useAuth(); return <><span>{auth.user?.role || 'Signed out'}</span><button onClick={() =>
      // Handles this control action and updates the screen state.
      auth.switchRole('venue_staff').catch(() => {
      // Reports a failed asynchronous operation.
      })}>Switch</button><button onClick={auth.logout}>Logout</button></>; }
  localStorage.setItem('cs_token', 'test-session'); render(<AuthProvider><Probe /></AuthProvider>);
  await screen.findByText('attendee'); fireEvent.click(screen.getByText('Switch')); fireEvent.click(screen.getByText('Logout'));
  await act(async () =>
      // Handles this operation using the surrounding screen or request state.
      resolve({ user: { ...user, role: 'venue_staff' }, token: 'late-token' }));
  expect(screen.getByText('Signed out')).toBeTruthy(); expect(localStorage.getItem('cs_token')).toBeNull();
});
it('venue dialogs close on Escape and restore focus to their opening control', async () => {
  // Checks keyboard accessibility for the create-record workflow.
  user = { ...user, role: 'venue_staff' }; open('/venue/dashboard');
  const button = await screen.findByRole('button', { name: 'Add venue' }); button.focus(); fireEvent.click(button);
  expect(screen.getByRole('dialog', { name: 'Add New Venue' })).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() =>
      // Handles this operation using the surrounding screen or request state.
      expect(screen.queryByRole('dialog')).toBeNull()); expect(document.activeElement).toBe(button);
});
it('venue creation rejects invalid capacity and time buffers without API writes', async () => {
  // Validates boundaries beyond the required-field happy path.
  user = { ...user, role: 'venue_staff' }; open('/venue/dashboard');
  fireEvent.click(await screen.findByRole('button', { name: 'Add venue' }));
  fireEvent.change(screen.getByLabelText('Capacity *'), { target: { value: '-1' } });
  fireEvent.change(screen.getByLabelText('Setup time (minutes) *'), { target: { value: '-30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save & Publish Venue' }));
  expect(screen.getByText('Enter a positive whole-number capacity.')).toBeTruthy();
  expect(screen.getByText('Enter whole minutes between 0 and 10080.')).toBeTruthy();
  expect(api.post).not.toHaveBeenCalled();
});
