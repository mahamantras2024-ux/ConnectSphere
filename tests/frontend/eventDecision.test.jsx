// File: Tests the Event Coordinator Approves/Rejects Event story through real routing: coordinator decisions, the organiser's
// outcome view and notifications, and the Safety Officer's Operational Safety Check queue.
// Test scope: Real App routes, AuthProvider, EventDetail, dashboards and new components; only the API client is replaced.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../frontend/src/api/client';
import App from '../../frontend/src/App';
import { AuthProvider } from '../../frontend/src/context/AuthContext';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

let user;
let review;
let event;
const routes = {};
// Readiness exactly as the API reports it when every requirement is met.
const metReadiness = [
  { name: 'clarificationsResolved', met: true, code: 'CLARIFICATIONS_RESOLVED', message: 'No clarification is outstanding.' },
  { name: 'venueConfirmed', met: true, code: 'VENUE_CONFIRMED', message: 'Venue booking confirmed.' },
  { name: 'technicalConfirmed', met: true, code: 'TECHNICAL_NOT_REQUIRED', message: 'No equipment or technical support was requested.' },
  { name: 'safetyPassed', met: true, code: 'SAFETY_APPROVED', message: 'Operational safety check passed.' },
];
const readyReview = { status: 'submitted', outcome: null, readiness: metReadiness, allowed: { approved: true, rejected: true },
  blocked: { approved: null, rejected: null }, safetyCheck: { outcome: 'approved', notes: null, safety_officer_name: 'Sam' } };
// Replaces one readiness requirement's state, as the API would after that requirement changes.
const withUnmet = (name, message) => readyReview.readiness.map((item) => (item.name === name ? { ...item, met: false, message } : item));
// What the API returns to the coordinator once the event is decided: the outcome plus readiness, with no decision allowed.
const decidedReview = (decision, reason) => {
  const blocker = { code: 'ALREADY_DECIDED', message: `This event has already been ${decision}.` };
  return { ...readyReview, status: decision, outcome: { decision, reason, decidedAt: '2030-01-02T03:04:05.000Z', decidedBy: 'Chris' },
    allowed: { approved: false, rejected: false }, blocked: { approved: blocker, rejected: blocker } };
};

// Renders the application at a route with a stored session token.
function open(path) {
  localStorage.setItem('cs_token', 'session-token');
  render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AuthProvider><App /></AuthProvider></MemoryRouter>);
}
const decisionPanel = async () => screen.findByRole('region', { name: 'Review decision' });
const decisionLoads = () => api.get.mock.calls.filter(([path]) => path === '/events/101/decision').length;

beforeEach(() => {
  localStorage.clear();
  user = { id: 30, email: 'chris@example.com', full_name: 'Chris', role: 'event_coordinator' };
  event = { id: 101, name: 'Community Workshop', organiser_id: 12, coordinator_id: 30, status: 'submitted', clarification_outstanding: false, clarification_requests: [] };
  review = readyReview;
  Object.assign(routes, { '/notifications': { notifications: [], unreadCount: 0 }, '/events': { events: [] }, '/events/change-requests': { changeRequests: [] } });
  api.get.mockImplementation(async (path) => {
    if (path === '/auth/me') return { user };
    if (path === '/events/101') return { event };
    if (path === '/events/101/decision') return typeof review === 'function' ? review() : review;
    if (path in routes) return typeof routes[path] === 'function' ? routes[path]() : routes[path];
    throw new Error(`Unexpected request: ${path}`);
  });
});
afterEach(cleanup);

// ---------- Coordinator decisions ----------

