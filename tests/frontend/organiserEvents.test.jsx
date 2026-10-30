// File: Tests organiser navigation, event display/creation, ownership errors, and external sign-in destinations.
// Test scope: Uses real components/utilities with controlled API/provider responses where configured; live service delivery is outside this scope.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../frontend/src/api/client';
import App from '../../frontend/src/App';
import { AuthProvider } from '../../frontend/src/context/AuthContext';

vi.mock('../../frontend/src/api/client', () => (// Replaces the imported dependency with controlled test doubles while retaining needed exports.

      // Handles this operation using the surrounding screen or request state.
  { api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
let user;
const event = { id: 101, name: 'Community Workshop', purpose: 'Bring neighbours together', description: 'A learning session', event_type: 'workshop',
  proposed_date: '2026-10-15', proposed_start_time: '09:00:00', proposed_end_time: '12:00:00', expected_attendance: 40,
  programme_details: 'Welcome followed by activities', room_layout_preference: 'classroom', accessibility_requirements: ['Wheelchair access', 'Hearing loop'],
  equipment_notes: 'Two microphones', registration_required: true, registration_capacity: 35,
  special_arrangements: 'Vegetarian catering', organiser_id: 12, organiser_name: 'Alice', coordinator_name: 'Chris', status: 'submitted' };
// Renders the application at a selected in-memory route with optional stored test-session credentials.
function open(path, authenticated = true, venueBookings = []) {
  // Supply the new external boundary explicitly so unrelated event tests keep valid venue responses.
  const getEventResource = api.get.getMockImplementation();
  api.get.mockImplementation((resource, ...args) => resource.endsWith('/organiser-venue-bookings')
    ? Promise.resolve({ bookings: venueBookings }) : getEventResource(resource, ...args));
  if (authenticated) localStorage.setItem('cs_token', 'organiser-token');
  render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AuthProvider><App /></AuthProvider></MemoryRouter>);
}
beforeEach(() => {
  // Initializes clean test state, fixtures, mocks, or a local HTTP server before the test cases.

  localStorage.clear(); api.get.mockReset(); api.post.mockReset(); api.put.mockReset();
  user = { id: 12, email: 'alice@example.com', full_name: 'Alice', role: 'event_organiser' };
  api.get.mockImplementation(async (path) => {
    // Supplies controlled api.get behavior for this regression case, including its expected result or failure.

    if (path === '/auth/me') return { user };
    if (path === '/events') return { events: [event] };
    if (path === '/events/101') return { event };
    if (path === '/venues') return [{ id: 7, name: 'Hall North' }];
    throw new Error('Event not found.');
  });
});
afterEach(cleanup);

// SCRUM-104 must be reachable from the real organiser route, not only as an isolated component.
it('SCRUM-104 AC1 AC3 - opens the managed event venue section through the organiser route', async () => {
  // Arrange: retain real routing and authentication while replacing only API traffic.
  const venueBookings = [{ id: 9, venue_name: 'North Hall', address: '12 North Road', capacity: 120,
    start_datetime: '2030-04-04T02:00:00Z', end_datetime: '2030-04-04T04:00:00Z', status: 'approved' }];
  // Act
  open('/organizer/events/101', true, venueBookings);
  // Assert: removing the integration or using a coordinator-only endpoint breaks this test.
  const section = await screen.findByRole('region', { name: 'Venue arrangements' });
  await within(section).findByText('North Hall');
  expect(within(section).getByText('Confirmed')).toBeTruthy();
  expect(within(section).getByText('12 North Road')).toBeTruthy();
  expect(api.get).toHaveBeenCalledWith('/events/101/organiser-venue-bookings', 'organiser-token');
});

it.each(['light', 'dark'])('UI contrast AC1 AC2 - event text stays readable in the brand palette with %s system preference', async preference => {
  // Arrange: render real event styles. Read CSSOM explicitly because jsdom does not evaluate colour-scheme media queries.
  open('/organizer/events/101');
  await screen.findByRole('heading', { name: event.name });
  const tokens = {};
  const declarations = {};
  /** Applies the actual stylesheet's root variables in cascade order for the selected system preference. */
  function readTokens(rules) {
    for (const rule of rules) {
      if (rule.selectorText) declarations[rule.selectorText] = rule.style;
      if (rule.selectorText === '.ed-root') {
        for (const property of Array.from(rule.style)) tokens[property] = rule.style.getPropertyValue(property).trim().toLowerCase();
      } else if (rule.media?.mediaText === '(prefers-color-scheme: dark)' && preference === 'dark') readTokens(rule.cssRules);
    }
  }
  for (const sheet of document.styleSheets) readTokens(sheet.cssRules);
  /** WCAG relative luminance uses linearised sRGB, not raw channel averages. */
  function luminance(hex) {
    const channels = hex.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255)
      .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return channels.reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  }
  // Act / Assert: the customer's palette is the oracle; dark-mode replacement colours fail this check.
  const palette = ['#30391c', '#686a5e', '#e3e4d3', '#fffffa', '#f4f4e5', '#ef6b2e', '#272c19', '#424f19', '#c7d45b', '#fffad9', '#942b20', '#efb6aa', '#a9b6d3'];
  expect(tokens['color-scheme']).toBe('light');
  for (const [name, value] of Object.entries(tokens).filter(([name]) => name.startsWith('--ed-') && name !== '--ed-radius')) expect(palette, name).toContain(value);
  /** Resolves the actual selectors' colours so changing a selector to use the wrong token also fails. */
  const colour = (selector, property) => declarations[selector].getPropertyValue(property).trim()
    .replace(/var\((--[\w-]+)\)/g, (_, token) => tokens[token]);
  const cardBackground = colour('.ed-card', 'background');
  // Check normal/muted text on both actual white cards and cream surroundings, plus links, buttons and notices.
  for (const [foreground, background] of [
    [colour('.ed-root', 'color'), cardBackground], [colour('.ed-muted', 'color'), cardBackground],
    [tokens['--ed-ink'], '#fffad9'], [tokens['--ed-muted'], '#fffad9'],
    [colour('.ed-field dt', 'color'), cardBackground], [colour('.ed-contact a', 'color'), cardBackground],
    [colour('.ed-btn', 'color'), colour('.ed-btn', 'background')],
    [tokens['--ed-ok-ink'], tokens['--ed-ok-bg']], [tokens['--ed-warn-ink'], tokens['--ed-warn-bg']],
    [tokens['--ed-bad-ink'], tokens['--ed-bad-bg']], [tokens['--ed-info-ink'], tokens['--ed-info-bg']],
  ]) {
    const [darker, lighter] = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
    expect((lighter + 0.05) / (darker + 0.05), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
  }
});

// Test case: AC2/AC3 - organisers save non-critical changes with the Save changes button and receive confirmation.
it('AC2/AC3 - saves non-critical programme changes with Save changes and confirms the save', async () => {
  api.put.mockResolvedValue({ event: { ...event, programme_details: 'Updated agenda' }, message: 'Non-critical event information saved.' });
  open('/organizer/events/101');
  await screen.findByRole('button', { name: 'Edit Programme' });
  fireEvent.click(screen.getByRole('button', { name: 'Edit Programme' }));
  const programme = screen.getByLabelText('Edit Programme');
  fireEvent.change(programme, { target: { value: 'Updated agenda' } });
  expect(api.put).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/events/101/non-critical', {
    programmeDetails: 'Updated agenda',
  }, 'organiser-token'));
  expect((await screen.findByText('Non-critical event information saved.')).textContent).toBe('Non-critical event information saved.');
  expect(screen.getByText('Updated agenda')).toBeTruthy();
});

