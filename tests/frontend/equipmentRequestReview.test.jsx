// File: Tests the Technical Support review workflow with real routing; only API calls are mocked.
// AC1 pending request information; AC2 all outcomes; AC3 reason requirement; AC4 save feedback; AC5 role guard.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../frontend/src/api/client';
import App from '../../frontend/src/App';
import { AuthProvider } from '../../frontend/src/context/AuthContext';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));

const supportUser = { id: 41, full_name: 'Taylor Support', email: 'staff@example.com', role: 'technical_support' };
const eventRequest = {
  id: 501, name: 'Community Workshop', proposed_date: '2030-10-15',
  proposed_start_time: '09:00:00', proposed_end_time: '12:00:00',
  venue_name: 'Innovation Hall', venue_location: 'Level 3',
  equipment_items: [{ item: 'Wireless microphone', quantity: 2 }, { item: 'Projector', quantity: 1 }],
  equipment_notes: 'Spare batteries', technical_support_required: true,
  technical_support_details: 'On-site AV technician', video_conferencing_required: true,
  technical_specifications: 'Zoom for remote participants', request_version: 1,
};

// Opens the protected dashboard and selects the review tab required by these cases.
async function openDashboard() {
  localStorage.setItem('cs_token', 'support-token');
  render(
    <MemoryRouter initialEntries={['/tech-support/dashboard']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider><App /></AuthProvider>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('tab', { name: 'Requests' }));
}

it('Navigation AC1 AC2 - places equipment tabs beside Dashboard and keeps their panels and keyboard controls', async () => {
  // Arrange the real authenticated application, including its shared navigation.
  await openDashboard();
  const navigation = screen.getByRole('navigation', { name: 'Main navigation' });
  const tabs = within(navigation).getByRole('tablist', { name: 'Technical Support dashboard sections' });
  expect(within(tabs).getAllByRole('tab').map(tab => tab.textContent)).toEqual([
    'Inventory', 'Requests', 'Reservations',
  ]);
  expect(within(navigation).getByRole('link', { name: 'Dashboard' }).nextElementSibling.contains(tabs)).toBe(true);
  expect(screen.getAllByRole('tablist', { name: 'Technical Support dashboard sections' })).toHaveLength(1);
  // Act/Assert: a header tab still controls the real workspace, including roving keyboard focus.
  const review = within(tabs).getByRole('tab', { name: 'Requests', selected: true });
  expect(screen.getByRole('tabpanel').id).toBe(review.getAttribute('aria-controls'));
  fireEvent.keyDown(review, { key: 'ArrowRight' });
  const reservation = within(tabs).getByRole('tab', { name: 'Reservations', selected: true });
  expect(document.activeElement).toBe(reservation);
  expect(screen.getByRole('tabpanel').id).toBe(reservation.getAttribute('aria-controls'));
  fireEvent.click(within(tabs).getByRole('tab', { name: 'Inventory' }));
  expect(screen.getByRole('tabpanel').id).toBe('support-panel-inventory');
});

it('Workspace AC1 AC2 - Dashboard and equipment sections show only their own content and active control', async () => {
  // Arrange the full workspace on Dashboard, rather than preselecting an equipment section.
  localStorage.setItem('cs_token', 'support-token');
  render(<MemoryRouter initialEntries={['/tech-support/dashboard']}><AuthProvider><App /></AuthProvider></MemoryRouter>);
  const dashboard = await screen.findByRole('link', { name: 'Dashboard' });
  await screen.findByRole('heading', { name: 'Assigned events' });
  expect(screen.getByRole('heading', { name: 'Notifications' })).toBeTruthy();
  expect(screen.queryByRole('tabpanel')).toBeNull();
  expect(dashboard.getAttribute('aria-current')).toBe('page');
  // Each selection must remove overview content and every other panel, rather than merely scroll to it.
  for (const [label, id, title] of [['Inventory','inventory','Equipment inventory'], ['Requests','review','Equipment request review'], ['Reservations','reservations','Equipment reservation']]) {
    fireEvent.click(screen.getByRole('tab', { name: label }));
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    expect(screen.getByRole('tabpanel').id).toBe(`support-panel-${id}`);
    // One page title is enough; queue headings should describe the work rather than repeat the section name.
    expect(screen.getAllByRole('heading', { name: title })).toHaveLength(1);
    expect(screen.queryByText('Manage equipment using the selected section below.')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Assigned events' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Notifications' })).toBeNull();
    expect(dashboard.getAttribute('aria-current')).not.toBe('page');
    expect(dashboard.classList.contains('active')).toBe(false);
  }
  // Dashboard restores the overview even when already on the same route.
  fireEvent.click(dashboard);
  expect(await screen.findByRole('heading', { name: 'Assigned events' })).toBeTruthy();
  expect(screen.queryByRole('tabpanel')).toBeNull();
  expect(screen.queryByRole('tab', { selected: true })).toBeNull();
  expect(dashboard.classList.contains('active')).toBe(true);
});

