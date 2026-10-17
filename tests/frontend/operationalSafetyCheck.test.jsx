// File: Tests the Operational Feasibility Check story through real routing: the Safety Officer's queue facts and change
// requests, and the requested-changes panel the coordinator and organiser see on the event page.
// Test scope: Real App routes, AuthProvider, dashboards, EventDetail and new components; only the API client is replaced.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../frontend/src/api/client';
import App from '../../frontend/src/App';
import { AuthProvider } from '../../frontend/src/context/AuthContext';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

let user;
let queue;
let review;
const officer = { id: 50, email: 'sam@example.com', full_name: 'Sam', role: 'safety_officer', roles: ['safety_officer'] };
const coordinator = { id: 30, email: 'chris@example.com', full_name: 'Chris', role: 'event_coordinator', roles: ['event_coordinator'] };
const organiser = { id: 12, email: 'olivia@example.com', full_name: 'Olivia', role: 'event_organiser', roles: ['event_organiser'] };
// A queued event as GET /api/safety/checks returns it, with every safety fact recorded.
const hallA = { name: 'Hall A', capacity: 100, supported_layouts: ['Theatre', 'Banquet'], accessibility_features: ['Ramp', 'Lift'],
  operating_hours: '08:00 - 22:00', setup_minutes: 30, turnaround_minutes: 15, emergency_access: 'Two exits to Marina Road', known_restrictions: 'No open flames' };
const gala = { id: 101, name: 'Annual Gala', proposed_date: '2030-10-15', proposed_start_time: '18:00:00', proposed_end_time: '22:00:00',
  expected_attendance: 80, room_layout_preference: 'Banquet', accessibility_requirements: ['Wheelchair seating'],
  equipment_items: [{ item: 'Projector', quantity: 1 }], technical_support_required: false, video_conferencing_required: false, equipment_notes: null,
  technical_specifications: 'Projector at the rear wall', venues: [hallA], latest_safety_check: null };
const review101 = { status: 'submitted', outcome: null, readiness: [], allowed: { approved: false, rejected: true },
  blocked: { approved: { code: 'SAFETY_CHANGES_REQUESTED', message: 'The Safety Officer requested changes before the event can proceed.' }, rejected: null }, safetyCheck: null };

// Renders the application at a route with a stored session token.
function open(path) {
  localStorage.setItem('cs_token', 'session-token');
  render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AuthProvider><App /></AuthProvider></MemoryRouter>);
}
// Opens the Safety Officer dashboard and returns the queued event's card.
async function openQueue(events) {
  user = officer; queue = { events };
  open('/safety/dashboard');
  const panel = await screen.findByRole('region', { name: 'Operational safety checks' });
  return { panel, item: (await within(panel).findByText(events[0].name, { selector: 'strong' })).closest('li') };
}
const facts = (item) => Object.fromEntries([...item.querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent]));
const stageBox = (item, label) => within(item).getByRole('checkbox', { name: label });

beforeEach(() => {
  localStorage.clear();
  api.get.mockReset(); api.post.mockReset();
  api.get.mockImplementation(async (path) => {
    if (path === '/auth/me') return { user };
    if (path === '/safety/checks') return typeof queue === 'function' ? queue() : queue;
    if (path === '/events/101') return { event: { id: 101, name: 'Annual Gala', organiser_id: 12, coordinator_id: 30, status: 'submitted', clarification_outstanding: false, clarification_requests: [] } };
    if (path === '/events/101/decision') return typeof review === 'function' ? review() : review;
    if (path === '/notifications') return { notifications: [], unreadCount: 0 };
    if (path === '/events' || path === '/events/change-requests') return { events: [], changeRequests: [] };
    throw new Error(`Unexpected request: ${path}`);
  });
});
afterEach(cleanup);

// ---------- AC1: the facts for the check ----------

