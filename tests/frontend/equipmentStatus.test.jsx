// File: Tests Event Coordinator Tracks Equipment Request Status in the real app: the coordinator's status panel on the
// event page (AC1/AC3) and Technical Support naming the affected items of a partial review (AC3).
// Test scope: Real App routes, AuthProvider, EventDetail, the Technical Support dashboard and new components; only the
// API client is replaced.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../frontend/src/api/client';
import App from '../../frontend/src/App';
import { AuthProvider } from '../../frontend/src/context/AuthContext';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

let user;
let status;
const coordinator = { id: 30, email: 'chris@example.com', full_name: 'Chris', role: 'event_coordinator', roles: ['event_coordinator'] };
const support = { id: 41, email: 'taylor@example.com', full_name: 'Taylor', role: 'technical_support', roles: ['technical_support'] };
// A partial review of version 2 (2 of 4 microphones), after a full review of version 1, as the API returns it.
const partialView = {
  status: 'partially_available', version: 2,
  review: { outcome: 'partially_fulfillable', reason: 'Two microphones are under repair.', reviewedAt: '2030-01-02T03:00:00.000Z', reviewedBy: 'Taylor' },
  items: [
    { key: 'equipment:0', label: 'Microphone', quantity: 4, status: 'affected', availableQuantity: 2 },
    { key: 'equipment:1', label: 'Projector', quantity: 1, status: 'available', availableQuantity: null },
    { key: 'technical_support', label: 'On-site technical support', quantity: null, status: 'affected', availableQuantity: null },
  ],
  history: [{ version: 1, status: 'confirmed', outcome: 'fully_fulfillable', reason: null, reviewedAt: '2030-01-01T03:00:00.000Z', reviewedBy: 'Taylor', affectedCount: 0 }],
};
const pendingReplacement = {
  id: 71,
  status: 'pending',
  reason: 'Battery failed inspection',
  event_date: '2030-10-15',
  start_time: '09:00:00',
  quantity: 2,
  original_asset_code: 'MIC-001',
  original_name: 'Wireless Microphone',
  replacement_asset_code: 'MIC-002',
  replacement_name: 'Wireless Microphone 2',
};
// Technical Support's queue entry for the same kind of request (version 3).
const queued = { id: 501, name: 'Gala', proposed_date: '2030-10-15', proposed_start_time: '09:00:00', proposed_end_time: '12:00:00',
  venue_name: 'Hall A', venue_location: 'Level 1', equipment_items: [{ item: 'Microphone', quantity: 4 }], equipment_notes: null,
  technical_support_required: true, technical_support_details: 'AV tech', video_conferencing_required: false, technical_specifications: null, request_version: 3 };

// Renders the application at a route with a stored session token.
function open(path) {
  localStorage.setItem('cs_token', 'session-token');
  render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AuthProvider><App /></AuthProvider></MemoryRouter>);
}
const panel = () => screen.findByRole('region', { name: 'Equipment request status' });
const itemRows = (section) => within(within(section).getByRole('list', { name: 'Requested equipment and technical support' })).getAllByRole('listitem')
  .map((row) => [row.querySelector('strong').textContent, row.querySelector('span').textContent, row.className]);

beforeEach(() => {
  localStorage.clear();
  api.get.mockReset(); api.post.mockReset();
  user = coordinator; status = partialView;
  api.get.mockImplementation(async (path) => {
    if (path === '/auth/me') return { user };
    if (path === '/events/101') return { event: { id: 101, name: 'Gala', organiser_id: 12, coordinator_id: 30, status: 'submitted', clarification_outstanding: false, clarification_requests: [] } };
    if (path === '/events/101/equipment-status') return typeof status === 'function' ? status() : status;
    if (path === '/events/101/decision') return { status: 'submitted', outcome: null };
    if (path === '/events/equipment-requests') return { requests: [queued] };
    if (path === '/events/equipment-inventory') return { inventory: [] };
    if (path === '/events/equipment-reservations') return { requests: [], reservations: [] };
    if (path === '/notifications') return { notifications: [], unreadCount: 0 };
    throw new Error(`Unexpected request: ${path}`);
  });
});
afterEach(cleanup);

// ---------- Coordinator status panel ----------

