// File: SCRUM-43 exercises the real staff queue, decision drawer and live coordinator notifications through the HTTP boundary.
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../frontend/src/context/AuthContext';
import VenueBookingInbox from '../../frontend/src/pages/venue/VenueBookingInbox';
import NotificationsPanel from '../../frontend/src/components/NotificationsPanel';
import useLiveResource from '../../frontend/src/hooks/useLiveResource';
import { api } from '../../frontend/src/api/client';
vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }));
const booking = { id: 20, venue_id: 7, venue_name: 'Hall A', event_name: 'Gala', expected_attendance: 100,
  room_layout_preference: 'Seminar', accessibility_requirements: ['Ramp'], start_datetime: '2031-10-20T02:00:00Z', end_datetime: '2031-10-20T03:00:00Z' };
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); localStorage.setItem('cs_token', 'staff-session');
  api.get.mockImplementation(async path => path === '/auth/me' ? { user: { id: 9, role: 'venue_staff' } }
    : path === '/venues/requests/pending' ? { requests: [booking] } : { notifications: [], unreadCount: 0 });
  api.put.mockResolvedValue({ request: { ...booking, status: 'tentative', hold_expires_at:'2099-01-01T00:00:00Z', decision_by: 9, updated_at: '2031-10-01T00:00:00Z' } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
/** Real authentication and drawer behavior are retained; test data enters only through API responses. */
function open() { return render(<AuthProvider><VenueBookingInbox /></AuthProvider>); }
it('SCRUM-43 AC1 AC2 AC7 - staff review requirements, approve and see persisted audit confirmation', async () => {
  open(); fireEvent.click(await screen.findByRole('button', { name: 'Review Gala at Hall A' }));
  const drawer = screen.getByRole('dialog', { name: 'Review venue booking request' });
  for (const text of ['Hall A', 'Gala', '100', 'Seminar', 'Ramp']) expect(within(drawer).getByText(text)).toBeVisible();
  expect(drawer).toHaveTextContent(/20 Oct 2031/); expect(drawer).toHaveTextContent(/10:00/);
  // SCRUM-107 AC1: staff choose an explicit deadline before granting a tentative approval.
  fireEvent.change(screen.getByLabelText('Hold expiry (Singapore time)'),{target:{value:'2099-01-01T08:00'}});
  fireEvent.click(within(drawer).getByRole('button', { name: 'Approve request' }));
  expect(await screen.findByRole('status')).toHaveTextContent(/Tentative hold approved/);
  expect(api.put).toHaveBeenCalledWith('/venues/7/requests/20/decision', { decision: 'approved', reason: '', holdExpiresAt:'2099-01-01T00:00:00.000Z' }, 'staff-session');
  expect(screen.getByRole('status')).toHaveTextContent(/9/);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Review Gala at Hall A'})).toBeVisible();
});
it.each(['Maintenance; try Hall B at 2pm.', ''])('SCRUM-43 AC3 AC4 - rejection accepts optional reason or alternative %j', async reason => {
  open(); fireEvent.click(await screen.findByRole('button', { name: 'Review Gala at Hall A' }));
  fireEvent.change(screen.getByLabelText('Reason or alternative arrangement (optional)'), { target: { value: reason } });
  api.put.mockResolvedValue({ request: { ...booking, status: 'rejected', decision_by: 9, updated_at: '2031-10-01T00:00:00Z' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reject request' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Rejected');
  expect(api.put).toHaveBeenCalledWith('/venues/7/requests/20/decision', { decision: 'rejected', reason }, 'staff-session');
});
it('SCRUM-43 AC1 AC2 AC3 - failed save preserves the review and notes for retry and prevents duplicate clicks', async () => {
  let fail; api.put.mockReturnValueOnce(new Promise((resolve, reject) => { fail = reject; }));
  open(); fireEvent.click(await screen.findByRole('button', { name: 'Review Gala at Hall A' }));
  fireEvent.change(screen.getByLabelText('Reason or alternative arrangement (optional)'), { target: { value: 'Try tomorrow' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reject request' }));
  expect(screen.getByRole('button', { name: 'Approve request' })).toBeDisabled();
  // Keep the submitting request in view until its outcome is known; closing cannot conceal a live write.
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  expect(screen.getByRole('dialog')).toBeVisible();
  await act(async () => fail(new Error('Request already decided; refresh the queue.')));
  expect(screen.getByRole('alert')).toHaveTextContent('Request already decided');
  expect(screen.getByLabelText('Reason or alternative arrangement (optional)')).toHaveValue('Try tomorrow');
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Review Gala at Hall A' })).toBeVisible();
});
it('SCRUM-43 AC1 - load failure is retryable and missing requirements are explicitly labelled', async () => {
  api.get.mockRejectedValueOnce(new Error('Queue offline'));
  // Render only the queue after real authentication has resolved, so the simulated failure targets the queue read.
  api.get.mockImplementation(async path => {
    if (path === '/auth/me') return { user: { id: 9, role: 'venue_staff' } };
    throw new Error('Queue offline');
  });
  open(); expect(await screen.findByRole('alert')).toHaveTextContent('Queue offline');
  api.get.mockResolvedValue({ requests: [{ ...booking, expected_attendance: null, room_layout_preference: '', accessibility_requirements: [] }] });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh requests' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Review Gala at Hall A' }));
  expect(screen.getAllByText('Not specified')).toHaveLength(2); expect(screen.getByText('None recorded')).toBeVisible();
});
it('SCRUM-43 AC5 - coordinator sees a new decision at 5000ms, with boundaries before and after and no manual reload', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  let notes = [];
  api.get.mockImplementation(async path => path === '/auth/me' ? { user: { id: 4, role: 'event_coordinator' } }
    : { notifications: notes, unreadCount: notes.length });
  render(<MemoryRouter><AuthProvider><NotificationsPanel /></AuthProvider></MemoryRouter>);
  await screen.findByText('No notifications yet.');
  notes = [{ id: 1, title: 'Venue booking rejected: Gala', message: 'Maintenance; try Hall B.', created_at: '2031-10-01T00:00:00Z', read_at: null }];
  await act(async () => { await vi.advanceTimersByTimeAsync(4999); });
  expect(screen.queryByText(notes[0].title)).not.toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(screen.getByText(notes[0].title)).toBeVisible(); expect(screen.getByText(notes[0].message)).toBeVisible();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(screen.getAllByText(notes[0].title)).toHaveLength(1);
});
it('SCRUM-43 AC5 - live refresh serializes slow reads, ignores stale reads after writes and removes listeners on unmount', async () => {
  vi.useFakeTimers(); let finish;
  api.get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const view = renderHook(() => useLiveResource('/notifications', 'session'));
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(api.get).toHaveBeenCalledTimes(1);
  act(() => view.result.current.updateData({ unreadCount: 0 }));
  await act(async () => finish({ unreadCount: 2 }));
  expect(view.result.current.data.unreadCount).toBe(0);
  api.get.mockResolvedValue({ unreadCount: 1 });
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(view.result.current.data.unreadCount).toBe(1);
  view.unmount(); const calls = api.get.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); window.dispatchEvent(new Event('focus')); });
  expect(api.get).toHaveBeenCalledTimes(calls);
});
it.each(['resolve', 'reject'])('SCRUM-43 AC1 AC5 - obsolete session %s cannot replace the current queue', async outcome => {
  let finish, fail;
  api.get.mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve; fail = reject; })).mockResolvedValue({ requests: [] });
  const view = renderHook(({ token }) => useLiveResource('/venues/requests/pending', token), { initialProps: { token: 'old' } });
  view.rerender({ token: 'new' }); await act(async () => {});
  await act(async () => { if (outcome === 'resolve') finish({ requests: [booking] }); else fail(new Error('Old error')); });
  expect(view.result.current.data).toEqual({ requests: [] }); expect(view.result.current.error).toBe('');
});

