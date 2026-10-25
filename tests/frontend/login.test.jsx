// File: Owns shared login form, real dashboard routing, staff provisioning and session/access regressions.
// Test scope: Uses real components/utilities with controlled API/provider responses where configured; live service delivery is outside this scope.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../../frontend/src/App';
import { AuthProvider, useAuth } from '../../frontend/src/context/AuthContext';
import { api } from '../../frontend/src/api/client';
import { getDashboardRoute } from '../../frontend/src/auth/dashboardRoutes';

vi.mock('../../frontend/src/api/client', () => (// Replaces the imported dependency with controlled test doubles while retaining needed exports.

      // Handles this operation using the surrounding screen or request state.
      { api: { get: vi.fn(), post: vi.fn() } }));
let currentUser;
// Renders the application at a selected in-memory route with optional stored test-session credentials.
function open(path = '/login', signedIn = false) {
  if (signedIn) localStorage.setItem('cs_token', 'provisioned-token');
  return render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AuthProvider><App /></AuthProvider></MemoryRouter>);
}
// Fills the staff test credentials and submits the login form.
function submitLogin() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'venue@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Login' }));
}
beforeEach(() => {
  // Initializes clean test state, fixtures, mocks, or a local HTTP server before the test cases.

  localStorage.clear();
  currentUser = { id: 1, email: 'venue@example.com', full_name: 'Vera', role: 'venue_staff' };
  api.get.mockReset(); api.post.mockReset();
  api.get.mockImplementation(async (path) => {
    // Supplies controlled api.get behavior for this regression case, including its expected result or failure.

    if (path === '/auth/me') return { user: currentUser };
    if (path === '/venues') return [];
    if (path === '/events') return { events: [] };
    if (path === '/registrations/mine') return { registrations: [] };
    if (path === '/events/assignments') return {events:[],coordinators:[]};
    throw new Error(`Unexpected request: ${path}`);
  });
  api.post.mockImplementation(async () => (// Supplies controlled api.post behavior for this regression case, including its expected result or failure.

      // Handles this operation using the surrounding screen or request state.
      { user: currentUser, token: 'provisioned-token' }));
});
afterEach(cleanup);

