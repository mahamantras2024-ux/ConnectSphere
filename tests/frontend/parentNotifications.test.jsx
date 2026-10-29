// File: Tests the parent notification system in the real app: a bell on every signed-in page (AC1), new notifications
// within ten seconds (AC1), concise previews (AC2) with a timestamp (AC3), and opening the related page (AC4).
// Test scope: Real App routes, AuthProvider, navbar, dashboards and notification components; only the API client is replaced.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../frontend/src/api/client';
import App from '../../frontend/src/App';
import NotificationBell from '../../frontend/src/components/NotificationBell';
import { AuthProvider } from '../../frontend/src/context/AuthContext';
import { PREVIEW_LIMIT, exactTime, previewText, relativeTime } from '../../frontend/src/notifications/notificationPreview';
import { notificationTarget } from '../../frontend/src/notifications/notificationTarget';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

const NOW = new Date('2030-01-02T04:00:00.000Z');
let user;
let inbox;
const roles = {
  event_organiser: { id: 12, full_name: 'Olivia', role: 'event_organiser' },
  event_coordinator: { id: 30, full_name: 'Chris', role: 'event_coordinator' },
  event_coordinator_lead: { id: 40, full_name: 'Lee', role: 'event_coordinator_lead' },
  attendee: { id: 70, full_name: 'Ada', role: 'attendee' },
  venue_staff: { id: 20, full_name: 'Vera', role: 'venue_staff' },
  technical_support: { id: 60, full_name: 'Tina', role: 'technical_support' },
  safety_officer: { id: 50, full_name: 'Sam', role: 'safety_officer' },
};
const note = (changes = {}) => ({ id: 9, event_id: 101, type: 'event_details_changed', title: 'Venue booking approved: Gala',
  message: 'Gala: venue booking #4 at Hall A was approved.', created_at: '2030-01-02T03:55:00.000Z', read_at: null, ...changes });

