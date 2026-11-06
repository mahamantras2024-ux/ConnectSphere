// File: Tests the Event Coordinator Review & Process Change Requests story through real routing, the coordinator inbox and dashboard notifications.
// Test scope: Real App routes, AuthProvider, dashboards, ChangeRequestInbox and NotificationBell; only the API client is replaced.
// AC1 view requested changes; AC2 coordinator notified on submission; AC3 apply/reject and notify relevant personnel.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../frontend/src/api/client';
import App from '../../frontend/src/App';
import { AuthProvider } from '../../frontend/src/context/AuthContext';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));

// jsdom has no scrollIntoView; notification navigation legitimately scrolls the amendment inbox.
const scrollDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
let user;
let changeRequests;
let notificationsResponse;
// Request 501 raises attendance at a venue it no longer fits; request 502 only renames its event.
const attendanceRequest = { id: 501, event_id: 101, event_name: 'Community Workshop', organiser_name: 'Alice', status: 'pending',
  changes: [
    { field: 'expectedAttendance', label: 'Expected attendance', current: null, requested: 0 },
    { field: 'registrationRequired', label: 'Registration required', current: false, requested: true },
    { field: 'accessibilityRequirements', label: 'Accessibility needs', current: [], requested: ['Ramp', 'Hearing loop'] },
    { field: 'proposedEndTime', label: 'End time', current: '12:00:00', requested: '12:30:00' },
  ],
  arrangements: [{ bookingId: 9, venueName: 'Hall A', reasons: ['150 expected guests exceed the venue capacity of 100.'] }] };
const renameRequest = { id: 502, event_id: 102, event_name: 'Book Club', organiser_name: 'Ben', status: 'pending',
  changes: [{ field: 'name', label: 'Event name', current: 'Book Club', requested: 'Readers Club' }], arrangements: [] };

// Renders the application at a route with a stored session token.
function open(path) {
  localStorage.setItem('cs_token', 'session-token');
  render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AuthProvider><App /></AuthProvider></MemoryRouter>);
}
// Returns the inbox card for one event so assertions cannot match text from another request.
const card = async (eventName) => (await screen.findByText(eventName, { selector: 'strong' })).closest('li');
// Returns the cells of a comparison row as [current, requested].
const rowValues = (container, label) => within(within(container).getByRole('rowheader', { name: label }).closest('tr')).getAllByRole('cell').map((cell) => cell.textContent);
const notificationDropdown = () => screen.getByRole('region', { name: 'Recent notifications' });
/** Notifications are opened through the navbar, leaving the coordinator's amendment inbox intact. */
async function openNotifications() {
  fireEvent.click(await screen.findByRole('button', { name: /^Notifications/ }));
  return screen.getByRole('region', { name: 'Recent notifications' });
}
const inbox = () => screen.getByRole('region', { name: 'Amendment requests' });

beforeEach(() => {
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  localStorage.clear();
  user = { id: 30, email: 'chris@example.com', full_name: 'Chris', role: 'event_coordinator' };
  changeRequests = [attendanceRequest, renameRequest];
  notificationsResponse = { notifications: [], unreadCount: 0 };
  api.get.mockImplementation(async (path) => {
    if (path === '/auth/me') return { user };
    if (path === '/events') return { events: [] };
    if (path === '/venues') return [];
    if (path === '/events/change-requests') return { changeRequests };
    if (path === '/notifications') return notificationsResponse;
    throw new Error(`Unexpected request: ${path}`);
  });
});
afterEach(() => {
  cleanup();
  if (scrollDescriptor) Object.defineProperty(Element.prototype, 'scrollIntoView', scrollDescriptor);
  else delete Element.prototype.scrollIntoView;
});

// ---------- AC1 ----------