// Test case: AC2 - coordinators can view event information but cannot edit it.
it('AC2 - non-organisers do not receive event edit controls', async () => {
  user = { ...user, role: 'event_coordinator' };
  open('/events/101');
  await screen.findByRole('heading', { name: event.name });
  expect(screen.queryByRole('button', { name: 'Edit Programme' })).toBeNull();
  expect(api.put).not.toHaveBeenCalled();
});

it('SCRUM-90 AC4 AC5 - organiser cancellation updates the event status on the detail page', async () => {
  // Arrange: the event is published and owned by the signed-in organiser.
  let confirmedEvent = { ...event, status: 'approved', is_draft: false, coordinator_id: 30 };
  api.get.mockImplementation(async path => path === '/auth/me' ? { user }
    : path === '/events/101' ? { event: confirmedEvent } : { event: confirmedEvent });
  api.post.mockImplementation(async () => { confirmedEvent = { ...confirmedEvent, status: 'cancelled' };
    return { event: confirmedEvent, message: 'Event cancelled. Active attendees have been notified.' }; });
  // Act: confirm cancellation from the existing event details page.
  open('/organizer/events/101');
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel event' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  // Assert: the detail view reflects the committed status and confirms notification delivery.
  expect(await screen.findByRole('status')).toBeTruthy();
  expect(await screen.findByText('Event cancelled. Active attendees have been notified.')).toBeTruthy();
  expect(screen.getByText('Cancelled', { selector: '.ed-badge' })).toBeTruthy();
  expect(api.post).toHaveBeenCalledWith('/events/101/cancel', {}, 'organiser-token');
});

// Test case: Opens an assigned event through the coordinator dashboard and checks every submitted requirement on its full page.
it('Coordinator AC1 / Workspace AC1 - assigned coordinator opens dashboard events and sees every submitted requirement',async()=>{
  // Verifies the coordinator's own navigation and complete record rather than relying on organiser rendering alone.
  user={...user,role:'event_coordinator'};open('/coordinator/dashboard');
  expect(await screen.findByRole('heading',{name:'Event Coordinator Dashboard'})).toBeTruthy();fireEvent.click(await screen.findByRole('link',{name:'View details'}));
  expect(await screen.findByRole('heading',{name:event.name})).toBeTruthy();
  for(const value of [event.purpose,'15/10/2026','09:00:00','12:00:00','40',event.programme_details,event.room_layout_preference,'Wheelchair access, Hearing loop','Yes','35',event.special_arrangements])expect(screen.getAllByText(value).some(node => !node.closest('[hidden]'))).toBe(true);
  fireEvent.click(screen.getByRole('tab', {name:'Equipment'}));
  expect(screen.getByText(event.equipment_notes).closest('[hidden]')).toBeNull();
  expect(screen.queryByRole('dialog', {name:'Event details'})).toBeNull();expect(api.get).toHaveBeenCalledWith('/events/101','organiser-token');
});