// Shows the current path so a test can see where a click led (AC4).
function Where() { return <output aria-label="Current page">{useLocation().pathname}</output>; }
// Renders the application at a route with a stored session token.
function open(path) {
  localStorage.setItem('cs_token', 'session');
  render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /><Where /></AuthProvider></MemoryRouter>);
}
// Waits for the first notification read to finish, so the bell shows its loaded state.
async function bell() {
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/notifications', 'session'));
  await act(async () => {});
  return screen.findByRole('button', { name: /^Notifications/ });
}
const page = () => screen.getByRole('status', { name: 'Current page' }).textContent;
const notificationCalls = () => api.get.mock.calls.filter(([path]) => path === '/notifications').length;

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  api.get.mockReset(); api.post.mockReset();
  user = roles.event_organiser;
  inbox = { notifications: [note()], unreadCount: 1 };
  api.get.mockImplementation(async (path) => {
    if (path === '/auth/me') return { user: { ...user, roles: [user.role] } };
    if (path === '/notifications') return typeof inbox === 'function' ? inbox() : inbox;
    if (path === '/venues') return [];
    // Every dashboard gets an empty, well-formed workspace.
    return { events: [], requests: [], reservations: [], inventory: [], registrations: [], coordinators: [], issues: [], changeRequests: [] };
  });
  api.post.mockImplementation(async (path) => ({ notification: { id: Number(path.split('/')[2]), read_at: '2030-01-02T04:00:01.000Z' } }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

// ---------- Pure rules ----------
describe('previews and targets', () => {
  // AC2 boundary: exactly the limit stays whole; one character more is shortened with an ellipsis.
  it('NT AC2 - a first line of exactly the limit is kept, one character longer is shortened with "…"', () => {
    const atLimit = 'x'.repeat(PREVIEW_LIMIT);
    expect(previewText(atLimit)).toBe(atLimit);
    const over = previewText('x'.repeat(PREVIEW_LIMIT + 1));
    expect([over.length, over.endsWith('…')]).toEqual([PREVIEW_LIMIT, true]);
  });
  it('NT AC2 - a long sentence is cut at a word boundary, and only the first non-empty line is previewed', () => {
    const sentence = `${'word '.repeat(30).trim()}`;
    const preview = previewText(`\n  ${sentence}\nReason: details for the full view`);
    expect(preview.endsWith('word…')).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(PREVIEW_LIMIT);
    expect(previewText('Short line\nSecond line')).toBe('Short line');
    expect(previewText('')).toBe('');
    // A single unbroken word longer than the limit is cut mid-word rather than to almost nothing.
    expect(previewText(`a ${'y'.repeat(200)}`).length).toBe(PREVIEW_LIMIT);
  });
  // AC3: relative time boundaries.
  it.each([
    ['2030-01-02T03:59:31.000Z', 'Just now'], ['2030-01-02T03:59:00.000Z', '1 min ago'], ['2030-01-02T03:01:00.000Z', '59 min ago'],
    ['2030-01-02T03:00:00.000Z', '1 h ago'], ['2030-01-01T04:00:01.000Z', '23 h ago'], ['2030-01-01T04:00:00.000Z', '1 day ago'],
    ['2029-12-27T04:00:01.000Z', '5 days ago'], ['2029-12-26T04:00:00.000Z', null],
  ])('NT AC3 - an update at %s reads "%s"', (at, expected) => {
    expect(relativeTime(at, NOW.getTime())).toBe(expected);
  });
  it('NT AC3 - the exact time is shown in Singapore time', () => {
    expect(exactTime('2030-01-02T03:55:00.000Z')).toBe('2 Jan 2030, 11:55 am');
  });
  // AC4: the page for each role and type.
  it.each([
    ['event_organiser', note(), '/organizer/events/101'], ['attendee', note(), '/attendee/events/101'],
    ['event_coordinator', note(), '/events/101'], ['event_coordinator_lead', note(), '/events/101'],
    ['event_coordinator_lead', note({ type: 'event_awaiting_assignment' }), '/coordinator-lead/dashboard'],
    ['safety_officer', note({ type: 'safety_check_ready' }), '/safety/dashboard#safety-event-101'],
    ['safety_officer', note({ type: 'safety_check_ready', event_id: null }), '/safety/dashboard'],
    ['venue_staff', note(), '/venue/dashboard'], ['technical_support', note(), '/tech-support/dashboard'],
    ['event_organiser', note({ event_id: null }), '/organizer/dashboard'],
  ])('NT AC4 - a %s opens the right page', (role, notification, path) => {
    expect(notificationTarget(notification, role)).toBe(path);
  });
});

// ---------- In the app ----------

// AC1: every signed-in role, including the Safety Officer and Coordinator Lead, has the bell with its unread count.
it.each(Object.keys(roles))('NT AC1 - a %s sees the notification bell with the unread count', async (role) => {
  user = roles[role];
  open('/');
  expect((await bell()).getAttribute('aria-label')).toBe('Notifications, 1 unread');
  expect(screen.getByText('1', { selector: '.notification-count' })).toBeTruthy();
});
// Test case: Signed-out pages have no bell and make no notification request.
it('NT AC1 - signed-out pages show no bell and request no notifications', async () => {
  render(<MemoryRouter initialEntries={['/login']}><AuthProvider><App /><Where /></AuthProvider></MemoryRouter>);
  expect(await screen.findByRole('heading', { name: 'ConnectSphere Login' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Notifications/ })).toBeNull();
  expect(notificationCalls()).toBe(0);
});
// Test case: The Safety Officer and Coordinator Lead dashboards now list notifications too.
it.each([['safety_officer', 'Ready for safety check: Gala'], ['event_coordinator_lead', 'New request to assign: Gala']])(
  'NT AC1 - the %s dashboard lists its notifications', async (role, title) => {
    user = roles[role];
    inbox = { notifications: [note({ title, type: role === 'safety_officer' ? 'safety_check_ready' : 'event_awaiting_assignment' })], unreadCount: 1 };
    open('/');
    const panel = await screen.findByRole('region', { name: 'Notifications' });
    expect(await within(panel).findByText(title)).toBeTruthy();
  });

// AC1: a notification created after the page opened appears within ten seconds without a reload.
it('NT AC1 - a new notification appears within ten seconds, from one shared request', async () => {
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOW);
  inbox = { notifications: [], unreadCount: 0 };
  open('/organizer/dashboard');
  expect((await bell()).getAttribute('aria-label')).toBe('Notifications');
  const callsBefore = notificationCalls();
  // The change happens just after the page loaded.
  inbox = { notifications: [note()], unreadCount: 1 };
  await act(async () => { vi.advanceTimersByTime(4999); });
  expect(screen.getByRole('button', { name: /^Notifications/ }).getAttribute('aria-label')).toBe('Notifications');
  await act(async () => { vi.advanceTimersByTime(1); });
  await waitFor(() => expect(screen.getByRole('button', { name: /^Notifications/ }).getAttribute('aria-label')).toBe('Notifications, 1 unread'));
  // Bell and dashboard panel share one request per refresh.
  expect(notificationCalls() - callsBefore).toBe(1);
  expect(await within(screen.getByRole('region', { name: 'Notifications' })).findByText('Venue booking approved: Gala')).toBeTruthy();
});

// AC2/AC3: the dropdown preview is concise and timed.
it('NT AC2/AC3 - the bell shows each notification as a title, a one-line summary and when it happened', async () => {
  inbox = { notifications: [note({ message: `Gala: ${'a long explanation '.repeat(10)}\nReason: Hall A closed for repairs.` })], unreadCount: 1 };
  open('/organizer/dashboard');
  fireEvent.click(await bell());
  const dropdown = screen.getByRole('region', { name: 'Recent notifications' });
  const item = within(dropdown).getByRole('button', { name: 'Venue booking approved: Gala (new)' });
  const summary = item.querySelector('.notification-summary').textContent;
  expect([summary.length <= PREVIEW_LIMIT, summary.endsWith('…'), summary.includes('Reason')]).toEqual([true, true, false]);
  expect(within(item).getByText('5 min ago')).toBeTruthy();
  expect(within(item).getByText('2 Jan 2030, 11:55 am').getAttribute('datetime')).toBe('2030-01-02T03:55:00.000Z');
  // The full message stays in the dashboard panel, behind "Details".
  const panel = screen.getByRole('region', { name: 'Notifications' });
  expect(within(panel).getByText('Details')).toBeTruthy();
  expect(within(panel).getByText(/Reason: Hall A closed for repairs\./)).toBeTruthy();
});
// Test case: A message the preview already shows in full has no Details control.
it('NT AC2 - a short single-line message has no separate details', async () => {
  open('/organizer/dashboard');
  const panel = await screen.findByRole('region', { name: 'Notifications' });
  await within(panel).findByText('Venue booking approved: Gala');
  expect(within(panel).queryByText('Details')).toBeNull();
});

// AC4: pressing a notification marks it read and opens the page where the update happened.
it.each([
  ['event_coordinator', '/coordinator/dashboard', note({ type: 'clarification_replied', title: 'Clarification reply received: Gala' }), '/events/101'],
  ['event_coordinator', '/coordinator/dashboard', note({ type: 'event_coordinator_assigned', title: 'Event assigned: Gala' }), '/events/101'],
  ['event_organiser', '/organizer/dashboard', note(), '/organizer/events/101'],
  ['event_coordinator_lead', '/coordinator-lead/dashboard', note({ type: 'event_awaiting_assignment', title: 'New request to assign: Gala' }), '/coordinator-lead/dashboard'],
  ['safety_officer', '/safety/dashboard', note({ type: 'safety_check_ready', title: 'Ready for safety check: Gala' }), '/safety/dashboard'],
  ['attendee', '/attendee/dashboard', note({ type: 'event_cancelled', title: 'Event cancelled: Gala' }), '/attendee/events/101'],
])('NT AC4 - a %s pressing a notification in the bell lands on its page', async (role, start, notification, destination) => {
  user = roles[role];
  inbox = { notifications: [notification], unreadCount: 1 };
  open(start);
  fireEvent.click(await bell());
  fireEvent.click(within(screen.getByRole('region', { name: 'Recent notifications' })).getByRole('button', { name: `${notification.title} (new)` }));
  await waitFor(() => expect(page()).toBe(destination));
  expect(api.post).toHaveBeenCalledWith('/notifications/9/read', {}, 'session');
  // The dropdown closes and the unread count drops.
  expect(screen.queryByRole('region', { name: 'Recent notifications' })).toBeNull();
  await waitFor(() => expect(screen.getByRole('button', { name: /^Notifications/ }).getAttribute('aria-label')).toBe('Notifications'));
});
// Test case: Pressing a notification for the page already open re-reads that page, so the announced update is shown
// (found in the browser demo: the Lead's queue stayed empty after opening "New request to assign").
it.each([
  ['event_coordinator_lead', '/coordinator-lead/dashboard', note({ type: 'event_awaiting_assignment', title: 'New request to assign: Gala' }), '/events/assignments'],
  ['safety_officer', '/safety/dashboard', note({ type: 'safety_check_ready', title: 'Ready for safety check: Gala' }), '/safety/checks'],
  ['technical_support', '/tech-support/dashboard', note(), '/events/equipment-requests'],
  ['event_coordinator', '/events/101', note(), '/events/101'],
])('NT AC4 - a %s opening a notification for the page already open sees it re-read', async (role, start, notification, dataPath) => {
  user = roles[role];
  inbox = { notifications: [notification], unreadCount: 1 };
  open(start);
  fireEvent.click(await bell());
  const reads = () => api.get.mock.calls.filter(([path]) => path === dataPath).length;
  await waitFor(() => expect(reads()).toBeGreaterThan(0));
  const before = reads();
  fireEvent.click(within(screen.getByRole('region', { name: 'Recent notifications' })).getByRole('button', { name: `${notification.title} (new)` }));
  await waitFor(() => expect(page()).toBe(start));
  await waitFor(() => expect(reads()).toBe(before + 1));
});
// Test case: An already-read notification opens its page without another mark-read request.
it('NT AC4 - a read notification in the dashboard panel opens its page without marking it again', async () => {
  inbox = { notifications: [note({ read_at: '2030-01-02T03:56:00.000Z' })], unreadCount: 0 };
  open('/organizer/dashboard');
  const panel = await screen.findByRole('region', { name: 'Notifications' });
  fireEvent.click(await within(panel).findByRole('button', { name: 'Venue booking approved: Gala' }));
  await waitFor(() => expect(page()).toBe('/organizer/events/101'));
  expect(api.post).not.toHaveBeenCalled();
});
// Test case: If marking read fails, the page still opens (the user is never stuck on the notification).
it('NT AC4 - a failed mark-read still opens the related page', async () => {
  api.post.mockRejectedValue(new Error('Server unavailable'));
  open('/organizer/dashboard');
  fireEvent.click(await bell());
  fireEvent.click(within(screen.getByRole('region', { name: 'Recent notifications' })).getByRole('button', { name: 'Venue booking approved: Gala (new)' }));
  await waitFor(() => expect(page()).toBe('/organizer/events/101'));
});

// Test case (reviewer regression): a mark-read request that never answers must not keep the user from the page (AC4).
it('NT AC4 - a mark-read request that stalls still opens the related page at once', async () => {
  // Arrange: the server never answers the mark-read request.
  api.post.mockImplementation(() => new Promise(() => {}));
  open('/organizer/dashboard');
  fireEvent.click(await bell());
  // Act
  fireEvent.click(within(screen.getByRole('region', { name: 'Recent notifications' })).getByRole('button', { name: 'Venue booking approved: Gala (new)' }));
  // Assert: the page opens without waiting, and the read was still requested.
  await waitFor(() => expect(page()).toBe('/organizer/events/101'));
  expect(api.post).toHaveBeenCalledWith('/notifications/9/read', {}, 'session');
});

// ---------- AC1 timing when a refresh stalls (reviewer regression) ----------
describe('stalled refreshes', () => {
  // Every timer is fake here (polls and the stalled-read retry), so Testing Library's waits are replaced by flushing the
  // clock and pending promises explicitly.
  const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const bellLabel = () => screen.getByRole('button', { name: /^Notifications/ }).getAttribute('aria-label');
  beforeEach(() => { vi.useRealTimers(); vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime(NOW); });

  // Test case: The 5-second poll hangs; the 3-second retry still shows the new notification before the 10-second limit, and
  // the hung read's late (older) answer does not replace it.
  it('NT AC1 - a change still appears within ten seconds when the next refresh stalls', async () => {
    // Arrange: the first read finds nothing; the next one hangs; the retry finds the new notification.
    let releaseStalled;
    const replies = [{ notifications: [], unreadCount: 0 }, new Promise((resolve) => { releaseStalled = resolve; }), { notifications: [note()], unreadCount: 1 }];
    inbox = () => replies.shift();
    open('/organizer/dashboard');
    await flush(); await flush(); await flush();
    expect(bellLabel()).toBe('Notifications');
    // Act / Assert: at 7.999 s the stalled poll (started at 5 s) has not been retried yet; at 8 s the retry shows it.
    await flush(7999);
    expect(bellLabel()).toBe('Notifications');
    await flush(1);
    expect(bellLabel()).toBe('Notifications, 1 unread');
    // The hung read finally answers with what it saw at 5 s (nothing); that older answer is ignored.
    await act(async () => { releaseStalled({ notifications: [], unreadCount: 0 }); });
    await flush();
    expect(bellLabel()).toBe('Notifications, 1 unread');
  });

  // Test case: A late failure of an overtaken read does not report an error over newer data.
  it('NT AC1 - a late failure from an overtaken refresh is ignored', async () => {
    let failStalled;
    const replies = [{ notifications: [], unreadCount: 0 }, new Promise((_, reject) => { failStalled = reject; }), { notifications: [note()], unreadCount: 1 }];
    inbox = () => replies.shift();
    open('/organizer/dashboard');
    await flush(); await flush(); await flush();
    await flush(8000);
    expect(bellLabel()).toBe('Notifications, 1 unread');
    await act(async () => { failStalled(new Error('Timed out')); });
    await flush();
    fireEvent.click(screen.getByRole('button', { name: /^Notifications/ }));
    expect(within(screen.getByRole('region', { name: 'Recent notifications' })).queryByText(/could not be/)).toBeNull();
  });

  // Test case: A hung server is retried, but no more than three reads are left open at once.
  it('NT AC1 - a hung server never has more than three notification reads open', async () => {
    let first = true;
    inbox = () => (first ? ((first = false), { notifications: [], unreadCount: 0 }) : new Promise(() => {}));
    open('/organizer/dashboard');
    await flush(); await flush(); await flush();
    const before = notificationCalls();
    // Polls at 5, 10, 15 and 20 s and retries every 3 s would add far more; only three stay open.
    await flush(20000);
    expect(notificationCalls() - before).toBe(3);
  });
});

// Test case: Only the pressed notification changes, and a refresh that already showed it read does not lower the count twice.
it('NT AC4 - marking one notification read leaves the others unread and never double-counts', async () => {
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOW);
  const other = note({ id: 10, event_id: 102, title: 'Event cancelled: Fair' });
  inbox = { notifications: [note(), other], unreadCount: 2 };
  let finishRead;
  api.post.mockImplementation(() => new Promise((resolve) => { finishRead = resolve; }));
  open('/organizer/dashboard');
  expect((await bell()).getAttribute('aria-label')).toBe('Notifications, 2 unread');
  fireEvent.click(screen.getByRole('button', { name: /^Notifications/ }));
  fireEvent.click(within(screen.getByRole('region', { name: 'Recent notifications' })).getByRole('button', { name: 'Venue booking approved: Gala (new)' }));
  // Another tab already marked it read; the next refresh shows that before this request returns.
  inbox = { notifications: [note({ read_at: '2030-01-02T03:59:00.000Z' }), other], unreadCount: 1 };
  await act(async () => { vi.advanceTimersByTime(5000); });
  await waitFor(() => expect(screen.getByRole('button', { name: /^Notifications/ }).getAttribute('aria-label')).toBe('Notifications, 1 unread'));
  await act(async () => finishRead({ notification: { id: 9, read_at: '2030-01-02T03:59:00.000Z' } }));
  await waitFor(() => expect(page()).toBe('/organizer/events/101'));
  expect(screen.getByRole('button', { name: /^Notifications/ }).getAttribute('aria-label')).toBe('Notifications, 1 unread');
  fireEvent.click(screen.getByRole('button', { name: /^Notifications/ }));
  const dropdown = screen.getByRole('region', { name: 'Recent notifications' });
  expect(within(dropdown).getByRole('button', { name: 'Event cancelled: Fair (new)' })).toBeTruthy();
  expect(within(dropdown).getByRole('button', { name: 'Venue booking approved: Gala' })).toBeTruthy();
});
// Test case: If the session ends while a notification is being marked read, the cleared list stays cleared.
it('NT AC4 - a sign-out response during mark-read does not bring back the cleared list', async () => {
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOW);
  let finishRead;
  api.post.mockImplementation(() => new Promise((resolve) => { finishRead = resolve; }));
  open('/organizer/dashboard');
  fireEvent.click(await bell());
  fireEvent.click(within(screen.getByRole('region', { name: 'Recent notifications' })).getByRole('button', { name: 'Venue booking approved: Gala (new)' }));
  // The next refresh is refused (expired session), which clears the private list.
  inbox = () => { throw Object.assign(new Error('Session expired'), { status: 401 }); };
  await act(async () => { vi.advanceTimersByTime(5000); });
  await waitFor(() => expect(screen.getByRole('button', { name: /^Notifications/ }).getAttribute('aria-label')).toBe('Notifications'));
  await act(async () => finishRead({ notification: { id: 9, read_at: '2030-01-02T04:00:05.000Z' } }));
  await waitFor(() => expect(page()).toBe('/organizer/events/101'));
  fireEvent.click(screen.getByRole('button', { name: /^Notifications/ }));
  expect(within(screen.getByRole('region', { name: 'Recent notifications' })).queryByText('Venue booking approved: Gala')).toBeNull();
});