// Test case: Every requirement is met; the coordinator approves, buttons lock while sending, and the page shows the stored outcome.
it('AR AC1/AC4/AC5 - the coordinator approves a ready event and sees the stored outcome', async () => {
  // Arrange: the second GET (after the decision) returns the stored outcome.
  let finish;
  api.post.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  open('/events/101');
  const panel = await decisionPanel();
  const checklist = await within(panel).findByRole('list', { name: 'Decision readiness' });
  expect(within(checklist).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
    'ClarificationsCompleteNo clarification is outstanding.', 'Venue arrangementsCompleteVenue booking confirmed.',
    'Technical arrangementsCompleteNo equipment or technical support was requested.', 'Operational safety checkCompleteOperational safety check passed.']);
  expect(within(panel).getByText('Safety Officer (Sam): Passed')).toBeTruthy();
  // Act
  fireEvent.click(within(panel).getByRole('button', { name: 'Approve event' }));
  // Assert: one decision in flight locks both buttons.
  expect(api.post).toHaveBeenCalledWith('/events/101/decision', { decision: 'approved' }, 'session-token');
  expect(within(panel).getByRole('button', { name: 'Saving…' }).disabled).toBe(true);
  expect(within(panel).getByRole('button', { name: 'Reject event' }).disabled).toBe(true);
  review = decidedReview('approved', null);
  await act(async () => finish({ event: { status: 'approved' }, message: 'Event approved. The organiser has been notified.' }));
  expect(within(panel).getByRole('status').textContent).toBe('Event approved. The organiser has been notified.');
  expect(await within(panel).findByText('Approved by Chris on 2 Jan 2030, 11:04 am')).toBeTruthy();
  expect(within(panel).getByText('Not applicable')).toBeTruthy();
  // The page header status reflects the decision without a reload.
  expect(screen.getByText('Approved', { selector: 'span:not(.status-badge)' })).toBeTruthy();
  expect(within(panel).queryByRole('button', { name: 'Approve event' })).toBeNull();
});

// Test case: A failed safety check blocks approval with its reason shown, while rejection stays available (AC2).
it('AR AC2 - after a failed safety check approval is unavailable with the reason, but rejection is still possible', async () => {
  review = { ...readyReview, readiness: withUnmet('safetyPassed', 'The event failed the operational safety check.'),
    allowed: { approved: false, rejected: true }, blocked: { approved: { code: 'SAFETY_FAILED', message: 'The event failed the operational safety check.' }, rejected: null },
    safetyCheck: { outcome: 'rejected', notes: 'Fire exit blocked', safety_officer_name: 'Sam' } };
  open('/events/101');
  const panel = await decisionPanel();
  expect(await within(panel).findByText('Approval unavailable: The event failed the operational safety check.')).toBeTruthy();
  expect(within(panel).getByText('Safety Officer (Sam): Failed — Fire exit blocked')).toBeTruthy();
  const safetyRow = within(panel).getByText('Operational safety check').closest('li');
  expect(within(safetyRow).getByText('Outstanding')).toBeTruthy();
  expect(within(panel).getByRole('button', { name: 'Approve event' }).disabled).toBe(true);
  expect(within(panel).getByRole('button', { name: 'Reject event' }).disabled).toBe(false);
  expect(within(panel).queryByText(/Rejection unavailable/)).toBeNull();
});

// Test case: The coordinator rejects with a reason; the reason is sent and the outcome shows it (AC3).
it('AR AC3/AC4 - the coordinator rejects with a reason and the stored reason is displayed', async () => {
  let finish;
  api.post.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  open('/events/101');
  const panel = await decisionPanel();
  fireEvent.click(await within(panel).findByRole('button', { name: 'Reject event' }));
  fireEvent.change(within(panel).getByLabelText('Reason for rejection (optional)'), { target: { value: 'No suitable venue.' } });
  fireEvent.click(within(panel).getByRole('button', { name: 'Confirm rejection' }));
  expect(api.post).toHaveBeenCalledWith('/events/101/decision', { decision: 'rejected', reason: 'No suitable venue.' }, 'session-token');
  expect(within(panel).getByRole('button', { name: 'Sending…' }).disabled).toBe(true);
  expect(within(panel).getByLabelText('Reason for rejection (optional)').disabled).toBe(true);
  review = decidedReview('rejected', 'No suitable venue.');
  await act(async () => finish({ event: { status: 'rejected' }, message: 'Event rejected. The organiser has been notified.' }));
  expect(await within(panel).findByText('No suitable venue.')).toBeTruthy();
  expect(within(panel).getByText('Rejected by Chris on 2 Jan 2030, 11:04 am')).toBeTruthy();
});

