import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../frontend/src/api/client';
import TechnicalSupportAssignment from '../../frontend/src/pages/coordinator/TechnicalSupportAssignment';
import OnSiteSupportSection from '../../frontend/src/pages/tech-support/OnSiteSupportSection';
import EventList from '../../frontend/src/pages/events/EventList';
import { useAuth } from '../../frontend/src/context/AuthContext';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), put: vi.fn() } }));
vi.mock('../../frontend/src/context/AuthContext', () => ({ useAuth: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const staff = [
  { id: 41, full_name: 'Taylor Support', email: 'taylor@example.com' },
  { id: 42, full_name: 'Morgan Support', email: 'morgan@example.com' },
];
const event = { id: 7, name: 'Community Workshop', technical_support_required: true, technical_support_staff: [staff[0]] };

// AC2: the coordinator can select multiple staff and persist the complete assignment.
it('AC2 - assigns one or more Technical Support Staff members', async () => {
  const onSaved = vi.fn();
  api.put.mockResolvedValue({ message: 'Saved' });
  render(<TechnicalSupportAssignment event={event} token="coordinator-token" staff={staff} onSaved={onSaved} />);

  fireEvent.click(screen.getByLabelText(/Morgan Support/));
  fireEvent.click(screen.getByRole('button', { name: 'Assign staff' }));

  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/events/7/technical-support-assignment',
    { staffIds: [41, 42] }, 'coordinator-token'));
  expect(onSaved).toHaveBeenCalledWith(staff);
  expect(screen.queryByText('taylor@example.com')).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByRole('button', { name: 'Assignment saved' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Change assignment' }));
  fireEvent.click(screen.getByLabelText(/Taylor Support/));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Assign staff' }).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Assign staff' }));
  await waitFor(() => expect(api.put).toHaveBeenLastCalledWith('/events/7/technical-support-assignment',
    { staffIds: [42] }, 'coordinator-token'));
});

// AC1: assigned staff see schedule, venue and all equipment facts in the operational view.
it('AC1 - displays assigned event date time venue and equipment', async () => {
  api.get.mockResolvedValue({
    events: [{
      id: 7, name: 'Community Workshop', proposed_date: '2026-10-12',
      proposed_start_time: '09:00:00', proposed_end_time: '12:00:00',
      venue_name: 'Innovation Hall', venue_location: 'Level 3',
      equipment_items: [{ item: 'Projector', quantity: 2 }],
    }],
  });
  render(<OnSiteSupportSection token="staff-token" />);

  const card = await screen.findByRole('article', { name: 'Community Workshop' });
  expect(within(card).getByText('12 October 2026')).toBeTruthy();
  expect(within(card).getByText('09:00 – 12:00')).toBeTruthy();
  expect(within(card).getByText('Innovation Hall · Level 3')).toBeTruthy();
  expect(within(card).getByText('Projector')).toBeTruthy();
  expect(within(card).getByText('Qty. 2')).toBeTruthy();
});

