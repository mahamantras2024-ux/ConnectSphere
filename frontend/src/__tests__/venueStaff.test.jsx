import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { getDashboardRoute } from '../auth/dashboardRoutes';

vi.mock('../api/client', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
let currentUser;
function open(path = '/login', signedIn = false) {
  if (signedIn) localStorage.setItem('cs_token', 'provisioned-token');
  return render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AuthProvider><App /></AuthProvider></MemoryRouter>);
}
function submitLogin() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'venue@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Login' }));
}
beforeEach(() => {
  localStorage.clear();
  currentUser = { id: 1, email: 'venue@example.com', full_name: 'Vera', role: 'venue_staff' };
  api.get.mockReset(); api.post.mockReset();
  api.get.mockImplementation(async (path) => {
    if (path === '/auth/me') return { user: currentUser };
    if (path === '/venues') return [];
    if (path === '/events') return { events: [] };
    throw new Error(`Unexpected request: ${path}`);
  });
  api.post.mockImplementation(async () => ({ user: currentUser, token: 'provisioned-token' }));
});
afterEach(cleanup);

const dashboards = [
  ['venue_staff', 'Venue Staff Dashboard'],
  ['event_coordinator', 'Event Coordinator Dashboard'],
  ['technical_support', 'Technical Support Dashboard'],
  ['event_organiser', 'Event Organiser Dashboard'],
  ['attendee', 'Attendee Dashboard'],
];
describe('shared login regression coverage', () => {
  it.each(dashboards)('logs in %s and redirects to the correct dashboard', async (role, title) => {
    currentUser.role = role; open(); submitLogin();
    expect(await screen.findByRole('heading', { name: title })).toBeTruthy();
    expect(api.post).toHaveBeenCalledWith('/auth/login', { email: 'venue@example.com', password: 'password123' });
    expect(localStorage.getItem('cs_token')).toBe('provisioned-token');
  });
  it('shows a clear invalid-credentials error without entering a dashboard', async () => {
    api.post.mockRejectedValue(new Error('Invalid email or password.'));
    open(); submitLogin();
    expect((await screen.findByRole('alert')).textContent).toBe('Invalid email or password.');
    expect(screen.queryByRole('heading', { name: 'Venue Staff Dashboard' })).toBeNull();
    expect(localStorage.getItem('cs_token')).toBeNull();
    expect(screen.getByRole('button', { name: 'Login' }).disabled).toBe(false);
  });
  it('prevents duplicate submissions while login is pending', async () => {
    let finish;
    api.post.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    open(); submitLogin();
    const button = screen.getByRole('button', { name: 'Signing in...' });
    expect(button.disabled).toBe(true); fireEvent.click(button); expect(api.post).toHaveBeenCalledTimes(1);
    await act(async () => finish({ user: currentUser, token: 'provisioned-token' }));
    expect(await screen.findByRole('heading', { name: 'Venue Staff Dashboard' })).toBeTruthy();
  });
});
describe('dashboard and event authorization', () => {
  it.each(['/coordinator/dashboard', '/tech-support/dashboard', '/organizer/dashboard', '/attendee/dashboard', '/events', '/events/1', '/events/999', '/dashboard', '/'])('keeps Venue Staff in their own dashboard when opening %s', async (path) => {
    open(path, true);
    expect(await screen.findByRole('heading', { name: 'Venue Staff Dashboard' })).toBeTruthy();
    expect(api.get.mock.calls.some(([endpoint]) => endpoint.startsWith('/events'))).toBe(false);
    expect(screen.queryByRole('link', { name: 'Events' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Equipment' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Dashboard' }).getAttribute('href')).toBe('/venue/dashboard');
  });
  it.each(dashboards.slice(1))('does not let %s open the Venue Staff dashboard', async (role, title) => {
    currentUser.role = role; open('/venue/dashboard', true);
    expect(await screen.findByRole('heading', { name: title })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Venue Staff Dashboard' })).toBeNull();
    expect(api.get.mock.calls.some(([endpoint]) => endpoint === '/venues')).toBe(false);
  });
  it('redirects an unauthenticated direct dashboard visit to login', async () => {
    open('/venue/dashboard');
    expect(await screen.findByRole('heading', { name: 'ConnectSphere Login' })).toBeTruthy();
    expect(api.get).not.toHaveBeenCalled();
  });
  it('restores a valid provisioned session after refresh', async () => {
    open('/venue/dashboard', true);
    expect(await screen.findByRole('heading', { name: 'Venue Staff Dashboard' })).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('/auth/me', 'provisioned-token');
  });
  it('clears an expired or deleted-account session', async () => {
    api.get.mockRejectedValue(new Error('Unauthorized: Invalid token.'));
    open('/venue/dashboard', true);
    expect(await screen.findByRole('heading', { name: 'ConnectSphere Login' })).toBeTruthy();
    expect(localStorage.getItem('cs_token')).toBeNull();
  });
  it('clears the user when session validation fails immediately after login', async () => {
    api.get.mockRejectedValue(new Error('User no longer exists.'));
    open(); submitLogin();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/auth/me', 'provisioned-token'));
    await waitFor(() => expect(localStorage.getItem('cs_token')).toBeNull());
    expect(await screen.findByRole('heading', { name: 'ConnectSphere Login' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Venue Staff Dashboard' })).toBeNull();
  });
  it('logout removes the token and returns to login', async () => {
    open('/venue/dashboard', true);
    await screen.findByRole('heading', { name: 'Venue Staff Dashboard' });
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('heading', { name: 'ConnectSphere Login' })).toBeTruthy();
    expect(localStorage.getItem('cs_token')).toBeNull();
  });
  it('does not restore an old user when a pending session request finishes after logout', async () => {
    let finish;
    api.get.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    localStorage.setItem('cs_token', 'old-token');
    function Probe() {
      const { user, logout } = useAuth();
      return <><span>{user ? user.full_name : 'Signed out'}</span><button onClick={logout}>Logout</button></>;
    }
    render(<AuthProvider><Probe /></AuthProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
    await act(async () => finish({ user: currentUser }));
    expect(screen.getByText('Signed out')).toBeTruthy(); expect(localStorage.getItem('cs_token')).toBeNull();
  });
  it('never treats inherited object keys as dashboard routes', () => {
    expect(getDashboardRoute('__proto__')).toBe('/dashboard');
    expect(getDashboardRoute('constructor')).toBe('/dashboard');
    expect(getDashboardRoute(undefined)).toBe('/dashboard');
  });
});
describe('provisioning and permitted venue functionality', () => {
  it('offers no self-registration form or role selector', async () => {
    open('/register');
    expect(await screen.findByRole('heading', { name: 'Account access' })).toBeTruthy();
    expect(screen.getByText(/Staff accounts are provisioned internally/)).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: /create account/i })).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });
  it('displays the existing catalogue and opens the existing venue detail modal', async () => {
    api.get.mockImplementation(async (path) => path === '/auth/me' ? { user: currentUser } : [{ id: 1, name: 'Marina Hall', location: 'Marina', facilities: ['Wi-Fi'] }]);
    open('/venue/dashboard', true);
    await screen.findByRole('heading', { name: 'Marina Hall' });
    fireEvent.click(screen.getByRole('button', { name: 'View details' }));
    expect(screen.getByText('Venue Details')).toBeTruthy();
    expect(screen.getAllByRole('heading', { name: 'Marina Hall' }).length).toBe(2);
  });
  it('sends the current token when creating a venue', async () => {
    api.post.mockResolvedValue({ venue: { id: 2, name: 'New Hall' } });
    open('/venue/dashboard', true);
    fireEvent.click(await screen.findByRole('button', { name: 'Add venue' }));
    fireEvent.change(screen.getByPlaceholderText('Venue Name *'), { target: { value: 'New Hall' } });
    fireEvent.change(screen.getByPlaceholderText('Pricing (e.g. from S$500) *'), { target: { value: 'S$500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & Publish Venue' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/venues', expect.objectContaining({ name: 'New Hall' }), 'provisioned-token'));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Add New Venue' })).toBeNull());
  });
});
