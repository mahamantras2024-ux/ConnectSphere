// Venue tabs AC1–AC5: real navigation, sections, and modal lifecycle; only HTTP is mocked.
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import App from '../../frontend/src/App';
import Navbar from '../../frontend/src/components/Navbar';
import { AuthProvider } from '../../frontend/src/context/AuthContext';
import { NotificationsProvider } from '../../frontend/src/context/NotificationsContext';
import { api } from '../../frontend/src/api/client';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
let role;
const venue = { id: 1, name: 'Marina Hall', capacity: 80, pricing: '500', location: 'Marina', facilities: [], accessibility_features: [], supported_layouts: [] };
const booking = { id: 10, venue_id: 1, event_id: 11, event_name: 'Workshop', venue_name: 'Marina Hall', status: 'pending', start_datetime: '2031-10-20T02:00:00Z', end_datetime: '2031-10-20T03:00:00Z' };

/** Exposes the real router history as test controls, equivalent to browser Back/Forward buttons. */
function HistoryControls() {
  const navigate = useNavigate();
  const location = useLocation();
  return <><span aria-label="Current route">{location.pathname + location.search}</span><button onClick={() => navigate(-1)}>Back</button><button onClick={() => navigate(1)}>Forward</button></>;
}

/** Mounts the real app, or its shared navigation on an unrelated page, with a provisioned staff session. */
function open(entries = ['/venue/dashboard'], navbarOnly = false) {
  return render(<MemoryRouter initialEntries={entries}><AuthProvider>
    {navbarOnly ? <NotificationsProvider><Navbar /></NotificationsProvider> : <App />}
    <HistoryControls />
  </AuthProvider></MemoryRouter>);
}

beforeEach(() => {
  role = 'venue_staff';
  localStorage.setItem('cs_token', 'venue-session');
  vi.resetAllMocks();
  api.get.mockImplementation(async path => {
    if (path === '/auth/me') return { user: { id: 7, role, full_name: 'Vera' } };
    if (path === '/venues') return [venue];
    if (path === '/venues/relevant-events') return { events: [{ bookingId: 10, eventId: 11, name: 'Overview event', status: 'approved', eventStatus: 'confirmed', venueName: 'Marina Hall', accessibility: [] }] };
    if (path === '/venues/requests/pending') return { requests: [booking] };
    return { notifications: [], unreadCount: 0, preference: { dailyPendingReminders: false, reminderFrequencyDays: 1 } };
  });
});
afterEach(() => { cleanup(); localStorage.clear(); });

