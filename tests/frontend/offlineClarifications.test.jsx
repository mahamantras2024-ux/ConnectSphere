// File: Tests "Record Offline Clarifications and Apply Agreed Amendments" in the real app: offline clarification records
// (AC1), marking clarifications resolved (AC2), the amendment history (AC3), applying an agreed amendment (AC3-AC5), Venue
// Staff re-confirmation (AC5) and attendee deadlines (AC6).
// Test scope: Real App routes, AuthProvider, EventDetail and the clarification/amendment components; only the API client is replaced.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../frontend/src/api/client';
import App from '../../frontend/src/App';
import { AuthProvider } from '../../frontend/src/context/AuthContext';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

const coordinator = { id: 30, email: 'chris@example.com', full_name: 'Chris', role: 'event_coordinator' };
const organiser = { id: 12, email: 'olivia@example.com', full_name: 'Olivia', role: 'event_organiser' };
const lead = { id: 40, email: 'lee@example.com', full_name: 'Lee', role: 'event_coordinator_lead' };
const venueStaff = { id: 41, email: 'vera@example.com', full_name: 'Vera', role: 'venue_staff' };
// A submitted event assigned to coordinator 30; the withdrawal deadline is 14 Oct 2030 18:00 Singapore time (10:00 UTC).
const baseEvent = { id: 101, name: 'Gala', purpose: 'Fundraising', status: 'submitted', is_draft: false, organiser_id: 12, coordinator_id: 30,
  organiser_name: 'Olivia', coordinator_name: 'Chris', proposed_date: '2030-10-15', proposed_start_time: '18:00:00', proposed_end_time: '20:00:00',
  expected_attendance: 60, attachments: {}, equipment_items: [], registration_deadline: null, withdrawal_deadline: '2030-10-14T10:00:00.000Z',
  clarification_requests: [] };
let user;
let event;
let history;

/** Renders the app at a route with a stored session. */
function open(path) {
  localStorage.setItem('cs_token', 'session');
  render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>);
}
/** Opens the coordinator's event page on its Activity tab. */
async function openActivity() {
  open('/events/101');
  await screen.findByRole('heading', { name: 'Gala' });
  fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
}
const clarificationItems = () => within(screen.getByRole('region', { name: 'Clarification requests' })).getAllByRole('listitem');

beforeEach(() => {
  localStorage.clear(); api.get.mockReset(); api.post.mockReset(); api.put.mockReset();
  user = coordinator;
  event = { ...baseEvent };
  history = [];
  api.get.mockImplementation(async (path) => {
    if (path === '/auth/me') return { user };
    if (path === '/events/101') return { event };
    if (path === '/events/101/amendment-requests') return { amendmentRequests: history };
    return { events: [], requests: [], notifications: [], unreadCount: 0, bookings: [], changeRequests: [] };
  });
});
afterEach(cleanup);

// ---------- AC1: record an offline clarification ----------

