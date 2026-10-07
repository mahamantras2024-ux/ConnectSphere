// File: Tests the Specify Equipment & Technical Support Requirements story through real routing, forms and event details.
// Test scope: Real App routes, AuthProvider, EventForm, EventDetail and EventList; only the API client is replaced.
// AC1 items/quantities/support needs; AC2 special technical specifications; AC3 updates before confirmation; AC4 confirmation message.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../frontend/src/api/client';
import App from '../../frontend/src/App';
import { AuthProvider } from '../../frontend/src/context/AuthContext';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));

let user;
let event;
// Event as stored before Technical Support confirms anything.
const baseEvent = { id: 101, name: 'Community Workshop', organiser_id: 12, coordinator_id: 30, status: 'submitted',
  proposed_date: '2026-10-15', equipment_notes: 'Spare batteries please',
  equipment_items: [{ item: 'Wireless microphone', quantity: 2 }, { item: 'Projector', quantity: 1 }],
  technical_support_required: true, technical_support_details: 'AV technician 09:00-12:00',
  video_conferencing_required: true, technical_specifications: 'Zoom for 50 remote participants', equipment_confirmed: false };

// Renders the application at a route with a stored session token.
function open(path) {
  localStorage.setItem('cs_token', 'organiser-token');
  render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AuthProvider><App /></AuthProvider></MemoryRouter>);
}
// Returns the event-detail equipment section so assertions cannot match the same text elsewhere on the page.
const equipmentSection = () => screen.getByRole('region', { name: 'Equipment & Technical Support' });
// Opens the new-request form and fills the required event name.
async function openNewRequest() {
  open('/organizer/events/new');
  fireEvent.change(await screen.findByLabelText('Event name'), { target: { value: 'Community Workshop' } });
}
// Adds an equipment row on the new-request form and fills its item and quantity.
function addItem(item, quantity) {
  fireEvent.click(screen.getByRole('button', { name: 'Add equipment item' }));
  const rows = screen.getAllByLabelText(/^Equipment item \d+$/);
  const index = rows.length;
  fireEvent.change(rows[index - 1], { target: { value: item } });
  fireEvent.change(screen.getByLabelText(`Quantity for item ${index}`), { target: { value: quantity } });
}

beforeEach(() => {
  localStorage.clear();
  user = { id: 12, email: 'alice@example.com', full_name: 'Alice', role: 'event_organiser' };
  event = { ...baseEvent };
  api.get.mockImplementation(async (path) => {
    if (path === '/auth/me') return { user };
    if (path === '/events') return { events: [event] };
    if (path === '/events/change-requests') return { changeRequests: [] };
    if (path === '/events/101') return { event };
    throw new Error('Event not found.');
  });
  api.post.mockResolvedValue({ event: { id: 101 }, message: 'Event request submitted.' });
});
afterEach(cleanup);

// Test case: Adds three items, removes the middle one and submits; the request carries exactly the remaining items in order.
it('EQ AC1/AC4 - organiser specifies items and quantities, removed rows are not sent, and submission is confirmed', async () => {
  // Arrange
  await openNewRequest();
  // All equipment information, including the free-text notes, is entered in one section of the form.
  expect(within(screen.getByRole('group', { name: 'Equipment & technical support' })).getByLabelText('Other equipment notes')).toBeTruthy();
  addItem('Wireless microphone', '2');
  addItem('Flip chart', '3');
  addItem('Projector', '1');
  // Act: remove row 2 (Flip chart) then submit.
  fireEvent.click(screen.getByRole('button', { name: 'Remove equipment item 2' }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  // Assert: the remaining rows keep their own values, and the confirmation is shown on the saved record.
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/events', expect.objectContaining({
    equipmentItems: [{ item: 'Wireless microphone', quantity: 2 }, { item: 'Projector', quantity: 1 }],
    technicalSupportRequired: false, technicalSupportDetails: null, videoConferencingRequired: false, technicalSpecifications: '',
  }), 'organiser-token'));
  expect(await screen.findByText('Event request submitted.')).toBeTruthy();
});