// Test case: Every AC1 fact is shown, taken from the event and from what Venue Staff recorded on the venue.
it('OFC AC1 - the Safety Officer sees attendance, capacity and layout, emergency access, accessibility, equipment placement, crowd movement and restrictions', async () => {
  const { item } = await openQueue([gala]);
  expect(facts(item)).toMatchObject({
    'Expected attendance': '80', Venue: 'Hall A (capacity 100)', Layout: 'Banquet', Occupancy: '80 of 100 (80%)',
    'Venue layouts': 'Hall A: Theatre, Banquet', 'Emergency access': 'Hall A: Two exits to Marina Road',
    Accessibility: 'Wheelchair seating', 'Venue accessibility': 'Hall A: Ramp, Lift',
    Equipment: 'Projector × 1', 'Equipment placement': 'Projector at the rear wall',
    'Crowd movement': 'Hall A: open 08:00 - 22:00, 30 min setup, 15 min turnaround', 'Known venue restrictions': 'Hall A: No open flames',
  });
  // A first check has no previous outcome to show.
  expect('Previous check' in facts(item)).toBe(false);
});

// Occupancy against total confirmed capacity, just below, exactly at and just above 100%.
it.each([[99, '99 of 100 (99%)'], [100, '100 of 100 (100%)'], [101, '101 of 100 (101%) - over capacity']])(
  'OFC AC1 - %i expected guests in a 100-person venue show occupancy %s', async (attendance, expected) => {
    const { item } = await openQueue([{ ...gala, expected_attendance: attendance }]);
    expect(facts(item).Occupancy).toBe(expected);
  });

// Test case: Two confirmed venues: capacity is combined and each venue's facts are listed by name.
it('OFC AC1 - an event across two venues combines capacity and lists each venue\'s facts', async () => {
  const roomB = { name: 'Room B', capacity: 60, supported_layouts: ['Classroom'], accessibility_features: [], operating_hours: '09:00 - 18:00', setup_minutes: 0, turnaround_minutes: 0, emergency_access: null, known_restrictions: 'Max 2 kN/m² floor load' };
  const { item } = await openQueue([{ ...gala, expected_attendance: 120, venues: [hallA, roomB] }]);
  expect(facts(item)).toMatchObject({
    Occupancy: '120 of 160 (75%)', 'Emergency access': 'Hall A: Two exits to Marina Road; Room B: Not recorded',
    'Known venue restrictions': 'Hall A: No open flames; Room B: Max 2 kN/m² floor load',
    'Crowd movement': 'Hall A: open 08:00 - 22:00, 30 min setup, 15 min turnaround; Room B: open 09:00 - 18:00, 0 min setup, 0 min turnaround',
  });
});

// Test case: Older venues and sparse events show explicit "not recorded/specified" values instead of blanks.
it('OFC AC1 - missing venue facts, attendance and placement details are shown as not recorded', async () => {
  const legacyVenue = { name: 'Old Hall', capacity: 50, supported_layouts: null, accessibility_features: null, operating_hours: null, setup_minutes: null, turnaround_minutes: null, emergency_access: null, known_restrictions: null };
  const { item } = await openQueue([{ ...gala, expected_attendance: null, technical_specifications: '  ', venues: [legacyVenue] }]);
  expect(facts(item)).toMatchObject({
    Occupancy: 'Not specified', 'Venue layouts': 'Old Hall: Not recorded', 'Emergency access': 'Old Hall: Not recorded',
    'Venue accessibility': 'Old Hall: Not recorded', 'Equipment placement': 'Not specified', 'Crowd movement': 'Old Hall: Not recorded',
    'Known venue restrictions': 'Old Hall: Not recorded',
  });
});

// Test case: A re-check shows what was asked for last time (AC4).
it('OFC AC4 - a re-check shows the previous change request with its stages and notes', async () => {
  const { item } = await openQueue([{ ...gala, latest_safety_check: { outcome: 'changes_requested', notes: 'Move the projector', change_areas: ['technical', 'event_details'] } }]);
  expect(facts(item)['Previous check']).toBe('Changes requested to Technical arrangements, Event details - Move the projector');
  expect(within(item).getByText('Last check: Changes requested')).toBeTruthy();
});

// ---------- AC2/AC3: requesting changes names the planning stages ----------

// Test case: The stage choices appear only for "Request changes", and at least one is required.
it('OFC AC3 - requesting changes requires choosing at least one planning stage', async () => {
  const { panel, item } = await openQueue([gala]);
  expect(within(item).queryByRole('group', { name: 'Planning stages to reopen for Annual Gala' })).toBeNull();
  fireEvent.click(within(item).getByLabelText('Request changes'));
  expect(within(item).getByRole('group', { name: 'Planning stages to reopen for Annual Gala' })).toBeTruthy();
  fireEvent.change(within(item).getByLabelText('Notes (required unless approving)'), { target: { value: 'Second exit needed' } });
  fireEvent.click(within(item).getByRole('button', { name: 'Record safety check' }));
  expect(within(panel).getByRole('alert').textContent).toBe('Choose which planning stages need changes.');
  expect(api.post).not.toHaveBeenCalled();
});