// Test case: The coordinator records what was asked, answered and decided offline; it joins the history as offline.
it('OC AC1 - the coordinator records an offline clarification with its answer, outcome and comments', async () => {
  // Arrange
  api.post.mockImplementation(async (path, body) => ({ message: 'Offline clarification recorded.', clarificationRequest: { id: 601, source: 'offline',
    status: 'responded', information_needed: body.informationNeeded, message: body.message, organiser_response: body.response, outcome: body.outcome,
    coordinator_comments: body.comments, created_at: '2030-01-01T02:00:00.000Z', responded_at: '2030-01-01T02:00:00.000Z' } }));
  await openActivity();
  // Act
  fireEvent.click(screen.getByRole('button', { name: 'Record an offline clarification' }));
  const form = screen.getByRole('form', { name: 'Record an offline clarification' });
  fireEvent.click(within(form).getByLabelText('Offline clarification about Expected attendance'));
  fireEvent.change(within(form).getByLabelText('Clarification question'), { target: { value: 'How many guests now?' } });
  fireEvent.change(within(form).getByLabelText("Organiser's response"), { target: { value: 'About 90.' } });
  fireEvent.change(within(form).getByLabelText('Outcome'), { target: { value: 'Attendance to become 90.' } });
  fireEvent.change(within(form).getByLabelText('Comments'), { target: { value: 'Phone call.' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Record offline clarification' }));
  // Assert: the exact record is sent, the form closes and the history shows it as an offline clarification.
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/events/101/clarifications/offline', { informationNeeded: ['expected_attendance'],
    message: 'How many guests now?', response: 'About 90.', outcome: 'Attendance to become 90.', comments: 'Phone call.', resolve: false }, 'session'));
  expect(await screen.findByText('Offline clarification recorded.')).toBeTruthy();
  expect(screen.queryByRole('form', { name: 'Record an offline clarification' })).toBeNull();
  const [item] = clarificationItems();
  expect(within(item).getByText('Offline')).toBeTruthy();
  expect(within(item).getByText('Organiser responded')).toBeTruthy();
  expect(within(item).getByText('Attendance to become 90.')).toBeTruthy();
  expect(within(item).getByText('Phone call.')).toBeTruthy();
  expect(within(item).getByText(/^Recorded offline on 1 Jan 2030, 10:00 am; answered 1 Jan 2030, 10:00 am$/)).toBeTruthy();
});
// Test case: Missing parts are explained before anything is sent; an outcome alone is enough only when resolved now.
it('OC AC1 - the offline form explains what is missing and needs an answer unless resolved with an outcome', async () => {
  api.post.mockResolvedValue({ message: 'Offline clarification recorded and resolved.', clarificationRequest: { id: 602, source: 'offline', status: 'resolved',
    information_needed: ['name'], message: 'Rename?', outcome: 'Keep the name.', created_at: '2030-01-01T02:00:00.000Z', resolved_at: '2030-01-01T02:00:00.000Z',
    resolved_by_name: 'Chris' } });
  await openActivity();
  fireEvent.click(screen.getByRole('button', { name: 'Record an offline clarification' }));
  const form = screen.getByRole('form', { name: 'Record an offline clarification' });
  const submit = () => fireEvent.click(within(form).getByRole('button', { name: 'Record offline clarification' }));
  // A topic ticked and then unticked leaves nothing selected.
  fireEvent.click(within(form).getByLabelText('Offline clarification about Purpose'));
  fireEvent.click(within(form).getByLabelText('Offline clarification about Purpose'));
  submit();
  expect(within(form).getByRole('alert').textContent).toBe('Select what the clarification was about.');
  fireEvent.click(within(form).getByLabelText('Offline clarification about Event name'));
  submit();
  expect(within(form).getByRole('alert').textContent).toBe('Enter the clarification question.');
  fireEvent.change(within(form).getByLabelText('Clarification question'), { target: { value: 'Rename?' } });
  fireEvent.change(within(form).getByLabelText('Outcome'), { target: { value: 'Keep the name.' } });
  submit();
  expect(within(form).getByRole('alert').textContent).toBe("Enter the organiser's response, or mark it resolved and record the outcome.");
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(within(form).getByLabelText('Mark resolved now'));
  submit();
  await waitFor(() => expect(api.post.mock.calls[0][1]).toMatchObject({ informationNeeded: ['name'], outcome: 'Keep the name.', response: '', resolve: true }));
  const [item] = await waitFor(() => clarificationItems());
  expect(within(item).getByText('Resolved')).toBeTruthy();
  expect(within(item).getByText('Resolved by Chris on 1 Jan 2030, 10:00 am')).toBeTruthy();
});
// Test case: An offline record (never pending) leaves an earlier unanswered question outstanding.
it('OC AC1 - recording offline keeps an earlier pending clarification outstanding', async () => {
  event = { ...baseEvent, clarification_outstanding: true, clarification_requests: [{ id: 600, status: 'pending', source: 'in_app',
    information_needed: ['purpose'], message: 'Why?', organiser_response: null, created_at: '2030-01-01T01:00:00.000Z', responded_at: null }] };
  api.post.mockResolvedValue({ message: 'Offline clarification recorded.', clarificationRequest: { id: 601, source: 'offline', status: 'responded',
    information_needed: ['name'], message: 'Rename?', organiser_response: 'No.', created_at: '2030-01-01T02:00:00.000Z', responded_at: '2030-01-01T02:00:00.000Z' } });
  await openActivity();
  fireEvent.click(screen.getByRole('button', { name: 'Record an offline clarification' }));
  const form = screen.getByRole('form', { name: 'Record an offline clarification' });
  fireEvent.click(within(form).getByLabelText('Offline clarification about Event name'));
  fireEvent.change(within(form).getByLabelText('Clarification question'), { target: { value: 'Rename?' } });
  fireEvent.change(within(form).getByLabelText("Organiser's response"), { target: { value: 'No.' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Record offline clarification' }));
  await waitFor(() => expect(clarificationItems()).toHaveLength(2));
  expect(screen.getByText('Clarification outstanding — planning is waiting for the Event Organiser.')).toBeTruthy();
});
// Test case: A refused record keeps the form open with the server's reason; Cancel closes it; other roles never see it.
it('OC AC1 - a refused record shows the reason, and only the coordinator can record', async () => {
  api.post.mockRejectedValueOnce(new Error('Assigned event not found.')).mockRejectedValueOnce({});
  await openActivity();
  fireEvent.click(screen.getByRole('button', { name: 'Record an offline clarification' }));
  const form = screen.getByRole('form', { name: 'Record an offline clarification' });
  fireEvent.click(within(form).getByLabelText('Offline clarification about Purpose'));
  fireEvent.change(within(form).getByLabelText('Clarification question'), { target: { value: 'Why?' } });
  fireEvent.change(within(form).getByLabelText("Organiser's response"), { target: { value: 'Charity.' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Record offline clarification' }));
  expect((await within(form).findByRole('alert')).textContent).toBe('Assigned event not found.');
  fireEvent.click(within(form).getByRole('button', { name: 'Record offline clarification' }));
  await waitFor(() => expect(within(form).getByRole('alert').textContent).toBe('Unable to record the clarification.'));
  fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('form', { name: 'Record an offline clarification' })).toBeNull();
  cleanup();
  user = lead;
  open('/events/101');
  await screen.findByRole('heading', { name: 'Gala' });
  expect(screen.queryByRole('button', { name: 'Record an offline clarification' })).toBeNull();
});

// ---------- AC2: mark resolved, keeping the history ----------

const pendingClarification = { id: 601, status: 'pending', source: 'in_app', information_needed: ['expected_attendance'], message: 'How many guests?',
  organiser_response: null, created_at: '2030-01-01T02:00:00.000Z', responded_at: null };

// Test case: A pending question needs its outcome; once resolved the history keeps the question and adds the resolution.
it('OC AC2 - the coordinator resolves a pending clarification with its outcome and the history is kept', async () => {
  const older = { ...pendingClarification, id: 600, status: 'responded', message: 'Which hall?', organiser_response: 'Hall A.', responded_at: '2030-01-01T01:00:00.000Z' };
  event = { ...baseEvent, clarification_outstanding: true, clarification_requests: [pendingClarification, older] };
  api.post.mockResolvedValue({ message: 'Clarification marked as resolved.', clarificationRequest: { ...pendingClarification, status: 'resolved',
    resolution_outcome: 'Agreed 90 by phone.', resolution_comments: 'Call notes in file.', resolved_at: '2030-01-02T02:00:00.000Z', resolved_by_name: 'Chris' } });
  await openActivity();
  expect(screen.getByText('Clarification outstanding — planning is waiting for the Event Organiser.')).toBeTruthy();
  fireEvent.click(within(clarificationItems()[0]).getByRole('button', { name: 'Mark resolved' }));
  const form = screen.getByRole('form', { name: 'Resolve clarification 601' });
  fireEvent.click(within(form).getByRole('button', { name: 'Confirm resolved' }));
  expect(within(form).getByRole('alert').textContent).toBe('Record the outcome: the organiser has not responded.');
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.change(within(form).getByLabelText('Resolution outcome (required)'), { target: { value: 'Agreed 90 by phone.' } });
  fireEvent.change(within(form).getByLabelText('Resolution comments (optional)'), { target: { value: 'Call notes in file.' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Confirm resolved' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/events/101/clarifications/601/resolve',
    { outcome: 'Agreed 90 by phone.', comments: 'Call notes in file.' }, 'session'));
  const [item] = clarificationItems();
  expect(await within(item).findByText('Resolved')).toBeTruthy();
  expect(within(item).getByText('How many guests?')).toBeTruthy();
  expect(within(item).getByText('Agreed 90 by phone.')).toBeTruthy();
  expect(within(item).getByText('Resolved by Chris on 2 Jan 2030, 10:00 am')).toBeTruthy();
  expect(within(item).queryByRole('button', { name: 'Mark resolved' })).toBeNull();
  // The other clarification is untouched and can still be resolved.
  expect(within(clarificationItems()[1]).getByText('Hall A.')).toBeTruthy();
  expect(within(clarificationItems()[1]).getByRole('button', { name: 'Mark resolved' })).toBeTruthy();
  // Nothing is pending any more, so planning is no longer waiting on the organiser.
  expect(screen.queryByText('Clarification outstanding — planning is waiting for the Event Organiser.')).toBeNull();
});
// Test case: An answered clarification's outcome is optional; a refusal is shown and Cancel closes the form.
it('OC AC2 - an answered clarification is resolved without an outcome; failures are shown', async () => {
  const answered = { ...pendingClarification, status: 'responded', organiser_response: 'About 90.', responded_at: '2030-01-01T03:00:00.000Z' };
  event = { ...baseEvent, clarification_requests: [answered] };
  api.post.mockRejectedValueOnce(new Error('This clarification is already resolved.')).mockRejectedValueOnce({});
  await openActivity();
  fireEvent.click(screen.getByRole('button', { name: 'Mark resolved' }));
  const form = screen.getByRole('form', { name: 'Resolve clarification 601' });
  expect(within(form).getByLabelText('Resolution outcome (optional)')).toBeTruthy();
  fireEvent.click(within(form).getByRole('button', { name: 'Confirm resolved' }));
  expect((await within(form).findByRole('alert')).textContent).toBe('This clarification is already resolved.');
  fireEvent.click(within(form).getByRole('button', { name: 'Confirm resolved' }));
  await waitFor(() => expect(within(form).getByRole('alert').textContent).toBe('Unable to resolve the clarification.'));
  fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('button', { name: 'Mark resolved' })).toBeTruthy();
});
// Test case (reviewer AC2): the outcome and comments recorded earlier stay visible beside the resolution added later.
it('OC AC2 - the earlier outcome and comments stay beside the resolution in the history', async () => {
  event = { ...baseEvent, clarification_requests: [{ ...pendingClarification, source: 'offline', status: 'resolved', organiser_response: 'About 90.',
    responded_at: '2030-01-01T02:00:00.000Z', outcome: 'Attendance to become 90.', coordinator_comments: 'Phone call.',
    resolution_outcome: 'Final: 90 guests.', resolution_comments: 'Confirmed in writing.', resolved_at: '2030-01-02T02:00:00.000Z', resolved_by_name: 'Chris' }] };
  await openActivity();
  const [item] = clarificationItems();
  const lines = within(item).getAllByText((_, node) => node.tagName === 'P' && /^(Outcome|Coordinator comments|Resolution outcome|Resolution comments):/.test(node.textContent))
    .map((node) => node.textContent);
  expect(lines).toEqual(['Outcome: Attendance to become 90.', 'Coordinator comments: Phone call.', 'Resolution outcome: Final: 90 guests.',
    'Resolution comments: Confirmed in writing.']);
});
// Test case: The organiser sees resolutions but cannot resolve.
it('OC AC2 - the organiser sees the resolution but has no resolve control', async () => {
  user = organiser;
  event = { ...baseEvent, clarification_requests: [{ ...pendingClarification, status: 'resolved', outcome: 'Settled.', resolved_at: '2030-01-02T02:00:00.000Z',
    resolved_by_name: 'Chris', source: 'offline', coordinator_comments: null }] };
  open('/organizer/events/101');
  const item = (await screen.findAllByRole('listitem')).find((node) => node.className === 'ed-clar-item');
  expect(within(item).getByText('Settled.')).toBeTruthy();
  expect(within(item).getByText(/^Recorded offline on/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Mark resolved' })).toBeNull();
});

// ---------- AC3: amendment history ----------

const appliedAmendment = { id: 700, status: 'approved', source: 'coordinator_agreed', submitted_at: '2030-01-03T02:00:00.000Z', explanation: 'Agreed by phone.',
  clarification_id: 601, changes: [{ field: 'expectedAttendance', label: 'Expected attendance', before: 60, after: 90 },
    { field: 'registrationRequired', label: 'Registration required', before: false, after: true }],
  rechecks: { venueBookings: [{ venueName: 'Hall A' }], technical: true, safety: true, returnedToPlanning: true } };
// A wording change that reopened no check.
const quietAmendment = { id: 698, status: 'approved', source: 'coordinator_agreed', submitted_at: '2030-01-01T05:00:00.000Z', explanation: 'Typo.',
  clarification_id: null, changes: [{ field: 'name', label: 'Event name', before: 'Gal', after: 'Gala' }],
  rechecks: { venueBookings: [], technical: false, safety: false, returnedToPlanning: false } };
const decidedRequest = { id: 699, status: 'rejected', source: 'organiser_request', submitted_at: '2030-01-02T02:00:00.000Z', reviewed_at: '2030-01-02T04:00:00.000Z',
  reviewed_by_name: 'Chris', explanation: 'Bigger room.', decision_reason: 'No larger hall free.', rechecks: null,
  changes: [{ field: 'roomLayoutPreference', label: 'Layout requirements', requested: 'Banquet' }] };

// Test case: The coordinator and the Lead see what each amendment changed, who agreed or decided it, and what it reopened.
it.each([['coordinator', coordinator], ['Coordinator Lead', lead]])('OC AC3 - the %s sees the amendment history with before and after values', async (_, viewer) => {
  user = viewer;
  history = [appliedAmendment, decidedRequest, quietAmendment];
  open('/events/101');
  await screen.findByRole('heading', { name: 'Gala' });
  // The coordinator's workspace keeps the history on its Activity tab; the Lead's page has no tabs.
  if (viewer === coordinator) fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
  const list = await screen.findByRole('region', { name: 'Amendment history' });
  const [applied, decided, quiet] = await within(list).findAllByRole('listitem');
  expect(within(applied).getByText('Agreed with the organiser and applied by the Event Coordinator')).toBeTruthy();
  expect(within(applied).getByText('60 → 90')).toBeTruthy();
  expect(within(applied).getByText('No → Yes')).toBeTruthy();
  expect(within(applied).getByText('Agreed by phone.')).toBeTruthy();
  expect(within(applied).getByText('What was agreed:')).toBeTruthy();
  expect(within(applied).getByText('Agreed in clarification #601')).toBeTruthy();
  expect(within(applied).getByText('Venue booking at Hall A to be re-confirmed by Venue Staff; Technical arrangements to be reviewed again; A new operational safety check; Event returned to planning until confirmed again')).toBeTruthy();
  expect(within(decided).getByText('Requested by the organiser')).toBeTruthy();
  expect(within(decided).getByText('Banquet')).toBeTruthy();
  expect(within(decided).getByText('Decided by Chris on 2 Jan 2030, 12:00 pm')).toBeTruthy();
  expect(within(decided).getByText('No larger hall free.')).toBeTruthy();
  expect(within(quiet).getByText('Gal → Gala')).toBeTruthy();
  expect(within(quiet).queryByText('Checks reopened:')).toBeNull();
  expect(within(quiet).queryByText(/Agreed in clarification/)).toBeNull();
  // Only the assigned coordinator can apply an agreed amendment.
  expect(Boolean(screen.queryByRole('button', { name: 'Apply agreed amendment' }))).toBe(viewer === coordinator);
});
// Test case: Empty, failed and incomplete history reads are explained rather than shown as nothing.
it('OC AC3 - the amendment history explains an empty, failed or incomplete read', async () => {
  await openActivity();
  expect(await within(screen.getByRole('region', { name: 'Amendment history' })).findByText('No amendments have been requested or applied.')).toBeTruthy();
  cleanup();
  api.get.mockImplementation(async (path) => (path === '/auth/me' ? { user } : path === '/events/101' ? { event }
    : path === '/events/101/amendment-requests' ? Promise.reject(new Error('Offline')) : { notifications: [], unreadCount: 0 }));
  await openActivity();
  expect((await within(screen.getByRole('region', { name: 'Amendment history' })).findByRole('alert')).textContent).toBe('Offline');
  cleanup();
  api.get.mockImplementation(async (path) => (path === '/auth/me' ? { user } : path === '/events/101' ? { event }
    : path === '/events/101/amendment-requests' ? Promise.reject({}) : path === '/notifications' ? { notifications: [], unreadCount: 0 } : null));
  await openActivity();
  expect((await within(screen.getByRole('region', { name: 'Amendment history' })).findByRole('alert')).textContent).toBe('Unable to load the amendment history.');
});
it('OC AC3 - an incomplete history response is shown as empty', async () => {
  api.get.mockImplementation(async (path) => (path === '/auth/me' ? { user } : path === '/events/101' ? { event }
    : path === '/events/101/amendment-requests' ? null : { notifications: [], unreadCount: 0 }));
  await openActivity();
  expect(await within(screen.getByRole('region', { name: 'Amendment history' })).findByText('No amendments have been requested or applied.')).toBeTruthy();
});

// ---------- AC3-AC5: the coordinator applies an agreed amendment ----------

// Test case: The coordinator enters the agreed change, links its clarification and applies it; the page shows the new event.
it('OC AC3 AC4 - the coordinator applies an agreed amendment linked to a clarification and the event is reloaded', async () => {
  event = { ...baseEvent, clarification_requests: [{ ...pendingClarification, status: 'resolved', resolved_at: '2030-01-02T02:00:00.000Z' }] };
  api.post.mockImplementation(async () => {
    event = { ...event, expected_attendance: 90 };
    history = [appliedAmendment];
    return { message: 'Agreed amendment applied. The organiser and affected staff have been notified.' };
  });
  await openActivity();
  fireEvent.click(screen.getByRole('button', { name: 'Apply agreed amendment' }));
  const form = screen.getByRole('form', { name: 'Apply an agreed amendment' });
  expect(within(form).getByText(/They apply straight away/)).toBeTruthy();
  fireEvent.change(within(form).getByLabelText('Expected attendance'), { target: { value: '90' } });
  fireEvent.change(within(form).getByLabelText('Agreed in clarification (optional)'), { target: { value: '601' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Apply agreed amendment' }));
  expect(within(form).getByRole('alert').textContent).toBe('Describe what was agreed with the organiser.');
  fireEvent.change(within(form).getByLabelText('What was agreed (required)'), { target: { value: 'Agreed by phone.' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Apply agreed amendment' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/events/101/agreed-amendments',
    { changes: { expectedAttendance: 90 }, explanation: 'Agreed by phone.', clarificationId: 601 }, 'session'));
  fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
  // The page reloads the changed event and its history.
  await waitFor(() => expect(api.get.mock.calls.filter(([path]) => path === '/events/101').length).toBe(2));
  expect(await screen.findByText('Agreed amendment applied. The organiser and affected staff have been notified.')).toBeTruthy();
  expect(await within(screen.getByRole('region', { name: 'Amendment history' })).findByText('60 → 90')).toBeTruthy();
});
// Test case: Without a linked clarification the link is sent as none; a refusal is shown in the confirmation.
it('OC AC3 - an agreed amendment without a clarification sends none, and a refusal is shown', async () => {
  api.post.mockRejectedValueOnce(new Error('Change at least one detail before applying an amendment.')).mockRejectedValueOnce({});
  await openActivity();
  fireEvent.click(screen.getByRole('button', { name: 'Apply agreed amendment' }));
  const form = screen.getByRole('form', { name: 'Apply an agreed amendment' });
  fireEvent.click(within(form).getByRole('button', { name: 'Apply agreed amendment' }));
  expect(within(form).getByRole('alert').textContent).toBe('Change at least one detail before applying an amendment.');
  fireEvent.change(within(form).getByLabelText('Purpose'), { target: { value: 'Charity' } });
  fireEvent.change(within(form).getByLabelText('What was agreed (required)'), { target: { value: 'New purpose.' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Apply agreed amendment' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(await within(screen.getByRole('dialog')).findByText('Change at least one detail before applying an amendment.')).toBeTruthy();
  expect(api.post.mock.calls[0][1].clarificationId).toBeNull();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }));
  expect(await within(screen.getByRole('dialog')).findByText('Unable to apply the amendment.')).toBeTruthy();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
  fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('button', { name: 'Apply agreed amendment' })).toBeTruthy();
});

// ---------- AC5: Venue Staff re-confirm a flagged booking ----------

const flaggedBooking = { id: 9, venue_id: 5, event_id: 101, event_name: 'Gala', venue_name: 'Hall A', status: 'approved',
  start_datetime: '2030-10-15T10:00:00.000Z', end_datetime: '2030-10-15T12:00:00.000Z', expected_attendance: 150,
  recheck_required_at: '2030-01-03T02:00:00.000Z', recheck_reason: '150 expected guests exceed the venue capacity of 100.' };

// Test case: A flagged booking is marked in the inbox with its reason, and re-confirming or rejecting uses its re-check.
it.each([['Re-confirm booking', 'confirmed', 'approved', 'Re-confirmed'], ['Reject booking', 'rejected', 'rejected', 'Rejected']])(
  'OC AC5 - Venue Staff use "%s" on a booking flagged after an amendment', async (button, decision, status, outcome) => {
    user = venueStaff;
    const base = api.get.getMockImplementation();
    api.get.mockImplementation(async (path) => (path === '/venues/requests/pending' ? { requests: [flaggedBooking] } : base(path)));
    api.put.mockResolvedValue({ request: { ...flaggedBooking, status, decision_by: 41, updated_at: '2030-01-03T03:00:00.000Z' } });
    open('/venue/dashboard');
    const inbox = await screen.findByRole('region', { name: 'Pending venue booking requests' });
    expect(await within(inbox).findByText('Re-check required')).toBeTruthy();
    fireEvent.click(within(inbox).getByRole('button', { name: 'Review Gala at Hall A' }));
    expect(screen.getByText('150 expected guests exceed the venue capacity of 100.')).toBeTruthy();
    // A booking without a requirements snapshot adds no comparison line.
    expect(screen.queryByText('Originally requested:')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: button }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/venues/5/requests/9/recheck', { decision, reason: '' }, 'session'));
    expect(await screen.findByText(new RegExp(`^${outcome}: Gala at Hall A\\.`))).toBeTruthy();
  });
// Test case (reviewer AC5): a flagged booking lists the amended requirements, with what was first requested for comparison.
it('OC AC5 - a flagged booking shows the amended requirements and what was originally requested', async () => {
  user = venueStaff;
  const amended = { ...flaggedBooking, room_layout_preference: 'Banquet', accessibility_requirements: ['Ramp'],
    original_requirements: { capacity: 60, layout: 'Theatre', accessibility: [] } };
  const base = api.get.getMockImplementation();
  api.get.mockImplementation(async (path) => (path === '/venues/requests/pending' ? { requests: [amended, { ...amended, id: 10, event_name: 'Fair',
    original_requirements: { accessibility: ['Lift'] } }] } : base(path)));
  open('/venue/dashboard');
  fireEvent.click(await screen.findByRole('button', { name: 'Review Gala at Hall A' }));
  const facts = (term) => screen.getByText(term).nextSibling.textContent;
  expect([facts('Expected attendance'), facts('Room layout'), facts('Accessibility')]).toEqual(['150', 'Banquet', 'Ramp']);
  expect(screen.getByText((_, node) => node.tagName === 'P' && node.textContent === 'Originally requested: 60 guests; Theatre layout')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  // Only what the snapshot recorded is listed.
  fireEvent.click(await screen.findByRole('button', { name: 'Review Fair at Hall A' }));
  expect(screen.getByText((_, node) => node.tagName === 'P' && node.textContent === 'Originally requested: accessibility: Lift')).toBeTruthy();
});
// Test case: An ordinary pending request is still approved through the normal decision.
it('OC AC5 - an unflagged pending request still uses the normal approval with a hold expiry', async () => {
  user = venueStaff;
  const pending = { ...flaggedBooking, status: 'pending', recheck_required_at: null, recheck_reason: null };
  const base = api.get.getMockImplementation();
  api.get.mockImplementation(async (path) => (path === '/venues/requests/pending' ? { requests: [pending] } : base(path)));
  api.put.mockResolvedValue({ request: { ...pending, status: 'tentative', hold_expires_at: '2099-01-02T04:00:00.000Z', decision_by: 41,
    updated_at: '2030-01-03T03:00:00.000Z' } });
  open('/venue/dashboard');
  fireEvent.click(await screen.findByRole('button', { name: 'Review Gala at Hall A' }));
  expect(screen.queryByText(/Re-check required/)).toBeNull();
  // Main's tentative-hold workflow: approval needs an expiry and goes through the normal decision, not the re-check.
  fireEvent.change(screen.getByLabelText('Hold expiry (Singapore time)'), { target: { value: '2099-01-02T12:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Approve request' }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/venues/5/requests/9/decision',
    { decision: 'approved', reason: '', holdExpiresAt: '2099-01-02T04:00:00.000Z' }, 'session'));
  expect(await screen.findByText(/^Tentative hold approved: Gala at Hall A\./)).toBeTruthy();
});
// Test case: A flagged booking is already confirmed, so it has no hold expiry to set.
it('OC AC5 - a flagged booking is re-checked without a hold expiry', async () => {
  user = venueStaff;
  const base = api.get.getMockImplementation();
  api.get.mockImplementation(async (path) => (path === '/venues/requests/pending' ? { requests: [flaggedBooking] } : base(path)));
  open('/venue/dashboard');
  fireEvent.click(await screen.findByRole('button', { name: 'Review Gala at Hall A' }));
  expect(screen.queryByLabelText('Hold expiry (Singapore time)')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Approve request' })).toBeNull();
  expect(screen.getByText('Re-confirming keeps the confirmed booking; rejecting ends it. The Coordinator is told either way.')).toBeTruthy();
});
// Test case: When an approval reopens the safety check, the coordinator's confirmation names the Safety Officers told.
it('OC AC4 - approving a change reports the Safety Officers and registered attendees notified', async () => {
  const change = { id: 501, event_id: 101, event_name: 'Gala', organiser_name: 'Olivia', explanation: 'More guests', requested_changes: { expectedAttendance: 90 },
    changes: [{ field: 'expectedAttendance', label: 'Expected attendance', current: 60, requested: 90 }], arrangements: [] };
  const base = api.get.getMockImplementation();
  api.get.mockImplementation(async (path) => (path === '/events/change-requests' ? { changeRequests: [change] } : base(path)));
  api.post.mockResolvedValue({ message: 'Change approved and applied. Relevant staff have been notified.',
    notified: { organiser: [12], venueStaff: [], technicalSupport: [], safetyOfficers: [50, 51], attendees: [70, 71, 72] } });
  open('/coordinator/dashboard');
  fireEvent.click(await screen.findByRole('button', { name: 'Approve and apply' }));
  expect(await screen.findByText('Change approved and applied. Relevant staff have been notified. Notified: the organiser, Safety Officers (2), registered attendees (3).')).toBeTruthy();
});

// ---------- AC6: registration and withdrawal deadlines ----------

// Test case: The event page shows each deadline in Singapore time, or that none is set.
it('OC AC6 - the event page shows the deadlines in Singapore time or that none is set', async () => {
  open('/events/101');
  await screen.findByRole('heading', { name: 'Gala' });
  expect(screen.getByText('Not set (closes when the event starts)')).toBeTruthy();
  expect(screen.getByText('14 Oct 2030, 6:00 pm (SGT)')).toBeTruthy();
});
// Test case: The organiser requests a new withdrawal deadline and clears none; the form shows the current one in Singapore time.
it('OC AC6 - the organiser requests a deadline change from the amendment form', async () => {
  user = organiser;
  api.post.mockResolvedValue({ message: 'Amendment request submitted.' });
  open('/organizer/events/101');
  fireEvent.click(await screen.findByRole('button', { name: 'Request an amendment' }));
  const form = screen.getByRole('form', { name: 'Request an amendment' });
  expect(within(form).getByLabelText('Withdrawal deadline (Singapore time)').value).toBe('2030-10-14T18:00');
  expect(within(form).getByLabelText('Withdrawal deadline (Singapore time)').type).toBe('datetime-local');
  fireEvent.change(within(form).getByLabelText('Withdrawal deadline (Singapore time)'), { target: { value: '' } });
  fireEvent.change(within(form).getByLabelText('Registration deadline (Singapore time)'), { target: { value: '2030-10-13T12:00' } });
  fireEvent.change(within(form).getByLabelText('Explanation (required)'), { target: { value: 'Close registration earlier.' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Submit amendment request' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/events/101/amendment-requests',
    { changes: { registrationDeadline: '2030-10-13T12:00', withdrawalDeadline: null }, explanation: 'Close registration earlier.' }, 'session'));
});
// Test case: On a draft the organiser edits a deadline directly with the same Singapore date-time input.
it('OC AC6 - a draft deadline is edited directly with a date and time input', async () => {
  user = organiser;
  event = { ...baseEvent, status: 'draft', is_draft: true };
  api.put.mockResolvedValue({ event: { ...event, registration_deadline: '2030-10-12T04:00:00.000Z' }, message: 'Event information saved.' });
  open('/organizer/events/101');
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Registration deadline' }));
  const input = screen.getByLabelText('Edit Registration deadline');
  expect(input.type).toBe('datetime-local');
  fireEvent.change(input, { target: { value: '2030-10-12T12:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/events/101/non-critical', { registrationDeadline: '2030-10-12T12:00' }, 'session'));
  await act(async () => {});
  expect(await screen.findByText('12 Oct 2030, 12:00 pm (SGT)')).toBeTruthy();
});

// ---------- An event payload without its clarification list ----------

// Test case: An older event payload without a clarification list still records offline and applies amendments.
it('OC AC1 AC3 - an event read without a clarification list still records offline and offers no clarification link', async () => {
  const { clarification_requests: _omitted, ...withoutList } = baseEvent;
  event = withoutList;
  api.post.mockResolvedValue({ message: 'Offline clarification recorded.', clarificationRequest: { id: 603, source: 'offline', status: 'responded',
    information_needed: ['name'], message: 'Rename?', organiser_response: 'No.', created_at: '2030-01-01T02:00:00.000Z', responded_at: '2030-01-01T02:00:00.000Z' } });
  await openActivity();
  fireEvent.click(screen.getByRole('button', { name: 'Apply agreed amendment' }));
  const select = within(screen.getByRole('form', { name: 'Apply an agreed amendment' })).getByLabelText('Agreed in clarification (optional)');
  expect([...select.options].map((option) => option.value)).toEqual(['']);
  fireEvent.click(screen.getByRole('button', { name: 'Record an offline clarification' }));
  const form = screen.getByRole('form', { name: 'Record an offline clarification' });
  fireEvent.click(within(form).getByLabelText('Offline clarification about Event name'));
  fireEvent.change(within(form).getByLabelText('Clarification question'), { target: { value: 'Rename?' } });
  fireEvent.change(within(form).getByLabelText("Organiser's response"), { target: { value: 'No.' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Record offline clarification' }));
  await waitFor(() => expect(within(clarificationItems()[0]).getByText('No.')).toBeTruthy());
});
