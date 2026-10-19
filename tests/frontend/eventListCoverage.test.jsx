import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../frontend/src/api/client';
import { useAuth } from '../../frontend/src/context/AuthContext';
import EventList from '../../frontend/src/pages/events/EventList';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), put: vi.fn() } }));
vi.mock('../../frontend/src/context/AuthContext', () => ({ useAuth: vi.fn() }));

afterEach(cleanup);

const supportStaff = [
  { id: 41, full_name: 'Taylor Support' },
  { id: 42, full_name: 'Morgan Support' },
];

// Resets each case to a coordinator session and predictable network responses.
beforeEach(() => {
  useAuth.mockReturnValue({ token: 'coordinator-token', user: { role: 'event_coordinator' } });
  api.get.mockReset();
  api.put.mockReset();
  api.put.mockResolvedValue({ message: 'Saved' });
  api.get.mockImplementation(async path => {
    if (path === '/events') return { events: [] };
    if (path === '/events/technical-support-staff') return { staff: supportStaff };
    if (path === '/events/change-requests') return { changeRequests: [] };
    if (path === '/notifications') return { notifications: [], unreadCount: 0 };
    return {};
  });
});

// Provides router context so the event-detail and request links remain real and usable.
function renderEventList(props = {}) {
  return render(<MemoryRouter><EventList {...props} /></MemoryRouter>);
}

// Coordinator view 1 / Technical Support assignment AC2: dashboard event cards permit assigning the fetched staff team.
it('Coordinator view 1 / Technical Support AC2 - loads events and saves a dashboard assignment', async () => {
  const event = {
    id: 7,
    name: 'Community Workshop',
    purpose: 'Share local projects',
    status: 'under_review',
    clarification_outstanding: true,
    technical_support_required: true,
    technical_support_staff: [supportStaff[0]],
  };
  const unrelatedEvent = { id: 8, name: 'Other event', technical_support_required: false };
  api.get.mockImplementation(async path => {
    if (path === '/events') return { events: [event, unrelatedEvent] };
    if (path === '/events/technical-support-staff') return { staff: supportStaff };
    if (path === '/events/change-requests') return { changeRequests: [] };
    if (path === '/notifications') return { notifications: [], unreadCount: 0 };
    return {};
  });

  renderEventList({ dashboard: true });

  expect(await screen.findByRole('heading', { name: 'Event Coordinator Dashboard' })).toBeTruthy();
  const eventHeading = await screen.findByRole('heading', { name: 'Community Workshop' });
  const card = eventHeading.closest('article');
  expect(card).not.toBeNull();
  expect(within(card).getByRole('heading', { name: 'Community Workshop' })).toBeTruthy();
  expect(within(card).getByText('under review')).toBeTruthy();
  expect(within(card).getByText('Clarification outstanding')).toBeTruthy();
  expect(within(card).getByRole('link', { name: /View details/ }).getAttribute('href')).toBe('/events/7');

  fireEvent.click(within(card).getByLabelText('Morgan Support'));
  fireEvent.click(within(card).getByRole('button', { name: 'Assign staff' }));

  await waitFor(() => expect(api.put).toHaveBeenCalledWith(
    '/events/7/technical-support-assignment',
    { staffIds: [41, 42] },
    'coordinator-token',
  ));
  expect(await within(card).findByRole('button', { name: 'Assignment saved' })).toBeTruthy();
  expect(within(card).getByLabelText('Taylor Support').checked).toBe(true);
  expect(within(card).getByLabelText('Morgan Support').checked).toBe(true);
  expect(screen.getByRole('heading', { name: 'Other event' })).toBeTruthy();
});

// Coordinator view 1 / AC1: the list distinguishes pending, empty, and failed event retrieval.
it('Coordinator view 1 AC1 - shows loading and the empty state when no events are returned', async () => {
  let resolveEvents;
  api.get.mockImplementation(path => path === '/events'
    ? new Promise(resolve => { resolveEvents = resolve; })
    : Promise.resolve({}));

  renderEventList();

  expect(screen.getByRole('status').textContent).toBe('Loading events...');
  resolveEvents({});

  expect(await screen.findByRole('heading', { name: 'No assigned events yet.' })).toBeTruthy();
  expect(screen.getByText('0 events')).toBeTruthy();
  expect(api.get).not.toHaveBeenCalledWith('/events/technical-support-staff', 'coordinator-token');
});