// Test case: Opens the coordinator dashboard; each changed field shows its current and requested value, and affected bookings are listed.
it('CR AC1 - the coordinator sees every requested change as Current vs Requested, with affected arrangements', async () => {
  open('/coordinator/dashboard');
  const attendance = await card('Community Workshop');
  // Empty, zero, false and list values are shown as recorded rather than hidden or invented.
  expect(rowValues(attendance, 'Expected attendance')).toEqual(['Not specified', '0']);
  expect(rowValues(attendance, 'Registration required')).toEqual(['No', 'Yes']);
  expect(rowValues(attendance, 'Accessibility needs')).toEqual(['None', 'Ramp, Hearing loop']);
  expect(rowValues(attendance, 'End time')).toEqual(['12:00:00', '12:30:00']);
  expect(within(attendance).getByText('Hall A: 150 expected guests exceed the venue capacity of 100.')).toBeTruthy();
  // A request with no affected bookings shows no warning.
  const rename = await card('Book Club');
  expect(rowValues(rename, 'Event name')).toEqual(['Book Club', 'Readers Club']);
  expect(within(rename).queryByText(/Existing arrangements to review/)).toBeNull();
  expect(within(inbox()).getByText('2 pending')).toBeTruthy();
  expect(within(rename).getByRole('link', { name: 'View confirmed event' }).getAttribute('href')).toBe('/events/102');
});

// Test case: The change-request list cannot be loaded; the coordinator sees why instead of an empty inbox.
it('CR AC1 - a failed inbox load is reported rather than shown as no requests', async () => {
  api.get.mockImplementation(async (path) => {
    if (path === '/auth/me') return { user };
    if (path === '/events/change-requests') throw new Error('Unable to load change requests.');
    return {};
  });
  open('/coordinator/dashboard');
  expect((await within(await screen.findByRole('region', { name: 'Amendment requests' })).findByRole('alert')).textContent).toBe('Unable to load change requests.');
  expect(screen.queryByText('No pending change requests.')).toBeNull();
});

// ---------- AC3 ----------

// Test case: Approves request 501; buttons lock while sending, then the card leaves the inbox and the coordinator sees who was notified.
it('CR AC3 - approving applies the change, removes it from the inbox and confirms who was notified', async () => {
  // Arrange
  let finish;
  api.post.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  open('/coordinator/dashboard');
  const attendance = await card('Community Workshop');
  // Act
  fireEvent.click(within(attendance).getByRole('button', { name: 'Approve and apply' }));
  // Assert: one decision in flight locks every decision button so a second decision cannot be sent.
  expect(api.post).toHaveBeenCalledWith('/events/change-requests/501/decision', { decision: 'approved' }, 'session-token');
  expect(within(attendance).getByRole('button', { name: 'Applying…' }).disabled).toBe(true);
  const otherApprove = within(await card('Book Club')).getByRole('button', { name: 'Approve and apply' });
  expect(otherApprove.disabled).toBe(true);
  fireEvent.click(otherApprove);
  await act(async () => finish({ message: 'Change approved and applied. Relevant staff have been notified.',
    notified: { organiser: [12], venueStaff: [41], technicalSupport: [61, 62] } }));
  expect(within(inbox()).getByRole('status').textContent)
    .toBe('Change approved and applied. Relevant staff have been notified. Notified: the organiser, Venue Staff (1), Technical Support (2).');
  expect(screen.queryByText('Community Workshop', { selector: 'strong' })).toBeNull();
  expect(within(inbox()).getByText('1 pending')).toBeTruthy();
  expect(api.post).toHaveBeenCalledOnce();
});