// Test case: Requests technical support plus hybrid facilities and a specification; all are sent with the request.
it('EQ AC1/AC2 - technical support needs and video-conferencing specifications are included in the request', async () => {
  await openNewRequest();
  // Details only appear once support is requested.
  expect(screen.queryByLabelText('Technical support details')).toBeNull();
  fireEvent.click(screen.getByLabelText('Technical support required'));
  fireEvent.change(screen.getByLabelText('Technical support details'), { target: { value: 'AV technician on site' } });
  fireEvent.click(screen.getByLabelText('Video-conferencing / hybrid facilities required'));
  fireEvent.change(screen.getByLabelText('Special technical specifications'), { target: { value: 'Zoom for 50 remote participants' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/events', expect.objectContaining({
    equipmentItems: [], technicalSupportRequired: true, technicalSupportDetails: 'AV technician on site',
    videoConferencingRequired: true, technicalSpecifications: 'Zoom for 50 remote participants',
  }), 'organiser-token'));
});

// Test case: Types support details then unticks support; the hidden details must not be sent (the API rejects contradictory details).
it('EQ AC1 - unticking technical support hides and withholds previously typed details', async () => {
  await openNewRequest();
  fireEvent.click(screen.getByLabelText('Technical support required'));
  fireEvent.change(screen.getByLabelText('Technical support details'), { target: { value: 'Technician' } });
  fireEvent.click(screen.getByLabelText('Technical support required'));
  expect(screen.queryByLabelText('Technical support details')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/events', expect.objectContaining({
    isDraft: true, technicalSupportRequired: false, technicalSupportDetails: null }), 'organiser-token'));
});

// Quantity is a whole number from 1 to 9999. The browser's own number constraints stop out-of-range or
// fractional values before submission; each must leave the input invalid for the expected reason and send nothing.
it.each([['0', 'rangeUnderflow'], ['1.5', 'stepMismatch'], ['10000', 'rangeOverflow']])(
  'EQ AC1 - quantity %s is blocked by the quantity constraints', async (quantity, reason) => {
    await openNewRequest();
    addItem('Projector', quantity);
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(screen.getByLabelText('Quantity for item 1').validity[reason]).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
  });

// Values the browser accepts but the API would reject are explained in the form and nothing is sent.
it.each([
  ['a missing quantity', 'Projector', '', 'Quantity for Projector must be a whole number from 1 to 9999.'],
  ['an unnamed item', '   ', '2', 'Name each equipment item or remove the empty row.'],
])('EQ AC1 - %s is explained and blocks submission', async (_label, item, quantity, message) => {
  await openNewRequest();
  addItem(item, quantity);
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  expect((await screen.findByRole('alert')).textContent).toBe(message);
  expect(api.post).not.toHaveBeenCalled();
});

it.each([['1', [{ item: 'Projector', quantity: 1 }]], ['9999', [{ item: 'Projector', quantity: 9999 }]]])(
  'EQ AC1 - boundary quantity %s is accepted', async (quantity, equipmentItems) => {
    await openNewRequest();
    addItem('Projector', quantity);
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/events', expect.objectContaining({ equipmentItems }), 'organiser-token'));
  });

// Test case: Adds a row but clears both fields; an untouched empty row is ignored rather than blocking the request.
it('EQ AC1 - a completely blank row is ignored', async () => {
  await openNewRequest();
  addItem('', '');
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/events', expect.objectContaining({ equipmentItems: [] }), 'organiser-token'));
});

// Test case: Requests technical support without describing it; the form explains what is missing and does not submit.
it('EQ AC1 - technical support without details is explained and blocks submission', async () => {
  await openNewRequest();
  fireEvent.click(screen.getByLabelText('Technical support required'));
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Describe the technical support your event requires.');
  expect(api.post).not.toHaveBeenCalled();
});

