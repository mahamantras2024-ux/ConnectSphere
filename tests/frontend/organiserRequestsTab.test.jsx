// Organiser requests tab AC1–AC4: real navigation, auth and request-list components; only HTTP is mocked.
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import App from '../../frontend/src/App';
import Navbar from '../../frontend/src/components/Navbar';
import { AuthProvider } from '../../frontend/src/context/AuthContext';
import { NotificationsProvider } from '../../frontend/src/context/NotificationsContext';
import { api } from '../../frontend/src/api/client';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
let role;
const events = [
  { id: 1, name: 'Draft workshop', status: 'draft', is_draft: true, can_manage: true, coordinator_id: null },
  { id: 2, name: 'Submitted meeting', status: 'submitted', can_manage: true, coordinator_id: null },
  { id: 3, name: 'Planning festival', status: 'planning', can_manage: true, coordinator_id: 9 },
];

/** Exposes actual router history so Back/Forward assertions do not bypass navigation state. */
function HistoryControls() {
  const navigate = useNavigate();
  const location = useLocation();
  return <><span aria-label="Current route">{location.pathname}</span>
    <button onClick={() => navigate(-1)}>Browser back</button><button onClick={() => navigate(1)}>Browser forward</button></>;
}

/** Mounts the full application, or real header for route-family selection tests, using a provisioned session. */
function open(path = '/organizer/dashboard', headerOnly = false) {
  return render(<MemoryRouter initialEntries={[path]}><AuthProvider>
    {headerOnly ? <NotificationsProvider><Navbar /></NotificationsProvider> : <App />}
    <HistoryControls />
  </AuthProvider></MemoryRouter>);
}

beforeEach(() => {
  role = 'event_organiser';
  localStorage.setItem('cs_token', 'organiser-tabs-session');
  vi.resetAllMocks();
  api.get.mockImplementation(async path => {
    if (path === '/auth/me') return { user: { id: 7, role, full_name: 'Alice' } };
    if (path === '/events') return { events };
    return { notifications: [], unreadCount: 0, preference: { dailyPendingReminders: false, reminderFrequencyDays: 1 } };
  });
});
afterEach(() => { cleanup(); localStorage.clear(); });

it('Organiser requests tab AC1 AC2 - opens the existing request list and preserves history and request actions', async () => {
  // Arrange: the current dashboard remains the default, with a separate request-list destination.
  open();
  await screen.findByRole('heading', { name: 'Event Organiser Dashboard' });
  // The dashboard keeps its existing creation action even after request-list navigation is added.
  expect(screen.getByRole('link', { name: 'Request an event' })).toHaveAttribute('href', '/organizer/events/new');
  const navigation = screen.getByRole('navigation', { name: 'Main navigation' });
  const requests = within(navigation).getByRole('link', { name: 'Requests', exact: true });
  const dashboard = within(navigation).getByRole('link', { name: 'My Events', exact: true });
  expect(dashboard).toHaveAttribute('aria-current', 'page');
  expect(requests).toHaveAttribute('href', '/organizer/events');
  expect(requests).not.toHaveAttribute('aria-current', 'page');

  // Act / Assert: the tab reuses the real list, including its existing draft, status and detail entry points.
  fireEvent.click(requests);
  await screen.findByRole('heading', { name: 'My Events', exact: true });
  expect(requests).toHaveAttribute('aria-current', 'page');
  expect(dashboard).not.toHaveAttribute('aria-current', 'page');
  for (const title of ['Drafts', 'Submitted', 'In progress']) expect(screen.getByRole('heading', { name: title, exact: true })).toBeVisible();
  const draft = screen.getByRole('heading', { name: 'Draft workshop' }).closest('li');
  expect(within(draft).getByRole('button', { name: 'Submit draft' })).toBeVisible();
  expect(within(draft).getByRole('button', { name: 'Delete draft' })).toBeVisible();
  const submitted = screen.getByRole('heading', { name: 'Submitted meeting' }).closest('li');
  expect(within(submitted).getByRole('link', { name: 'View status' })).toHaveAttribute('href', '/organizer/events/2/status');
  expect(within(submitted).getByRole('link', { name: 'View details' })).toHaveAttribute('href', '/organizer/events/2');
  expect(screen.getByRole('link', { name: 'Request an event' })).toHaveAttribute('href', '/organizer/events/new');
  fireEvent.click(screen.getByRole('button', { name: 'Browser back' }));
  await screen.findByRole('heading', { name: 'Event Organiser Dashboard' });
  expect(dashboard).toHaveAttribute('aria-current', 'page');
  expect(requests).not.toHaveAttribute('aria-current', 'page');
  fireEvent.click(screen.getByRole('button', { name: 'Browser forward' }));
  await screen.findByRole('heading', { name: 'My Events', exact: true });
  expect(requests).toHaveAttribute('aria-current', 'page');
  expect(api.post).not.toHaveBeenCalled();
  expect(api.put).not.toHaveBeenCalled();
  expect(api.delete).not.toHaveBeenCalled();
});

it.each(['/organizer/events', '/organizer/events/new', '/organizer/events/101', '/organizer/events/101/status'])(
  'Organiser requests tab AC2 - direct route %s selects only Requests', async path => {
    // Arrange / Act: mount the real header at each member of the existing request route family.
    open(path, true);
    const requests = await screen.findByRole('link', { name: 'Requests', exact: true });
    // Assert: nested editor/status pages remain in the Requests workspace without also activating My Events.
    expect(requests).toHaveAttribute('aria-current', 'page');
    expect(requests).toHaveClass('active');
    expect(screen.getByRole('link', { name: 'My Events', exact: true })).not.toHaveAttribute('aria-current', 'page');
    expect(screen.getByLabelText('Current route')).toHaveTextContent(path);
  });

it.each(['empty', 'error'])('Organiser requests tab AC3 - keeps navigation usable with an %s request list', async state => {
  // Arrange: only the event-list response changes; authentication and notifications remain valid.
  const base = api.get.getMockImplementation();
  api.get.mockImplementation((path, ...args) => path === '/events'
    ? state === 'error' ? Promise.reject(new Error('Unable to load requests.')) : Promise.resolve({ events: [] })
    : base(path, ...args));
  open('/organizer/events');
  // Assert: the tab and creation entry point survive both data states; neither causes a write.
  expect(await screen.findByRole('link', { name: 'Requests', exact: true })).toHaveAttribute('aria-current', 'page');
  if (state === 'error') expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load requests.');
  else expect(await screen.findByText('No draft requests.')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Request an event' })).toBeVisible();
  expect(api.post).not.toHaveBeenCalled();
});

it.each(['event_coordinator', 'attendee'])('Organiser requests tab AC4 - does not expose the organiser tab in the %s workspace', async activeRole => {
  // Arrange / Act: internal staff and other external users have their own header destinations.
  role = activeRole;
  open('/unrelated', true);
  await screen.findByRole('link', { name: role === 'attendee' ? 'My Registrations' : 'Dashboard', exact: true });
  // Assert: an organiser-only route cannot become another role's Requests shortcut.
  expect(screen.queryByRole('link', { name: 'Requests', exact: true })).not.toBeInTheDocument();
});

it('Organiser requests tab AC4 - does not expose Requests before signing in', async () => {
  // Arrange / Act: no session means the public sign-in navigation is rendered.
  localStorage.clear();
  open('/external/login', true);
  await screen.findByRole('link', { name: 'External sign in' });
  // Assert: authentication remains the boundary for organiser workspace navigation.
  expect(screen.queryByRole('link', { name: 'Requests', exact: true })).not.toBeInTheDocument();
});
