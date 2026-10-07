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
function open(path, authenticated = true) {
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
    throw new Error('Event not found.');
  });
});
afterEach(cleanup);

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

// Test case: Opens an assigned event through the coordinator dashboard and checks every submitted requirement in its drawer.
it('assigned coordinator opens dashboard events and sees every submitted requirement',async()=>{
  // Verifies the coordinator's own navigation and complete record rather than relying on organiser rendering alone.
  user={...user,role:'event_coordinator'};open('/coordinator/dashboard');
  expect(await screen.findByRole('heading',{name:'Event Coordinator Dashboard'})).toBeTruthy();fireEvent.click(await screen.findByRole('link',{name:'View details'}));
  expect(await screen.findByRole('heading',{name:event.name})).toBeTruthy();
  for(const value of [event.purpose,'15/10/2026','09:00:00','12:00:00','40',event.programme_details,event.room_layout_preference,'Wheelchair access, Hearing loop',event.equipment_notes,'Yes','35',event.special_arrangements])expect(screen.getAllByText(value).length).toBeGreaterThan(0);
  expect(screen.getByRole('dialog', {name:'Event details'})).toBeTruthy();expect(api.get).toHaveBeenCalledWith('/events/101','organiser-token');
});
// Test case: Opens a sparse coordinator record and checks unavailable labels for missing fields.
it('coordinator records with missing submitted information identify it as unavailable',async()=>{
  // Exercises missing-data behavior through the coordinator's protected detail route.
  user={...user,role:'event_coordinator'};api.get.mockImplementation(async path=>path==='/auth/me'?{user}:{event:{id:101,name:'Incomplete assigned event'}});open('/events/101');
  await screen.findByRole('heading',{name:'Incomplete assigned event'});for(const label of ['Purpose','Date','Programme','Layout Requirements','Accessibility Needs','Equipment Requests','Registration Required'])expect(screen.getByText(label,{selector:'dt'}).parentElement.textContent).toMatch(/Not specified/);
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
  fireEvent.click(screen.getByRole('button', { name: 'Back to list' }));
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
  await screen.findByRole('heading', { name: event.name });
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
  api.get.mockImplementation(async (path) => path === '/auth/me' ? { user }
    : { event: { ...event, clarification_outstanding: true, clarification_requests: [clarificationRequest] } });
  const answered = { ...clarificationRequest, status: 'responded', organiser_response: 'The expected attendance is 45.' };
  api.post.mockResolvedValue({ clarificationRequest: answered, clarificationOutstanding: false, message: 'Clarification response saved.' });
  open('/organizer/events/101');
  await screen.findByRole('heading', { name: event.name });
  fireEvent.change(screen.getByLabelText('Response or amendment to clarification 601'), { target: { value: answered.organiser_response } });
  fireEvent.click(screen.getByRole('button', { name: 'Send response' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/events/101/clarifications/601/respond', { response: answered.organiser_response }, 'organiser-token'));
  expect(await screen.findByText(answered.organiser_response)).toBeTruthy();
  expect(screen.queryByText(/Clarification outstanding/)).toBeNull();
});
// Test case: Returns an empty event list and checks its empty state without sample records.
it('shows an empty My Events state without fake records', async () => {

  api.get.mockImplementation(async (path) => // Supplies controlled api.get behavior for this regression case, including its expected result or failure.

      // Handles this operation using the surrounding screen or request state.
      path === '/auth/me' ? { user } : { events: [] });
  open('/organizer/events');
  expect(await screen.findByText('You have not requested any events yet.')).toBeTruthy();
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
it('existing coordinator event-detail route still displays event information', async () => {

  user.role = 'event_coordinator'; open('/events/101');
  expect(await screen.findByRole('heading', { name: event.name })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Back to Events' }).getAttribute('href')).toBe('/events');
});
// Test case: Fills event requirements and checks submitted payload and navigation to the saved record.
it('event request form sends all fields and navigates to the saved record', async () => {

  api.post.mockResolvedValue({ event: { id: 101 }, message: 'Event request submitted.' });
  open('/organizer/events/new');
  fireEvent.change(await screen.findByLabelText('Event name'), { target: { value: 'Community Workshop' } });
  for (const [label, value] of [['Purpose',event.purpose],['Description',event.description],['Event type',event.event_type],['Proposed date','2030-10-15'],['Start time','09:00'],['End time','12:00'],['Expected attendance','50'],['Room layout preference','Theatre'],['Programme', event.programme_details], ['Special arrangements', event.special_arrangements],
    ['Equipment requirements', event.equipment_notes], ['Accessibility needs (one per line)', 'Wheelchair access\nHearing loop']]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByLabelText('Requires attendee registration'));fireEvent.change(screen.getByLabelText('Registration capacity'),{target:{value:'45'}});
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  await waitFor(() => // Repeats the assertion until the expected asynchronous UI or mocked API state appears.

      // Handles this operation using the surrounding screen or request state.
      expect(api.post).toHaveBeenCalledWith('/events', expect.objectContaining({
    expectedAttendance:50,registrationCapacity:45,registrationRequired:true,isDraft: false, programmeDetails: event.programme_details, specialArrangements: event.special_arrangements,
    equipmentNotes: event.equipment_notes, accessibilityRequirements: event.accessibility_requirements,
  }), 'organiser-token'));
  expect(await screen.findByRole('heading', { name: event.name })).toBeTruthy();
  expect(screen.getByRole('status').textContent).toBe('Event request submitted.');
});



// Test case: Fails a pending event submission after duplicate submits; checks one request, retained name and visible error through real application routing.
it('Event requests AC1 - failed pending saves preserve input and prevent duplicate writes',async()=>{
  let reject;api.post.mockImplementation(()=>new Promise((_,bad)=>{reject=bad;}));open('/organizer/events/new');
  fireEvent.change(await screen.findByLabelText('Event name'),{target:{value:'Draft'}});
  const form=screen.getByRole('button',{name:'Submit'}).closest('form');fireEvent.submit(form);fireEvent.submit(form);expect(api.post).toHaveBeenCalledOnce();
  await act(async()=>reject(new Error('Unable to save event')));expect(screen.getByRole('alert').textContent).toBe('Unable to save event');expect(screen.getByLabelText('Event name').value).toBe('Draft');
});

// ---------- Organiser updates before venue confirmation (edit AC1/AC2) and clarification handling (clarification AC1-AC5) ----------

// Each critical field uses an editor suited to its value and sends the typed value in the API's format.
// The fixture has no confirmed venue, so every field is directly editable (AC1).
it.each([
  // [editor label, displayed heading, input type, stored value shown in editor, new value, API payload, saved record, displayed result]
  ['Date', 'Date', 'date', '2026-10-15', '2026-11-02', { proposedDate: '2026-11-02' }, { proposed_date: '2026-11-02' }, '02/11/2026'],
  ['Start time', 'Start Time', 'time', '09:00', '10:30', { proposedStartTime: '10:30' }, { proposed_start_time: '10:30:00' }, '10:30:00'],
  ['Expected attendance', 'Expected Attendance', 'number', '40', '120', { expectedAttendance: 120 }, { expected_attendance: 120 }, '120'],
  // Clearing a number means "not specified", which the API stores as null rather than 0.
  ['Expected attendance', 'Expected Attendance', 'number', '40', '', { expectedAttendance: null }, { expected_attendance: null }, 'Not specified'],
])('AC1 - before venue confirmation the %s editor saves the new value', async (label, heading, type, before, after, payload, stored, shown) => {
  // Arrange
  api.put.mockResolvedValue({ event: { ...event, ...stored }, message: 'Event information saved.' });
  open('/organizer/events/101');
  await screen.findByRole('heading', { name: event.name });
  // Act
  fireEvent.click(screen.getByRole('button', { name: `Edit ${label}` }));
  const input = screen.getByLabelText(`Edit ${label}`);
  expect([input.type, input.value]).toEqual([type, before]);
  if (type === 'number') expect(input.min).toBe('0');
  fireEvent.change(input, { target: { value: after } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  // Assert: exact payload, confirmation, and the saved value displayed in place of the old one.
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/events/101/non-critical', payload, 'organiser-token'));
  expect(await screen.findByText('Event information saved.')).toBeTruthy();
  const field = screen.getByText(heading, { selector: 'dt' }).parentElement;
  expect(within(field).getByText(shown)).toBeTruthy();
});

// Test case: Unticks "Registration required" with its checkbox editor and checks false is sent and shown.
it('AC1 - registration can be switched off with its checkbox editor before venue confirmation', async () => {
  api.put.mockResolvedValue({ event: { ...event, registration_required: false }, message: 'Event information saved.' });
  open('/organizer/events/101');
  await screen.findByRole('heading', { name: event.name });
  fireEvent.click(screen.getByRole('button', { name: 'Edit Registration required' }));
  const checkbox = screen.getByLabelText('Edit Registration required');
  expect(checkbox.checked).toBe(true);
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/events/101/non-critical', { registrationRequired: false }, 'organiser-token'));
  expect(within(screen.getByText('Registration Required', { selector: 'dt' }).parentElement).getByText('No')).toBeTruthy();
});

// Test case: Edits accessibility needs one per line; blank lines and padding are dropped before sending the list.
it('AC2 - accessibility needs are edited one per line and saved as a clean list', async () => {
  api.put.mockResolvedValue({ event: { ...event, accessibility_requirements: ['Ramp', 'Hearing loop'] }, message: 'Event information saved.' });
  open('/organizer/events/101');
  await screen.findByRole('heading', { name: event.name });
  fireEvent.click(screen.getByRole('button', { name: 'Edit Accessibility needs' }));
  const editor = screen.getByLabelText('Edit Accessibility needs');
  expect(editor.value).toBe('Wheelchair access\nHearing loop');
  fireEvent.change(editor, { target: { value: '  Ramp \n\n Hearing loop ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/events/101/non-critical', { accessibilityRequirements: ['Ramp', 'Hearing loop'] }, 'organiser-token'));
  expect(await screen.findByText('Ramp, Hearing loop')).toBeTruthy();
});

// Test case: Starts an edit and cancels it; nothing is sent, the stored value stays, and reopening shows the stored value again.
it('AC2 - cancelling an edit discards the typed value without saving', async () => {
  open('/organizer/events/101');
  await screen.findByRole('heading', { name: event.name });
  fireEvent.click(screen.getByRole('button', { name: 'Edit Programme' }));
  fireEvent.change(screen.getByLabelText('Edit Programme'), { target: { value: 'Discarded agenda' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(api.put).not.toHaveBeenCalled();
  expect(screen.getByText(event.programme_details)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Programme' }));
  expect(screen.getByLabelText('Edit Programme').value).toBe(event.programme_details);
});

// Test case: Presses Save twice (form submitted twice) while the first save is pending; only one update is sent.
it('AC2 - a second submit while saving does not send a duplicate update', async () => {
  let finish;
  api.put.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  open('/organizer/events/101');
  await screen.findByRole('heading', { name: event.name });
  fireEvent.click(screen.getByRole('button', { name: 'Edit Description' }));
  fireEvent.change(screen.getByLabelText('Edit Description'), { target: { value: 'New description' } });
  const form = screen.getByLabelText('Edit Description').closest('form');
  fireEvent.submit(form); fireEvent.submit(form);
  expect(api.put).toHaveBeenCalledOnce();
  await act(async () => finish({ event: { ...event, description: 'New description' }, message: 'Event information saved.' }));
  expect(screen.getByText('Event information saved.')).toBeTruthy();
});

// Test case: The save is refused by the server; its reason is shown and no saved confirmation appears.
it('AC2 - a failed save shows the server reason instead of a confirmation', async () => {
  api.put.mockRejectedValue(new Error('description must be text of at most 10000 characters.'));
  open('/organizer/events/101');
  await screen.findByRole('heading', { name: event.name });
  fireEvent.click(screen.getByRole('button', { name: 'Edit Description' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect((await screen.findByRole('alert')).textContent).toBe('description must be text of at most 10000 characters.');
  expect(screen.queryByText(/information saved/)).toBeNull();
});

// Test case: A record without a stored name opens an empty, controlled name editor.
// React would also render a null value as an empty box, so the observable defect is React's null-value warning
// (an uncontrolled input that later switches to controlled while typing); the test fails if that warning appears.
it('Organiser AC4 - missing values open as empty editors', async () => {
  const warnings = vi.spyOn(console, 'error').mockImplementation(() => {});
  api.get.mockImplementation(async (path) => path === '/auth/me' ? { user } : { event: { id: 101, organiser_id: 12, status: 'draft' } });
  open('/organizer/events/101');
  expect(await screen.findByRole('heading', { name: 'Not specified' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Edit Event name' }));
  const editor = screen.getByLabelText('Edit Event name');
  fireEvent.change(editor, { target: { value: 'Named at last' } });
  expect(editor.value).toBe('Named at last');
  expect(warnings.mock.calls.flat().join(' ')).not.toMatch(/should not be null|uncontrolled/);
  warnings.mockRestore();
});

// Test case: The coordinator ticks two fields then unticks one; only the field still ticked is identified as needing clarification.
it('Clarification AC1 - unticking a field removes it from the clarification request', async () => {
  user = { ...user, id: 30, role: 'event_coordinator' };
  api.get.mockImplementation(async (path) => path === '/auth/me' ? { user } : { event: { ...event, clarification_requests: [] } });
  api.post.mockResolvedValue({ clarificationRequest: { id: 602, information_needed: ['programme_details'], message: 'Please share timings.', status: 'pending' },
    message: 'Clarification request sent to the Event Organiser.' });
  open('/events/101');
  await screen.findByRole('heading', { name: event.name });
  fireEvent.click(screen.getByLabelText('Expected attendance'));
  fireEvent.click(screen.getByLabelText('Programme'));
  fireEvent.click(screen.getByLabelText('Expected attendance'));
  fireEvent.change(screen.getByLabelText('What needs clarification?'), { target: { value: 'Please share timings.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send clarification request' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/events/101/clarifications',
    { informationNeeded: ['programme_details'], message: 'Please share timings.' }, 'organiser-token'));
});

// Test case: Submits the clarification form twice while the first request is pending; only one request reaches the organiser.
it('Clarification AC2 - a second submit while sending does not send a duplicate clarification request', async () => {
  user = { ...user, id: 30, role: 'event_coordinator' };
  api.get.mockImplementation(async (path) => path === '/auth/me' ? { user } : { event: { ...event, clarification_requests: [] } });
  api.post.mockImplementation(() => new Promise(() => {}));
  open('/events/101');
  await screen.findByRole('heading', { name: event.name });
  fireEvent.click(screen.getByLabelText('Expected attendance'));
  fireEvent.change(screen.getByLabelText('What needs clarification?'), { target: { value: 'Please confirm.' } });
  const form = screen.getByRole('button', { name: 'Send clarification request' }).closest('form');
  fireEvent.submit(form); fireEvent.submit(form);
  expect(api.post).toHaveBeenCalledOnce();
});

// Test case: Sending a clarification fails; the server reason is shown and nothing is marked outstanding.
it('Clarification AC2 - a failed clarification request shows the reason and is not marked outstanding', async () => {
  user = { ...user, id: 30, role: 'event_coordinator' };
  api.get.mockImplementation(async (path) => path === '/auth/me' ? { user } : { event: { ...event, clarification_requests: [] } });
  api.post.mockRejectedValue(new Error('Assigned event not found.'));
  open('/events/101');
  await screen.findByRole('heading', { name: event.name });
  fireEvent.click(screen.getByLabelText('Expected attendance'));
  fireEvent.change(screen.getByLabelText('What needs clarification?'), { target: { value: 'Please confirm.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send clarification request' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Assigned event not found.');
  expect(screen.queryByText(/Clarification outstanding/)).toBeNull();
});

// Test case: Two clarifications are pending; answering one updates only that one, and the other still awaits a response.
it('Clarification AC4/AC5 - answering one of two clarifications keeps the other outstanding', async () => {
  const first = { id: 601, information_needed: ['expected_attendance'], message: 'Confirm the count.', status: 'pending' };
  const second = { id: 602, information_needed: ['programme_details'], message: 'Share timings.', status: 'pending' };
  api.get.mockImplementation(async (path) => path === '/auth/me' ? { user }
    : { event: { ...event, clarification_outstanding: true, clarification_requests: [second, first] } });
  api.post.mockResolvedValue({ clarificationRequest: { ...first, status: 'responded', organiser_response: '45 people.' },
    clarificationOutstanding: true, message: 'Clarification response saved.' });
  open('/organizer/events/101');
  await screen.findByRole('heading', { name: event.name });
  fireEvent.change(screen.getByLabelText('Response or amendment to clarification 601'), { target: { value: '45 people.' } });
  fireEvent.click(within(screen.getByText('Confirm the count.').closest('li')).getByRole('button', { name: 'Send response' }));
  expect(await screen.findByText('45 people.')).toBeTruthy();
  expect(within(screen.getByText('Confirm the count.').closest('li')).getByText('Organiser responded')).toBeTruthy();
  expect(within(screen.getByText('Share timings.').closest('li')).getByText('Awaiting organiser response')).toBeTruthy();
  expect(screen.getByLabelText('Response or amendment to clarification 602')).toBeTruthy();
  expect(screen.getByText(/Clarification outstanding/)).toBeTruthy();
});

// Test case: Submits a response twice while the first is pending; only one response is sent.
it('Clarification AC4 - a second submit while sending does not send a duplicate response', async () => {
  const pending = { id: 601, information_needed: ['expected_attendance'], message: 'Confirm the count.', status: 'pending' };
  api.get.mockImplementation(async (path) => path === '/auth/me' ? { user } : { event: { ...event, clarification_outstanding: true, clarification_requests: [pending] } });
  api.post.mockImplementation(() => new Promise(() => {}));
  open('/organizer/events/101');
  await screen.findByRole('heading', { name: event.name });
  fireEvent.change(screen.getByLabelText('Response or amendment to clarification 601'), { target: { value: '45 people.' } });
  const form = screen.getByRole('button', { name: 'Send response' }).closest('form');
  fireEvent.submit(form); fireEvent.submit(form);
  expect(api.post).toHaveBeenCalledOnce();
});

// Test case: Saving a response fails; the reason is shown and the request is not shown as answered.
it('Clarification AC4 - a failed response shows the reason and leaves the request unanswered', async () => {
  const pending = { id: 601, information_needed: ['expected_attendance'], message: 'Confirm the count.', status: 'pending' };
  api.get.mockImplementation(async (path) => path === '/auth/me' ? { user } : { event: { ...event, clarification_outstanding: true, clarification_requests: [pending] } });
  api.post.mockRejectedValue(new Error('Outstanding clarification request not found.'));
  open('/organizer/events/101');
  await screen.findByRole('heading', { name: event.name });
  fireEvent.change(screen.getByLabelText('Response or amendment to clarification 601'), { target: { value: '45 people.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send response' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Outstanding clarification request not found.');
  expect(screen.queryByText('Organiser responded')).toBeNull();
});

// Test case: My Events marks only the event waiting on a clarification, so the organiser can see which needs their answer.
it('Clarification AC5 - the event list flags only events with an outstanding clarification', async () => {
  api.get.mockImplementation(async (path) => path === '/auth/me' ? { user }
    : { events: [{ ...event, clarification_outstanding: true }, { ...event, id: 102, name: 'Second event', clarification_outstanding: false }] });
  open('/organizer/events');
  const waiting = (await screen.findByRole('heading', { name: event.name })).closest('article');
  expect(within(waiting).getByText('Clarification outstanding')).toBeTruthy();
  expect(within(screen.getByRole('heading', { name: 'Second event' }).closest('article')).queryByText('Clarification outstanding')).toBeNull();
});
