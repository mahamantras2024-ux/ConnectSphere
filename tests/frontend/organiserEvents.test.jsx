// File: Tests organiser navigation, event display/creation, ownership errors, and external sign-in destinations.
// Test scope: Uses real components/utilities with controlled API/provider responses where configured; live service delivery is outside this scope.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
it('existing coordinator event-detail route still displays event information', async () => {

  user.role = 'event_coordinator'; open('/events/101');
  expect(await screen.findByRole('heading', { name: event.name })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Back to Events' }).getAttribute('href')).toBe('/events');
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
  open('/events/101');await screen.findByRole('heading',{name:event.name});
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
  api.get.mockImplementation(async path=>path==='/auth/me'?{user}:{event:{...event,clarification_requests:requests}});
  let finish;api.post.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  open('/organizer/events/101');await screen.findByRole('heading',{name:event.name});
  const form=screen.getByLabelText('Response or amendment to clarification 601').closest('form');
  fireEvent.submit(form);expect(api.post).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Response or amendment to clarification 601'),{target:{value:'45 people'}});
  fireEvent.submit(form);fireEvent.submit(form);expect(api.post).toHaveBeenCalledTimes(1);
  await act(async()=>finish({clarificationRequest:{...requests[0],status:'responded',organiser_response:'45 people'},clarificationOutstanding:true,message:'Saved'}));
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
  api.get.mockImplementation(async path=>path==='/auth/me'?{user}:path==='/events'?{events:[{id:101,name:null,purpose:null,status:null,clarification_outstanding:true}]}:path==='/events/change-requests'?{changeRequests:[{id:501,event_id:101,event_name:'Workshop',organiser_name:'Alice',requested_changes:{accessibilityRequirements:['Ramp'],registrationRequired:false,other:null,expectedAttendance:5}}, {id:502,event_id:101,event_name:'Another',requested_changes:{registrationRequired:true}},{id:503,event_id:101,event_name:'Third',requested_changes:null}]}:[]);
  open('/coordinator/dashboard');await screen.findByText('Ramp');
  expect(screen.getByText('No')).toBeTruthy();expect(screen.getByText('Yes')).toBeTruthy();
  expect(screen.getByText('Not specified')).toBeTruthy();expect(screen.getByText('Untitled Event')).toBeTruthy();
  expect(screen.getByText('Clarification outstanding')).toBeTruthy();
});

// AC3: a failed inbox load is an error, not a claim that no coordinator work is pending.
it.each([new Error('Offline'),{}])('Event AC3 - coordinator inbox reports retrieval failure %j',async failure=>{
  user={...user,role:'event_coordinator'};
  api.get.mockImplementation(async path=>{if(path==='/auth/me')return {user};if(path==='/events')return {events:[]};if(path==='/events/change-requests')throw failure;return [];});
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
  open('/events/101');await screen.findByRole('heading',{name:event.name});
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
  open('/events/101');await screen.findByRole('heading',{name:event.name});
  fireEvent.click(screen.getByLabelText('Purpose'));fireEvent.change(screen.getByLabelText('What needs clarification?'),{target:{value:'First question'}});
  fireEvent.click(screen.getByRole('button',{name:'Send clarification request'}));
  expect(await screen.findByText('First question')).toBeTruthy();
});

// Lead AC2/AC6: review uses the existing accessible detail drawer and closing returns to the lead queue.
it('Lead AC2 AC6 - reviews a request in the existing drawer and returns to queue',async()=>{
  user={...user,role:'event_coordinator_lead'};
  api.get.mockImplementation(async path=>path==='/auth/me'?{user}:path==='/events/assignments'?{events:[{...event,coordinator_id:null}],coordinators:[]}:{event});
  open('/coordinator-lead/dashboard');await screen.findByRole('link',{name:'View details'});
  fireEvent.click(screen.getByRole('link',{name:'View details'}));
  expect(await screen.findByRole('dialog',{name:'Event details'})).toBeTruthy();
  expect(await screen.findByRole('heading',{name:event.name})).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Edit Purpose'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Close dialog'}));
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
  ['submitted', 3, 'In progress'], ['under_review', 3, 'In progress'],
  ['approved', 3, 'In progress'], ['planning', 3, 'In progress'], ['confirmed', 3, 'In progress'],
  ['submitted', null, 'submitted'], ['draft', 3, 'draft'],
  ['cancelled', 3, 'cancelled'], ['completed', 3, 'completed'],
])('UI AC2 - organiser displays %s with coordinator %s as %s', async (status, coordinatorId, label) => {
  // Arrange: persisted assignment is the source of progress; no lifecycle mutation is needed.
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