// Test case: Opening and cancelling the rejection form sends nothing and restores the decision buttons.
it('AR AC3 - cancelling a rejection sends nothing', async () => {
  open('/events/101');
  const panel = await decisionPanel();
  fireEvent.click(await within(panel).findByRole('button', { name: 'Reject event' }));
  fireEvent.change(within(panel).getByLabelText('Reason for rejection (optional)'), { target: { value: 'draft' } });
  fireEvent.click(within(panel).getByRole('button', { name: 'Cancel' }));
  expect(within(panel).getByRole('button', { name: 'Approve event' })).toBeTruthy();
  expect(api.post).not.toHaveBeenCalled();
  // Reopening starts from an empty reason.
  fireEvent.click(within(panel).getByRole('button', { name: 'Reject event' }));
  expect(within(panel).getByLabelText('Reason for rejection (optional)').value).toBe('');
});

// Test case: An outstanding clarification blocks both decisions, each with an explanation (AC7).
it('AR AC7 - with a clarification outstanding neither decision is available', async () => {
  const blocker = { code: 'CLARIFICATION_OUTSTANDING', message: 'A clarification from the organiser is still outstanding.' };
  review = { ...readyReview, readiness: withUnmet('clarificationsResolved', blocker.message), allowed: { approved: false, rejected: false }, blocked: { approved: blocker, rejected: blocker } };
  open('/events/101');
  const panel = await decisionPanel();
  expect(await within(panel).findByText('Rejection unavailable: A clarification from the organiser is still outstanding.')).toBeTruthy();
  expect(within(panel).getByText('Approval unavailable: A clarification from the organiser is still outstanding.')).toBeTruthy();
  expect(within(panel).getByRole('button', { name: 'Approve event' }).disabled).toBe(true);
  expect(within(panel).getByRole('button', { name: 'Reject event' }).disabled).toBe(true);
});

// Test case: Sending a clarification on the same page changes AC7 readiness, so the decision panel re-reads it.
it('AR AC7 - sending a clarification refreshes whether a decision is allowed', async () => {
  api.post.mockResolvedValue({ clarificationRequest: { id: 5, information_needed: ['name'], message: 'Confirm the title.', status: 'pending' }, message: 'Clarification request sent to the Event Organiser.' });
  open('/events/101');
  await within(await decisionPanel()).findByRole('button', { name: 'Approve event' });
  expect(decisionLoads()).toBe(1);
  fireEvent.click(screen.getByLabelText('Event name'));
  fireEvent.change(screen.getByLabelText('What needs clarification?'), { target: { value: 'Confirm the title.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send clarification request' }));
  await waitFor(() => expect(decisionLoads()).toBe(2));
});

// Test case: The decision is refused because something changed (409); the server's reason is shown and the panel re-reads.
it('AR AC4 - a refused decision shows the server reason and reloads the review', async () => {
  api.post.mockRejectedValue(Object.assign(new Error('This event has already been approved.'), { status: 409 }));
  open('/events/101');
  const panel = await decisionPanel();
  fireEvent.click(await within(panel).findByRole('button', { name: 'Approve event' }));
  expect((await within(panel).findByRole('alert')).textContent).toBe('This event has already been approved.');
  await waitFor(() => expect(decisionLoads()).toBe(2));
  expect(within(panel).queryByRole('status', { name: /approved/i })).toBeNull();
});

// ---------- Organiser outcome view (AC6) ----------

