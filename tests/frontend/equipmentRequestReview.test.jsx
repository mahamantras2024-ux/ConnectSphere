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
  fireEvent.click(await screen.findByRole('tab', { name: 'Equipment request review' }));
}

beforeEach(() => {
  localStorage.clear();
  let pendingRequest = eventRequest;
  api.get.mockImplementation(async path => {
    if (path === '/auth/me') return { user: supportUser };
    if (path === '/events/equipment-requests') return { requests: pendingRequest ? [pendingRequest] : [] };
    if (path === '/events/equipment-inventory') return { inventory: [] };
    if (path === '/events/equipment-reservations') return { requests: [], reservations: [] };
    throw new Error(`Unexpected API route: ${path}`);
  });
  api.post.mockImplementation(async path => {
    if (path.endsWith('/equipment-reviews')) pendingRequest = null;
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

  fireEvent.click(within(card).getByRole('button', { name: 'Save review' }));
  expect(await screen.findByText('Review saved for Community Workshop.')).toBeTruthy();
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/events/501/equipment-reviews', {
    outcome, ...(reason ? { reason } : {}), requestVersion: 1,
  }, 'support-token'));
  expect(screen.queryByRole('article', { name: 'Community Workshop' })).toBeNull();
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

// AC4 - The review shortcut takes staff directly to the reservation tab after the audit write succeeds.
it('AC4 - saves the review and opens equipment reservation', async () => {
  await openDashboard();
  const card = await screen.findByRole('article', { name: 'Community Workshop' });
  fireEvent.change(within(card).getByLabelText('Fulfillment decision'), {
    target: { value: 'fully_fulfillable' },
  });
  fireEvent.click(within(card).getByRole('button', { name: 'Save review & go to equipment reservation' }));

  expect(await screen.findByRole('heading', { name: 'Equipment availability and reservation' })).toBeTruthy();
  expect(api.post).toHaveBeenCalledWith('/events/501/equipment-reviews', {
    outcome: 'fully_fulfillable',
    requestVersion: 1,
  }, 'support-token');
});

// AC1 - A failing section remains independently visible when each dashboard data request errors.
it('AC1 - reports inventory and reservation load errors in their respective tabs', async () => {
  api.get.mockImplementation(async path => {
    if (path === '/auth/me') return { user: supportUser };
    if (path === '/events/equipment-requests') throw new Error('Request queue unavailable.');
    if (path === '/events/equipment-inventory') throw new Error('Catalogue unavailable.');
    if (path === '/events/equipment-reservations') throw new Error('Reservation list unavailable.');
    throw new Error(`Unexpected API route: ${path}`);
  });
  await openDashboard();
  expect((await screen.findByRole('alert')).textContent).toContain('Request queue unavailable.');

  fireEvent.click(screen.getByRole('tab', { name: 'Equipment info' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Catalogue unavailable.');
  fireEvent.click(screen.getByRole('tab', { name: 'Equipment reservation' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Reservation list unavailable.');
});