// Test case: The chosen stages are sent in a fixed order, the outcome confirmed and the queue reloaded (AC2/AC3).
it('OFC AC2/AC3 - the Safety Officer requests changes to chosen stages and sees the event return to planning', async () => {
  // Arrange
  let finish;
  api.post.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const { panel, item } = await openQueue([gala]);
  // Act: choose event details first, then venue, then untick and re-tick to prove the final selection is sent.
  fireEvent.click(within(item).getByLabelText('Request changes'));
  fireEvent.click(stageBox(item, 'Event details'));
  fireEvent.click(stageBox(item, 'Venue arrangements'));
  fireEvent.click(stageBox(item, 'Technical arrangements'));
  fireEvent.click(stageBox(item, 'Technical arrangements'));
  fireEvent.change(within(item).getByLabelText('Notes (required unless approving)'), { target: { value: 'Second exit needed' } });
  fireEvent.click(within(item).getByRole('button', { name: 'Record safety check' }));
  // Assert
  expect(api.post).toHaveBeenCalledWith('/events/101/safety-checks',
    { outcome: 'changes_requested', notes: 'Second exit needed', changeAreas: ['venue', 'event_details'] }, 'session-token');
  // The whole stage group locks while the check is being recorded (fieldset-disabled controls match :disabled).
  expect(stageBox(item, 'Venue arrangements').matches(':disabled')).toBe(true);
  queue = { events: [] };
  await act(async () => finish({ message: 'Safety check recorded. The Event Coordinator has been notified. The event has returned to planning for the requested changes.' }));
  expect(within(panel).getByRole('status').textContent).toBe('Safety check recorded. The Event Coordinator has been notified. The event has returned to planning for the requested changes.');
  expect(await within(panel).findByText(/No events are waiting for a safety check/)).toBeTruthy();
});

// Test case: Technical arrangements cannot be chosen when the event asked for nothing technical.
it('OFC AC3 - the technical stage is unavailable for an event with no technical needs', async () => {
  const { item } = await openQueue([{ ...gala, equipment_items: [] }]);
  fireEvent.click(within(item).getByLabelText('Request changes'));
  expect(stageBox(item, 'Technical arrangements').disabled).toBe(true);
  expect(stageBox(item, 'Venue arrangements').disabled).toBe(false);
});

// Each technical need on its own makes the technical stage available (matching the server's rule); blank notes do not.
it.each([
  ['an equipment item', { equipment_items: [{ item: 'Projector', quantity: 1 }] }, false],
  ['on-site technical support', { technical_support_required: true }, false],
  ['video-conferencing', { video_conferencing_required: true }, false],
  ['other equipment notes', { equipment_notes: 'Spare batteries' }, false],
  ['only blank equipment notes', { equipment_notes: '   ' }, true],
])('OFC AC3 - an event that requested %s can reopen technical arrangements unless blank (disabled: %s)', async (label, needs, disabled) => {
  const { item } = await openQueue([{ ...gala, equipment_items: [], ...needs }]);
  fireEvent.click(within(item).getByLabelText('Request changes'));
  expect(stageBox(item, 'Technical arrangements').disabled).toBe(disabled);
});