// The organiser sees the outcome of their own request: pending, approved, rejected with and without a reason.
it.each([
  ['pending', { status: 'submitted', outcome: null }, ["Awaiting the Event Coordinator's decision. You will be notified of the outcome."], 'Awaiting decision'],
  ['approved', { status: 'approved', outcome: { decision: 'approved', reason: null, decidedAt: '2030-01-02T03:04:05.000Z', decidedBy: 'Chris' } },
    ['Approved by Chris on 2 Jan 2030, 11:04 am', 'Not applicable'], 'Approved'],
  ['rejected with a reason', { status: 'rejected', outcome: { decision: 'rejected', reason: 'Venue unavailable', decidedAt: '2030-01-02T03:04:05.000Z', decidedBy: 'Chris' } },
    ['Rejected by Chris on 2 Jan 2030, 11:04 am', 'Venue unavailable'], 'Rejected'],
  ['rejected without a reason', { status: 'rejected', outcome: { decision: 'rejected', reason: null, decidedAt: '2030-01-02T03:04:05.000Z', decidedBy: 'Chris' } },
    ['No reason was given.'], 'Rejected'],
])('AR AC6 - the organiser can view a %s outcome and has no decision controls', async (_label, response, texts, badge) => {
  user = { id: 12, email: 'olivia@example.com', full_name: 'Olivia', role: 'event_organiser' };
  review = response;
  open('/organizer/events/101');
  const panel = await decisionPanel();
  for (const text of texts) expect(await within(panel).findByText(text)).toBeTruthy();
  expect(within(panel).getByText(badge, { selector: '.status-badge' })).toBeTruthy();
  expect(within(panel).queryByRole('button')).toBeNull();
});

// Test case: The decision panel cannot load or receives an unexpected response; it says so without breaking the event page.
it.each([
  ['a failed request', () => { throw new Error('Unable to load the review.'); }, 'event_coordinator', 'Unable to load the review.'],
  ['a coordinator response without readiness', () => ({ status: 'submitted', outcome: null }), 'event_coordinator', 'The review decision is unavailable right now.'],
  ['a response without a status', () => ({ event: {} }), 'event_organiser', 'The review decision is unavailable right now.'],
])('AR AC6 - %s shows the panel as unavailable while the event page still works', async (_label, response, role, message) => {
  user = { ...user, role };
  review = response;
  open(role === 'event_organiser' ? '/organizer/events/101' : '/events/101');
  const panel = await decisionPanel();
  expect(await within(panel).findByText(message)).toBeTruthy();
  // Not an alert: a panel outage must not mask the page's own errors; the event itself still renders.
  expect(within(panel).queryByRole('alert')).toBeNull();
  expect(screen.getByRole('heading', { name: 'Community Workshop' })).toBeTruthy();
});

// Test case: The organiser is notified of the outcome on their dashboard and can mark it read (AC6).
it('AR AC6 - the organiser receives the decision as a dashboard notification and can mark it read', async () => {
  user = { id: 12, email: 'olivia@example.com', full_name: 'Olivia', role: 'event_organiser' };
  routes['/notifications'] = { unreadCount: 1, notifications: [{ id: 4, title: 'Event request not approved: Community Workshop',
    message: 'Your event request Community Workshop was not approved by the Event Coordinator.\nReason: Venue unavailable', created_at: '2030-01-02T03:04:05.000Z', read_at: null }] };
  api.post.mockResolvedValue({ notification: { id: 4, read_at: '2030-01-02T04:00:00.000Z' } });
  open('/organizer/dashboard');
  const panel = await screen.findByRole('region', { name: 'Notifications' });
  const item = (await within(panel).findByText('Event request not approved: Community Workshop')).closest('li');
  expect(within(item).getByText(/Reason: Venue unavailable/)).toBeTruthy();
  expect(within(panel).getByText('1 unread')).toBeTruthy();
  fireEvent.click(within(item).getByRole('button', { name: 'Mark Event request not approved: Community Workshop as read' }));
  expect(within(item).getByRole('button').disabled).toBe(true);
  expect(await within(panel).findByText('0 unread')).toBeTruthy();
  expect(api.post).toHaveBeenCalledWith('/notifications/4/read', {}, 'session-token');
  expect(within(item).queryByRole('button')).toBeNull();
});

// ---------- Safety Officer queue (Week 7 change 6) ----------