it('Venue tabs AC1 AC2 - separates the overview, venues catalogue and booking requests in header navigation', async () => {
  // Arrange: a staff member starts on the default overview.
  open();
  await screen.findByText('Overview event');
  const navigation = screen.getByRole('navigation', { name: 'Main navigation' });
  expect(within(navigation).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  expect(screen.queryByRole('button', { name: 'Add venue' })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Pending venue booking requests' })).not.toBeInTheDocument();

  // Act/Assert: the two links open only their respective working sections.
  fireEvent.click(within(navigation).getByRole('link', { name: 'Venues', exact: true }));
  await screen.findByRole('heading', { name: 'Marina Hall' });
  expect(screen.getByRole('button', { name: 'Add venue' })).toBeVisible();
  expect(within(navigation).getByRole('link', { name: 'Venues', exact: true })).toHaveAttribute('aria-current', 'page');
  expect(within(navigation).getByRole('link', { name: 'Dashboard' })).not.toHaveClass('active');
  expect(screen.queryByText('Overview event')).not.toBeInTheDocument();
  fireEvent.click(within(navigation).getByRole('link', { name: 'Requests', exact: true }));
  await screen.findByRole('button', { name: 'Review Workshop at Marina Hall' });
  expect(within(navigation).getByRole('link', { name: 'Requests', exact: true })).toHaveAttribute('aria-current', 'page');
  expect(screen.queryByRole('button', { name: 'Add venue' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Venues', exact: true })).not.toBeInTheDocument();
  fireEvent.click(within(navigation).getByRole('link', { name: 'Dashboard' }));
  await screen.findByText('Overview event');
  expect(screen.getByLabelText('Current route')).toHaveTextContent(/^\/venue\/dashboard$/);
});

it.each(['venues', 'requests'])('Venue tabs AC2 - restores the %s section from a direct URL without loading the other work section', async section => {
  // Arrange/Act: a reload or bookmarked link supplies the selected section.
  open([`/venue/dashboard?section=${section}`]);
  await screen.findByRole('link', { name: 'Requests', exact: true });
  const name = section === 'venues' ? 'Venues' : 'Requests';
  expect(screen.getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'page');
  if (section === 'venues') await screen.findByRole('heading', { name: 'Marina Hall' });
  else await screen.findByRole('button', { name: 'Review Workshop at Marina Hall' });
  // Assert: inactive sections do not mount or make unrelated catalogue/queue reads.
  const paths = api.get.mock.calls.map(([path]) => path);
  expect(paths).not.toContain('/venues/relevant-events');
  expect(paths).not.toContain(section === 'venues' ? '/venues/requests/pending' : '/venues');
});

it('Venue tabs AC2 - restores sections through Back and Forward and falls back safely for unknown sections', async () => {
  // Arrange: an unsupported section must still show a usable overview.
  open(['/venue/dashboard?section=unknown']);
  await screen.findByText('Overview event');
  expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  fireEvent.click(screen.getByRole('link', { name: 'Venues', exact: true }));
  await screen.findByRole('heading', { name: 'Marina Hall' });
  fireEvent.click(screen.getByRole('link', { name: 'Requests', exact: true }));
  await screen.findByRole('button', { name: 'Review Workshop at Marina Hall' });
  // Act/Assert: router history controls restore both the URL and mounted content.
  fireEvent.click(screen.getByRole('button', { name: 'Back', exact: true }));
  await screen.findByRole('heading', { name: 'Marina Hall' });
  expect(screen.getByLabelText('Current route')).toHaveTextContent('section=venues');
  fireEvent.click(screen.getByRole('button', { name: 'Forward', exact: true }));
  await screen.findByRole('button', { name: 'Review Workshop at Marina Hall' });
  expect(screen.getByLabelText('Current route')).toHaveTextContent('section=requests');
});

it('Venue tabs AC3 - keeps booking review and refresh working inside Requests', async () => {
  // Arrange: open a review through its new section URL, retaining the real queue and drawer.
  open(['/venue/dashboard?section=requests']);
  fireEvent.click(await screen.findByRole('button', { name: 'Review Workshop at Marina Hall' }));
  expect(screen.getByRole('dialog', { name: 'Review venue booking request' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  const before = api.get.mock.calls.filter(([path]) => path === '/venues/requests/pending').length;
  // Act/Assert: refresh still re-reads the queue while preserving its selected section.
  fireEvent.click(screen.getByRole('button', { name: 'Refresh requests' }));
  await waitFor(() => expect(api.get.mock.calls.filter(([path]) => path === '/venues/requests/pending').length).toBeGreaterThan(before));
  expect(screen.getByRole('link', { name: 'Requests', exact: true })).toHaveAttribute('aria-current', 'page');
});

it('Venue tabs AC4 - browser history closes an add-venue dialog without reopening it when returning to Venues', async () => {
  // Arrange: the catalogue is reachable from an existing overview history entry.
  open(['/venue/dashboard', '/venue/dashboard?section=venues']);
  fireEvent.click(await screen.findByRole('button', { name: 'Add venue' }));
  expect(screen.getByRole('dialog', { name: 'Add New Venue' })).toBeVisible();
  // Act: hidden test controls stand in for the browser toolbar, which remains available while a modal is open.
  fireEvent.click(screen.getByRole('button', { name: 'Back', exact: true, hidden: true }));
  await screen.findByText('Overview event');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: 'Venues', exact: true }));
  await screen.findByRole('heading', { name: 'Marina Hall' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('Venue tabs AC5 - does not mark venue links active outside the venue workspace', async () => {
  // Arrange/Act: the shared header can appear on other signed-in pages with the same query parameter.
  open(['/forgot-password?section=venues'], true);
  const venues = await screen.findByRole('link', { name: 'Venues', exact: true });
  // Assert: query text alone must not make a different page look like the venue workspace.
  expect(venues).not.toHaveClass('active');
  expect(screen.getByRole('link', { name: 'Requests', exact: true })).not.toHaveClass('active');
});

it.each(['technical_support', 'event_coordinator'])('Venue tabs AC5 - leaves %s navigation free of Venue Staff-only links', async otherRole => {
  // Arrange/Act: switch the authenticated role, retaining the real shared navigation.
  role = otherRole;
  open(['/forgot-password'], true);
  await screen.findByRole('link', { name: 'Dashboard' });
  // Assert: staff-specific catalogue/review links must not leak into other workspaces.
  expect(screen.queryByRole('link', { name: 'Venues', exact: true })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Requests', exact: true })).not.toBeInTheDocument();
});