// Test case: Rejects request 502 with a reason; the reason is sent, the card leaves and only the organiser is reported notified.
it('CR AC3 - rejecting sends the optional reason and confirms the organiser was notified', async () => {
  api.post.mockResolvedValue({ message: 'Change request rejected. The organiser has been notified.',
    notified: { organiser: [12], venueStaff: [], technicalSupport: [] } });
  open('/coordinator/dashboard');
  const rename = await card('Book Club');
  fireEvent.click(within(rename).getByRole('button', { name: 'Reject' }));
  fireEvent.change(within(rename).getByLabelText('Reason for rejection (optional)'), { target: { value: 'The name is used by another event.' } });
  fireEvent.click(within(rename).getByRole('button', { name: 'Confirm rejection' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/events/change-requests/502/decision',
    { decision: 'rejected', reason: 'The name is used by another event.' }, 'session-token'));
  expect((await within(inbox()).findByRole('status')).textContent)
    .toBe('Change request rejected. The organiser has been notified. Notified: the organiser.');
  expect(screen.queryByText('Book Club', { selector: 'strong' })).toBeNull();
});

// Test case: Opens and cancels the rejection form; nothing is sent and the decision buttons return.
it('CR AC3 - cancelling a rejection sends nothing', async () => {
  open('/coordinator/dashboard');
  const rename = await card('Book Club');
  fireEvent.click(within(rename).getByRole('button', { name: 'Reject' }));
  fireEvent.change(within(rename).getByLabelText('Reason for rejection (optional)'), { target: { value: 'draft' } });
  fireEvent.click(within(rename).getByRole('button', { name: 'Cancel' }));
  expect(within(rename).getByRole('button', { name: 'Approve and apply' })).toBeTruthy();
  expect(api.post).not.toHaveBeenCalled();
});

// A 404/409 means the request was decided or reassigned elsewhere, so the inbox reloads; other failures keep the list as is.
it.each([[409, 'This change request has already been decided.', 2, false], [404, 'Change request not found.', 2, false], [500, 'Server unavailable', 1, true]])(
  'CR AC3 - a %s decision failure is shown and the inbox reloads only when the request changed elsewhere', async (status, message, loads, stillListed) => {
    api.post.mockRejectedValue(Object.assign(new Error(message), { status }));
    open('/coordinator/dashboard');
    const attendance = await card('Community Workshop');
    // The reloaded inbox reflects the server's current state (the request is gone).
    changeRequests = [renameRequest];
    fireEvent.click(within(attendance).getByRole('button', { name: 'Approve and apply' }));
    expect((await within(inbox()).findByRole('alert')).textContent).toBe(message);
    await waitFor(() => expect(api.get.mock.calls.filter(([path]) => path === '/events/change-requests')).toHaveLength(loads));
    // After a reload the decided request disappears; after a server error it stays so the coordinator can retry.
    await waitFor(() => expect(Boolean(screen.queryByText('Community Workshop', { selector: 'strong' }))).toBe(stillListed));
    expect(within(inbox()).queryByRole('status')).toBeNull();
  });

// ---------- AC2: notifications ----------

// CR AC2: the bell retains unread counts, trusted text previews and mark-read navigation.
it('CR AC2 - the coordinator opens a new change request notification through the bell', async () => {
  notificationsResponse = { unreadCount: 1, notifications: [
    { id: 3, event_id: 101, type: 'change_request_submitted', title: 'New change request: Community Workshop',
      message: 'Expected attendance: 80 → <b>150</b>', created_at: '2026-10-07T02:30:00.000Z', read_at: null },
  ] };
  api.post.mockResolvedValue({ notification: { id: 3, read_at: '2026-10-07T03:00:00.000Z' } });
  open('/coordinator/dashboard');
  const dropdown = await openNotifications();
  const unread = (await within(dropdown).findByText('New change request: Community Workshop')).closest('li');
  expect(within(unread).getByText('Expected attendance: 80 → <b>150</b>')).toBeTruthy();
  expect(unread.querySelector('b')).toBeNull();
  expect(within(unread).getByText('7 Oct 2026, 10:30 am')).toBeTruthy();

  fireEvent.click(within(unread).getByRole('button', { name: 'New change request: Community Workshop (new)' }));

  await waitFor(() => expect(screen.getByRole('button', { name: 'Notifications' })).toBeTruthy());
  expect(api.post).toHaveBeenCalledWith('/notifications/3/read', {}, 'session-token');
  expect(await card('Community Workshop')).toBeTruthy();
});

// CR AC2: a failed mark-read cannot drop the unread count or block navigation to the request.
it('CR AC2 - a failed mark-read keeps the bell unread count', async () => {
  notificationsResponse = { unreadCount: 1, notifications: [{ id: 3, type: 'change_request_submitted', title: 'New change request: Community Workshop', message: 'x', created_at: '2026-10-07T02:30:00.000Z', read_at: null }] };
  api.post.mockRejectedValue(new Error('Notification not found.'));
  open('/coordinator/dashboard');
  const dropdown = await openNotifications();
  fireEvent.click(await within(dropdown).findByRole('button', { name: 'New change request: Community Workshop (new)' }));
  await act(async () => {});
  expect(screen.getByRole('button', { name: 'Notifications, 1 unread' })).toBeTruthy();
  expect(await card('Community Workshop')).toBeTruthy();
});

// Test case: No notifications, a response missing the list (older API), and a load failure are distinguishable, and none raises an alert.
it.each([[{ notifications: [], unreadCount: 0 }, 'No notifications yet.'], [{}, 'No notifications yet.'], [null, 'Notifications could not be loaded right now.']])(
  'CR AC2 - an empty or unavailable notification list is stated plainly', async (response, text) => {
    api.get.mockImplementation(async (path) => {
      if (path === '/auth/me') return { user };
      if (path === '/notifications') { if (!response) throw new Error('offline'); return response; }
      return { changeRequests: [], events: [] };
    });
    open('/coordinator/dashboard');
    expect(await within(await openNotifications()).findByText(text)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeTruthy();
    expect(within(notificationDropdown()).queryByRole('alert')).toBeNull();
  });

// Organisers (outcomes), Venue Staff and Technical Support (changed details) see their own notifications on their dashboards.
it.each([
  ['event_organiser', '/organizer/dashboard', 'Change request approved: Community Workshop'],
  ['venue_staff', '/venue/dashboard', 'Event details changed: Community Workshop'],
  ['technical_support', '/tech-support/dashboard', 'Event details changed: Community Workshop'],
])('CR AC3 - %s sees notifications about processed change requests through the bell', async (role, path, title) => {
  user = { ...user, role, roles: [role] };
  notificationsResponse = { unreadCount: 1, notifications: [{ id: 7, title, message: 'Expected attendance: 80 → 150', created_at: '2026-10-07T02:30:00.000Z', read_at: null }] };
  open(path);
  expect(await within(await openNotifications()).findByText(title)).toBeTruthy();
  // Only coordinators get the review inbox.
  expect(screen.queryByRole('region', { name: 'Amendment requests' })).toBeNull();
});

// Test case: Slow responses must not be mistaken for "no change requests" or "no notifications" (a coordinator could
// otherwise conclude nothing was sent); counts appear only once the real data has loaded.
it('CR AC1/AC2 - while loading, the inbox and notifications say they are loading instead of reporting nothing', async () => {
  // Arrange: both lists stay pending until released.
  const pending = {};
  api.get.mockImplementation((path) => {
    if (path === '/auth/me') return Promise.resolve({ user });
    if (path === '/events/change-requests' || path === '/notifications') return new Promise((resolve) => { pending[path] = resolve; });
    return Promise.resolve({ events: [] });
  });
  open('/coordinator/dashboard');
  // Assert while pending: loading text, no empty-state claims and no counts.
  expect(await within(await screen.findByRole('region', { name: 'Amendment requests' })).findByText('Loading change requests...')).toBeTruthy();
  await openNotifications();
  expect(within(notificationDropdown()).getByText('Loading notifications...')).toBeTruthy();
  expect(screen.queryByText('No pending change requests.')).toBeNull();
  expect(screen.queryByText('No notifications yet.')).toBeNull();
  expect(screen.queryByText(/\d+ pending/)).toBeNull();
  expect(screen.queryByText(/\d+ unread/)).toBeNull();
  // Act: the data arrives.
  await act(async () => { pending['/events/change-requests']({ changeRequests: [renameRequest] }); pending['/notifications']({ notifications: [], unreadCount: 0 }); });
  // Assert: real content replaces the loading text.
  expect(within(inbox()).getByText('1 pending')).toBeTruthy();
  expect(within(inbox()).queryByText('Loading change requests...')).toBeNull();
  expect(within(notificationDropdown()).getByText('No notifications yet.')).toBeTruthy();
});

// Test case: The organiser's change removes every attachment; the coordinator sees the current file and "None" requested,
// not a blank cell or a broken link (structured attachments come from the merged request-workflow story).
it('CR AC1 - a change that removes all attachments shows None as the requested value', async () => {
  changeRequests = [{ ...renameRequest, requested_changes: { attachments: {} }, arrangements: [],
    changes: [{ field: 'attachments', label: 'Attachments', current: ['agenda.pdf'], requested: [] }] }];
  open('/coordinator/dashboard');
  const row = (await screen.findByRole('rowheader', { name: 'Attachments' })).closest('tr');
  expect(within(row).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['agenda.pdf', 'None']);
  expect(within(row).queryByRole('link')).toBeNull();
});
