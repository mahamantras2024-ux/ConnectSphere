// File: Tests "Request All Post-Submission Amendments Through the Coordinator" in the real app: a submitted event has no
// direct edit controls (AC1); one form proposes changes with a required explanation (AC2); the accepted details stay in
// effect while the request awaits review (AC3); and the coordinator sees the organiser's explanation (AC4).
// Test scope: Real App routes, AuthProvider, EventDetail and the amendment components; only the API client is replaced.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../frontend/src/api/client';
import App from '../../frontend/src/App';
import { AuthProvider } from '../../frontend/src/context/AuthContext';
import { changedValues, toApiChange, toEditValues } from '../../frontend/src/pages/events/eventEditValues';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));

const organiser = { id: 12, email: 'olivia@example.com', full_name: 'Olivia', role: 'event_organiser' };
const coordinatorUser = { id: 30, email: 'chris@example.com', full_name: 'Chris', role: 'event_coordinator' };
// A submitted request with an assigned coordinator, as GET /events/:id returns it.
const submitted = { id: 101, name: 'Gala', purpose: 'Fundraising', description: 'Annual dinner', event_type: 'dinner',
  proposed_date: '2030-10-15', proposed_start_time: '18:00:00', proposed_end_time: '20:00:00', expected_attendance: 60,
  programme_details: 'Speeches', room_layout_preference: 'Theatre', accessibility_requirements: ['Ramp'],
  equipment_notes: 'Spare cables', registration_required: true, registration_capacity: 50, special_arrangements: 'Vegetarian menu',
  equipment_items: [{ item: 'Projector', quantity: 1 }], technical_support_required: false, technical_support_details: null,
  video_conferencing_required: false, technical_specifications: null, attachments: {},
  organiser_id: 12, coordinator_id: 30, organiser_name: 'Olivia', coordinator_name: 'Chris', status: 'submitted', is_draft: false };
let user;
let event;
let amendmentRequests;

/** Renders the app at a route with a stored session. */
function open(path) {
  localStorage.setItem('cs_token', 'session');
  render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>);
}
/** Opens the organiser's event page and waits for it. */
async function openEvent() {
  open('/organizer/events/101');
  await screen.findByRole('heading', { name: event.name });
}
/** Opens the amendment form from the event page. */
async function openForm() {
  await openEvent();
  fireEvent.click(screen.getByRole('button', { name: 'Request an amendment' }));
  return screen.getByRole('form', { name: 'Request an amendment' });
}
const amendmentList = () => screen.getByRole('region', { name: 'Amendment requests' });

beforeEach(() => {
  localStorage.clear(); api.get.mockReset(); api.post.mockReset(); api.put.mockReset();
  user = organiser;
  event = { ...submitted };
  amendmentRequests = [];
  api.get.mockImplementation(async (path) => {
    if (path === '/auth/me') return { user };
    if (path === '/events/101') return { event };
    if (path === '/events/101/amendment-requests') return { amendmentRequests };
    if (path === '/events/change-requests') return { changeRequests: [] };
    return { events: [] };
  });
});
afterEach(cleanup);

// ---------- Pure value conversion ----------
describe('editor values', () => {
  // AC2: the form proposes only what the organiser changed, in the API's formats.
  it('AM AC2 - only edited values are proposed, converted to the API format', () => {
    const initial = toEditValues(submitted);
    // Inputs report numbers as text: an unchanged "60" is not a change, "75" is.
    expect(changedValues({ ...initial, expectedAttendance: '60' }, initial)).toEqual({});
    expect(changedValues({ ...initial, expectedAttendance: '75', accessibilityText: 'Ramp\n\n Lift ', registrationCapacity: '' }, initial))
      .toEqual({ expectedAttendance: 75, accessibilityRequirements: ['Ramp', 'Lift'], registrationCapacity: null });
    expect(toApiChange('name', 'Gala 2')).toEqual(['name', 'Gala 2']);
  });
});

// ---------- AC1: no direct edits once submitted ----------