it.each(['inventory','review','reservations','unknown'])('Workspace AC3 - restores the section URL %s and safely falls back for an unknown section', async section => {
  // A refreshed or shared URL must select the same section; unknown values show Dashboard.
  localStorage.setItem('cs_token', 'support-token');
  render(<MemoryRouter initialEntries={[`/tech-support/dashboard?section=${section}`]}><AuthProvider><App /></AuthProvider></MemoryRouter>);
  if (section === 'unknown') {
    expect(await screen.findByRole('heading', { name: 'Assigned events' })).toBeTruthy();
    expect(screen.queryByRole('tabpanel')).toBeNull();
  } else {
    expect((await screen.findByRole('tabpanel')).id).toBe(`support-panel-${section}`);
    expect(screen.queryByRole('heading', { name: 'Assigned events' })).toBeNull();
  }
});

beforeEach(() => {
  localStorage.clear();
  let pendingRequest = eventRequest;
  let reservationRequest = null;
  api.get.mockImplementation(async path => {
    if (path === '/auth/me') return { user: supportUser };
    if (path === '/events/on-site-support') return { events: [] };
    if (path === '/events/equipment-requests') return { requests: pendingRequest ? [pendingRequest] : [] };
    if (path === '/events/equipment-inventory') return { inventory: [] };
    if (path === '/events/equipment-reservations') {
      return { requests: reservationRequest ? [reservationRequest] : [], reservations: [] };
    }
    if (path === '/events/equipment-reservation-issues') return { affectedReservations: [] };
    throw new Error(`Unexpected API route: ${path}`);
  });
  api.post.mockImplementation(async (path, body) => {
    if (path.endsWith('/equipment-reviews')) {
      pendingRequest = null;
      if (body.outcome === 'fully_fulfillable' || body.outcome === 'partially_fulfillable') {
        reservationRequest = {
          ...eventRequest,
          review_outcome: body.outcome,
          review_reason: body.reason || null,
        };
      }
    }
    return { review: { outcome: 'fully_fulfillable' }, message: 'Review saved.' };
  });
});
afterEach(cleanup);

// Arrange a pending event; Act load the dashboard; Assert all organiser-supplied details are shown.
it('AC1 - displays event timing, venue, equipment quantities, and technical requirements', async () => {
  await openDashboard();
  const card = await screen.findByRole('article', { name: 'Community Workshop' });

  expect(within(card).getByText('15 October 2030')).toBeTruthy();
  expect(within(card).getByText(/09:00.*12:00/)).toBeTruthy();
  expect(within(card).getByText('Innovation Hall')).toBeTruthy();
  expect(within(card).getByText(/Level 3/)).toBeTruthy();
  expect(within(card).getByText(/Wireless microphone — quantity: 2/)).toBeTruthy();
  expect(within(card).getByText(/Projector — quantity: 1/)).toBeTruthy();
  expect(within(card).getByText('Spare batteries')).toBeTruthy();
  expect(within(card).getByText('On-site AV technician')).toBeTruthy();
  expect(within(card).getAllByText('Yes')).toHaveLength(2);
  expect(within(card).getByText('Zoom for remote participants')).toBeTruthy();
  expect(api.get).toHaveBeenCalledWith('/events/equipment-requests', 'support-token');
});