const dashboards = [
  ['venue_staff', 'Venue Staff Dashboard'],
  ['event_coordinator', 'Event Coordinator Dashboard'],
  ['technical_support', 'Technical Support Dashboard'],
  ['event_organiser', 'Event Organiser Dashboard'],
  ['attendee', 'Attendee Dashboard'],
  ['event_coordinator_lead', 'Coordinator Lead Dashboard'],
  ['safety_officer', 'Safety Officer Dashboard'],
];
describe('shared login regression coverage', () => {
  // Groups regression cases for: shared login regression coverage.

  // Test case: Logs in each provisioned role through real routing with simulated responses and checks its dashboard heading.
  it.each(dashboards)('Internal AC2-3 / External AC5-7 - logs in %s and opens its permitted dashboard', async (role, title) => {

    currentUser.role = role; const external=['event_organiser','attendee'].includes(role); open(external?'/external/login':'/login'); submitLogin();
    expect(await screen.findByRole('heading', { name: title })).toBeTruthy();
    expect(api.post).toHaveBeenCalledWith('/auth/login', { email: 'venue@example.com', password: 'password123', audience: external ? 'external' : 'internal' });
    expect(localStorage.getItem('cs_token')).toBe('provisioned-token');
  });
  // Test case: Rejects login and checks the invalid-credentials error without a dashboard.
  it('Internal AC5 / External AC5 - shows a clear invalid-credentials error without entering a dashboard', async () => {

    api.post.mockRejectedValue(new Error('Invalid email or password.'));
    open(); submitLogin();
    expect((await screen.findByRole('alert')).textContent).toBe('Invalid email or password.');
    expect(screen.queryByRole('heading', { name: 'Venue Staff Dashboard' })).toBeNull();
    expect(localStorage.getItem('cs_token')).toBeNull();
    expect(screen.getByRole('button', { name: 'Login' }).disabled).toBe(false);
  });
  // Test case: Leaves login unresolved and checks repeated submits do not create extra requests.
  it('Internal AC2 / External AC5 - prevents duplicate submissions while login is pending', async () => {

    let finish;
    api.post.mockImplementation(() => // Supplies controlled api.post behavior for this regression case, including its expected result or failure.

      // Handles this operation using the surrounding screen or request state.
      new Promise((resolve) => {
      // Captures the promise resolver so a test can control when the pending operation completes.
       finish = resolve; }));
    open(); submitLogin();
    const button = screen.getByRole('button', { name: 'Signing in...' });
    expect(button.disabled).toBe(true); fireEvent.click(button); expect(api.post).toHaveBeenCalledTimes(1);
    await act(async () => // Resolves the pending test action while allowing React state updates to settle.

      // Handles this operation using the surrounding screen or request state.
      finish({ user: currentUser, token: 'provisioned-token' }));
    expect(await screen.findByRole('heading', { name: 'Venue Staff Dashboard' })).toBeTruthy();
  });
});
describe('dashboard and event authorization', () => {
  // Groups regression cases for: dashboard and event authorization.

  // Test case: Opens other dashboard URLs as Venue Staff and checks the permitted venue workspace remains active.
  it.each(['/coordinator/dashboard', '/tech-support/dashboard', '/organizer/dashboard', '/attendee/dashboard', '/events', '/events/1', '/events/999', '/dashboard', '/'])('Internal AC4 - keeps Venue Staff in their own dashboard when opening %s', async (path) => {

    open(path, true);
    expect(await screen.findByRole('heading', { name: 'Venue Staff Dashboard' })).toBeTruthy();
    expect(api.get.mock.calls.some(([endpoint]) => // Checks recorded API calls for an endpoint that should have been blocked.

      // Handles this operation using the surrounding screen or request state.
      endpoint.startsWith('/events'))).toBe(false);
    expect(screen.queryByRole('link', { name: 'Events' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Equipment' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('href')).toBe('/venue/dashboard');
  });
  // Test case: Opens Venue Staff URLs as other roles and checks venue dashboard content is denied.
  it.each(dashboards.slice(1))('Internal AC4 / Venue AC1 - does not let %s open the Venue Staff dashboard', async (role, title) => {
    // Arrange: coordinator schedule viewing does not grant staff dashboard or management permissions.
    currentUser.role = role;
    // Act
    open('/venue/dashboard', true);
    // Assert: redirect to the permitted dashboard; venue discovery is a separate opt-in tab.
    expect(await screen.findByRole('heading', { name: title })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Venue Staff Dashboard' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add venue' })).toBeNull();
    expect(api.get.mock.calls.some(([endpoint]) => endpoint === '/venues')).toBe(false);
  });
  // Test case: Visits a protected dashboard without a token and checks login redirection.
  it('Internal AC4 / External AC8 - redirects an unauthenticated direct dashboard visit to login', async () => {

    open('/venue/dashboard');
    expect(await screen.findByRole('heading', { name: 'ConnectSphere Login' })).toBeTruthy();
    expect(api.get).not.toHaveBeenCalled();
  });
  // Test case: Reloads with a valid stored token and checks the provisioned dashboard is restored.
  it('Internal AC2 / External AC5 - restores a valid provisioned session after refresh', async () => {

    open('/venue/dashboard', true);
    expect(await screen.findByRole('heading', { name: 'Venue Staff Dashboard' })).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('/auth/me', 'provisioned-token');
  });
  // Test case: Rejects an expired/deleted-account session and checks user/token cleanup.
  it('Internal AC4 / External AC8 - clears an expired or deleted-account session', async () => {

    api.get.mockRejectedValue(new Error('Unauthorized: Invalid token.'));
    open('/venue/dashboard', true);
    expect(await screen.findByRole('heading', { name: 'ConnectSphere Login' })).toBeTruthy();
    expect(localStorage.getItem('cs_token')).toBeNull();
  });
  // Test case: Fails identity validation immediately after login and checks authenticated user state is cleared.
  it('Internal AC2 / External AC5 - clears the user when session validation fails immediately after login', async () => {

    api.get.mockRejectedValue(new Error('User no longer exists.'));
    open(); submitLogin();
    await waitFor(() => // Repeats the assertion until the expected asynchronous UI or mocked API state appears.

      // Handles this operation using the surrounding screen or request state.
      expect(api.get).toHaveBeenCalledWith('/auth/me', 'provisioned-token'));
    await waitFor(() => // Repeats the assertion until the expected asynchronous UI or mocked API state appears.

      // Handles this operation using the surrounding screen or request state.
      expect(localStorage.getItem('cs_token')).toBeNull());
    expect(await screen.findByRole('heading', { name: 'ConnectSphere Login' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Venue Staff Dashboard' })).toBeNull();
  });
  // Test case: Logs out and checks token removal and return to login.
  it('Internal AC4 / External AC8 - logout removes the token and returns to login', async () => {

    open('/venue/dashboard', true);
    await screen.findByRole('heading', { name: 'Venue Staff Dashboard' });
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('heading', { name: 'ConnectSphere Login' })).toBeTruthy();
    expect(localStorage.getItem('cs_token')).toBeNull();
  });
  // Test case: Logs out before identity retrieval resolves and checks late data cannot restore the old user.
  it('Internal AC4 / External AC8 - does not restore an old user when a pending session request finishes after logout', async () => {

    let finish;
    api.get.mockImplementation(() => // Supplies controlled api.get behavior for this regression case, including its expected result or failure.

      // Handles this operation using the surrounding screen or request state.
      new Promise((resolve) => {
      // Captures the promise resolver so a test can control when the pending operation completes.
       finish = resolve; }));
    localStorage.setItem('cs_token', 'old-token');
    // Displays authentication state and a logout button for the stale-session-response regression test.
    function Probe() {
      const { user, logout } = useAuth();
      return <><span>{user ? user.full_name : 'Signed out'}</span><button onClick={logout}>Logout</button></>;
    }
    render(<AuthProvider><Probe /></AuthProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
    await act(async () => // Resolves the pending test action while allowing React state updates to settle.

      // Handles this operation using the surrounding screen or request state.
      finish({ user: currentUser }));
    expect(screen.getByText('Signed out')).toBeTruthy(); expect(localStorage.getItem('cs_token')).toBeNull();
  });
  // Test case: Passes inherited object-key role names to routing and checks they never become dashboard destinations.
  it('Internal AC4 / External AC8 - never treats inherited object keys as dashboard routes', () => {

    expect(getDashboardRoute('__proto__')).toBe('/dashboard');
    expect(getDashboardRoute('constructor')).toBe('/dashboard');
    expect(getDashboardRoute(undefined)).toBe('/dashboard');
  });
});
// Staff login story: a Safety Officer (and every other staff role) reaches only its own workspace.
const staffDashboards = dashboards.filter(([role]) => !['event_organiser', 'attendee'].includes(role));
const queuedEvent = { id: 7, name: 'Annual Gala', proposed_date: '2030-02-01', proposed_start_time: '18:00', proposed_end_time: '22:00',
  expected_attendance: 120, room_layout_preference: 'Banquet', accessibility_requirements: null, equipment_items: [],
  technical_support_required: false, video_conferencing_required: false, equipment_notes: null,
  venues: [{ name: 'Hall A', capacity: 200 }], latest_safety_check: null };
describe('Safety Officer role-based access', () => {
  beforeEach(() => {
    // Adds the Safety Officer queue to the shared API double; every other unexpected request still fails loudly.
    const shared = api.get.getMockImplementation();
    api.get.mockImplementation(async (path, token) => path === '/safety/checks' ? { events: [queuedEvent] } : shared(path, token));
  });
  // Test case: Opens another role's workspace or event data as a Safety Officer and checks only the safety workspace loads.
  it.each(['/venue/dashboard', '/coordinator/dashboard', '/tech-support/dashboard', '/coordinator-lead/dashboard', '/organizer/dashboard',
    '/attendee/dashboard', '/events', '/events/1', '/registrations', '/dashboard', '/'])('Staff AC4 - keeps a Safety Officer in their own dashboard when opening %s', async (path) => {
    currentUser = { ...currentUser, role: 'safety_officer', roles: ['safety_officer'] };
    open(path, true);
    expect(await screen.findByRole('heading', { name: 'Safety Officer Dashboard' })).toBeTruthy();
    await screen.findByText('Annual Gala');
    // Only the Safety Officer's own data: the session, their notifications and the safety queue.
    expect([...new Set(api.get.mock.calls.map(([endpoint]) => endpoint))].sort()).toEqual(['/auth/me', '/notifications', '/safety/checks']);
    expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('href')).toBe('/safety/dashboard');
  });
  // Test case: Opens the Safety Officer dashboard as each other staff role and checks the safety queue is never requested.
  it.each(staffDashboards.filter(([role]) => role !== 'safety_officer'))('Staff AC4 - does not let %s open the Safety Officer dashboard', async (role, title) => {
    currentUser = { ...currentUser, role, roles: [role] };
    open('/safety/dashboard', true);
    expect(await screen.findByRole('heading', { name: title })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Operational safety checks' })).toBeNull();
    expect(api.get.mock.calls.some(([endpoint]) => endpoint === '/safety/checks')).toBe(false);
  });
  // Test case: Signs in as a Safety Officer and checks the dashboard shows the safety queue and nothing from other roles.
  it('Staff AC2/AC3 - a Safety Officer lands on a dashboard with only safety tasks', async () => {
    currentUser = { id: 4, email: 'safety@example.com', full_name: 'Sam Safety', role: 'safety_officer', roles: ['safety_officer'] };
    open(); submitLogin();
    expect(await screen.findByRole('heading', { name: 'Safety Officer Dashboard' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Operational safety checks' })).toBeTruthy();
    expect(screen.getByText('Annual Gala')).toBeTruthy();
    expect(screen.getByLabelText('Provisioned workspaces').textContent).toBe('Safety Officer');
    for (const heading of ['Venues', 'Unassigned requests', 'Assigned active events', 'Pending equipment requests']) {
      expect(screen.queryByRole('heading', { name: heading })).toBeNull();
    }
    expect(screen.queryByRole('button', { name: 'Add venue' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Events' })).toBeNull();
  });
  // Test case: Opens each staff dashboard with its one provisioned role and checks no role switcher is offered.
  it.each(staffDashboards)('Staff AC1 - a single-role %s account is offered no role switcher', async (role, title) => {
    currentUser = { ...currentUser, role, roles: [role] };
    open(getDashboardRoute(role), true);
    expect(await screen.findByRole('heading', { name: title })).toBeTruthy();
    expect(screen.queryByLabelText('Active role')).toBeNull();
  });
});
describe('internal account provisioning', () => {
  // Groups checks that internal accounts cannot self-register.

  // Test case: Opens staff login and checks there is no self-registration or role-selector control.
  it('Internal AC1 - offers no self-registration form or role selector', async () => {

    open('/register');
    expect(await screen.findByRole('heading', { name: 'Account access' })).toBeTruthy();
    expect(screen.getByText(/Staff accounts are provisioned internally/)).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: /create account/i })).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });


});

// Test case: Rejects a message-free API error and checks the fallback, no session, and enabled retry control through the real auth context.
it('Internal AC5 / External AC5 - missing login error messages use a readable fallback',async()=>{
  api.post.mockRejectedValue({});open();submitLogin();
  expect((await screen.findByRole('alert')).textContent).toBe('Invalid email or password. Please try again.');
  expect(localStorage.getItem('cs_token')).toBeNull();expect(screen.getByRole('button',{name:'Login'}).disabled).toBe(false);
});
// Test case: Opens external sign-in and checks its signup/recovery links; audience submission and redirects are covered by the role matrix above.
it('External AC1/AC5 - external sign-in offers account creation and password recovery',async()=>{
  open('/external/login');expect(await screen.findByRole('heading',{name:'Sign in'})).toBeTruthy();
  expect(screen.getByRole('link',{name:'Create an account'}).getAttribute('href')).toBe('/external/register');
  expect(screen.getByRole('link',{name:'Forgot password?'}).getAttribute('href')).toBe('/external/forgot-password');
});
// Test case: Checks missing and malformed browser credentials are invalid while a complete pair is valid, without sending an API request.
it('Internal AC2 / External AC5 - browser validation requires valid email and password',()=>{
  open();const form=screen.getByRole('button',{name:'Login'}).form;
  expect(form.checkValidity()).toBe(false);fireEvent.change(screen.getByLabelText('Email'),{target:{value:'bad-email'}});
  fireEvent.change(screen.getByLabelText('Password'),{target:{value:'password123'}});expect(form.checkValidity()).toBe(false);
  fireEvent.change(screen.getByLabelText('Email'),{target:{value:'staff@example.test'}});expect(form.checkValidity()).toBe(true);expect(api.post).not.toHaveBeenCalled();
});

// Staff login UI AC1: only the staff footer centres its recovery link beneath the submit button.
it.each([false,true])('Staff login UI AC1 - centres recovery link only when external=%s is false',async external=>{
  open(external ? '/external/login' : '/login');
  const link=await screen.findByRole('link',{name:'Forgot password?'});
  const footer=link.closest('.auth-footer');
  expect(footer.classList.contains('staff-login-footer')).toBe(!external);
  expect(screen.getByRole('button',{name:'Login'}).compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(link.getAttribute('href')).toBe(external ? '/external/forgot-password' : '/forgot-password');
});
