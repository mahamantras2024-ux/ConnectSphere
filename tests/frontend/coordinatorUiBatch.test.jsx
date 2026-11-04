// Approved coordinator UI batch: real routes/components and production styles; only HTTP and session boundaries are mocked.
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import App from '../../frontend/src/App';
import { api } from '../../frontend/src/api/client';
import { useAuth } from '../../frontend/src/context/AuthContext';
import EquipmentStatusSection from '../../frontend/src/pages/events/EquipmentStatusSection';
import AmendmentRequestForm from '../../frontend/src/pages/events/AmendmentRequestForm';
import AmendmentRequestList from '../../frontend/src/pages/events/AmendmentRequestList';
import SafetyRereviewPanel from '../../frontend/src/pages/events/SafetyRereviewPanel';
import OfflineClarificationForm from '../../frontend/src/pages/events/OfflineClarificationForm';
import CoordinatorAmendments from '../../frontend/src/pages/events/CoordinatorAmendments';
vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
vi.mock('../../frontend/src/context/AuthContext', () => ({ useAuth: vi.fn() }));
let event, eligible, style;
const venue = { id: 8, name: 'South Hall', capacity: 100, operating_hours: '08:00 - 22:00', facilities: ['Projector'] };
/** Keeps navigation real so a drawer cannot satisfy the separate-page requirement. */
function open(path) { return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>); }
/** Only visual assertions load the production stylesheet; behavior tests do not need costly CSS layout queries. */
function addStyles() {
  style = document.createElement('style'); style.textContent = readFileSync('src/index.css', 'utf8'); document.head.append(style);
}
beforeEach(() => {
  vi.resetAllMocks();
  event = { id: 3, name: 'Forum', status: 'confirmed', registration_required: true, equipment_items: [], clarification_requests: [] };
  eligible = [event];
  useAuth.mockReturnValue({ token: 'session', user: { id: 12, role: 'event_coordinator' } });
  api.get.mockImplementation(async path => {
    if (path === '/events') return { events: [event, { ...event, id: 4, name: 'Too large', expected_attendance: 101 }] };
    if (path === '/events/3') return { event };
    if (path.endsWith('/eligible-events')) return { events: eligible };
    if (path.endsWith('/eligible-venues')) return { venues: [venue] };
    if (path === '/venues/8') return venue;
    if (path.includes('/schedule?')) return [];
    if (path.startsWith('/venues')) return [venue];
    return { notifications: [], unreadCount: 0, bookings: [], requests: [], amendmentRequests: [], items: [], history: [] };
  });
  style = null;
});
afterEach(() => { cleanup(); style?.remove(); });

it('Schedule AC1 AC4 / batch 1 - opens a separate read-only schedule page and returns to the event catalogue', async () => {
  await act(async () => { open('/coordinator/venues?eventId=3'); });
  fireEvent.click(await screen.findByRole('button', { name: /View details/ }));
  fireEvent.click(screen.getByRole('link', { name: 'View schedule' }));
  expect(await screen.findByRole('region', { name: 'Venue schedule' })).toBeVisible();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Save schedule' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Schedule date'), { target: { value: '2030-10-10' } });
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/venues/8/schedule?date=2030-10-10', 'session'));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh schedule' }));
  fireEvent.click(screen.getByRole('link', { name: 'Back to venues' }));
  expect(await screen.findByLabelText('Booking for event')).toHaveValue('3');
});

