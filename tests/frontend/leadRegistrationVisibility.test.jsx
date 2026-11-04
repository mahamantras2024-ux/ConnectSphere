import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../../frontend/src/App';
import { api } from '../../frontend/src/api/client';
import { useAuth } from '../../frontend/src/context/AuthContext';
vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../frontend/src/context/AuthContext', () => ({ useAuth: vi.fn() }));
let event;
const notice = { id: 1, event_id: 7, type: 'event_details_changed', title: 'Event details updated', message: 'The event status changed.',
  created_at: '2030-01-01T00:00:00Z', read_at: null };
beforeEach(() => {
  vi.resetAllMocks(); event = { id: 7, name: 'Workshop', status: 'confirmed', registration_required: true, is_draft: false,
    coordinator_id: 3, organiser_id: 2, clarification_requests: [], equipment_items: [] };
  useAuth.mockReturnValue({ token: 'lead', user: { id: 1, role: 'event_coordinator_lead' } });
  api.get.mockImplementation(async path => {
    if (path === '/events/7') return { event };
    if (path === '/notifications') return { notifications: [notice], unreadCount: 1 };
    if (path === '/events/7/decision') return { status: event.status, outcome: 'approved' };
    if (path === '/events/7/lead-registrations') return { event: { id: 7, name: 'Workshop' }, headcount: 1, waitlist_count: 0, withdrawal_count: 0,
      venue_capacity: 100, remaining_spots: 99, attendees: [{ id: 1, attendee_name: 'Private Ari', status: 'registered' }], waitlist: [] };
    if (path === '/events/assignments') return { events: [{ ...event, coordinator_name: 'Chris', organiser_name: 'Alex' }], coordinators: [] };
    return { history: [], requests: [], bookings: [], items: [] };
  });
  api.post.mockResolvedValue({ notification: { ...notice, read_at: '2030-01-02T00:00:00Z' } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
/** Keep the real route, event details, notification navigation and private report interactions. */
async function open(path = '/events/7') { render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>); await screen.findByRole('heading', { level: 1, name: 'Workshop' }); }
/** A real notification refreshes the already-open page without directly invoking its load effect. */
async function openNotice() {
  fireEvent.click(await screen.findByRole('button', { name: /^Notifications/ }));
  fireEvent.click(await screen.findByRole('button', { name: /^Event details updated/ }));
}

it.each(['submitted', 'under_review', 'approved', 'planning', 'confirmed', 'rejected'])('Lead UI AC3 - registration information is gated by active lifecycle status %s', async status => {
  // Arrange: these are the existing Lead API's active statuses; terminal/draft access remains server-owned.
  event = { ...event, status }; await open();
  // Assert: the report is neither offered early nor fetched merely because the event details loaded.
  expect(Boolean(screen.queryByRole('button', { name: 'Registration information' }))).toBe(status === 'confirmed');
  expect(api.get).not.toHaveBeenCalledWith('/events/7/lead-registrations', 'lead');
});

it.each([false, undefined])('Lead UI AC3 - a confirmed event with registration flag %s offers no attendee report', async flag => {
  // Arrange / Act: an omitted API field is contract degradation and must never be interpreted as permission to show attendees.
  event = { ...event, registration_required: flag }; await open();
  expect(screen.queryByRole('button', { name: 'Registration information' })).not.toBeInTheDocument();
  expect(api.get).not.toHaveBeenCalledWith('/events/7/lead-registrations', 'lead');
});

it('Lead UI AC3 - notification-driven confirmation and reopening update the report action without loading private data early', async () => {
  // Arrange: freeze only Date so notification navigation signals are deterministic while UI/network promises stay real.
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2030-01-02T00:00:00Z'));
  event = { ...event, status: 'planning' }; await open();
  expect(screen.queryByRole('button', { name: 'Registration information' })).not.toBeInTheDocument();
  // Act: replace the server snapshot rather than mutate the object held by React, then open the actual notification.
  event = { ...event, status: 'confirmed' }; await openNotice();
  fireEvent.click(await screen.findByRole('button', { name: 'Registration information' }));
  expect(await screen.findByText('Private Ari')).toBeVisible(); expect(api.get).toHaveBeenCalledWith('/events/7/lead-registrations', 'lead');
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  event = { ...event, status: 'planning' }; vi.setSystemTime(new Date('2030-01-02T00:00:00.001Z')); await openNotice();
  // Assert: renewed planning removes the action again instead of keeping the previously confirmed view.
  await screen.findByRole('heading', { level: 1, name: 'Workshop' });
  expect(screen.queryByRole('button', { name: 'Registration information' })).not.toBeInTheDocument(); expect(screen.queryByText('Private Ari')).not.toBeInTheDocument();
});

it('Lead UI AC4 - compact View details preserves the return to the Lead dashboard', async () => {
  // Arrange / Act: use the real card destination and return state rather than testing a standalone link string only.
  render(<MemoryRouter initialEntries={['/coordinator-lead/dashboard']}><App /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('link', { name: 'View details' })); await screen.findByRole('heading', { level: 1, name: 'Workshop' });
  fireEvent.click(screen.getByRole('link', { name: /Back to Events/ }));
  // Assert: a global coordinator dashboard destination would expose the wrong role and fail this route assertion.
  expect(await screen.findByRole('heading', { name: 'Coordinator Lead Dashboard' })).toBeVisible();
});