// AC2: coordinators can save support assignments from the dashboard for only the event requiring support.
it('AC2 - saves technical support staff from the coordinator dashboard', async () => {
  user = { ...user, role: 'event_coordinator' };
  const assignedEvent = { ...event, technical_support_required: true, technical_support_staff: [] };
  const unrelatedEvent = { ...event, id: 102, name: 'Planning Meeting', technical_support_required: false };
  const supportMember = { id: 41, full_name: 'Taylor Support' };
  api.get.mockImplementation(async path => {
    if (path === '/auth/me') return { user };
    if (path === '/events') return { events: [assignedEvent, unrelatedEvent] };
    if (path === '/events/technical-support-staff') return { staff: [supportMember] };
    if (path === '/notifications') return { notifications: [], unreadCount: 0 };
    return { requests: [] };
  });
  api.put.mockResolvedValue({});
  open('/coordinator/dashboard');

  const assignmentCard = (await screen.findByRole('heading', { name: 'Community Workshop' })).closest('article');
  expect(assignmentCard).toBeTruthy();
  fireEvent.click(within(assignmentCard).getByLabelText(/Taylor Support/));
  fireEvent.click(within(assignmentCard).getByRole('button', { name: 'Assign staff' }));

  await waitFor(() => expect(api.put).toHaveBeenCalledWith(
    '/events/101/technical-support-assignment',
    { staffIds: [41] },
    'organiser-token',
  ));
  expect(within(assignmentCard).getByRole('button', { name: 'Assignment saved' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Planning Meeting' }).closest('article')
    .querySelector('.support-assignment-form')).toBeNull();
});

// AC2: if the staff directory cannot be loaded, the coordinator sees that failure on support-required events.
it('AC2 - reports a failed technical support staff directory load', async () => {
  user = { ...user, role: 'event_coordinator' };
  api.get.mockImplementation(async path => {
    if (path === '/auth/me') return { user };
    if (path === '/events') return { events: [{ ...event, technical_support_required: true }] };
    if (path === '/events/technical-support-staff') throw new Error('Staff directory is unavailable.');
    if (path === '/notifications') return { notifications: [], unreadCount: 0 };
    return { requests: [] };
  });
  open('/coordinator/dashboard');

  expect(await screen.findByText('Staff directory is unavailable.')).toBeTruthy();
  expect(api.put).not.toHaveBeenCalled();
});

it('SCRUM-45 AC1 AC2 AC3 / SCRUM-61 AC3 AC4 - assigned coordinator submits a request and immediately sees its status', async () => {
  // Arrange: the coordinator opens an assigned event and receives one selectable venue.
  user = { ...user, role: 'event_coordinator' };
  const originalGet = api.get.getMockImplementation();
  let submitted = false;
  // The history response changes only after the server accepts the request; a missing refresh leaves it empty.
  api.get.mockImplementation(async path => path === '/events/101/venue-bookings'
    ? { bookings: submitted ? [{ id: 21, venue_name: 'Hall North', status: 'pending' }] : [] }
    : path.startsWith('/venues/search?') ? [{ id: 7, name: 'Hall North' }] : originalGet(path));
  api.post.mockImplementation(async () => { submitted = true; return { request: { id: 21 } }; });
  open('/events/101');
  await screen.findByRole('heading', { name: event.name });
  fireEvent.click(screen.getByRole('tab', { name: 'Venue requests' }));
  fireEvent.click(screen.getByRole('link', { name: 'Find a venue' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Request Hall North' }));
  expect(await screen.findByLabelText('Venue')).toBeTruthy();

  // Act: submit the prefilled event date and time to the coordinator's selected venue.
  fireEvent.click(screen.getByRole('button', { name: 'Request venue' }));

  // Assert: the request section is reachable from event details and sends the correct event, venue and period.
  expect(await screen.findByText('Venue request submitted.')).toBeTruthy();
  fireEvent.click(screen.getByRole('link', { name: 'View event requests' }));
  expect(await screen.findByRole('listitem', { name: 'Hall North Pending' })).toBeTruthy();
  expect(api.post).toHaveBeenCalledWith('/venues/7/requests', expect.objectContaining({
    eventId: 101,
    startDatetime: '2026-10-15T09:00:00+08:00',
    endDatetime: '2026-10-15T12:00:00+08:00',
  }), 'organiser-token');
});
// Test case: Opens a sparse coordinator record and checks unavailable labels for missing fields.
it('coordinator records with missing submitted information identify it as unavailable',async()=>{
  // Exercises missing-data behavior through the coordinator's protected detail route.
  user={...user,role:'event_coordinator'};api.get.mockImplementation(async path=>path==='/auth/me'?{user}:{event:{id:101,name:'Incomplete assigned event'}});open('/events/101');
  await screen.findByRole('heading',{name:'Incomplete assigned event'});for(const label of ['Purpose','Date','Programme','Layout Requirements','Accessibility Needs','Other equipment notes','Registration Required'])expect(screen.getByText(label,{selector:'dt'}).parentElement.textContent).toMatch(/Not specified/);
});

// Test case: Uses My Events, opens details and returns to the list, checking submitted fields and pencil controls beside editable fields.
it('Organiser AC1 / UI navigation AC1 - the single My Events tab opens the workspace and submitted details', async () => {

  open('/organizer/dashboard');
  const tab = await screen.findByRole('link', { name: 'My Events' });
  fireEvent.click(tab);
  expect(await screen.findByRole('heading', { name: 'Event Organiser Dashboard' })).toBeTruthy();
  fireEvent.click(await screen.findByRole('link', { name: 'View details' }));
  expect(await screen.findByRole('heading', { name: event.name })).toBeTruthy();
  for (const value of [event.purpose, event.description, '15/10/2026', '09:00:00', '12:00:00', '40', event.programme_details,
    event.room_layout_preference, 'Wheelchair access, Hearing loop', event.equipment_notes, 'Yes', '35', event.special_arrangements, 'Alice', 'Chris']) {
    expect(screen.getAllByText(value).length).toBeGreaterThan(0);
  }
  expect(api.get).toHaveBeenCalledWith('/events/101', 'organiser-token');
  expect(screen.getByRole('button', { name: 'Edit Programme' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Edit Event name' })).toBeTruthy();
  expect(screen.queryByRole('textbox', { name: 'Edit Programme' })).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: 'Back to Events' }));
  expect(await screen.findByRole('heading', { name: 'Event Organiser Dashboard' })).toBeTruthy();
});

// Test case: AC2 - after venue confirmation, critical fields open a request editor while non-critical fields remain directly editable.
it('AC2 - confirmed venue exposes request controls for critical fields and pencil controls for non-critical fields', async () => {
  api.get.mockImplementation(async (path) => path === '/auth/me' ? { user } : { event: { ...event, venue_confirmed: true } });
  open('/organizer/events/101');
  await screen.findByRole('heading', { name: event.name });
  expect(screen.getByRole('button', { name: 'Request change to Event name' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Edit Programme' })).toBeTruthy();
});

// Test case: AC1/AC2/AC3 - critical edits after venue confirmation become pending requests without changing confirmed details.
it('AC1/AC2/AC3 - submits a critical change request and keeps the confirmed event value in effect', async () => {
  api.get.mockImplementation(async (path) => path === '/auth/me' ? { user } : { event: { ...event, coordinator_id: 30, venue_confirmed: true } });
  api.put.mockResolvedValue({ changeRequest: { id: 501, status: 'pending' },
    message: 'Change request submitted. The confirmed event information remains in effect, and the Event Coordinator has been notified.' });
  open('/organizer/events/101');
  await screen.findByRole('heading', { name: event.name });
  fireEvent.click(screen.getByRole('button', { name: 'Request change to Event name' }));
  fireEvent.change(screen.getByLabelText('Edit Event name'), { target: { value: 'Revised Workshop' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit change request' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/events/101/non-critical', { name: 'Revised Workshop' }, 'organiser-token'));
  expect(await screen.findByRole('heading', { name: event.name })).toBeTruthy();
  expect(await screen.findByText(/confirmed event information remains in effect/)).toBeTruthy();
});

// Test case: AC1/AC2/AC3/AC5 - coordinator identifies unclear fields, sends a request, and sees outstanding status.
it('AC1/AC2/AC3/AC5 - coordinator sends a field-specific clarification and event shows it outstanding', async () => {
  user = { ...user, id: 30, role: 'event_coordinator' };
  api.get.mockImplementation(async (path) => path === '/auth/me' ? { user } : { event: { ...event, clarification_requests: [] } });
  const clarificationRequest = { id: 601, information_needed: ['expected_attendance'], message: 'Please confirm the expected count.', status: 'pending' };
  api.post.mockResolvedValue({ clarificationRequest, message: 'Clarification request sent to the Event Organiser.' });
  open('/events/101');
  await screen.findByRole('heading', { name: event.name });fireEvent.click(screen.getByRole('tab',{name:'Activity'}));
  fireEvent.click(screen.getByLabelText('Expected attendance'));
  fireEvent.change(screen.getByLabelText('What needs clarification?'), { target: { value: clarificationRequest.message } });
  fireEvent.click(screen.getByRole('button', { name: 'Send clarification request' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/events/101/clarifications', {
    informationNeeded: ['expected_attendance'], message: clarificationRequest.message,
  }, 'organiser-token'));
  expect(await screen.findByText(/Clarification outstanding/)).toBeTruthy();
  expect(screen.getByText(clarificationRequest.message)).toBeTruthy();
});

// Test case: AC4/AC5 - organiser response is shown in the event history and clears outstanding status.
it('AC4/AC5 - organiser responds to a clarification and can see the retained response', async () => {
  const clarificationRequest = { id: 601, information_needed: ['expected_attendance'], message: 'Please confirm the count.', status: 'pending' };
  let currentEvent = { ...event, clarification_outstanding: true, clarification_requests: [clarificationRequest] };
  api.get.mockImplementation(async (path) => path === '/auth/me' ? { user } : { event: currentEvent });
  const answered = { ...clarificationRequest, status: 'responded', organiser_response: 'The expected attendance is 45.' };
  // SCRUM-93 rereads after a committed response; model the server's updated state rather than returning a stale fixture forever.
  api.post.mockImplementation(async () => { currentEvent = { ...currentEvent, clarification_outstanding: false, clarification_requests: [answered] };
    return { clarificationRequest: answered, clarificationOutstanding: false, message: 'Clarification response saved.' }; });
  open('/organizer/events/101');
  await screen.findByRole('heading', { name: event.name });
  fireEvent.change(screen.getByLabelText('Response or amendment to clarification 601'), { target: { value: answered.organiser_response } });
  fireEvent.click(screen.getByRole('button', { name: 'Send response' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/events/101/clarifications/601/respond', { response: answered.organiser_response }, 'organiser-token'));
  expect(await screen.findByText(answered.organiser_response)).toBeTruthy();
  expect(screen.queryByText(/Clarification outstanding/)).toBeNull();
});
// Test case: Returns an empty event list and checks its empty state without sample records.
it('Workflow AC1 - shows empty request sections without fake records', async () => {

  api.get.mockImplementation(async (path) => // Supplies controlled api.get behavior for this regression case, including its expected result or failure.

      // Handles this operation using the surrounding screen or request state.
      path === '/auth/me' ? { user } : { events: [] });
  open('/organizer/events');
  expect(await screen.findByText('No draft requests.')).toBeTruthy();
});
// Test case: Opens organiser routes without a session and checks external sign-in without private requests.
it.each(['/organizer/events', '/organizer/events/101'])('unauthenticated %s uses external sign-in', async (path) => {

  open(path, false);
  expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
  expect(screen.queryByText(/Staff accounts are provided/)).toBeNull();
  expect(api.get).not.toHaveBeenCalled();
});
// Test case: Requests denied/missing records and checks errors conceal submitted details.
it.each(['102', '999'])('denied or missing event %s exposes no event details', async (id) => {

  open(`/organizer/events/${id}`);
  expect((await screen.findByRole('alert')).textContent).toBe('Event not found.');
  expect(screen.queryByText(event.special_arrangements)).toBeNull();
});
// Test case: Displays null/blank/false/zero/empty arrays and checks honest missing labels while retaining valid false/zero values.
it('handles null, blank, false, zero and empty arrays without fabricated dates', async () => {

  api.get.mockImplementation(async (path) => // Supplies controlled api.get behavior for this regression case, including its expected result or failure.

      // Handles this operation using the surrounding screen or request state.
      path === '/auth/me' ? { user } : { event: { ...event, proposed_date: null, programme_details: '', accessibility_requirements: [], expected_attendance: 0, registration_capacity: 0, registration_required: false } });
  open('/organizer/events/101');
  await screen.findByRole('heading', { name: event.name });
  expect(screen.getAllByText('0')).toHaveLength(2); expect(screen.getByText('No')).toBeTruthy();
  expect(screen.getAllByText('Not specified').length).toBeGreaterThanOrEqual(3);
  expect(screen.queryByText(/1970|Invalid Date/)).toBeNull();
});
// Test case: Displays HTML-like event text and checks it remains literal text without an executable image.
it('renders event text as text rather than executable markup', async () => {

  api.get.mockImplementation(async (path) => // Supplies controlled api.get behavior for this regression case, including its expected result or failure.

      // Handles this operation using the surrounding screen or request state.
      path === '/auth/me' ? { user } : { event: { ...event, special_arrangements: '<img src=x onerror=alert(1)>' } });
  open('/organizer/events/101');
  expect(await screen.findByText('<img src=x onerror=alert(1)>', { selector: 'span' })).toBeTruthy();
  expect(screen.queryByRole('img')).toBeNull();
});
// Test case: Opens the coordinator detail URL and checks its fields and Back to Events destination.
it('Coordinator AC1 / Workspace AC1 - existing coordinator event-detail route still displays event information', async () => {

  user.role = 'event_coordinator'; open('/events/101');
  expect(await screen.findByRole('heading', { name: event.name })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Back to Assigned Events' }).getAttribute('href')).toBe('/coordinator/dashboard');
});
// Test case: Fills event requirements and checks submitted payload and navigation to the saved record.
it('Workflow AC2 AC4 - event request form confirms all fields and navigates after success', async () => {

  api.post.mockResolvedValue({ event: { id: 101 }, message: 'Event request submitted.' });
  open('/organizer/events/new');
  fireEvent.change(await screen.findByLabelText('Event name'), { target: { value: 'Community Workshop' } });
  for (const [label, value] of [['Purpose',event.purpose],['Description',event.description],['Event type',event.event_type],['Proposed date','2030-10-15'],['Start time','09:00'],['End time','12:00'],['Expected attendance','50'],['Room layout preference','Theatre'],['Programme', event.programme_details], ['Special arrangements', event.special_arrangements],
    ['Other equipment notes', event.equipment_notes], ['Accessibility needs (one per line)', 'Wheelchair access\nHearing loop']]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByLabelText('Requires attendee registration'));fireEvent.change(screen.getByLabelText('Registration capacity'),{target:{value:'45'}});
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => // Repeats the assertion until the expected asynchronous UI or mocked API state appears.

      // Handles this operation using the surrounding screen or request state.
      expect(api.post).toHaveBeenCalledWith('/events', expect.objectContaining({
    expectedAttendance:50,registrationCapacity:45,registrationRequired:true,isDraft: false, programmeDetails: event.programme_details, specialArrangements: event.special_arrangements,
    equipmentNotes: event.equipment_notes, accessibilityRequirements: event.accessibility_requirements,
  }), 'organiser-token'));
  await screen.findByText('Event request submitted.');fireEvent.click(screen.getByRole('button',{name:'Continue'}));
  expect(await screen.findByRole('heading', { name: event.name })).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('Event request submitted.');
});



// Test case: Fails a pending event submission after duplicate submits; checks one request, retained name and visible error through real application routing.
it('Workflow AC4 / Event requests AC1 - failed pending saves preserve input and prevent duplicate writes',async()=>{
  let reject;api.post.mockImplementation(()=>new Promise((_,bad)=>{reject=bad;}));open('/organizer/events/new');
  fireEvent.change(await screen.findByLabelText('Event name'),{target:{value:'Draft'}});
  fireEvent.click(screen.getByRole('button',{name:'Save as draft'}));expect(api.post).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Confirm'}));fireEvent.click(screen.getAllByRole('button',{name:'Saving…'}).at(-1));expect(api.post).toHaveBeenCalledOnce();
  await act(async()=>reject(new Error('Unable to save event')));expect(screen.getByRole('alert').textContent).toBe('Unable to save event');expect(screen.getByLabelText('Event name').value).toBe('Draft');
});

// Lead AC6/AC7: the real protected detail route exposes recorded email to the assigned coordinator.
it('Lead AC6 AC7 - coordinator views the recorded organiser email', async () => {
  user = { ...user, role: 'event_coordinator' };
  api.get.mockImplementation(async path => path === '/auth/me' ? { user } : { event: { ...event, organiser_email: 'alice@example.com' } });
  open('/events/101');
  expect((await screen.findByRole('link', { name: 'alice@example.com' })).getAttribute('href')).toBe('mailto:alice@example.com');
});

// AC1/AC2: each editable field has a distinct input type or API mapping; literal payloads verify those contracts.
it.each([
  ['Event name', 'name', 'Renamed', 'Renamed'], ['Purpose','purpose','New purpose','New purpose'],
  ['Description','description','New description','New description'], ['Event type','eventType','seminar','seminar'],
  ['Date','proposedDate','2026-10-20','2026-10-20'], ['Start time','proposedStartTime','10:00','10:00'],
  ['End time','proposedEndTime','13:00','13:00'], ['Expected attendance','expectedAttendance','50',50],
  ['Layout requirements','roomLayoutPreference','theatre','theatre'], ['Other equipment notes','equipmentNotes','Projector','Projector'],
  ['Accessibility needs','accessibilityRequirements','Ramp\nHearing loop',['Ramp','Hearing loop']],
  ['Special arrangements','specialArrangements','Quiet room','Quiet room'], ['Registration capacity','registrationCapacity','',null],
])('Event AC1 AC2 - edits %s through its real control', async (label, key, value, expected) => {
  const column = {eventType:'event_type',proposedDate:'proposed_date',proposedStartTime:'proposed_start_time',proposedEndTime:'proposed_end_time',expectedAttendance:'expected_attendance',roomLayoutPreference:'room_layout_preference',equipmentNotes:'equipment_notes',accessibilityRequirements:'accessibility_requirements',specialArrangements:'special_arrangements',registrationCapacity:'registration_capacity'}[key] || key;
  // API fixtures use the real persisted snake-case record, with independently specified saved values.
  api.put.mockResolvedValue({event:{...event,[column]:expected},message:'Event information saved.'});
  open('/organizer/events/101'); await screen.findByRole('heading',{name:event.name});
  fireEvent.click(screen.getByRole('button',{name:`Edit ${label}`}));
  fireEvent.change(screen.getByLabelText(`Edit ${label}`),{target:{value}});
  fireEvent.click(screen.getByRole('button',{name:'Save changes'}));fireEvent.click(screen.getByRole('button',{name:'Confirm'}));
  await waitFor(()=>expect(api.put).toHaveBeenCalledWith('/events/101/non-critical',{[key]:expected},'organiser-token'));
  expect(await screen.findByText('Event information saved.')).toBeTruthy();
  const displayed = key === 'proposedDate' ? '20/10/2026' : key === 'accessibilityRequirements' ? 'Ramp, Hearing loop' : key === 'eventType' ? 'Seminar' : expected === null ? 'Not specified' : String(expected);
  expect(screen.getAllByText(displayed).length).toBeGreaterThan(0);
});

// AC2: boolean edits and cancellation must preserve the stored value until an explicit save.
it('Event AC2 - cancels checkbox edits and can save registration requirement', async()=>{
  api.put.mockResolvedValue({event:{...event,registration_required:false}});
  open('/organizer/events/101'); await screen.findByRole('heading',{name:event.name});
  fireEvent.click(screen.getByRole('button',{name:'Edit Registration required'}));
  fireEvent.click(screen.getByLabelText('Edit Registration required'));
  fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
  expect(api.put).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Edit Registration required'}));
  expect(screen.getByLabelText('Edit Registration required').checked).toBe(true);
  fireEvent.click(screen.getByLabelText('Edit Registration required'));
  fireEvent.click(screen.getByRole('button',{name:'Save changes'}));fireEvent.click(screen.getByRole('button',{name:'Confirm'}));
  await waitFor(()=>expect(api.put).toHaveBeenCalledWith('/events/101/non-critical',{registrationRequired:false},'organiser-token'));
});

// AC2: a rejected save is visible and never announces success (recovery is a separately reported existing defect).
it('Event AC2 - rejected edit displays the server validation error',async()=>{
  api.put.mockRejectedValue(new Error('End time must be later than start time.'));
  open('/organizer/events/101'); await screen.findByRole('heading',{name:event.name});
  fireEvent.click(screen.getByRole('button',{name:'Edit End time'}));
  fireEvent.change(screen.getByLabelText('Edit End time'),{target:{value:'08:00'}});
  fireEvent.click(screen.getByRole('button',{name:'Save changes'}));fireEvent.click(screen.getByRole('button',{name:'Confirm'}));
  expect((await screen.findByRole('alert')).textContent).toBe('End time must be later than start time.');
  expect(screen.getByLabelText('Edit End time').value).toBe('08:00');
});

// Lead AC2/AC6: full-page review is read-only and its back navigation returns to the lead workspace.
it('Lead AC2 AC6 - lead opens details without coordinator management controls',async()=>{
  user={...user,role:'event_coordinator_lead'};
  api.get.mockImplementation(async path=>path==='/auth/me'?{user}:{event});
  open('/events/101'); await screen.findByRole('heading',{name:event.name});
  expect(screen.getByText('Email not recorded')).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Send clarification request'})).toBeNull();
  expect(screen.queryByRole('button',{name:'Edit Purpose'})).toBeNull();
  expect(screen.getByRole('link',{name:'Back to Events'}).getAttribute('href')).toBe('/coordinator-lead/dashboard');
});

// AC2: cancellation restores stored values, including absent optional date/time/list/boolean fields.
it.each(['Accessibility needs','Date','Start time','End time','Registration required','Expected attendance'])('Event AC2 - cancels absent %s without a write',async label=>{
  api.get.mockImplementation(async path=>path==='/auth/me'?{user}:{event:{...event,accessibility_requirements:null,proposed_date:null,proposed_start_time:null,proposed_end_time:null,registration_required:null,expected_attendance:null}});
  open('/organizer/events/101');await screen.findByRole('heading',{name:event.name});
  fireEvent.click(screen.getByRole('button',{name:`Edit ${label}`}));
  const control=screen.getByLabelText(`Edit ${label}`);
  if(label==='Registration required') fireEvent.click(control);
  else fireEvent.change(control,{target:{value:label==='Date'?'2026-11-01':label.includes('time')?'15:00':label==='Expected attendance'?'25':'Temporary edit'}});
  fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
  expect(screen.getByRole('button',{name:`Edit ${label}`})).toBeTruthy();expect(api.put).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:`Edit ${label}`}));
  const restored=screen.getByLabelText(`Edit ${label}`);
  if(label==='Registration required') expect(restored.checked).toBe(false);
  else expect(restored.value).toBe('');
});

// AC2: cancellation also preserves non-empty stored date/time/list values rather than clearing them.
it.each(['Accessibility needs','Date','Start time'])('Event AC2 - cancels recorded %s and restores its value',async label=>{
  open('/organizer/events/101');await screen.findByRole('heading',{name:event.name});
  fireEvent.click(screen.getByRole('button',{name:`Edit ${label}`}));
  // Expected values come from the recorded event fixture, not from the editor's initial rendering.
  const expected = {'Accessibility needs':'Wheelchair access\nHearing loop',Date:'2026-10-15','Start time':'09:00'}[label];
  expect(screen.getByLabelText(`Edit ${label}`).value).toBe(expected);
  fireEvent.change(screen.getByLabelText(`Edit ${label}`),{target:{value:label==='Date'?'2026-11-01':label==='Start time'?'15:00':'Temporary edit'}});
  fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
  fireEvent.click(screen.getByRole('button',{name:`Edit ${label}`}));
  expect(screen.getByLabelText(`Edit ${label}`).value).toBe(expected);expect(api.put).not.toHaveBeenCalled();
});

// AC2: duplicate form submissions during a slow save must not make competing updates.
it('Event AC2 - slow saves prevent duplicate writes and surface a useful generic failure',async()=>{
  let reject;
  api.put.mockImplementation(()=>new Promise((resolve,failure)=>{reject=failure;}));
  open('/organizer/events/101');await screen.findByRole('heading',{name:event.name});
  fireEvent.click(screen.getByRole('button',{name:'Edit Programme'}));
  const form=screen.getByRole('button',{name:'Save changes'}).closest('form');
  fireEvent.submit(form);expect(api.put).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Confirm'}));fireEvent.click(screen.getAllByRole('button',{name:'Saving…'}).at(-1));expect(api.put).toHaveBeenCalledTimes(1);
  await act(async()=>reject({}));expect((await screen.findByRole('alert')).textContent).toBe('Unable to save event information.');
});

// AC1/AC5: deselecting fields, blank submission and a slow request must never create duplicate clarification records.
it('Clarification AC1 AC5 - validates selection prevents duplicates and reports failed sending',async()=>{
  user={...user,role:'event_coordinator'};
  let reject;api.post.mockImplementation(()=>new Promise((resolve,failure)=>{reject=failure;}));
  open('/events/101');await screen.findByRole('heading',{name:event.name});fireEvent.click(screen.getByRole('tab',{name:'Activity'}));
  const form=screen.getByRole('button',{name:'Send clarification request'}).closest('form');
  fireEvent.submit(form);expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText('Expected attendance'));fireEvent.click(screen.getByLabelText('Expected attendance'));
  fireEvent.change(screen.getByLabelText('What needs clarification?'),{target:{value:'Please confirm'}});fireEvent.submit(form);expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText('Expected attendance'));fireEvent.submit(form);fireEvent.submit(form);expect(api.post).toHaveBeenCalledTimes(1);
  await act(async()=>reject({}));expect((await screen.findByRole('alert')).textContent).toBe('Unable to send clarification request.');
});

// AC4/AC5: blank replies do not resolve requests; responding to one preserves the other outstanding request.
it('Clarification AC4 AC5 - responds once and preserves other outstanding requests',async()=>{
  const requests=[{id:601,information_needed:['expected_attendance','legacy_field'],message:'Count?',status:'pending'}, {id:602,information_needed:['purpose'],message:'Purpose?',status:'pending'}];
  let currentEvent = { ...event, clarification_requests: requests };
  api.get.mockImplementation(async path=>path==='/auth/me'?{user}:{event:currentEvent});
  let finish;api.post.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  open('/organizer/events/101');await screen.findByRole('heading',{name:event.name});
  const form=screen.getByLabelText('Response or amendment to clarification 601').closest('form');
  fireEvent.submit(form);expect(api.post).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Response or amendment to clarification 601'),{target:{value:'45 people'}});
  fireEvent.submit(form);fireEvent.submit(form);expect(api.post).toHaveBeenCalledTimes(1);
  currentEvent = { ...currentEvent, clarification_outstanding: true, clarification_requests: [{ ...requests[0], status: 'responded', organiser_response: '45 people' }, requests[1]] };
  await act(async()=>finish({clarificationRequest:currentEvent.clarification_requests[0],clarificationOutstanding:true,message:'Saved'}));
  expect(screen.getByText('45 people')).toBeTruthy();expect(screen.getByLabelText('Response or amendment to clarification 602')).toBeTruthy();
});

// AC4: response failures never falsely mark the clarification answered.
it.each([new Error('Offline'),{}])('Clarification AC4 - failed replies report an error %j',async failure=>{
  const request={id:601,information_needed:['purpose'],message:'Purpose?',status:'pending'};
  api.get.mockImplementation(async path=>path==='/auth/me'?{user}:{event:{...event,clarification_requests:[request]}});
  api.post.mockRejectedValue(failure);open('/organizer/events/101');await screen.findByRole('heading',{name:event.name});
  fireEvent.change(screen.getByLabelText('Response or amendment to clarification 601'),{target:{value:'Learning'}});
  fireEvent.click(screen.getByRole('button',{name:'Send response'}));
  expect((await screen.findByRole('alert')).textContent).toBe(failure.message||'Unable to save clarification response.');
});

// AC3: inherited critical-change inbox shows heterogeneous requested fields with honest missing-value labels.
it('Event AC3 - coordinator inbox renders pending changes and missing event summaries',async()=>{
  user={...user,role:'event_coordinator'};
  api.get.mockImplementation(async path=>path==='/auth/me'?{user}:path==='/events'?{events:[{id:101,name:null,purpose:null,status:null,clarification_outstanding:true}]}:path==='/events/change-requests'?{changeRequests:[
    // The review API describes each change (current vs requested); an empty change list is valid too.
    {id:501,event_id:101,event_name:'Workshop',organiser_name:'Alice',requested_changes:{},arrangements:[],changes:[{field:'accessibilityRequirements',label:'Accessibility needs',current:[],requested:['Ramp']},{field:'registrationRequired',label:'Registration required',current:true,requested:false},{field:'other',label:'other',current:null,requested:5}]},
    {id:502,event_id:101,event_name:'Another',requested_changes:{},arrangements:[],changes:[{field:'registrationRequired',label:'Registration required',current:false,requested:true}]},
    {id:503,event_id:101,event_name:'Third',requested_changes:{},arrangements:[],changes:[]}]}:path==='/notifications'?{notifications:[],unreadCount:0}:[]);
  open('/coordinator/dashboard');await screen.findByText('Ramp');
  expect(screen.getAllByText('No')).toHaveLength(2);expect(screen.getAllByText('Yes')).toHaveLength(2);
  expect(screen.getByText('Not specified')).toBeTruthy();expect(screen.getByText('None')).toBeTruthy();expect(screen.getByText('Untitled Event')).toBeTruthy();
  expect(screen.getByText('Clarification outstanding')).toBeTruthy();
});

// AC3: a failed inbox load is an error, not a claim that no coordinator work is pending.
it.each([new Error('Offline'),{}])('Event AC3 - coordinator inbox reports retrieval failure %j',async failure=>{
  user={...user,role:'event_coordinator'};
  api.get.mockImplementation(async path=>{if(path==='/auth/me')return {user};if(path==='/events')return {events:[]};if(path==='/events/change-requests')throw failure;return {notifications:[],unreadCount:0};});
  open('/coordinator/dashboard');expect((await screen.findByRole('alert')).textContent).toBe(failure.message||'Unable to load change requests.');
});

// AC6: an empty detail response must be explicit and must never expose stale event information.
it('Organiser view AC4 - missing detail payload shows no event details',async()=>{
  api.get.mockImplementation(async path=>path==='/auth/me'?{user}:{event:null});
  open('/organizer/events/101');expect(await screen.findByText('No event details available.')).toBeTruthy();
  expect(screen.queryByRole('heading',{name:event.name})).toBeNull();
});

// Clarification AC1/AC5: adding a request retains recorded history instead of replacing it.
it('Clarification AC1 AC5 - coordinator adds a question alongside existing requests',async()=>{
  user={...user,role:'event_coordinator'};
  const old={id:601,information_needed:['purpose'],message:'Old question',status:'responded',organiser_response:'Answered'};
  api.get.mockImplementation(async path=>path==='/auth/me'?{user}:{event:{...event,clarification_requests:[old]}});
  api.post.mockResolvedValue({clarificationRequest:{id:602,information_needed:['expected_attendance'],message:'New question',status:'pending'},message:'Sent'});
  open('/events/101');await screen.findByRole('heading',{name:event.name});fireEvent.click(screen.getByRole('tab',{name:'Activity'}));
  fireEvent.click(screen.getByLabelText('Expected attendance'));fireEvent.change(screen.getByLabelText('What needs clarification?'),{target:{value:'New question'}});
  fireEvent.click(screen.getByRole('button',{name:'Send clarification request'}));
  expect(await screen.findByText('New question')).toBeTruthy();expect(screen.getByText('Old question')).toBeTruthy();expect(screen.getByText('Answered')).toBeTruthy();
});

// Organiser view AC4: deliberately malformed API input must not invent a name; this is not a valid database row.
it('Organiser view AC4 - defensive API input with absent required name stays unspecified',async()=>{
  api.get.mockImplementation(async path=>path==='/auth/me'?{user}:{event:{...event,name:null}});
  open('/organizer/events/101');expect(await screen.findByRole('heading',{name:'Not specified'})).toBeTruthy();
});

// Clarification AC1: the first request on a legacy record without a history array initializes visible history.
it('Clarification AC1 - first request initializes absent history',async()=>{
  user={...user,role:'event_coordinator'};
  api.post.mockResolvedValue({clarificationRequest:{id:601,information_needed:['purpose'],message:'First question',status:'pending'},message:'Sent'});
  open('/events/101');await screen.findByRole('heading',{name:event.name});fireEvent.click(screen.getByRole('tab',{name:'Activity'}));
  fireEvent.click(screen.getByLabelText('Purpose'));fireEvent.change(screen.getByLabelText('What needs clarification?'),{target:{value:'First question'}});
  fireEvent.click(screen.getByRole('button',{name:'Send clarification request'}));
  expect(await screen.findByText('First question')).toBeTruthy();
});

// Lead AC2/AC6: full-page review retains read-only details and Back returns to the lead queue.
it('Lead AC2 AC6 - reviews a request on the full page and returns to queue',async()=>{
  user={...user,role:'event_coordinator_lead'};
  api.get.mockImplementation(async path=>path==='/auth/me'?{user}:path==='/events/assignments'?{events:[{...event,coordinator_id:null}],coordinators:[]}:{event});
  open('/coordinator-lead/dashboard');await screen.findByRole('link',{name:'View details'});
  fireEvent.click(screen.getByRole('link',{name:'View details'}));
  expect(screen.queryByRole('dialog',{name:'Event details'})).toBeNull();
  expect(await screen.findByRole('heading',{name:event.name})).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Edit Purpose'})).toBeNull();
  fireEvent.click(screen.getByRole('link',{name:'Back to Events'}));
  expect(await screen.findByRole('heading',{name:'Unassigned requests'})).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
});

// Existing event-view missing-information rule: this is deliberately incomplete API input for defensive UI testing,
// not a claim that PostgreSQL permits a null registration_required column or returns this normal success shape.
it.each(['Date','Start time','End time','Accessibility needs','Expected attendance','Registration capacity','Programme','Layout requirements','Other equipment notes','Special arrangements','Event type','Registration required'])('Organiser view AC4 / existing edit AC2 AC3 - defensive incomplete API input defaults %s',async label=>{
  const incomplete={...event,event_type:null,proposed_date:null,proposed_start_time:null,proposed_end_time:null,
    accessibility_requirements:null,registration_required:undefined,registration_capacity:null,expected_attendance:null,
    programme_details:null,room_layout_preference:null,equipment_notes:null,special_arrangements:null};
  // Arrange a synthetic contract-degradation fixture separately from the normal persisted-record save tests.
  api.get.mockImplementation(async path=>path==='/auth/me'?{user}:{event:incomplete});
  api.put.mockResolvedValue({event:incomplete});
  open('/organizer/events/101');await screen.findByRole('heading',{name:event.name});
  // Act: saving a blank optional field preserves the independently specified missing values.
  fireEvent.click(screen.getByRole('button',{name:'Edit Other equipment notes'}));
  fireEvent.click(screen.getByRole('button',{name:'Save changes'}));fireEvent.click(screen.getByRole('button',{name:'Confirm'}));
  await screen.findByText('Non-critical event information saved.');fireEvent.click(screen.getByRole('button',{name:'Continue'}));
  // Assert one independently specified control default per test, keeping each case focused and fast.
  fireEvent.click(screen.getByRole('button',{name:`Edit ${label}`}));
  if(label==='Registration required') expect(screen.getByLabelText(`Edit ${label}`).checked).toBe(false);
  else expect(screen.getByLabelText(`Edit ${label}`).value).toBe('');
});

// UI AC1: both role-scoped cards use the dedicated red clarification style.
it.each(['event_organiser', 'event_coordinator'])('UI AC1 - %s shows a red outstanding clarification badge', async role => {
  // Arrange: only the HTTP boundary is mocked; authentication, routing and cards are real.
  user = { ...user, role };
  api.get.mockImplementation(async path => path === '/auth/me' ? { user } : { events: [{ ...event, clarification_outstanding: true }] });
  // Act and Assert: the dedicated class connects the visible label to the red palette.
  open(role === 'event_organiser' ? '/organizer/dashboard' : '/events');
  expect((await screen.findByText('Clarification outstanding')).className).toContain('status-clarification_outstanding');
});

// UI AC2: assignment changes the organiser presentation while terminal/draft states remain explicit.
it.each([
  ['submitted', 3, 'Submitted'], ['under_review', 3, 'Under Review'],
  ['approved', 3, 'Approved'], ['planning', 3, 'Planning'], ['confirmed', 3, 'Confirmed'],
  ['submitted', null, 'Submitted'], ['draft', 3, 'Draft'],
  ['cancelled', 3, 'Cancelled'], ['completed', 3, 'Completed'],
])('SCRUM-93 AC1/AC2 - organiser displays %s with coordinator %s as %s', async (status, coordinatorId, label) => {
  // Arrange: SCRUM-93 displays the recorded lifecycle status regardless of assignment.
  api.get.mockImplementation(async path => path === '/auth/me' ? { user } : { events: [{ ...event, status, coordinator_id: coordinatorId }] });
  // Act and Assert: inspect the rendered status and ensure this remains a read-only change.
  open('/organizer/dashboard');
  expect(await screen.findByText(label, { selector: '.status-badge' })).toBeTruthy();
  expect(api.put).not.toHaveBeenCalled();
});

// UI AC2: coordinator cards retain their operational lifecycle status after assignment.
it('UI AC2 - coordinator retains submitted status on an assigned card', async () => {
  user = { ...user, role: 'event_coordinator' };
  api.get.mockImplementation(async path => path === '/auth/me' ? { user } : { events: [{ ...event, coordinator_id: 3 }] });
  open('/events');
  expect(await screen.findByText('submitted')).toBeTruthy();
  expect(screen.queryByText('In progress')).toBeNull();
});

// UI AC3: organisers read the full question before reaching its compact checkbox.
it('UI AC3 - registration question precedes a compact checkbox and saves the answer', async () => {
  // Arrange: real editor and routing; the API supplies the persisted event and saved answer.
  api.put.mockResolvedValue({ event: { ...event, registration_required: false }, message: 'Saved' });
  open('/organizer/events/101');
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Registration required' }));
  // Act: inspect semantic order before changing the existing true answer to false.
  const checkbox = screen.getByRole('checkbox', { name: 'Edit Registration required' });
  const question = screen.getByText('Registration required?');
  expect(question.compareDocumentPosition(checkbox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(checkbox.className).toContain('registration-required-checkbox');
  expect(checkbox.checked).toBe(true);
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  // Assert: the layout correction preserves the literal boolean sent and its displayed result.
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/events/101/non-critical', { registrationRequired: false }, 'organiser-token'));
  await screen.findByText('Saved');
  expect(screen.queryByRole('checkbox')).toBeNull();
});

it('SCRUM-93 AC3/AC5 - live status and new clarification preserve an unsaved organiser edit', async () => {
  // Arrange: real App routing and editing, with only the HTTP responses controlled.
  let snapshot = { ...event, can_manage: true, clarification_outstanding: false, clarification_requests: [] };
  api.get.mockImplementation(async path => path === '/auth/me' ? { user }
    : path === '/events/101' ? { event }
    : path === '/events/101/request-status' ? { event: snapshot }
    : path === '/events/101/decision' ? { status: snapshot.status, outcome: null }
    : { notifications: [], unreadCount: 0 });
  open('/organizer/events/101');
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Purpose' }));
  const input = screen.getByLabelText('Edit Purpose');
  fireEvent.change(input, { target: { value: 'Unsaved programme proposal' } });
  // Act: a Coordinator changes lifecycle state and asks a new question elsewhere.
  snapshot = { ...snapshot, status: 'planning', clarification_outstanding: true,
    clarification_requests: [{ id: 701, status: 'pending', information_needed: ['purpose'], message: 'Please explain the programme.' }] };
  fireEvent(window, new Event('focus'));
  await within(screen.getByRole('region', { name: 'Request status', hidden: true })).findByText('Planning', { selector: 'strong' });
  // Assert: polling updates status/action data while preserving the separately owned form state.
  expect(input.value).toBe('Unsaved programme proposal');
  expect(screen.getByText('Please explain the programme.')).toBeTruthy();
  expect(screen.getByLabelText('Response or amendment to clarification 701')).toBeTruthy();
});

it('SCRUM-93 AC3/AC5 - a pre-response poll cannot restore an answered clarification', async () => {
  const question = { id: 701, status: 'pending', information_needed: ['purpose'], message: 'Please explain the programme.' };
  const original = { ...event, can_manage: true, clarification_outstanding: true, clarification_requests: [question] };
  let current = original, reads = 0, finishOld;
  api.get.mockImplementation(async path => {
    if (path === '/auth/me') return { user };
    if (path === '/events/101/request-status') {
      reads++;
      if (reads === 2) return new Promise(resolve => { finishOld = resolve; });
      return { event: current };
    }
    if (path === '/events/101') return { event: original };
    if (path === '/events/101/decision') return { status: 'submitted', outcome: null };
    return { notifications: [], unreadCount: 0 };
  });
  const answered = { ...question, status: 'responded', organiser_response: 'A community learning session.' };
  api.post.mockImplementation(async () => {
    current = { ...original, clarification_outstanding: false, clarification_requests: [answered] };
    return { clarificationRequest: answered, clarificationOutstanding: false, message: 'Response saved.' };
  });
  open('/organizer/events/101');
  await within(await screen.findByRole('region', { name: 'Request status' })).findByText('Submitted', { selector: 'strong' });
  fireEvent(window, new Event('focus'));
  fireEvent.change(screen.getByLabelText('Response or amendment to clarification 701'), { target: { value: answered.organiser_response } });
  fireEvent.click(screen.getByRole('button', { name: 'Send response' }));
  await screen.findByText(answered.organiser_response);
  await act(async () => { finishOld({ event: original }); });
  expect(screen.queryByText(/Action required/)).toBeNull();
  expect(screen.queryByLabelText('Response or amendment to clarification 701')).toBeNull();
  expect(screen.getByText(answered.organiser_response)).toBeTruthy();
});

it('SCRUM-93 AC1/AC6 - organisation colleague opens the status route without fetching private details', async () => {
  // Arrange: real authentication, App routes and links; only HTTP returns the organisation-scoped colleague row.
  const colleague = { ...event, organiser_id: 99, can_manage: false, status: 'under_review' };
  api.get.mockImplementation(async path => path === '/auth/me' ? { user }
    : path === '/events' ? { events: [colleague] }
    : path === '/events/101/request-status' ? { event: colleague }
    : { notifications: [], unreadCount: 0 });
  open('/organizer/events');
  fireEvent.click(await screen.findByRole('link', { name: 'View status' }));
  // Assert: a missing App route or navigation to private EventDetail would fail this oracle.
  expect(await within(await screen.findByRole('region', { name: 'Request status' })).findByText('Under Review', { selector: 'strong' })).toBeTruthy();
  expect(api.get).toHaveBeenCalledWith('/events/101/request-status', 'organiser-token');
  expect(api.get).not.toHaveBeenCalledWith('/events/101', 'organiser-token');
  expect(screen.queryByRole('button', { name: 'Edit Purpose' })).toBeNull();
});