it('VS AC1 AC3 / SCRUM-61 AC2 / batch 2 3 - filters selectable events and links optional booking-entry guidance', async () => {
  const view = open('/coordinator/venues?eventId=4&venueId=8');
  expect(await screen.findByRole('alert')).toHaveTextContent(/does not meet/);
  expect(screen.queryByRole('heading', { name: 'Request a venue booking' })).toBeNull();
  expect(screen.queryByRole('option', { name: 'Too large' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Booking for event'), { target: { value: '3' } });
  expect(await screen.findByRole('heading', { name: 'Request a venue booking' })).toBeVisible();
  // Both asterisks are note references, never required-field indicators.
  for (const label of ['Accessibility requirements', 'Required facilities']) {
    const input = screen.getByLabelText(label);
    expect(input).toHaveAccessibleDescription('Separate multiple accessibility requirements or facilities with commas.');
    expect(input).not.toBeRequired();
    expect(input.closest('label')).toHaveTextContent('*');
  }
  view.unmount(); eligible = [];
  open('/coordinator/venues?venueId=8');
  expect(await screen.findByText('No assigned events meet this venue’s requirements.')).toBeVisible();
});

it('OC AC1 AC3 / batch 4 - provides four independent Activity disclosures with the agreed defaults', async () => {
  open('/events/3?tab=activity');
  const requests = await screen.findByRole('heading', { name: 'Clarification requests' });
  expect(requests.closest('details').open).toBe(true);
  const history = screen.getByRole('heading', { name: 'Amendment history' });
  fireEvent.click(history);
  expect(screen.getByText('No amendments have been requested or applied.')).toBeVisible();
  fireEvent.click(history);
  expect(screen.getByText('No amendments have been requested or applied.')).not.toBeVisible();
  for (const label of ['Record an offline clarification', 'Apply agreed amendment', 'Amendment history']) {
    expect(screen.getByRole('heading', { name: label }).closest('details').open).toBe(false);
  }
  // Toggling the request history must not expand any of the other three sections.
  fireEvent.click(requests); expect(requests.closest('details').open).toBe(false);
  fireEvent.click(requests); expect(requests.closest('details').open).toBe(true);
});

it('OC AC1 / batch 4 - preserves the offline clarification draft when collapsed', () => {
  // The form owns this state; keep its real hooks and fields while avoiding unrelated event-page rendering.
  render(<OfflineClarificationForm eventId={3} token="session" onRecorded={vi.fn()} />);
  const offline = screen.getByRole('heading', { name: 'Record an offline clarification' });
  fireEvent.click(offline);
  fireEvent.change(screen.getByLabelText('Clarification question'), { target: { value: 'Confirm access?' } });
  fireEvent.click(offline); fireEvent.click(offline);
  expect(screen.getByLabelText('Clarification question')).toHaveValue('Confirm access?');
});

it('OC AC3 / batch 4 - preserves the agreed amendment draft when collapsed', async () => {
  // This separate editor has a large field set, so its draft oracle is independent of clarification/history assertions.
  await act(async () => { render(<CoordinatorAmendments event={event} token="session" canApply onApplied={vi.fn()} />); });
  const apply = screen.getByRole('heading', { name: 'Apply agreed amendment' });
  fireEvent.click(apply);
  const amendment = within(apply.closest('details')).getByRole('form');
  fireEvent.change(within(amendment).getByLabelText('Purpose'), { target: { value: 'Agreed purpose' } });
  fireEvent.click(apply); expect(amendment).not.toBeVisible();
  fireEvent.click(apply); expect(within(amendment).getByLabelText('Purpose')).toHaveValue('Agreed purpose');
});

it('ES AC1 AC3 / batch 5 - separates latest and historical equipment reviews with readable stored facts', async () => {
  addStyles();
  api.get.mockResolvedValue({ status: 'confirmed', review: null, items: [{ key: 'mic', label: 'Microphone', quantity: 3, status: 'available' }],
    history: [{ version: 1, status: 'partially_available', reviewedAt: '2030-01-01T03:00:00Z', reviewedBy: 'Taylor', reason: 'Repair', affectedCount: 1 },
      { version: 0, status: 'confirmed', reviewedAt: '2030-01-01T02:00:00Z' }] });
  render(<EquipmentStatusSection eventId={3} token="session" />);
  const latest = await screen.findByText('Latest equipment request review', { selector: 'summary' });
  expect(latest.closest('details').open).toBe(true);
  const earlier = screen.getByText('Earlier reviews (2)', { selector: 'summary' });
  expect(earlier.closest('details').open).toBe(false);
  fireEvent.click(latest); expect(screen.getByText('Microphone × 3')).not.toBeVisible();
  fireEvent.click(earlier);
  const history = screen.getByRole('list', { name: 'Earlier reviews' });
  for (const value of ['Taylor', 'Repair', '1', 'Not recorded']) expect(within(history).getByText(value)).toBeVisible();
  expect(within(history).getAllByText('Historical item details were not recorded.')).toHaveLength(2);
  for (const row of within(history).getAllByRole('listitem')) expect(getComputedStyle(row).borderTopWidth).toBe('1px');
  fireEvent.click(earlier); expect(history).not.toBeVisible();
  fireEvent.click(latest); expect(screen.getByText('Microphone × 3')).toBeVisible();
});

it('ES AC1 AC3 / batch 5 - retains past reviews when the latest request no longer needs equipment', async () => {
  // Earlier decisions belong to their recorded version, even after an amendment removes current equipment requirements.
  api.get.mockResolvedValue({ status: 'not_requested', items: [], history: [{ version: 1, status: 'unavailable',
    reviewedAt: '2030-01-01T03:00:00Z', reviewedBy: 'Taylor', reason: 'No stock', affectedCount: 1 }] });
  render(<EquipmentStatusSection eventId={3} token="session" />);
  expect(await screen.findByText('The organiser has not requested any equipment or technical support.')).toBeVisible();
  fireEvent.click(screen.getByText('Earlier reviews (1)', { selector: 'summary' }));
  expect(within(screen.getByRole('list', { name: 'Earlier reviews' })).getByText('No stock')).toBeVisible();
});

it('OC AC3 / batch 6 - uses readable amendment equipment fields and typed history values', () => {
  addStyles();
  render(<div className="event-detail"><AmendmentRequestForm event={{ ...event, technical_support_required: true }} token="session" mode="coordinator" onCancel={vi.fn()} onSubmitted={vi.fn()} />
    <AmendmentRequestList requests={[{ id: 1, status: 'approved', submitted_at: '2030-01-01T03:00:00Z', changes: [
      { field: 'proposedStartTime', label: 'Start time', before: '18:00:00', after: '19:15:00' },
      { field: 'equipmentItems', label: 'Equipment', requested: [{ item: 'Microphone', quantity: 3 }] }], rechecks: null }]} /></div>);
  expect(screen.getByText('6:00 pm → 7:15 pm')).toBeVisible();
  expect(screen.getByText('Microphone × 3')).toBeVisible();
  expect(getComputedStyle(screen.getByText('Start time', { selector: 'dt' })).fontSize).toBe('16px');
  expect(getComputedStyle(screen.getByLabelText('Technical support details')).fontSize).toBe('16px');
});

it('SCRUM-111 AC1 / batch 7 - separates safety history entries with borders and minute precision', async () => {
  addStyles();
  api.get.mockResolvedValue({ required: false, history: [
    { id: 1, kind: 'review', outcome: 'changes_requested', actor: 'Safety Officer', recorded_at: '2030-01-01T03:00:17Z', notes: 'Check wiring' },
    { id: 2, kind: 'review', outcome: 'approved', actor: 'Safety Officer', recorded_at: '2030-01-02T03:00:59Z' }] });
  render(<SafetyRereviewPanel eventId={3} token="session" />);
  const records = await screen.findByRole('list', { name: 'Safety review records' });
  const rows = within(records).getAllByRole('listitem');
  expect(rows).toHaveLength(2);
  // Expand the recorded decisions before inspecting their human-readable details.
  fireEvent.click(within(rows[0]).getByText('Changes requested'));
  fireEvent.click(within(rows[1]).getByText('Passed'));
  for (const row of rows) { expect(getComputedStyle(row).borderTopWidth).toBe('1px'); expect(row.textContent).not.toMatch(/\d+:\d+:\d+/); }
  expect(rows[0]).toHaveTextContent('Check wiring'); expect(rows[1]).not.toHaveTextContent('Check wiring');
});

it.each(['draft', 'submitted', 'under_review', 'approved', 'planning', 'confirmed', 'completed', 'rejected', 'cancelled'])('Registration AC1 / batch 8 - shows coordinator registration details only for eligible status %s', async status => {
  event.status = status; open('/events/3');
  await screen.findByRole('heading', { name: 'Forum' });
  expect(Boolean(screen.queryByRole('tab', { name: 'Registration details' }))).toBe(['confirmed', 'completed'].includes(status));
});
it.each([false, undefined])('Registration AC1 / batch 8 - hides registration details for flag %s', async flag => {
  event.registration_required = flag; open('/events/3'); await screen.findByRole('heading', { name: 'Forum' });
  expect(screen.queryByRole('tab', { name: 'Registration details' })).toBeNull();
});

it('Workspace AC1 / batch 9 10 - uses status-based card accents and Dashboard navigation', async () => {
  addStyles();
  const colours = { submitted: 'rgb(125, 180, 224)', under_review: 'rgb(239, 107, 46)', planning: 'rgb(139, 111, 192)',
    confirmed: 'rgb(47, 143, 131)', completed: 'rgb(83, 133, 55)', rejected: 'rgb(184, 59, 46)', cancelled: 'rgb(139, 143, 126)', draft: 'rgb(139, 143, 126)' };
  const original = api.get.getMockImplementation();
  api.get.mockImplementation(path => path === '/events' ? Promise.resolve({ events: Object.keys(colours).map((status, index) => ({ id: index + 20, name: status, status })) }) : original(path));
  open('/events');
  const cards = await screen.findAllByRole('article');
  for (const card of cards) expect(getComputedStyle(card).borderTopColor).toBe(colours[within(card).getByRole('heading').textContent]);
  expect(screen.getByRole('link', { name: 'Dashboard', exact: true })).toHaveAttribute('href', '/coordinator/dashboard');
  fireEvent.click(within(cards[0]).getByRole('link', { name: /View details/ }));
  expect(await screen.findByRole('link', { name: 'Back to Dashboard' })).toHaveAttribute('href', '/events');
});

// Route errors and delayed reads must never leave an old venue's schedule on the new screen.
it('Schedule AC1 AC4 / batch 1 - supports direct links and reports profile errors without a timeline', async () => {
  const original = api.get.getMockImplementation();
  api.get.mockImplementation(path => path === '/venues/8' ? Promise.reject(new Error('Venue not found')) : original(path));
  open('/coordinator/venues/8/schedule');
  expect(screen.getByText('Loading venue…')).toBeVisible();
  expect(await screen.findByRole('alert')).toHaveTextContent('Venue not found');
  expect(screen.queryByRole('region', { name: 'Venue schedule' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Back to venues' })).toHaveAttribute('href', '/coordinator/venues');
});
it('Schedule AC1 / batch 1 - links independent catalogue browsing to a schedule without inventing an event', async () => {
  await act(async () => { open('/coordinator/venues'); });
  fireEvent.click(screen.getByRole('button', { name: /View details/ }));
  const schedule = screen.getByRole('link', { name: 'View schedule' });
  expect(schedule).toHaveAttribute('href', '/coordinator/venues/8/schedule');
  fireEvent.click(schedule);
  expect(await screen.findByRole('region', { name: 'Venue schedule' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Back to venues' })).toHaveAttribute('href', '/coordinator/venues');
});
it.each(['resolve', 'reject'])('Schedule AC1 AC4 / batch 1 - ignores a late profile %s after leaving the page', async outcome => {
  let finish;
  const original = api.get.getMockImplementation();
  api.get.mockImplementation(path => path === '/venues/8' ? new Promise((resolve, reject) => { finish = outcome === 'resolve' ? resolve : reject; }) : original(path));
  open('/coordinator/venues/8/schedule');
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  fireEvent.click(screen.getByRole('link', { name: 'Back to venues' }));
  await act(async () => finish(outcome === 'resolve' ? venue : new Error('Old profile read')));
  expect(await screen.findByLabelText('Booking for event')).toBeVisible();
  expect(screen.queryByText('Old profile read')).toBeNull();
  expect(screen.queryByRole('region', { name: 'Venue schedule' })).toBeNull();
});
it('Schedule AC1 / batch 1 - rejects a non-coordinator schedule route before fetching venue data', async () => {
  useAuth.mockReturnValue({ token: 'session', user: { role: 'event_organiser' } });
  open('/coordinator/venues/8/schedule');
  await screen.findByRole('heading', { name: 'Event Organiser Dashboard' });
  expect(api.get).not.toHaveBeenCalledWith('/venues/8', 'session');
});

it('VS AC1 AC3 / batch 3 - retries failed eligibility and rechecks when the selected venue changes', async () => {
  const original = api.get.getMockImplementation();
  let unavailable = true;
  let smallUnavailable = true;
  api.get.mockImplementation(path => {
    if (path === '/venues/8/eligible-events' && unavailable) return Promise.reject(new Error('Eligibility offline'));
    if (path === '/events/3/eligible-venues') return Promise.resolve({ venues: [venue, { ...venue, id: 9, name: 'Small room' }] });
    if (path === '/venues/9/eligible-events') return smallUnavailable ? Promise.reject(new Error('New venue eligibility offline')) : Promise.resolve({ events: [] });
    return original(path);
  });
  open('/coordinator/venues?eventId=3&venueId=8');
  expect(await screen.findByRole('alert')).toHaveTextContent('Eligibility offline');
  expect(screen.queryByRole('button', { name: 'Request venue', exact: true })).toBeNull();
  unavailable = false; fireEvent.click(screen.getByRole('button', { name: 'Retry events' }));
  await screen.findByRole('heading', { name: 'Request a venue booking' });
  fireEvent.change(await screen.findByLabelText('Venue'), { target: { value: '9' } });
  // A failed read for a different venue must not retain the previous venue's selectable events.
  expect(await screen.findByRole('alert')).toHaveTextContent('New venue eligibility offline');
  expect(screen.queryByRole('option', { name: 'Forum' })).toBeNull();
  smallUnavailable = false; fireEvent.click(screen.getByRole('button', { name: 'Retry events' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('does not meet');
  expect(screen.queryByRole('heading', { name: 'Request a venue booking' })).toBeNull();
});

// Time boundaries use explicit expected labels rather than duplicating the production formatter.
it.each([['00:00:59', '12:00 am'], ['00:01:00', '12:01 am'], ['11:59:59', '11:59 am'],
  ['12:00:00', '12:00 pm'], ['12:01:00', '12:01 pm'], ['23:59:59', '11:59 pm'], ['unknown', 'unknown']])('OC AC3 / batch 6 - formats amendment clock value %s as %s', (time, expected) => {
  render(<AmendmentRequestList requests={[{ id: 1, status: 'approved', submitted_at: '2030-01-01T00:00:00Z',
    changes: [{ field: 'proposedStartTime', label: 'Start time', requested: time }] }]} />);
  expect(screen.getByText(expected, { selector: 'dd' })).toBeVisible();
});

it('Registration AC1 / batch 8 - reveals registration details after a successful live confirmation', async () => {
  event.status = 'planning'; event.coordinator_id = 12;
  const original = api.get.getMockImplementation();
  api.get.mockImplementation(path => path === '/events/3/decision' ? Promise.resolve({ status: event.status, outcome: null,
    readiness: [], transitions: [{ status: 'confirmed' }], allowed: { approved: false, rejected: false },
    blocked: { approved: { message: 'Already approved' }, rejected: { message: 'Already approved' } } }) : original(path));
  // Replace the server fixture, rather than mutating the same object held by React; the real callback must update the page.
  api.post.mockImplementation(async () => { event = { ...event, status: 'confirmed' }; return { event: { status: 'confirmed' } }; });
  open('/events/3'); await screen.findByRole('heading', { name: 'Forum' });
  expect(screen.queryByRole('tab', { name: 'Registration details' })).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm event' }));
  expect(await screen.findByRole('tab', { name: 'Registration details' })).toBeVisible();
});


it.each([false, true])('Clarification AC4 - separates heading and badge for outstanding=%s', async outstanding => {
  // Arrange: both badge variants must retain a visible gap under the real page stylesheet.
  addStyles(); event.clarification_outstanding = outstanding;
  open('/events/3'); await screen.findByRole('heading', { name: 'Forum' });
  // Act: the activity workspace owns the clarification disclosure.
  fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
  const region = screen.getByRole('region', { name: 'Clarification requests' });
  const badge = within(region).getByText(outstanding ? 'Outstanding' : 'No outstanding clarification');
  // Assert: a zero-margin badge would reproduce the crowded heading in the reported screenshot.
  expect(getComputedStyle(badge).marginInlineStart).toBe('20px');
  expect(getComputedStyle(badge).display).toBe('inline-block');
});


it('Safety AC1 / batch 12 - exposes Singapore timestamps while collapsed and stably orders tied records', async () => {
  // Arrange: the API order is deliberately nonchronological, with two records sharing one instant.
  api.get.mockResolvedValue({ required: false, history: [
    { id: 2, kind: 'review', outcome: 'approved', actor: 'Jo', recorded_at: '2030-01-02T03:00:00Z' },
    { id: 1, kind: 'review', outcome: 'changes_requested', actor: 'Alex', notes: 'Revise exits', recorded_at: '2030-01-01T03:00:00Z' },
    { id: 3, kind: 'resubmission', actor: 'Coordinator', recorded_at: '2030-01-01T03:00:00Z' }] });
  render(<SafetyRereviewPanel eventId={3} token="session" />);
  const rows = within(await screen.findByRole('list', { name: 'Safety review records' })).getAllByRole('listitem');
  // Assert: dates are visible without revealing the collapsed reason; equal timestamps retain API order.
  expect(rows.map(row => row.querySelector('summary strong').textContent)).toEqual(['Changes requested', 'Submitted for safety re-review', 'Passed']);
  expect(rows[0].querySelector('summary time')).toBeVisible();
  expect(rows[0].querySelector('summary time')).toHaveTextContent('1 Jan 2030, 11:00 am');
  expect(rows[2].querySelector('summary time')).toHaveTextContent('2 Jan 2030, 11:00 am');
  expect(screen.getByText('Reason: Revise exits')).not.toBeVisible();
});

it('Review AC2 AC3 / batch 12 - keeps cancellation next to lifecycle buttons and commits through the existing confirmation', async () => {
  // Arrange: cancellation is already authorised; the requested change is its position, not permission.
  addStyles(); event.status = 'approved'; event.coordinator_id = 12;
  const original = api.get.getMockImplementation();
  api.get.mockImplementation(path => path === '/events/3/decision' ? Promise.resolve({ status: event.status,
    outcome: { decision: 'approved', decidedBy: 'Coordinator', decidedAt: '2030-01-01T00:00:00Z' }, readiness: [],
    transitions: [{ status: 'planning' }, { status: 'confirmed', blocked: { code: 'VENUE_PENDING', message: 'Confirm venue first.' } }] }) : original(path));
  api.post.mockResolvedValue({ event: { status: 'cancelled' }, message: 'Event cancelled.' });
  open('/events/3');
  const panel = await screen.findByRole('region', { name: 'Review decision' });
  const planning = await within(panel).findByRole('button', { name: 'Start planning' });
  const confirm = within(panel).getByRole('button', { name: 'Confirm event' });
  const cancel = within(panel).getByRole('button', { name: 'Cancel event' });
  // Assert: a shared wrapping flex row retains the server blocker instead of enabling confirmation.
  const row = planning.closest('.decision-status-actions');
  expect(row).toContainElement(cancel); expect(row).toContainElement(confirm);
  expect(getComputedStyle(row).display).toBe('flex'); expect(getComputedStyle(row).flexWrap).toBe('wrap');
  expect(confirm).toBeDisabled(); expect(within(panel).getByText('Confirm venue first.')).toBeVisible();
  // Act / Assert: the relocated action still requires explicit confirmation and updates the real event page.
  fireEvent.click(cancel); fireEvent.click(screen.getByRole('button', { name: 'Confirm', exact: true }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/events/3/cancel', {}, 'session'));
  expect(await screen.findByText('Event cancelled.')).toBeVisible();
  expect(within(panel).queryByRole('button', { name: 'Cancel event' })).not.toBeInTheDocument();
  expect(screen.getByText('Cancelled', { selector: '.event-status' })).toBeVisible();
});

it.each(['Clarification requests', 'Record an offline clarification', 'Apply agreed amendment', 'Amendment history'])('Activity AC5 / batch 12 - gives collapsed %s the shared card dimensions', async name => {
  // Arrange / Act: each card has a focused style oracle, avoiding one long full-page layout test under coverage.
  addStyles(); await act(async () => { open('/events/3'); });
  const tab = screen.getByText('Activity', { selector: 'button' });
  fireEvent.click(tab);
  const panel = document.getElementById(tab.getAttribute('aria-controls'));
  // Visible captions identify the style subjects without repeated full-workspace role/style filtering.
  fireEvent.click(within(panel).getByText('Clarification requests', { selector: 'h2' }));
  const heading = within(panel).getByText(name, { selector: 'h2' });
  const cardStyle = getComputedStyle(heading.closest('.ed-card'));
  const summaryStyle = getComputedStyle(heading.closest('summary'));
  // Assert: identical padding, margins and header minimum height prevent the clarification badge enlarging its card.
  expect(cardStyle.padding).toBe('24px'); expect(cardStyle.marginBottom).toBe('0px');
  expect(summaryStyle.marginBottom).toBe('0px'); expect(summaryStyle.minHeight).toBe('36px');
});

it('Activity AC5 / batch 12 - assigns inter-card spacing to one layout owner', async () => {
  // Arrange / Act: the amendment wrapper must not add a second gap between its two cards.
  addStyles(); await act(async () => { open('/events/3'); });
  const tab = screen.getByText('Activity', { selector: 'button' });
  fireEvent.click(tab);
  const panel = document.getElementById(tab.getAttribute('aria-controls'));
  // Assert: a single grid gap handles all four sections, while the wrapper contributes no box of its own.
  expect(getComputedStyle(panel).gap).toBe('24px');
  expect(getComputedStyle(panel.querySelector('.amendment-panel')).display).toBe('contents');
});

it.each(['confirmed', 'completed'])('Registration AC6 / batch 12 - exposes the final inline tab and keyboard navigation for %s', async status => {
  // Arrange: report data stays private until the tab is actually selected.
  event.status = status;
  const original = api.get.getMockImplementation();
  api.get.mockImplementation(path => path.endsWith('/coordinator-registrations') ? Promise.resolve({ event: { name: 'Attendance' }, headcount: 0,
    waitlist_count: 0, withdrawal_count: 0, registered: [], waitlist: [], attendees: [], venue_capacity: null, remaining_spots: null, overflow_count: null, overflow: [] }) : original(path));
  open('/events/3'); await screen.findByRole('heading', { name: 'Forum' });
  expect(screen.getAllByRole('tab').at(-1)).toHaveTextContent('Registration details');
  expect(api.get).not.toHaveBeenCalledWith('/events/3/coordinator-registrations', 'session');
  // Act: End must reach the new fifth tab, while Home and wrapping Left still work.
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Overview' }), { key: 'End' });
  const tab = screen.getByRole('tab', { name: 'Registration details' }); expect(tab).toHaveFocus();
  expect(await screen.findByLabelText('Registration summary')).toHaveTextContent('Confirmed headcount0Waitlist0Withdrawals0');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.keyDown(tab, { key: 'Home' }); expect(screen.getByRole('tab', { name: 'Overview' })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Overview' }), { key: 'ArrowLeft' }); expect(tab).toHaveFocus();
  fireEvent.keyDown(tab, { key: 'ArrowRight' }); expect(screen.getByRole('tab', { name: 'Overview' })).toHaveFocus();
});

it('Registration AC6 / batch 12 - supports eligible deep links and reports denied access inline', async () => {
  // Arrange: eligibility does not override the registration endpoint's authorisation decision.
  const original = api.get.getMockImplementation();
  api.get.mockImplementation(path => path.endsWith('/coordinator-registrations') ? Promise.reject(Object.assign(new Error('Access denied.'), { status: 403 })) : original(path));
  open('/events/3?tab=registration');
  expect(await screen.findByRole('alert')).toHaveTextContent('Access denied.');
  expect(screen.getByRole('tab', { name: 'Registration details' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('Registration AC6 / batch 12 - rejects a registration deep link before final confirmation', async () => {
  // Arrange / Act: a URL must not bypass the same eligibility rule used for tab visibility.
  event.status = 'planning'; open('/events/3?tab=registration'); await screen.findByRole('heading', { name: 'Forum' });
  // Assert: the overview is selected and no private registration request is made.
  expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.queryByRole('tab', { name: 'Registration details' })).not.toBeInTheDocument();
  expect(api.get).not.toHaveBeenCalledWith('/events/3/coordinator-registrations', 'session');
});
