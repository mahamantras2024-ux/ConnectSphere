// File: Tests role dashboards, protected navigation, session lifecycle, provisioning guidance, and venue access.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../../frontend/src/App';
import { AuthProvider, useAuth } from '../../frontend/src/context/AuthContext';
import { api } from '../../frontend/src/api/client';
// Makes the create-form tests independent of live geocoding while retaining selected coordinates.
vi.mock('../../frontend/src/pages/venues/LocationPicker', () => ({default:({value,onChange})=><input placeholder="Location / Address *" value={value.location} onChange={event=>onChange({location:event.target.value,latitude:1.296,longitude:103.85,mrt:{name:'Bras Basah MRT',distanceM:100}})}/> }));
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

  it.each(dashboards)('logs in %s and redirects to the correct dashboard', async (role, title) => {
    // Verifies: logs in %s and redirects to the correct dashboard.

    currentUser.role = role; open(); submitLogin();
    expect(await screen.findByRole('heading', { name: title })).toBeTruthy();
    expect(api.post).toHaveBeenCalledWith('/auth/login', { email: 'venue@example.com', password: 'password123', audience: 'internal' });
    expect(localStorage.getItem('cs_token')).toBe('provisioned-token');
  });
  it('shows a clear invalid-credentials error without entering a dashboard', async () => {
    // Verifies: shows a clear invalid-credentials error without entering a dashboard.

    api.post.mockRejectedValue(new Error('Invalid email or password.'));
    open(); submitLogin();
    expect((await screen.findByRole('alert')).textContent).toBe('Invalid email or password.');
    expect(screen.queryByRole('heading', { name: 'Venue Staff Dashboard' })).toBeNull();
    expect(localStorage.getItem('cs_token')).toBeNull();
    expect(screen.getByRole('button', { name: 'Login' }).disabled).toBe(false);
  });
  it('prevents duplicate submissions while login is pending', async () => {
    // Verifies: prevents duplicate submissions while login is pending.

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

  it.each(['/coordinator/dashboard', '/tech-support/dashboard', '/organizer/dashboard', '/attendee/dashboard', '/events', '/events/1', '/events/999', '/dashboard', '/'])('keeps Venue Staff in their own dashboard when opening %s', async (path) => {
    // Verifies: keeps Venue Staff in their own dashboard when opening %s.

    open(path, true);
    expect(await screen.findByRole('heading', { name: 'Venue Staff Dashboard' })).toBeTruthy();
    expect(api.get.mock.calls.some(([endpoint]) => // Checks recorded API calls for an endpoint that should have been blocked.

      // Handles this operation using the surrounding screen or request state.
      endpoint.startsWith('/events'))).toBe(false);
    expect(screen.queryByRole('link', { name: 'Events' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Equipment' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('href')).toBe('/venue/dashboard');
  });
  it.each(dashboards.slice(1))('does not let %s open the Venue Staff dashboard', async (role, title) => {
    // Verifies: does not let %s open the Venue Staff dashboard.

    currentUser.role = role; open('/venue/dashboard', true);
    expect(await screen.findByRole('heading', { name: title })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Venue Staff Dashboard' })).toBeNull();
    expect(api.get.mock.calls.some(([endpoint]) => // Checks recorded API calls for an endpoint that should have been blocked.

      // Handles this operation using the surrounding screen or request state.
      endpoint === '/venues')).toBe(false);
  });
  it('redirects an unauthenticated direct dashboard visit to login', async () => {
    // Verifies: redirects an unauthenticated direct dashboard visit to login.

    open('/venue/dashboard');
    expect(await screen.findByRole('heading', { name: 'ConnectSphere Login' })).toBeTruthy();
    expect(api.get).not.toHaveBeenCalled();
  });
  it('restores a valid provisioned session after refresh', async () => {
    // Verifies: restores a valid provisioned session after refresh.

    open('/venue/dashboard', true);
    expect(await screen.findByRole('heading', { name: 'Venue Staff Dashboard' })).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('/auth/me', 'provisioned-token');
  });
  it('clears an expired or deleted-account session', async () => {
    // Verifies: clears an expired or deleted-account session.

    api.get.mockRejectedValue(new Error('Unauthorized: Invalid token.'));
    open('/venue/dashboard', true);
    expect(await screen.findByRole('heading', { name: 'ConnectSphere Login' })).toBeTruthy();
    expect(localStorage.getItem('cs_token')).toBeNull();
  });
  it('clears the user when session validation fails immediately after login', async () => {
    // Verifies: clears the user when session validation fails immediately after login.

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
  it('logout removes the token and returns to login', async () => {
    // Verifies: logout removes the token and returns to login.

    open('/venue/dashboard', true);
    await screen.findByRole('heading', { name: 'Venue Staff Dashboard' });
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('heading', { name: 'ConnectSphere Login' })).toBeTruthy();
    expect(localStorage.getItem('cs_token')).toBeNull();
  });
  it('does not restore an old user when a pending session request finishes after logout', async () => {
    // Verifies: does not restore an old user when a pending session request finishes after logout.

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
  it('never treats inherited object keys as dashboard routes', () => {
    // Verifies: never treats inherited object keys as dashboard routes.

    expect(getDashboardRoute('__proto__')).toBe('/dashboard');
    expect(getDashboardRoute('constructor')).toBe('/dashboard');
    expect(getDashboardRoute(undefined)).toBe('/dashboard');
  });
});
describe('provisioning and permitted venue functionality', () => {
  // Groups regression cases for: provisioning and permitted venue functionality.

  it('offers no self-registration form or role selector', async () => {
    // Verifies: offers no self-registration form or role selector.

    open('/register');
    expect(await screen.findByRole('heading', { name: 'Account access' })).toBeTruthy();
    expect(screen.getByText(/Staff accounts are provisioned internally/)).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: /create account/i })).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });
  it('displays the existing catalogue and opens the existing venue detail modal', async () => {
    // Verifies: displays the existing catalogue and opens the existing venue detail modal.

    api.get.mockImplementation(async (path) => // Supplies controlled api.get behavior for this regression case, including its expected result or failure.

      // Handles this operation using the surrounding screen or request state.
      path === '/auth/me' ? { user: currentUser } : [{ id: 1, name: 'Marina Hall', location: 'Marina', facilities: ['Wi-Fi'] }]);
    open('/venue/dashboard', true);
    await screen.findByRole('heading', { name: 'Marina Hall' });
    fireEvent.click(screen.getByRole('button', { name: 'View details' }));
    expect(screen.getByText('Venue Details')).toBeTruthy();
    expect(screen.getAllByRole('heading', { name: 'Marina Hall' }).length).toBe(2);
  });
  it('sends the current token when creating a venue', async () => {
    // Verifies: sends the current token when creating a venue.

    api.post.mockResolvedValue({ venue: { id: 2, name: 'New Hall' } });
    open('/venue/dashboard', true);
    fireEvent.click(await screen.findByRole('button', { name: 'Add venue' }));
    fireEvent.change(screen.getByPlaceholderText('Venue Name *'), { target: { value: 'New Hall' } });
    fireEvent.change(screen.getByPlaceholderText('Hourly rate (e.g. 500)'), { target: { value: '500' } });
    for (const [label, value] of [['Capacity (e.g. 100) *', '80'], ['Location / Address *', 'Marina'], ['Facilities & Amenities (comma-separated) *', 'Wi-Fi'], ['Supported Room Layouts (e.g. Banquet, Classroom, Theatre) *', 'Theatre'], ['Accessibility Features (e.g. Wheelchair Access, Ramps, Elevator) *', 'Ramp']]) {
      fireEvent.change(screen.getByPlaceholderText(label), { target: { value } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save & Publish Venue' }));
    await waitFor(() => // Repeats the assertion until the expected asynchronous UI or mocked API state appears.

      // Handles this operation using the surrounding screen or request state.
      expect(api.post).toHaveBeenCalledWith('/venues', expect.objectContaining({ name: 'New Hall' }), 'provisioned-token'));
    await waitFor(() => // Repeats the assertion until the expected asynchronous UI or mocked API state appears.

      // Handles this operation using the surrounding screen or request state.
      expect(screen.queryByRole('heading', { name: 'Add New Venue' })).toBeNull());
  });
});