const queuedEvent = { id: 101, name: 'Community Workshop', proposed_date: '2030-10-15', proposed_start_time: '10:00:00', proposed_end_time: '12:00:00',
  expected_attendance: 80, room_layout_preference: 'Theatre', accessibility_requirements: ['Ramp', 'Hearing loop'],
  equipment_items: [{ item: 'Projector', quantity: 1 }], technical_support_required: true, video_conferencing_required: true, equipment_notes: ' Spare batteries ',
  venues: [{ name: 'Hall A', capacity: 100 }], latest_safety_check: { outcome: 'changes_requested', notes: 'Widen aisles' } };
const sparseEvent = { id: 102, name: 'Sparse Talk', proposed_date: null, proposed_start_time: '09:00:00', proposed_end_time: null, expected_attendance: null,
  room_layout_preference: null, accessibility_requirements: [], equipment_items: [], technical_support_required: false, video_conferencing_required: false,
  equipment_notes: null, venues: [{ name: 'Room B', capacity: 20 }], latest_safety_check: null };
// Opens the Safety Officer dashboard with the given queue response.
async function openSafety(queue) {
  user = { id: 50, email: 'sam@example.com', full_name: 'Sam', role: 'safety_officer', roles: ['safety_officer'] };
  routes['/safety/checks'] = queue;
  open('/safety/dashboard');
  return screen.findByRole('region', { name: 'Operational safety checks' });
}
const card = (panel, name) => within(panel).getByText(name, { selector: 'strong' }).closest('li');
const facts = (item) => Object.fromEntries([...item.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent]));

// Test case: The queue shows the facts the Safety Officer reviews, including explicit "not specified" values.
it('AR AC1 - the Safety Officer sees each ready event with the facts the safety check considers', async () => {
  const panel = await openSafety({ events: [queuedEvent, sparseEvent] });
  await within(panel).findByText('Community Workshop', { selector: 'strong' });
  expect(within(panel).getByText('2 ready')).toBeTruthy();
  expect(facts(card(panel, 'Community Workshop'))).toEqual({ 'Date and time': '2030-10-15, 10:00–12:00', 'Expected attendance': '80', Venue: 'Hall A (capacity 100)',
    Layout: 'Theatre', Accessibility: 'Ramp, Hearing loop', Equipment: 'Projector × 1; On-site technical support; Video-conferencing / hybrid; Spare batteries' });
  expect(within(card(panel, 'Community Workshop')).getByText('Last check: Changes requested')).toBeTruthy();
  expect(facts(card(panel, 'Sparse Talk'))).toEqual({ 'Date and time': 'Not specified, 09:00–?', 'Expected attendance': 'Not specified', Venue: 'Room B (capacity 20)',
    Layout: 'Not specified', Accessibility: 'None recorded', Equipment: 'None requested' });
  expect(within(card(panel, 'Sparse Talk')).getByText('Not yet checked')).toBeTruthy();
});

// Test case: An event with no time at all omits the time part instead of inventing one.
it('AR AC1 - an event without a start time shows only its date', async () => {
  const panel = await openSafety({ events: [{ ...sparseEvent, proposed_date: '2030-11-01', proposed_start_time: null }] });
  await within(panel).findByText('Sparse Talk', { selector: 'strong' });
  expect(facts(card(panel, 'Sparse Talk'))['Date and time']).toBe('2030-11-01');
});

// Test case: Missing outcome or missing notes on a failed check are explained in the form and nothing is sent.
it('AR AC2 - the safety form requires an outcome, and notes unless approving', async () => {
  const panel = await openSafety({ events: [queuedEvent] });
  const item = await within(panel).findByText('Community Workshop', { selector: 'strong' }).then((strong) => strong.closest('li'));
  fireEvent.click(within(item).getByRole('button', { name: 'Record safety check' }));
  expect(within(panel).getByRole('alert').textContent).toBe('Choose an outcome for the safety check.');
  fireEvent.click(within(item).getByLabelText('Reject'));
  fireEvent.change(within(item).getByLabelText('Notes (required unless approving)'), { target: { value: '   ' } });
  fireEvent.click(within(item).getByRole('button', { name: 'Record safety check' }));
  expect(within(panel).getByRole('alert').textContent).toBe('Explain what is unsafe or what must change.');
  expect(api.post).not.toHaveBeenCalled();
});