it('SCRUM-43 AC5 - a decision arriving just after a poll is shown by 10000ms and remains at 10001ms', async () => {
  vi.useFakeTimers(); let status = 'pending';
  api.get.mockImplementation(async () => ({ status }));
  const view = renderHook(() => useLiveResource('/notifications', 'session'));
  await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(5001); }); status = 'approved';
  await act(async () => { await vi.advanceTimersByTimeAsync(4998); });
  expect(view.result.current.data.status).toBe('pending');
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(view.result.current.data.status).toBe('approved');
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(view.result.current.data.status).toBe('approved');
});
it.each([401, 403, 404])('SCRUM-43 AC1 AC5 - access loss HTTP %s removes private snapshots', async status => {
  vi.useFakeTimers();
  api.get.mockResolvedValueOnce({ requests: [booking] }).mockRejectedValueOnce(Object.assign(new Error('Access lost'), { status }));
  const view = renderHook(() => useLiveResource('/venues/requests/pending', 'session'));
  await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(view.result.current.data).toBe(null); expect(view.result.current.error).toBe('Access lost');
});
it('SCRUM-43 AC5 - transient notification failure labels retained data and later refresh recovers', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  render(<MemoryRouter><AuthProvider><NotificationsPanel /></AuthProvider></MemoryRouter>);
  await screen.findByText('No notifications yet.');
  api.get.mockRejectedValueOnce(new Error('Network unavailable'));
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.getByText(/Showing the last loaded information/)).toBeVisible();
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.queryByText(/Showing the last loaded information/)).not.toBeInTheDocument();
});
it('SCRUM-43 AC5 - failed obsolete reads cannot undo a successful notification write', async () => {
  vi.useFakeTimers(); let fail;
  api.get.mockImplementation(() => new Promise((resolve, reject) => { fail = reject; }));
  const view = renderHook(() => useLiveResource('/notifications', 'session'));
  act(() => view.result.current.updateData({ unreadCount: 0 }));
  await act(async () => fail(new Error('Old read failed')));
  expect(view.result.current.error).toBe(''); expect(view.result.current.data.unreadCount).toBe(0);
});
it.each(['already read', 'access lost'])('SCRUM-43 AC5 - delayed mark-read response preserves the newer %s snapshot', async scenario => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const note = { id: 1, title: 'Venue approved', message: 'Gala', created_at: '2031-10-01T00:00:00Z', read_at: null };
  api.get.mockImplementation(async path => path === '/auth/me' ? { user: { id: 4, role: 'event_coordinator' } }
    : { notifications: [note, { ...note, id: 2, title: 'Earlier decision', read_at: '2031-10-01T00:00:00Z' }], unreadCount: 1 });
  let finish; api.post.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<MemoryRouter><AuthProvider><NotificationsPanel /></AuthProvider></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Mark Venue approved as read' }));
  if (scenario === 'already read') api.get.mockResolvedValue({ notifications: [{ ...note, read_at: '2031-10-01T00:00:00Z' }], unreadCount: 0 });
  else api.get.mockRejectedValue(Object.assign(new Error('Access lost'), { status: 403 }));
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  await act(async () => finish({ notification: { read_at: '2031-10-01T00:00:00Z' } }));
  expect(screen.getByText('0 unread')).toBeVisible();
  expect(screen.queryByText('-1 unread')).not.toBeInTheDocument();
  if (scenario === 'access lost') expect(screen.queryByText('Venue approved')).not.toBeInTheDocument();
});
it('SCRUM-43 AC1 AC2 - access loss closes an open review and a delayed decision cannot restore the private queue', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  let finish; api.put.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  open(); fireEvent.click(await screen.findByRole('button', { name: 'Review Gala at Hall A' }));
  fireEvent.change(screen.getByLabelText('Hold expiry (Singapore time)'),{target:{value:'2099-01-01T08:00'}});
  fireEvent.click(screen.getByRole('button', { name: 'Approve request' }));
  api.get.mockRejectedValue(Object.assign(new Error('Access lost'), { status: 403 }));
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await act(async () => finish({ request: { ...booking, status: 'tentative', hold_expires_at:'2099-01-01T00:00:00Z', decision_by: 9, updated_at: '2031-10-01T00:00:00Z' } }));
  expect(screen.queryByRole('button', { name: 'Review Gala at Hall A' })).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