// Test case: Opens an organiser's event and checks every recorded equipment requirement and the arrangement state are shown.
it('EQ AC1/AC2 - event details show items, support needs, specifications, other notes and arrangement state', async () => {
  open('/organizer/events/101');
  await screen.findByRole('heading', { name: event.name });
  const section = equipmentSection();
  for (const text of ['Wireless microphone × 2, Projector × 1', 'Required: AV technician 09:00-12:00', 'Required',
    'Zoom for 50 remote participants', 'Spare batteries please', 'Awaiting technical arrangement']) {
    expect(within(section).getByText(text)).toBeTruthy();
  }
});

// Test case: Edits equipment before confirmation; the PUT carries the full replacement and the page confirms and shows the new list.
it('EQ AC3/AC4 - before confirmation the organiser updates equipment and sees a saved confirmation', async () => {
  // Arrange
  const savedItems = [{ item: 'Wireless microphone', quantity: 4 }];
  api.put.mockResolvedValue({ message: 'Equipment requirements saved.', event: { ...baseEvent, equipment_items: savedItems,
    technical_support_required: false, technical_support_details: null, proposed_date: '2026-10-14T16:00:00.000Z' } });
  open('/organizer/events/101');
  await screen.findByRole('heading', { name: event.name });
  // Act: raise microphones to 4, remove the projector, drop technical support.
  fireEvent.click(within(equipmentSection()).getByRole('button', { name: 'Edit Equipment requirements' }));
  expect(screen.getByLabelText('Equipment item 1').value).toBe('Wireless microphone');
  fireEvent.change(screen.getByLabelText('Quantity for item 1'), { target: { value: '4' } });
  fireEvent.click(screen.getByRole('button', { name: 'Remove equipment item 2' }));
  fireEvent.click(screen.getByLabelText('Technical support required'));
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  // Assert
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/events/101/equipment', {
    equipmentItems: savedItems, technicalSupportRequired: false, technicalSupportDetails: null,
    videoConferencingRequired: true, technicalSpecifications: 'Zoom for 50 remote participants' }, 'organiser-token'));
  expect(await screen.findByText('Equipment requirements saved.')).toBeTruthy();
  expect(within(equipmentSection()).getByText('Wireless microphone × 4')).toBeTruthy();
  expect(within(equipmentSection()).getByText('Not required')).toBeTruthy();
  // The raw UPDATE row's timestamp must not replace the stored calendar date.
  expect(screen.getByText('15/10/2026')).toBeTruthy();
});