// Coordinator view 1 / AC1: an API failure must not be presented as a valid empty event list.
it('Coordinator view 1 AC1 - reports event retrieval failures without showing the empty state', async () => {
  api.get.mockImplementation(async path => {
    if (path === '/events') throw new Error('Events are unavailable.');
    return {};
  });

  renderEventList();

  expect((await screen.findByRole('alert')).textContent).toBe('Events are unavailable.');
  expect(screen.queryByRole('heading', { name: 'No assigned events yet.' })).toBeNull();
});

// Coordinator view 1 / AC1: support assignment controls belong only on the coordinator dashboard.
it('Coordinator view 1 AC1 - keeps support assignment controls off the event list page', async () => {
  api.get.mockImplementation(async path => path === '/events'
    ? { events: [{ id: 11, name: 'Workshop', technical_support_required: true }] }
    : {});

  renderEventList();

  expect(await screen.findByRole('heading', { name: 'Workshop' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Assign staff' })).toBeNull();
  expect(api.get).not.toHaveBeenCalledWith('/events/technical-support-staff', 'coordinator-token');
});

// Coordinator view 1 / AC1: support-staff failure stays scoped to required events without hiding the event itself.
it('Coordinator view 1 AC1 - reports staff lookup failure and renders optional event fallbacks', async () => {
  api.get.mockImplementation(async path => {
    if (path === '/events') return { events: [
      { id: 8, name: '', purpose: '', technical_support_required: true },
      { id: 9, name: 'No support needed', technical_support_required: false },
    ] };
    if (path === '/events/technical-support-staff') throw new Error('Support staff are unavailable.');
    if (path === '/events/change-requests') return { changeRequests: [] };
    if (path === '/notifications') return { notifications: [], unreadCount: 0 };
    return {};
  });

  renderEventList({ dashboard: true });

  const unnamedEventHeading = await screen.findByRole('heading', { name: 'Untitled Event' });
  const unnamedEvent = unnamedEventHeading.closest('article');
  expect(unnamedEvent).not.toBeNull();
  expect(within(unnamedEvent).getByText('No purpose provided')).toBeTruthy();
  expect(within(unnamedEvent).getByText('Draft')).toBeTruthy();
  expect(within(unnamedEvent).getByText('Support staff are unavailable.')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'No support needed' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Assign staff' })).toBeNull();
});

// Technical Support assignment AC2: an absent staff array behaves like no available staff, not a broken event list.
it('Technical Support AC2 - handles a staff response without a staff list', async () => {
  api.get.mockImplementation(async path => {
    if (path === '/events') return {
      events: [{ id: 10, name: 'Workshop', technical_support_required: true }],
    };
    if (path === '/events/technical-support-staff') return {};
    if (path === '/events/change-requests') return { changeRequests: [] };
    if (path === '/notifications') return { notifications: [], unreadCount: 0 };
    return {};
  });

  renderEventList({ dashboard: true });

  expect(await screen.findByText('No Technical Support Staff are available.')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

// Organiser view 1 / AC1: organisers retain their workspace and never fetch coordinator support assignments.
it('Organiser view 1 AC1 - renders the personal list and dashboard without requesting support staff', async () => {
  useAuth.mockReturnValue({ token: 'organiser-token', user: { role: 'event_organiser' } });
  api.get.mockImplementation(async path => path === '/events' ? { events: [] } : {});

  const { rerender } = renderEventList();

  expect(await screen.findByRole('heading', { name: 'My Events' })).toBeTruthy();
  expect(screen.getByRole('link', { name: /Request an event/ }).getAttribute('href')).toBe('/organizer/events/new');
  expect(screen.getByRole('region', { name: 'Drafts' })).toBeTruthy();
  expect(api.get).not.toHaveBeenCalledWith('/events/technical-support-staff', 'organiser-token');

  rerender(<MemoryRouter><EventList dashboard /></MemoryRouter>);

  expect(await screen.findByRole('heading', { name: 'Event Organiser Dashboard' })).toBeTruthy();
  expect(screen.getByRole('link', { name: /Request an event/ })).toBeTruthy();
  expect(api.get).not.toHaveBeenCalledWith('/events/technical-support-staff', 'organiser-token');
});