// AC1 - missing date/time and notes use explicit fallbacks in the review card.
it('AC1 - displays review fallbacks for partial event details', async () => {
  api.get.mockImplementation(async path => {
    if (path === '/auth/me') return { user: supportUser };
    if (path === '/events/on-site-support') return { events: [] };
    if (path === '/events/equipment-requests') return {
      requests: [
        { ...eventRequest, proposed_date: null, proposed_start_time: '09:00:00', proposed_end_time: null, equipment_items: [], equipment_notes: 'Additional cable' },
        { ...eventRequest, id: 502, name: 'Evening Meetup', proposed_date: null, proposed_start_time: null, proposed_end_time: '12:00:00', equipment_items: [], equipment_notes: 'Additional cable' },
      ],
    };
    if (path === '/events/equipment-inventory') return { inventory: [] };
    if (path === '/events/equipment-reservations') return { requests: [], reservations: [] };
    throw new Error(`Unexpected API route: ${path}`);
  });
  await openDashboard();
  const card = await screen.findByRole('article', { name: 'Community Workshop' });
  expect(within(card).getByText('Not provided')).toBeTruthy();
  expect(within(card).getByText(/09:00.*Not provided/)).toBeTruthy();
  expect(within(card).getByText('Requested equipment')).toBeTruthy();
});

// AC2/AC3/AC4: submit each permitted decision and remove it from the pending queue on success.
it.each([
  ['fully fulfillable', 'fully_fulfillable', ''],
  ['partially fulfillable', 'partially_fulfillable', 'Only one microphone is available.'],
  ['not fulfillable', 'not_fulfillable', 'No technician is available.'],
])('AC2 AC3 AC4 - records a %s decision with the required reason', async (label, outcome, reason) => {
  await openDashboard();
  const card = await screen.findByRole('article', { name: 'Community Workshop' });
  fireEvent.change(within(card).getByLabelText('Fulfillment decision'), { target: { value: outcome } });
  const reasonInput = within(card).getByLabelText(/Reason/);
  if (reason) fireEvent.change(reasonInput, { target: { value: reason } });
  if (outcome !== 'fully_fulfillable') expect(reasonInput.required).toBe(true);
  // A partial decision names the affected item (Tracks Equipment Request Status AC3).
  if (outcome === 'partially_fulfillable') fireEvent.click(within(card).getByRole('checkbox', { name: /microphone/i }));

  fireEvent.click(within(card).getByRole('button', { name: 'Save review' }));
  expect(await screen.findByText('Review saved for Community Workshop.')).toBeTruthy();
  fireEvent.click(screen.getByRole('status'));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/events/501/equipment-reviews', {
    outcome, ...(reason ? { reason } : {}), requestVersion: 1,
    ...(outcome === 'partially_fulfillable' ? { affectedItems: [{ key: 'equipment:0' }] } : {}),
  }, 'support-token'));
  expect(screen.getByRole('tab', { name: 'Reservations', selected: true })).toBeTruthy();
  const reservationPanel = screen.getByRole('tabpanel', { name: 'Reservations' });
  if (outcome === 'fully_fulfillable' || outcome === 'partially_fulfillable') {
    expect(await within(reservationPanel).findByRole('article', { name: 'Community Workshop' })).toBeTruthy();
    expect(within(reservationPanel).getByText(`Review: ${outcome.replaceAll('_', ' ')}${reason ? ` — ${reason}` : ''}`)).toBeTruthy();
  } else {
    expect(within(reservationPanel).queryByRole('article', { name: 'Community Workshop' })).toBeNull();
  }
});

// AC3: a partial or unavailable choice cannot be persisted without a reason.
it.each([
  ['partially fulfillable', 'partially_fulfillable'],
  ['not fulfillable', 'not_fulfillable'],
])('AC3 - blocks a %s review when its reason is blank', async (label, outcome) => {
  await openDashboard();
  const card = await screen.findByRole('article', { name: 'Community Workshop' });
  fireEvent.change(within(card).getByLabelText('Fulfillment decision'), { target: { value: outcome } });
  fireEvent.submit(within(card).getByRole('button', { name: 'Save review' }).closest('form'));

  expect((await within(card).findByRole('alert')).textContent).toContain('Enter a reason for this decision.');
  expect(api.post).not.toHaveBeenCalled();
});