// Test case: Recording a failed check sends the outcome and notes, confirms, clears the form and reloads the queue.
it('AR AC2 - the Safety Officer records a failed check with notes', async () => {
  let finish;
  api.post.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const panel = await openSafety({ events: [queuedEvent] });
  const item = (await within(panel).findByText('Community Workshop', { selector: 'strong' })).closest('li');
  fireEvent.click(within(item).getByLabelText('Request changes'));
  fireEvent.click(within(item).getByLabelText('Reject'));
  fireEvent.change(within(item).getByLabelText('Notes (required unless approving)'), { target: { value: 'Fire exit blocked' } });
  fireEvent.click(within(item).getByRole('button', { name: 'Record safety check' }));
  expect(api.post).toHaveBeenCalledWith('/events/101/safety-checks', { outcome: 'rejected', notes: 'Fire exit blocked' }, 'session-token');
  expect(within(item).getByRole('button', { name: 'Recording…' }).disabled).toBe(true);
  expect(within(item).getByLabelText('Reject').matches(':disabled')).toBe(true);
  await act(async () => finish({ message: 'Safety check recorded. The Event Coordinator has been notified.' }));
  expect(within(panel).getByRole('status').textContent).toBe('Safety check recorded. The Event Coordinator has been notified.');
  expect(within(item).getByLabelText('Reject').checked).toBe(false);
  expect(within(item).getByLabelText('Notes (required unless approving)').value).toBe('');
  expect(api.get.mock.calls.filter(([path]) => path === '/safety/checks')).toHaveLength(2);
});

// Test case: Approving needs no notes; the outcome is sent with empty notes.
it('AR AC1 - the Safety Officer approves without notes', async () => {
  api.post.mockResolvedValue({ message: 'Safety check recorded.' });
  const panel = await openSafety({ events: [queuedEvent] });
  const item = (await within(panel).findByText('Community Workshop', { selector: 'strong' })).closest('li');
  fireEvent.click(within(item).getByLabelText('Approve'));
  fireEvent.click(within(item).getByRole('button', { name: 'Record safety check' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/events/101/safety-checks', { outcome: 'approved', notes: '' }, 'session-token'));
  expect(await within(panel).findByRole('status')).toBeTruthy();
});

// Test case: The server refuses the check (e.g. arrangements changed); the reason is shown.
it('AR AC1 - a refused safety check shows the server reason', async () => {
  api.post.mockRejectedValue(new Error('No venue booking has been confirmed by Venue Staff.'));
  const panel = await openSafety({ events: [queuedEvent] });
  const item = (await within(panel).findByText('Community Workshop', { selector: 'strong' })).closest('li');
  fireEvent.click(within(item).getByLabelText('Approve'));
  fireEvent.click(within(item).getByRole('button', { name: 'Record safety check' }));
  expect((await within(panel).findByRole('alert')).textContent).toBe('No venue booking has been confirmed by Venue Staff.');
});

// Queue states: loading, empty and failed.
it('AR AC1 - the safety queue distinguishes loading, empty and failed states', async () => {
  let release;
  let panel = await openSafety(() => new Promise((resolve) => { release = resolve; }));
  expect(within(panel).getByText('Loading safety checks...')).toBeTruthy();
  expect(within(panel).queryByText(/ready/)).toBeNull();
  await act(async () => release({ events: [] }));
  expect(within(panel).getByText(/No events are waiting for a safety check/)).toBeTruthy();
  expect(within(panel).getByText('0 ready')).toBeTruthy();
  cleanup();
  panel = await openSafety(() => { throw new Error('Unable to load safety checks.'); });
  expect((await within(panel).findByRole('alert')).textContent).toBe('Unable to load safety checks.');
});