// AC3: a failed assignment is visible and does not claim that the team was saved.
it('AC3 - reports assignment changes that fail', async () => {
  api.put.mockRejectedValue(new Error('Assignment changed. Refresh and try again.'));
  render(<TechnicalSupportAssignment event={event} token="coordinator-token" staff={staff} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Assign staff' }));
  expect((await screen.findByRole('alert')).textContent.includes('Assignment changed. Refresh and try again.')).toBe(true);
});

// AC2: zero selected members cannot be saved, and a missing staff catalogue cannot invent choices.
it('AC2 - prevents empty assignment and explains when no staff are available', () => {
  const unassigned = { id: 7 };
  const view = render(<TechnicalSupportAssignment event={unassigned} token="coordinator" staff={[]} onSaved={vi.fn()} />);
  expect(screen.getByText('No Technical Support Staff are available.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Assign staff' })).toBeNull();
  view.rerender(<TechnicalSupportAssignment event={unassigned} token="coordinator" staff={staff} onSaved={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Assign staff' }).disabled).toBe(true);
  expect(screen.getByLabelText('Taylor Support').checked).toBe(false);
});

// AC1: distinguish loading from a successfully loaded empty assignment list.
it('AC1 - shows loading before an absent event list resolves to no assigned events', async () => {
  let finish;
  api.get.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<OnSiteSupportSection token="support" />);
  expect(screen.getByRole('status').textContent).toBe('Loading support assignments...');
  expect(screen.queryByText('No assigned events yet.')).toBeNull();
  await act(async () => finish({}));
  expect(screen.getByText('No assigned events yet.')).toBeTruthy();
  expect(screen.queryByRole('status')).toBeNull();
});

// AC1: a failed fetch must not claim the staff member has no assignments.
it('AC1 - shows an on-site assignment retrieval failure instead of an empty list', async () => {
  api.get.mockRejectedValue(new Error('Support assignments unavailable'));
  render(<OnSiteSupportSection token="support" />);
  expect((await screen.findByRole('alert')).textContent).toBe('Support assignments unavailable');
  expect(screen.queryByText('No assigned events yet.')).toBeNull();
});

// AC1: incomplete persisted facts are explicit; narrative equipment/support notes remain visible when no item list exists.
it('AC1 - displays sparse event fallbacks and narrative support preparation details', async () => {
  api.get.mockResolvedValue({ events: [{ id: 8 }, { id: 9, name: 'Briefing', status: 'approved',
    purpose: 'Prepare the team', equipment_items: [], equipment_notes: 'Bring a laptop', technical_support_details: 'Arrive early' }] });
  render(<OnSiteSupportSection token="support" />);
  const sparse = await screen.findByRole('article', { name: 'Untitled Event' });
  expect(within(sparse).getByText('Assigned')).toBeTruthy();
  expect(within(sparse).getByText('No purpose provided')).toBeTruthy();
  expect(within(sparse).getByText('Not specified')).toBeTruthy();
  expect(within(sparse).getByText('Not specified – Not specified')).toBeTruthy();
  expect(within(sparse).getByText('No equipment details provided.')).toBeTruthy();
  const briefing = screen.getByRole('article', { name: 'Briefing' });
  expect(within(briefing).getByText('approved')).toBeTruthy();
  expect(within(briefing).getByText('Prepare the team')).toBeTruthy();
  expect(within(briefing).getByText('Bring a laptop')).toBeTruthy();
  expect(within(briefing).getByText(/Arrive early/)).toBeTruthy();
});

// AC2: exercise the real event-card callback and preserve the other assigned event when the team is saved.
it('AC2 - saves a support assignment from its event card without replacing another event', async () => {
  useAuth.mockReturnValue({ token: 'coordinator', user: { role: 'event_coordinator' } });
  api.get.mockImplementation(async path => path === '/events' ? { events: [event, { id: 8, name: 'Other event' }] }
    : path === '/events/technical-support-staff' ? { staff } : {});
  api.put.mockResolvedValue({});
  render(<MemoryRouter><EventList dashboard /></MemoryRouter>);
  const card = await screen.findByRole('heading', { name: 'Community Workshop' });
  const scope = within(card.closest('article'));
  fireEvent.click(scope.getByLabelText('Taylor Support'));
  fireEvent.click(scope.getByLabelText('Morgan Support'));
  fireEvent.click(scope.getByRole('button', { name: 'Assign staff' }));
  await waitFor(() => expect(scope.getByRole('button', { name: 'Assignment saved' }).disabled).toBe(true));
  expect(api.put).toHaveBeenCalledWith('/events/7/technical-support-assignment', { staffIds: [42] }, 'coordinator');
  expect(scope.getByLabelText('Morgan Support').checked).toBe(true);
  expect(scope.getByLabelText('Taylor Support').checked).toBe(false);
  expect(screen.getByRole('heading', { name: 'Other event' })).toBeTruthy();
});

// AC3: assignment choices cannot be offered when loading the authorised staff list fails.
it('AC3 - reports staff catalogue errors on events needing support', async () => {
  useAuth.mockReturnValue({ token: 'coordinator', user: { role: 'event_coordinator' } });
  api.get.mockImplementation(async path => {
    if (path === '/events') return { events: [event] };
    if (path === '/events/technical-support-staff') throw new Error('Staff list unavailable');
    return {};
  });
  render(<MemoryRouter><EventList dashboard /></MemoryRouter>);
  expect((await screen.findByRole('alert')).textContent).toBe('Staff list unavailable');
  expect(screen.queryByRole('button', { name: 'Assign staff' })).toBeNull();
});