// Test case: A partial review shows its status, who reviewed it and why, each item's status, the affected items and history.
it('ES AC1/AC3 - the coordinator sees a partially available request, which items are affected and earlier reviews', async () => {
  open('/events/101');
  const section = await panel();
  // AC1: the overall status and the review behind it.
  expect(await within(section).findByText('Partially available', { selector: '.status-badge' })).toBeTruthy();
  expect(within(section).getByText(/Reviewed by Taylor on 2 Jan 2030, 11:00 am\. Reason: Two microphones are under repair\./)).toBeTruthy();
  // AC3: each item's own status, with affected ones highlighted and quantified when known.
  expect(itemRows(section)).toEqual([
    ['Microphone × 4', 'Affected: 2 of 4 available', 'decision-unmet'],
    ['Projector × 1', 'Available', 'decision-met'],
    ['On-site technical support', 'Affected', 'decision-unmet'],
  ]);
  expect(within(section).getByRole('note').textContent).toBe('Arrange alternatives or inform the organiser: Microphone × 4, On-site technical support cannot be fully provided.');
  // Earlier versions remain visible.
  expect(within(within(section).getByRole('list', { name: 'Earlier reviews' })).getByRole('listitem').textContent)
    .toBe('Request version 1: Confirmed (1 Jan 2030, 11:00 am, Taylor)');
});

// AC3 - The assigned coordinator can accept a pending replacement and receives the updated reservation state.
it('ES AC3 - accepts a pending replacement suggestion', async () => {
  // Arrange
  status = { ...partialView, replacementSuggestions: [pendingReplacement] };
  api.post.mockImplementation(async () => {
    status = {
      ...status,
      replacementSuggestions: [{ ...pendingReplacement, status: 'accepted' }],
    };
    return { message: 'Replacement accepted and reservation updated.' };
  });
  open('/events/101');
  const section = await panel();

  // Act
  fireEvent.click(await within(section).findByRole('button', { name: 'Accept replacement' }));

  // Assert: the coordinator decision is sent for the correct event and the accepted outcome is visible.
  await waitFor(() => expect(api.post).toHaveBeenCalledWith(
    '/events/101/equipment-reservation-issues/71/decision',
    { outcome: 'accepted' },
    'session-token',
  ));
  expect(await within(section).findByText('Replacement accepted and reservation updated.')).toBeTruthy();
  expect(within(section).queryByRole('button', { name: 'Accept replacement' })).toBeNull();
});

// AC3 - The assigned coordinator can reject a pending replacement without hiding the follow-up state.
it('ES AC3 - rejects a pending replacement suggestion and sees staff follow-up', async () => {
  // Arrange
  status = { ...partialView, replacementSuggestions: [pendingReplacement] };
  api.post.mockImplementation(async () => {
    status = {
      ...status,
      replacementSuggestions: [{ ...pendingReplacement, status: 'rejected' }],
    };
    return { message: 'Replacement rejected. Technical Support has been asked to follow up.' };
  });
  open('/events/101');
  const section = await panel();

  // Act
  fireEvent.click(await within(section).findByRole('button', { name: 'Reject replacement' }));

  // Assert: rejection does not become acceptance and explicitly tells the coordinator that support will follow up.
  await waitFor(() => expect(api.post).toHaveBeenCalledWith(
    '/events/101/equipment-reservation-issues/71/decision',
    { outcome: 'rejected' },
    'session-token',
  ));
  expect(await within(section).findByText('Replacement rejected. Technical Support has been asked to follow up.')).toBeTruthy();
  expect(await within(section).findByText('Suggestion rejected. Technical Support will follow up.')).toBeTruthy();
});

// AC3 - An API decision failure is surfaced and does not convert the suggestion into a completed choice.
it('ES AC3 - shows an error when accepting a replacement fails', async () => {
  // Arrange
  status = { ...partialView, replacementSuggestions: [pendingReplacement] };
  api.post.mockRejectedValueOnce(new Error('The replacement is no longer available.'));
  open('/events/101');
  const section = await panel();

  // Act
  fireEvent.click(await within(section).findByRole('button', { name: 'Accept replacement' }));

  // Assert: a stale offer stays unresolved and its service error is visible.
  expect((await within(section).findByRole('alert')).textContent).toBe('The replacement is no longer available.');
  expect(within(section).getByRole('button', { name: 'Accept replacement' })).toBeTruthy();
});