// AC1: missing fields are identified explicitly, including a missing item list.
it('AC1 - presents safe fallbacks for event requests with no recorded optional details', async () => {
  const sparseRequest = {
    ...eventRequest, id: 502, name: 'Unspecified Equipment Request',
    proposed_date: null, proposed_start_time: null, proposed_end_time: null,
    venue_name: null, venue_location: null, equipment_items: undefined, equipment_notes: null,
    technical_support_required: false, technical_support_details: null,
    video_conferencing_required: false, technical_specifications: null,
  };
  api.get.mockImplementation(async path => path === '/auth/me'
    ? { user: supportUser }
    : path === '/events/on-site-support' ? { events: [] }
      : path === '/events/equipment-requests' ? { requests: [sparseRequest] }
      : path === '/events/equipment-inventory' ? { inventory: [] }
        : { requests: [], reservations: [] });
  await openDashboard();
  const card = await screen.findByRole('article', { name: 'Unspecified Equipment Request' });

  expect(within(card).getAllByText('Not provided')).toHaveLength(4);
  expect(within(card).getByText('Not assigned')).toBeTruthy();
  expect(within(card).getByText(/Not provided – Not provided/)).toBeTruthy();
  expect(within(card).getByText('No individual equipment items requested.')).toBeTruthy();
  expect(within(card).getAllByText('No')).toHaveLength(2);
});

// AC2/AC3: staff must choose a decision before submission.
it('AC2 AC3 - requires a fulfillment choice before review submission', async () => {
  await openDashboard();
  const card = await screen.findByRole('article', { name: 'Community Workshop' });
  fireEvent.submit(within(card).getByRole('button', { name: 'Save review' }).closest('form'));

  expect((await within(card).findByRole('alert')).textContent).toContain('Select a fulfillment decision.');
  expect(api.post).not.toHaveBeenCalled();
});

// AC1: load failures are visible and staff can retry to an accurate empty queue.
it('AC1 - shows queue errors and permits retry', async () => {
  let queueFails = true;
  api.get.mockImplementation(async path => {
    if (path === '/auth/me') return { user: supportUser };
    if (path === '/events/on-site-support') return { events: [] };
    if (path === '/events/equipment-requests' && queueFails) {
      queueFails = false;
      throw new Error('The request queue is unavailable.');
    }
    if (path === '/events/equipment-requests') return { requests: [] };
    if (path === '/events/equipment-inventory') return { inventory: [] };
    return { requests: [], reservations: [] };
  });
  await openDashboard();

  expect((await screen.findByRole('alert')).textContent).toContain('The request queue is unavailable.');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh dashboard' }));
  expect(await screen.findByText('No pending equipment requests.')).toBeTruthy();
});

// AC1: a missing error message still produces a clear failed-load state.
it('AC1 - shows a fallback queue error when no error message is supplied', async () => {
  api.get.mockImplementation(async path => {
    if (path === '/auth/me') return { user: supportUser };
    if (path === '/events/on-site-support') return { events: [] };
    throw {};
  });
  await openDashboard();

  expect((await screen.findByRole('alert')).textContent).toBe('Unable to load equipment requests.');
});

// AC2/AC4: failed saves retain the pending request and report the API error.
it('AC2 AC4 - shows failed review saves without success feedback', async () => {
  api.post.mockRejectedValue(new Error('The request changed; refresh and try again.'));
  await openDashboard();
  const card = await screen.findByRole('article', { name: 'Community Workshop' });
  fireEvent.change(within(card).getByLabelText('Fulfillment decision'), { target: { value: 'fully_fulfillable' } });
  fireEvent.click(within(card).getByRole('button', { name: 'Save review' }));

  expect((await within(card).findByRole('alert')).textContent).toContain('The request changed; refresh and try again.');
  expect(within(card).getByRole('button', { name: 'Save review' })).toBeTruthy();
});

// AC2/AC4: the staff member can recover a useful message if a failed save has no error message.
it('AC2 AC4 - shows a fallback review error when no error message is supplied', async () => {
  api.post.mockRejectedValue({});
  await openDashboard();
  const card = await screen.findByRole('article', { name: 'Community Workshop' });
  fireEvent.change(within(card).getByLabelText('Fulfillment decision'), { target: { value: 'fully_fulfillable' } });
  fireEvent.click(within(card).getByRole('button', { name: 'Save review' }));

  expect((await within(card).findByRole('alert')).textContent).toBe('Unable to save this review.');
  expect(screen.getByRole('article', { name: 'Community Workshop' })).toBeTruthy();
});

// AC2/AC4: a pending API write disables repeated submission until its outcome is known.
it('AC2 AC4 - disables duplicate review submissions while saving', async () => {
  let finishSave;
  api.post.mockImplementation(() => new Promise(resolve => { finishSave = resolve; }));
  await openDashboard();
  const card = await screen.findByRole('article', { name: 'Community Workshop' });
  fireEvent.change(within(card).getByLabelText('Fulfillment decision'), { target: { value: 'fully_fulfillable' } });
  fireEvent.click(within(card).getByRole('button', { name: 'Save review' }));

  expect((await within(card).findByRole('button', { name: 'Saving review…' })).disabled).toBe(true);
  await act(async () => { finishSave({}); });
  expect(await screen.findByText('Review saved for Community Workshop.')).toBeTruthy();
});