// Test case: Switching to Reject after ticking stages sends no stages (only change requests reopen planning).
it('OFC AC2 - stages ticked before switching to Reject are not sent', async () => {
  api.post.mockResolvedValue({ message: 'Safety check recorded.' });
  const { item } = await openQueue([gala]);
  fireEvent.click(within(item).getByLabelText('Request changes'));
  fireEvent.click(stageBox(item, 'Venue arrangements'));
  fireEvent.click(within(item).getByLabelText('Reject'));
  fireEvent.change(within(item).getByLabelText('Notes (required unless approving)'), { target: { value: 'Unsafe' } });
  fireEvent.click(within(item).getByRole('button', { name: 'Record safety check' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/events/101/safety-checks', { outcome: 'rejected', notes: 'Unsafe' }, 'session-token'));
});

// ---------- AC3/AC4/AC5: the event page while changes are open ----------

const changesReview = (open) => ({ ...review101, safetyChanges: { open, notes: 'Second exit needed' } });

// Test case: The coordinator completes a ready stage; a stage whose arrangement is not ready explains why and stays locked.
it('OFC AC3/AC4 - the coordinator marks a completed stage and sees why another cannot be completed yet', async () => {
  // Arrange: the venue is re-confirmed; event details still wait for a clarification.
  user = coordinator;
  review = changesReview([{ area: 'venue', blocked: null }, { area: 'event_details', blocked: { code: 'CLARIFICATION_OUTSTANDING', message: 'A clarification from the organiser is still outstanding.' } }]);
  let finish;
  api.post.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  open('/events/101');
  const changes = await screen.findByRole('group', { name: 'Safety changes requested' });
  // Assert the starting state, then Act.
  expect(within(changes).getByText('Safety Officer notes: Second exit needed')).toBeTruthy();
  expect(within(changes).getByText('A clarification from the organiser is still outstanding.')).toBeTruthy();
  expect(within(changes).getByRole('button', { name: 'Mark event details complete' }).disabled).toBe(true);
  fireEvent.click(within(changes).getByRole('button', { name: 'Mark venue arrangements complete' }));
  expect(api.post).toHaveBeenCalledWith('/events/101/safety-changes/resolve', { area: 'venue' }, 'session-token');
  expect(within(changes).getByRole('button', { name: 'Saving…' }).disabled).toBe(true);
  review = changesReview([{ area: 'event_details', blocked: { code: 'CLARIFICATION_OUTSTANDING', message: 'A clarification from the organiser is still outstanding.' } }]);
  await act(async () => finish({ open: ['event_details'], message: 'Stage marked complete.' }));
  // Assert: confirmation shown and the re-read review drops the completed stage. Approval remains blocked (AC5).
  expect(within(changes).getByRole('status').textContent).toBe('Stage marked complete.');
  await waitFor(() => expect(within(changes).queryByText('Venue arrangements')).toBeNull());
  expect(screen.getByRole('button', { name: 'Approve event' }).disabled).toBe(true);
});

// Test case: A refused completion shows the server reason and re-reads the review.
it('OFC AC4 - a refused stage completion shows the server reason', async () => {
  user = coordinator;
  review = changesReview([{ area: 'venue', blocked: null }]);
  api.post.mockRejectedValue(new Error('No venue booking has been confirmed by Venue Staff.'));
  open('/events/101');
  const changes = await screen.findByRole('group', { name: 'Safety changes requested' });
  const loads = api.get.mock.calls.filter(([path]) => path === '/events/101/decision').length;
  fireEvent.click(within(changes).getByRole('button', { name: 'Mark venue arrangements complete' }));
  expect((await within(changes).findByRole('alert')).textContent).toBe('No venue booking has been confirmed by Venue Staff.');
  await waitFor(() => expect(api.get.mock.calls.filter(([path]) => path === '/events/101/decision').length).toBe(loads + 1));
});

// Test case: The organiser sees what must change, without completion controls.
it('OFC AC3 - the organiser sees which planning stages need changes and the Safety Officer notes', async () => {
  user = organiser;
  review = { status: 'submitted', outcome: null, safetyChanges: { open: [{ area: 'technical' }, { area: 'event_details' }], notes: 'Move the projector' } };
  open('/events/101');
  const changes = await screen.findByRole('group', { name: 'Safety changes requested' });
  expect(within(within(changes).getByRole('list', { name: 'Stages needing changes' })).getAllByRole('listitem').map((item) => item.textContent))
    .toEqual(['Technical arrangements', 'Event details']);
  expect(within(changes).getByText('Safety Officer notes: Move the projector')).toBeTruthy();
  expect(within(changes).queryByRole('button')).toBeNull();
});

// Test case: Without open changes the panel is not shown at all.
it('OFC AC4 - no requested-changes panel is shown when no stage is open', async () => {
  user = organiser;
  review = { status: 'submitted', outcome: null };
  open('/events/101');
  expect(await screen.findByText(/Awaiting the Event Coordinator's decision/)).toBeTruthy();
  expect(screen.queryByRole('group', { name: 'Safety changes requested' })).toBeNull();
});