// AC1: each status reads correctly, without an affected-items note.
it.each([
  ['pending', { review: null, items: [{ key: 'equipment:0', label: 'Microphone', quantity: 4, status: 'pending', availableQuantity: null }] }, 'Pending', 'Awaiting review', 'Waiting for Technical Support to review this request.'],
  ['confirmed', { review: { ...partialView.review, outcome: 'fully_fulfillable', reason: null, reviewedBy: null }, items: [{ key: 'equipment:0', label: 'Microphone', quantity: 4, status: 'available', availableQuantity: null }] },
    'Confirmed', 'Available', 'Reviewed by Technical Support on 2 Jan 2030, 11:00 am.'],
  ['unavailable', { review: { ...partialView.review, outcome: 'not_fulfillable', reason: 'No stock.' }, items: [{ key: 'equipment:0', label: 'Microphone', quantity: 4, status: 'unavailable', availableQuantity: null }] },
    'Unavailable', 'Unavailable', 'Reviewed by Taylor on 2 Jan 2030, 11:00 am. Reason: No stock.'],
])('ES AC1 - a %s request shows its status for the request and the item', async (key, changes, badge, itemText, reviewText) => {
  status = { ...partialView, status: key, history: [], ...changes };
  open('/events/101');
  const section = await panel();
  expect(await within(section).findByText(badge, { selector: '.status-badge' })).toBeTruthy();
  expect(itemRows(section)[0][1]).toBe(itemText);
  expect(within(section).getByText(reviewText)).toBeTruthy();
  expect(within(section).queryByRole('note')).toBeNull();
  expect(within(section).queryByText(/Earlier reviews/)).toBeNull();
});

// Test case: An affected item without a known quantity, and an earlier partial review, read naturally.
it('ES AC3 - an earlier partial review shows how many items were affected and why', async () => {
  status = { ...partialView, history: [{ version: 1, status: 'partially_available', outcome: 'partially_fulfillable', reason: 'Short of cables', reviewedAt: '2030-01-01T03:00:00.000Z', reviewedBy: null, affectedCount: 2 }] };
  open('/events/101');
  const section = await panel();
  expect(within(await within(section).findByRole('list', { name: 'Earlier reviews' })).getByRole('listitem').textContent)
    .toBe('Request version 1: Partially available (1 Jan 2030, 11:00 am), 2 item(s) affected - Short of cables');
});

// Test case: A partial review from before affected items were tracked says so, instead of listing items as available.
it('ES AC3 - an older partial review without affected items shows them as not recorded and explains why', async () => {
  status = { ...partialView, history: [], items: partialView.items.map((item) => ({ ...item, status: 'not_recorded', availableQuantity: null })) };
  open('/events/101');
  const section = await panel();
  expect(await within(section).findByText('Partially available', { selector: '.status-badge' })).toBeTruthy();
  expect(itemRows(section)).toEqual([
    ['Microphone × 4', 'Not recorded', 'decision-unmet'], ['Projector × 1', 'Not recorded', 'decision-unmet'], ['On-site technical support', 'Not recorded', 'decision-unmet'],
  ]);
  expect(within(section).getByRole('note').textContent).toBe('This review was recorded before affected items were tracked, so it does not say which items are affected. Use the reason above or ask Technical Support.');
});

// Test case: Nothing technical requested is stated plainly.
it('ES AC1 - an event without equipment requests says none were requested', async () => {
  status = { status: 'not_requested', version: 1, review: null, items: [], history: [] };
  open('/events/101');
  const section = await panel();
  expect(await within(section).findByText('The organiser has not requested any equipment or technical support.')).toBeTruthy();
  expect(within(section).getByText('No equipment requested', { selector: '.status-badge' })).toBeTruthy();
});

// Panel states: loading, a failed load and an unusable response never break the event page.
it('ES AC1 - the panel distinguishes loading, a failed load and an unusable response', async () => {
  let release;
  status = () => new Promise((resolve) => { release = resolve; });
  open('/events/101');
  const section = await panel();
  expect(within(section).getByText('Loading equipment request status...')).toBeTruthy();
  release(partialView);
  expect(await within(section).findByText('Partially available', { selector: '.status-badge' })).toBeTruthy();
  cleanup();
  status = () => { throw new Error('Unable to load equipment status.'); };
  open('/events/101');
  expect(await within(await panel()).findByText('Unable to load equipment status.')).toBeTruthy();
  expect(within(await panel()).queryByRole('alert')).toBeNull();
  cleanup();
  status = { status: 'mystery', items: [], history: [] };
  open('/events/101');
  expect(await within(await panel()).findByText('Equipment request status is unavailable right now.')).toBeTruthy();
});

// Test case: Only the Event Coordinator gets the panel; the organiser never requests it.
it('ES AC1 - an organiser viewing the event does not see the equipment request status panel', async () => {
  user = { id: 12, full_name: 'Olivia', role: 'event_organiser', roles: ['event_organiser'] };
  open('/events/101');
  await screen.findByText('Gala', { selector: 'h1' });
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/events/101', 'session-token'));
  expect(screen.queryByRole('region', { name: 'Equipment request status' })).toBeNull();
  expect(api.get.mock.calls.some(([path]) => path === '/events/101/equipment-status')).toBe(false);
});