// AC4 - Saving a review opens the reservation tab without a second navigation action.
it('AC4 - saves the review and immediately opens equipment reservation', async () => {
  await openDashboard();
  const card = await screen.findByRole('article', { name: 'Community Workshop' });
  fireEvent.change(within(card).getByLabelText('Fulfillment decision'), {
    target: { value: 'fully_fulfillable' },
  });

  expect(within(card).queryByRole('button', { name: 'Save review & go to equipment reservation' })).toBeNull();
  fireEvent.click(within(card).getByRole('button', { name: 'Save review' }));

  expect(await screen.findByRole('heading', { name: 'Reviewed requests' })).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'Reservations', selected: true })).toBeTruthy();
  expect(api.post).toHaveBeenCalledWith('/events/501/equipment-reviews', {
    outcome: 'fully_fulfillable',
    requestVersion: 1,
  }, 'support-token');
});

// AC5 - dashboard tabs support keyboard navigation and preserve the selected workspace.
it('AC5 - moves between support tabs with arrow, Home, and End keys', async () => {
  await openDashboard();
  const reviewTab = screen.getByRole('tab', { name: 'Requests' });
  fireEvent.keyDown(reviewTab, { key: 'PageDown' });
  fireEvent.keyDown(reviewTab, { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: 'Reservations', selected: true })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Reservations' }), { key: 'Home' });
  expect(screen.getByRole('tab', { name: 'Inventory', selected: true })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Inventory' }), { key: 'ArrowLeft' });
  expect(screen.getByRole('tab', { name: 'Reservations', selected: true })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Reservations' }), { key: 'End' });
  expect(screen.getByRole('tab', { name: 'Reservations', selected: true })).toBeTruthy();
});

// AC5 - the reservation empty state returns staff to the review queue.
it('AC5 - returns from the empty reservation state to equipment review', async () => {
  await openDashboard();
  fireEvent.click(screen.getByRole('tab', { name: 'Reservations' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Go to equipment request review' }));
  expect(screen.getByRole('tab', { name: 'Requests', selected: true })).toBeTruthy();
});

// AC1 - A failing section remains independently visible when each dashboard data request errors.
it('AC1 - reports inventory and reservation load errors in their respective tabs', async () => {
  api.get.mockImplementation(async path => {
    if (path === '/auth/me') return { user: supportUser };
    if (path === '/events/on-site-support') return { events: [] };
    if (path === '/events/equipment-requests') throw new Error('Request queue unavailable.');
    if (path === '/events/equipment-inventory') throw new Error('Catalogue unavailable.');
    if (path === '/events/equipment-reservations') throw new Error('Reservation list unavailable.');
    throw new Error(`Unexpected API route: ${path}`);
  });
  await openDashboard();
  expect((await screen.findByRole('alert')).textContent).toContain('Request queue unavailable.');

  fireEvent.click(screen.getByRole('tab', { name: 'Inventory' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Catalogue unavailable.');
  fireEvent.click(screen.getByRole('tab', { name: 'Reservations' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Reservation list unavailable.');
});

// AC1/accessibility: Arrow keys wrap, Home/End jump, and unrelated keys leave the current tab unchanged.
it('AC1 - navigates equipment tabs with the keyboard and returns from an empty reservation queue', async () => {
  await openDashboard();
  const review = screen.getByRole('tab', { name: 'Requests' });
  fireEvent.keyDown(review, { key: 'End' });
  expect(screen.getByRole('tab', { name: 'Reservations' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Reservations' }), { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: 'Inventory' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Inventory' }), { key: 'ArrowLeft' });
  expect(screen.getByRole('tab', { name: 'Reservations' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Reservations' }), { key: 'Home' });
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Inventory' }), { key: 'Escape' });
  expect(screen.getByRole('tab', { name: 'Inventory' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByRole('tab', { name: 'Reservations' }));
  fireEvent.click(screen.getByRole('button', { name: 'Go to equipment request review' }));
  expect(screen.getByRole('tab', { name: 'Requests' }).getAttribute('aria-selected')).toBe('true');
});