// Test case: Edits equipment after confirmation; the request is sent but the confirmed list stays displayed with the change-request message.
it('EQ AC3 - after confirmation an edit is submitted as a change request and confirmed equipment stays displayed', async () => {
  event = { ...baseEvent, equipment_confirmed: true };
  api.put.mockResolvedValue({ changeRequest: { id: 7, status: 'pending' },
    message: 'Change request submitted. The confirmed equipment arrangements remain in effect, and the Event Coordinator has been notified.' });
  open('/organizer/events/101');
  await screen.findByRole('heading', { name: event.name });
  expect(within(equipmentSection()).getByText('Arrangements confirmed')).toBeTruthy();
  expect(within(equipmentSection()).queryByRole('button', { name: 'Edit Equipment requirements' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Request change to Equipment requirements' }));
  expect(screen.getByText(/sent to the Event Coordinator as a change request/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Quantity for item 1'), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit change request' }));
  expect(await screen.findByText(/confirmed equipment arrangements remain in effect/)).toBeTruthy();
  expect(within(equipmentSection()).getByText('Wireless microphone × 2, Projector × 1')).toBeTruthy();
});

// Test case: The save fails; the error is shown, the edits stay in the form, and no saved confirmation appears.
it('EQ AC4 - a failed save keeps the edits and shows the error instead of a confirmation', async () => {
  let rejectSave;
  api.put.mockImplementation(() => new Promise((_, reject) => { rejectSave = reject; }));
  open('/organizer/events/101');
  await screen.findByRole('heading', { name: event.name });
  fireEvent.click(screen.getByRole('button', { name: 'Edit Equipment requirements' }));
  fireEvent.change(screen.getByLabelText('Quantity for item 2'), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  // While saving, inputs are locked so the in-flight values cannot drift from what was sent.
  expect(screen.getByRole('button', { name: 'Saving…' }).disabled).toBe(true);
  expect(screen.getByLabelText('Quantity for item 2').matches(':disabled')).toBe(true);
  await act(async () => rejectSave(new Error('Server unavailable')));
  expect(screen.getByRole('alert').textContent).toBe('Server unavailable');
  expect(screen.getByLabelText('Quantity for item 2').value).toBe('3');
  expect(screen.queryByText('Equipment requirements saved.')).toBeNull();
  // Cancel discards the draft and returns to the stored values.
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(within(equipmentSection()).getByText('Wireless microphone × 2, Projector × 1')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

// Test case: Clears a quantity in the detail editor; the reason is shown and nothing is sent.
it('EQ AC3 - the detail editor blocks invalid quantities before saving', async () => {
  open('/organizer/events/101');
  await screen.findByRole('heading', { name: event.name });
  fireEvent.click(screen.getByRole('button', { name: 'Edit Equipment requirements' }));
  fireEvent.change(screen.getByLabelText('Quantity for item 1'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(screen.getByRole('alert').textContent).toBe('Quantity for Wireless microphone must be a whole number from 1 to 9999.');
  expect(api.put).not.toHaveBeenCalled();
});

// Test case: A coordinator views the requirements read-only; markup in item names is shown as text, not executed.
it('EQ AC1 - coordinators can read equipment requirements but cannot edit them, and item text is not executed', async () => {
  user = { ...user, id: 30, role: 'event_coordinator' };
  event = { ...baseEvent, equipment_items: [{ item: '<img src=x onerror=alert(1)>', quantity: 1 }] };
  open('/events/101');
  await screen.findByRole('heading', { name: event.name });
  expect(within(equipmentSection()).getByText('<img src=x onerror=alert(1)> × 1')).toBeTruthy();
  expect(equipmentSection().querySelector('img')).toBeNull();
  expect(within(equipmentSection()).queryByRole('button')).toBeNull();
});

// Test case: An event saved before this story has no equipment fields; the page states nothing was requested instead of inventing values.
it('EQ AC1 - events without recorded equipment show that nothing was requested', async () => {
  event = { id: 101, name: 'Legacy event', organiser_id: 12 };
  open('/organizer/events/101');
  await screen.findByRole('heading', { name: 'Legacy event' });
  const section = equipmentSection();
  expect(within(section).getByText('No equipment items requested')).toBeTruthy();
  expect(within(section).getAllByText('Not required')).toHaveLength(2);
  expect(within(section).getAllByText('Not specified')).toHaveLength(2);
  // Opening the editor on a legacy record starts from an empty list.
  fireEvent.click(within(section).getByRole('button', { name: 'Edit Equipment requirements' }));
  expect(screen.getByText('No equipment items added.')).toBeTruthy();
});

// Test case: The assigned coordinator's change-request inbox lists an equipment change readably rather than as raw objects.
it('EQ AC3 - coordinators see requested equipment changes as readable items in their change-request inbox', async () => {
  user = { ...user, id: 30, role: 'event_coordinator' };
  api.get.mockImplementation(async (path) => {
    if (path === '/auth/me') return { user };
    if (path === '/events') return { events: [] };
    return { changeRequests: [{ id: 7, event_id: 101, event_name: 'Community Workshop', organiser_name: 'Alice',
      requested_changes: { equipmentItems: [{ item: 'Wireless microphone', quantity: 4 }], technicalSupportRequired: false } }] };
  });
  open('/coordinator/dashboard');
  const item = await screen.findByText('Equipment items:');
  expect(item.parentElement.textContent).toBe('Equipment items: Wireless microphone × 4');
  expect(screen.getByText('Technical support required:').parentElement.textContent).toBe('Technical support required: No');
});