// ---------- Technical Support names the affected items ----------

// Opens Technical Support's review tab and returns the Gala request card.
async function openReviewCard() {
  user = support;
  open('/tech-support/dashboard');
  fireEvent.click(await screen.findByRole('tab', { name: 'Equipment request review' }));
  return screen.findByRole('article', { name: 'Gala' });
}
const choose = (card, outcome, reason) => {
  fireEvent.change(within(card).getByLabelText('Fulfillment decision'), { target: { value: outcome } });
  if (reason) fireEvent.change(within(card).getByLabelText(/Reason/), { target: { value: reason } });
};

// Test case: The affected-item choices appear only for a partial decision, one per requested item.
it('ES AC3 - Technical Support is offered the requested items to mark as affected only for a partial decision', async () => {
  const card = await openReviewCard();
  choose(card, 'not_fulfillable');
  expect(within(card).queryByRole('group', { name: /Affected items/ })).toBeNull();
  choose(card, 'partially_fulfillable');
  const group = within(card).getByRole('group', { name: 'Affected items (choose what cannot be fully provided)' });
  expect(within(group).getAllByRole('checkbox').map((box) => box.closest('label').textContent)).toEqual(['Microphone × 4', 'On-site technical support']);
  // A quantity can only be given for counted equipment, once it is ticked.
  expect(within(group).queryByLabelText('Can provide (optional)')).toBeNull();
  fireEvent.click(within(group).getByRole('checkbox', { name: 'On-site technical support' }));
  expect(within(group).queryByLabelText('Can provide (optional)')).toBeNull();
});

// Test case: A partial decision with no item ticked is explained and not sent.
it('ES AC3 - a partial decision without an affected item is not sent', async () => {
  const card = await openReviewCard();
  choose(card, 'partially_fulfillable', 'Two are under repair.');
  fireEvent.click(within(card).getByRole('button', { name: 'Save review' }));
  expect(within(card).getByRole('alert').textContent).toBe('Choose which requested items cannot be fully provided.');
  expect(api.post).not.toHaveBeenCalled();
});

// Available quantity for 4 microphones: 4 (all) is refused, 3 is accepted; unticking removes the item.
it('ES AC3 - the available quantity must be fewer than requested, and the ticked items are sent exactly', async () => {
  api.post.mockResolvedValue({ review: {}, message: 'Review saved.' });
  const card = await openReviewCard();
  choose(card, 'partially_fulfillable', 'Two are under repair.');
  const group = within(card).getByRole('group', { name: /Affected items/ });
  fireEvent.click(within(group).getByRole('checkbox', { name: 'Microphone × 4' }));
  fireEvent.change(within(group).getByLabelText('Can provide (optional)'), { target: { value: '4' } });
  fireEvent.click(within(card).getByRole('button', { name: 'Save review' }));
  expect(within(card).getByRole('alert').textContent).toBe('Available quantity for Microphone must be a whole number from 0 to 3.');
  expect(api.post).not.toHaveBeenCalled();
  // Correct the quantity; tick and untick on-site support so only the microphone is sent.
  fireEvent.change(within(group).getByLabelText('Can provide (optional)'), { target: { value: '3' } });
  fireEvent.click(within(group).getByRole('checkbox', { name: 'On-site technical support' }));
  fireEvent.click(within(group).getByRole('checkbox', { name: 'On-site technical support' }));
  fireEvent.click(within(card).getByRole('button', { name: 'Save review' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/events/501/equipment-reviews', {
    outcome: 'partially_fulfillable', reason: 'Two are under repair.', requestVersion: 3, affectedItems: [{ key: 'equipment:0', availableQuantity: 3 }],
  }, 'session-token'));
});
// Test case: Text that is not a whole number is refused (the number field can still hold it while typing).
it('ES AC3 - a non-numeric available quantity is refused', async () => {
  const card = await openReviewCard();
  choose(card, 'partially_fulfillable', 'Short.');
  const group = within(card).getByRole('group', { name: /Affected items/ });
  fireEvent.click(within(group).getByRole('checkbox', { name: 'Microphone × 4' }));
  fireEvent.change(within(group).getByLabelText('Can provide (optional)'), { target: { value: '1.5' } });
  fireEvent.click(within(card).getByRole('button', { name: 'Save review' }));
  expect(within(card).getByRole('alert').textContent).toBe('Available quantity for Microphone must be a whole number from 0 to 3.');
  expect(api.post).not.toHaveBeenCalled();
});