// Test case: A submitted event shows its details read-only and points to the amendment request instead.
it('AM AC1 - a submitted event offers no direct edit controls, only an amendment request', async () => {
  await openEvent();
  // No field pencils, no equipment edit and no attachment upload on the page itself.
  expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Request change to / })).toBeNull();
  expect(screen.queryByLabelText('Purpose attachment')).toBeNull();
  expect(screen.getByText(/has been submitted, so its details can't be edited directly/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Request an amendment' })).toBeTruthy();
  expect(api.put).not.toHaveBeenCalled();
});

// Test case: A draft is still edited directly and shows no amendment request.
it('AM AC1 - a draft keeps its direct edit controls and has no amendment request', async () => {
  event = { ...submitted, status: 'draft', is_draft: true };
  await openEvent();
  expect(screen.getByRole('button', { name: 'Edit Expected attendance' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Request an amendment' })).toBeNull();
  expect(api.get).not.toHaveBeenCalledWith('/events/101/amendment-requests', 'session');
});

// Test case: Amendments are not offered when nobody can review them or the event is closed.
it.each([
  [{ coordinator_id: null }, 'An Event Coordinator must be assigned before you can request an amendment.'],
  [{ status: 'cancelled' }, 'This event is cancelled, so amendments can no longer be requested.'],
  [{ status: 'completed' }, 'This event is completed, so amendments can no longer be requested.'],
])('AM AC2 AC4 - %o explains why no amendment can be requested', async (changes, message) => {
  event = { ...submitted, ...changes };
  await openEvent();
  expect(screen.getByText(message)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Request an amendment' })).toBeNull();
});

// ---------- AC2 + AC3: one amendment request with an explanation ----------

// Test case: The form starts from the accepted details, sends only the changed ones plus the explanation, and the page keeps
// showing the accepted details while the new request appears as awaiting review.
it('AM AC2 AC3 - a combined amendment sends only the changes and the explanation, and the accepted details stay', async () => {
  // Arrange: the server stores the request; the list then returns it as pending.
  api.post.mockImplementation(async () => {
    amendmentRequests = [{ id: 501, status: 'pending', submitted_at: '2030-01-01T02:00:00.000Z', explanation: 'Ticket sales are up.',
      decision_reason: null, changes: [{ field: 'expectedAttendance', label: 'Expected attendance', requested: 90 },
        { field: 'equipmentItems', label: 'Equipment items', requested: ['Projector × 2'] }] }];
    return { amendmentRequest: { id: 501, status: 'pending' },
      message: 'Amendment request submitted. The current event information stays in effect until your Event Coordinator reviews it.' };
  });
  const form = await openForm();
  // The form is prefilled with the accepted details.
  expect(within(form).getByLabelText('Expected attendance').value).toBe('60');
  expect(within(form).getByLabelText('Layout requirements').value).toBe('Theatre');
  expect(within(form).getByLabelText('Equipment item 1').value).toBe('Projector');
  // Act: change attendance, layout, accessibility and the projector count; add a document; explain.
  fireEvent.change(within(form).getByLabelText('Expected attendance'), { target: { value: '90' } });
  fireEvent.change(within(form).getByLabelText('Layout requirements'), { target: { value: 'Banquet' } });
  fireEvent.change(within(form).getByLabelText('Accessibility needs (one per line)'), { target: { value: 'Ramp\nLift' } });
  fireEvent.change(within(form).getByLabelText('Quantity for item 1'), { target: { value: '2' } });
  fireEvent.change(within(form).getByLabelText('Other equipment notes'), { target: { value: 'Two spare cables' } });
  const file = new File(['%PDF-plan'], 'plan.pdf', { type: 'application/pdf' });
  await act(async () => { fireEvent.change(within(form).getByLabelText('Purpose attachment'), { target: { files: [file] } }); });
  await within(form).findByText('plan.pdf');
  fireEvent.change(within(form).getByLabelText('Explanation (required)'), { target: { value: '  Ticket sales are up.  ' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Submit amendment request' }));
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  // Assert AC2: exactly the changed values (the equipment block whole, as the server validates it as a unit).
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  const [path, body, session] = api.post.mock.calls[0];
  expect([path, session]).toEqual(['/events/101/amendment-requests', 'session']);
  expect(body.explanation).toBe('Ticket sales are up.');
  expect(Object.keys(body.changes).sort()).toEqual(['accessibilityRequirements', 'attachments', 'equipmentItems', 'equipmentNotes', 'expectedAttendance',
    'roomLayoutPreference', 'technicalSpecifications', 'technicalSupportDetails', 'technicalSupportRequired', 'videoConferencingRequired']);
  expect(body.changes).toMatchObject({ expectedAttendance: 90, roomLayoutPreference: 'Banquet', accessibilityRequirements: ['Ramp', 'Lift'], equipmentNotes: 'Two spare cables',
    equipmentItems: [{ item: 'Projector', quantity: 2 }] });
  expect(body.changes.attachments.purpose.name).toBe('plan.pdf');
  // Assert AC3: after acknowledging, the page still shows the accepted 60, and the request is listed as awaiting review.
  await screen.findByText(/current event information stays in effect/);
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.queryByRole('form', { name: 'Request an amendment' })).toBeNull();
  // The event's own Expected attendance field still shows the accepted value, not the proposal.
  const attendance = screen.getByText(/^Expected attendance$/i, { selector: 'dt' }).parentElement;
  expect(within(attendance).getByRole('definition').textContent).toBe('60');
  expect(api.put).not.toHaveBeenCalled();
  const item = await within(amendmentList()).findByRole('listitem');
  expect(within(item).getByText('Awaiting review')).toBeTruthy();
  expect(within(item).getByText('90')).toBeTruthy();
  expect(within(item).getByText('Projector × 2')).toBeTruthy();
  expect(within(item).getByText('Ticket sales are up.')).toBeTruthy();
});

// Test case: The form refuses a request with nothing changed or no explanation, before any request is sent.
it('AM AC2 - the form requires at least one change and an explanation', async () => {
  // An event recorded before attachments existed has none; the form still opens with every document slot empty.
  event = { ...submitted, attachments: undefined };
  const form = await openForm();
  fireEvent.change(within(form).getByLabelText('Explanation (required)'), { target: { value: 'Just checking' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Submit amendment request' }));
  expect(within(form).getByRole('alert').textContent).toBe('Change at least one detail before requesting an amendment.');
  fireEvent.change(within(form).getByLabelText('Purpose'), { target: { value: 'Charity' } });
  fireEvent.change(within(form).getByLabelText('Explanation (required)'), { target: { value: '   ' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Submit amendment request' }));
  expect(within(form).getByRole('alert').textContent).toBe('Explain why you need these changes.');
  // An invalid equipment block (a cleared quantity) is caught before confirmation too. A 0 would already be stopped by the
  // input's own min=1 constraint, as in a browser.
  fireEvent.change(within(form).getByLabelText('Explanation (required)'), { target: { value: 'New focus' } });
  fireEvent.change(within(form).getByLabelText('Quantity for item 1'), { target: { value: '' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Submit amendment request' }));
  expect(within(form).getByRole('alert').textContent).toBe('Quantity for Projector must be a whole number from 1 to 9999.');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(api.post).not.toHaveBeenCalled();
});

// Test case: The explanation is limited to 2000 characters and its length is shown as the organiser types.
it('AM AC2 - the explanation counts characters up to the 2000 limit', async () => {
  const form = await openForm();
  const box = within(form).getByLabelText('Explanation (required)');
  expect(box.getAttribute('maxLength')).toBe('2000');
  fireEvent.change(box, { target: { value: 'x'.repeat(1999) } });
  expect(within(form).getByText('1999 / 2000 characters')).toBeTruthy();
  fireEvent.change(box, { target: { value: 'x'.repeat(2000) } });
  expect(within(form).getByText('2000 / 2000 characters')).toBeTruthy();
});

// Test case: A refused request is shown and the organiser's inputs stay for correction; Cancel then closes the form.
it('AM AC2 - a server refusal is shown and the inputs are kept', async () => {
  api.post.mockRejectedValue(new Error('End time must be later than start time.'));
  const form = await openForm();
  fireEvent.change(within(form).getByLabelText('End time'), { target: { value: '17:00' } });
  fireEvent.change(within(form).getByLabelText('Explanation (required)'), { target: { value: 'Shorter evening' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Submit amendment request' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(await within(screen.getByRole('dialog')).findByText('End time must be later than start time.')).toBeTruthy();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
  expect(within(form).getByLabelText('End time').value).toBe('17:00');
  expect(api.post).toHaveBeenCalledWith('/events/101/amendment-requests', { changes: { proposedEndTime: '17:00' }, explanation: 'Shorter evening' }, 'session');
  fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('form', { name: 'Request an amendment' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Request an amendment' })).toBeTruthy();
});

// Test case: A server failure without a message still tells the organiser it did not work.
it('AM AC2 - an unexplained failure shows a generic message', async () => {
  api.post.mockRejectedValue({});
  const form = await openForm();
  fireEvent.click(within(form).getByLabelText('Registration required?'));
  fireEvent.change(within(form).getByLabelText('Explanation (required)'), { target: { value: 'Open event' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Submit amendment request' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(await within(screen.getByRole('dialog')).findByText('Unable to submit the amendment request.')).toBeTruthy();
  expect(api.post.mock.calls[0][1].changes).toEqual({ registrationRequired: false });
});

// ---------- AC3: the organiser's list of requests ----------

// Test case: Each request shows its status, the proposal, the explanation and any coordinator note.
it('AM AC3 - the list shows awaiting, approved and not approved requests with their details', async () => {
  amendmentRequests = [
    { id: 503, status: 'pending', submitted_at: '2030-01-03T02:00:00.000Z', explanation: 'More guests.', decision_reason: null,
      changes: [{ field: 'accessibilityRequirements', label: 'Accessibility needs', requested: ['Ramp', 'Lift'] },
        { field: 'registrationRequired', label: 'Registration required', requested: false },
        { field: 'technicalSupportDetails', label: 'Technical support details', requested: null }] },
    { id: 502, status: 'approved', submitted_at: '2030-01-02T02:00:00.000Z', explanation: null, decision_reason: null,
      changes: [{ field: 'equipmentItems', label: 'Equipment items', requested: [] }, { field: 'registrationRequired', label: 'Registration required', requested: true }] },
    { id: 501, status: 'rejected', submitted_at: '2030-01-01T02:00:00.000Z', explanation: 'Rename.', decision_reason: 'Already printed.',
      changes: [{ field: 'name', label: 'Event name', requested: 'Gala Night' }] },
  ];
  await openEvent();
  const items = await within(amendmentList()).findAllByRole('listitem');
  expect(items.map((item) => item.querySelector('.ed-badge').textContent)).toEqual(['Awaiting review', 'Approved', 'Not approved']);
  expect(within(items[0]).getByText('Ramp, Lift')).toBeTruthy();
  expect(within(items[0]).getByText('No')).toBeTruthy();
  expect(within(items[0]).getByText('Not specified')).toBeTruthy();
  expect(within(items[0]).getByText('Requested 3 Jan 2030, 10:00 am')).toBeTruthy();
  expect(within(items[1]).getByText('None')).toBeTruthy();
  expect(within(items[1]).getByText('Yes')).toBeTruthy();
  expect(within(items[1]).queryByText(/Your explanation/)).toBeNull();
  expect(within(items[2]).getByText('Already printed.')).toBeTruthy();
});

// Test case: The list explains loading, an empty history, a failure and an incomplete response.
it('AM AC3 - the list shows loading, empty, failed and incomplete states', async () => {
  let release;
  api.get.mockImplementation(async (path) => {
    if (path === '/auth/me') return { user };
    if (path === '/events/101') return { event };
    if (path === '/events/101/amendment-requests') return new Promise((resolve) => { release = resolve; });
    return { events: [] };
  });
  await openEvent();
  expect(within(amendmentList()).getByText('Loading amendment requests…')).toBeTruthy();
  await act(async () => release({}));
  expect(within(amendmentList()).getByText('You have not requested any amendments.')).toBeTruthy();
  cleanup();
  api.get.mockImplementation(async (path) => {
    if (path === '/auth/me') return { user };
    if (path === '/events/101') return { event };
    throw new Error('Service unavailable');
  });
  await openEvent();
  expect((await within(amendmentList()).findByRole('alert')).textContent).toBe('Service unavailable');
  cleanup();
  api.get.mockImplementation(async (path) => {
    if (path === '/auth/me') return { user };
    if (path === '/events/101') return { event };
    throw {};
  });
  await openEvent();
  expect((await within(amendmentList()).findByRole('alert')).textContent).toBe('Unable to load amendment requests.');
});

// Test case: The organiser is on the event page when the coordinator decides; opening the decision notification reloads the
// event page (notification system), which reads the list again, so the request shows its new status without a manual reload.
it('AM AC3 - opening a decision notification on the event page refreshes the amendment list', async () => {
  // Arrange: one pending request, and an unread approval notification for this event.
  amendmentRequests = [{ id: 501, status: 'pending', submitted_at: '2030-01-01T02:00:00.000Z', explanation: 'More guests.', decision_reason: null,
    changes: [{ field: 'expectedAttendance', label: 'Expected attendance', requested: 90 }] }];
  const base = api.get.getMockImplementation();
  api.get.mockImplementation(async (path) => (path === '/notifications'
    ? { notifications: [{ id: 7, event_id: 101, type: 'change_request_approved', title: 'Change request approved: Gala',
      message: 'Your requested changes to Gala were approved and applied.', created_at: '2030-01-01T03:00:00.000Z', read_at: null }], unreadCount: 1 }
    : base(path)));
  api.post.mockResolvedValue({ notification: { id: 7, read_at: '2030-01-01T03:01:00.000Z' } });
  await openEvent();
  expect(await within(amendmentList()).findByText('Awaiting review')).toBeTruthy();
  // The coordinator approves meanwhile.
  amendmentRequests = [{ ...amendmentRequests[0], status: 'approved' }];
  // Act: open the notification from the bell (the event page is already open).
  fireEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
  fireEvent.click(within(screen.getByRole('region', { name: 'Recent notifications' })).getByRole('button', { name: 'Change request approved: Gala (new)' }));
  // Assert: the list re-reads and shows the decision (the page reloads the event first, so the list is looked up again).
  await waitFor(() => expect(within(amendmentList()).getByText('Approved')).toBeTruthy());
  expect(api.get.mock.calls.filter(([path]) => path === '/events/101/amendment-requests').length).toBeGreaterThan(1);
});

// ---------- AC4: the coordinator reviews the request ----------

// Test case: The coordinator's inbox shows each request's explanation; requests from before the story show none.
it('AM AC4 - the coordinator inbox shows the organiser explanation', async () => {
  user = coordinatorUser;
  api.get.mockImplementation(async (path) => {
    if (path === '/auth/me') return { user };
    if (path === '/events/change-requests') {
      return { changeRequests: [
        { id: 501, event_id: 101, event_name: 'Gala', organiser_name: 'Olivia', explanation: 'Ticket sales are up.', requested_changes: { expectedAttendance: 90 },
          changes: [{ field: 'expectedAttendance', label: 'Expected attendance', current: 60, requested: 90 }], arrangements: [] },
        { id: 400, event_id: 102, event_name: 'Fair', organiser_name: 'Olivia', explanation: null, requested_changes: { name: 'Fair 2' },
          changes: [{ field: 'name', label: 'Event name', current: 'Fair', requested: 'Fair 2' }], arrangements: [] },
      ] };
    }
    return { events: [] };
  });
  open('/coordinator/dashboard');
  const inbox = await screen.findByRole('region', { name: 'Amendment requests' });
  await within(inbox).findByText('Gala');
  expect(within(inbox).getByText('Ticket sales are up.')).toBeTruthy();
  expect(within(inbox).getAllByText(/Organiser's explanation:/)).toHaveLength(1);
  expect(within(inbox).getAllByRole('button', { name: 'Approve and apply' }).length).toBe(2);
});

// Reconsider AC2: the correction workflow must remain available while the event is still rejected.
it('Reconsider AC2 - a rejected request can submit corrections through its coordinator', async () => {
  event = { ...submitted, status: 'rejected' };
  await openEvent();
  expect(screen.getByRole('button', { name: 'Request an amendment' })).toBeTruthy();
});