// Bell behaviour: closing, empty, loading and failure states, and a large count.
it('NT AC1 - the bell dropdown closes with Escape or a click outside', async () => {
  open('/organizer/dashboard');
  fireEvent.click(await bell());
  expect(screen.getByRole('region', { name: 'Recent notifications' })).toBeTruthy();
  fireEvent.mouseDown(within(screen.getByRole('region', { name: 'Recent notifications' })).getByText('Venue booking approved: Gala'));
  expect(screen.getByRole('region', { name: 'Recent notifications' })).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Enter' });
  expect(screen.getByRole('region', { name: 'Recent notifications' })).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('region', { name: 'Recent notifications' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^Notifications/ }));
  fireEvent.mouseDown(document.body);
  expect(screen.queryByRole('region', { name: 'Recent notifications' })).toBeNull();
});
it('NT AC1 - the bell explains when there are no notifications, while loading, and when loading fails', async () => {
  let release;
  inbox = () => new Promise((resolve) => { release = resolve; });
  open('/organizer/dashboard');
  fireEvent.click(await bell());
  expect(within(screen.getByRole('region', { name: 'Recent notifications' })).getByText('Loading notifications...')).toBeTruthy();
  await act(async () => release({ notifications: [], unreadCount: 0 }));
  expect(within(screen.getByRole('region', { name: 'Recent notifications' })).getByText('No notifications yet.')).toBeTruthy();
  cleanup();
  inbox = () => { throw new Error('Offline'); };
  open('/organizer/dashboard');
  fireEvent.click(await bell());
  expect(await within(screen.getByRole('region', { name: 'Recent notifications' })).findByText('Notifications could not be loaded right now.')).toBeTruthy();
});
it('NT AC1 - a refresh failure keeps the last loaded notifications and says so', async () => {
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOW);
  open('/organizer/dashboard');
  fireEvent.click(await bell());
  await within(screen.getByRole('region', { name: 'Recent notifications' })).findByText('Venue booking approved: Gala');
  inbox = () => { throw new Error('Offline'); };
  await act(async () => { vi.advanceTimersByTime(5000); });
  const dropdown = screen.getByRole('region', { name: 'Recent notifications' });
  expect(await within(dropdown).findByText('Notifications could not be refreshed. Showing the last loaded information.')).toBeTruthy();
  expect(within(dropdown).getByText('Venue booking approved: Gala')).toBeTruthy();
});
// Test case: A bell rendered on its own (outside the app's provider) shows an empty list instead of failing.
it('NT AC1 - a bell outside the notification provider shows no notifications and makes no request', () => {
  render(<MemoryRouter><NotificationBell /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
  expect(within(screen.getByRole('region', { name: 'Recent notifications' })).getByText('No notifications yet.')).toBeTruthy();
  expect(api.get).not.toHaveBeenCalled();
});
it('NT AC1 - more than 99 unread notifications show as 99+', async () => {
  inbox = { notifications: [note()], unreadCount: 120 };
  open('/organizer/dashboard');
  expect((await bell()).getAttribute('aria-label')).toBe('Notifications, 120 unread');
  expect(screen.getByText('99+', { selector: '.notification-count' })).toBeTruthy();
});

// Assignment AC5: the saved assignment uses the shared coordinator dashboard inbox and its real event route.
it('Assignment notification AC5 - coordinator dashboard notice opens the assigned event',async()=>{
  user=roles.event_coordinator;
  inbox={unreadCount:1,notifications:[note({type:'event_coordinator_assigned',title:'Event assigned: Gala',message:'You have been assigned as Event Coordinator for Gala.'})]};
  open('/coordinator/dashboard');
  const panel=await screen.findByRole('region',{name:'Notifications'});
  const notice=await within(panel).findByRole('button',{name:'Event assigned: Gala (new)'});
  expect(within(panel).getByText('1 unread')).toBeTruthy();
  fireEvent.click(notice);
  await waitFor(()=>expect(page()).toBe('/events/101'));
  expect(api.post).toHaveBeenCalledWith('/notifications/9/read',{},'session');
});
