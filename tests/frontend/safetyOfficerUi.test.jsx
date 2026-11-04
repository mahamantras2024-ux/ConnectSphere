import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../../frontend/src/App';
import { api } from '../../frontend/src/api/client';
import { useAuth } from '../../frontend/src/context/AuthContext';
vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../frontend/src/context/AuthContext', () => ({ useAuth: vi.fn() }));
const event = { id: 101, name: 'Safety Forum', proposed_date: '2030-11-25', proposed_start_time: '09:00:00', proposed_end_time: '12:00:00',
  expected_attendance: 60, room_layout_preference: 'Theatre', accessibility_requirements: [], equipment_items: [],
  venues: [{ name: 'North Hall', capacity: 100, supported_layouts: ['Theatre'], accessibility_features: ['Ramp'],
    emergency_access: 'Two exits', emergency_documents: { procedure: { name: 'procedure.pdf', type: 'application/pdf', data: 'JVBERi0=' } } }], latest_safety_check: null };
let queue;
beforeEach(() => {
  vi.resetAllMocks(); queue = [event];
  useAuth.mockReturnValue({ token: 'officer', user: { id: 50, full_name: 'Sam', email: 'sam@example.com', role: 'safety_officer' } });
  api.get.mockImplementation(async path => path === '/safety/checks' ? { events: queue }
    : { events: [], registrations: [], coordinators: [], notifications: [], unreadCount: 0 });
});
afterEach(cleanup);
/** Keep route protection, cards, facts and form interaction real; only session and HTTP are external. */
function open(path = '/safety/dashboard') { return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>); }

it('Safety UI AC1 AC2 - removes account details and presents compact cards before conducting a check', async () => {
  // Arrange / Act: the dashboard must show a useful queue rather than the complete review form for every event.
  open(); const card = await screen.findByRole('article');
  // Assert: a faulty inline form or leaked profile remains observable through its original labels.
  expect(screen.queryByRole('heading', { name: 'Account details' })).not.toBeInTheDocument(); expect(screen.queryByText('sam@example.com')).not.toBeInTheDocument();
  expect(within(card).getByText('Safety Forum')).toBeVisible(); expect(card).toHaveTextContent('2030-11-25');
  expect(card).toHaveTextContent('60'); expect(card).toHaveTextContent('North Hall');
  expect(within(card).getByRole('link', { name: 'Conduct safety check for Safety Forum' })).toHaveAttribute('href', '/safety/events/101/check');
  expect(screen.queryByText('Emergency access')).not.toBeInTheDocument(); expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});

it('Safety UI AC2 / OFC AC1 - opens the protected full check page with all facts and documents and returns to the queue', async () => {
  // Arrange / Act: following the real card action must change routes, not expand an inline dashboard form.
  open(); fireEvent.click(await screen.findByRole('link', { name: 'Conduct safety check for Safety Forum' }));
  await screen.findByRole('heading', { level: 1, name: 'Conduct safety check' });
  // Assert: the existing safety source facts and immutable document downloads remain available on the full page.
  expect(await screen.findByText('Two exits', { exact: false })).toBeVisible(); expect(screen.getByText('60 of 100 (60%)')).toBeVisible();
  expect(screen.getByRole('link', { name: /Download emergency procedure/ })).toHaveAttribute('download', 'procedure.pdf');
  expect(screen.getByRole('group', { name: 'Outcome for Safety Forum' })).toBeVisible();
  fireEvent.click(screen.getByRole('link', { name: 'Back to safety checks' }));
  expect(await screen.findByRole('link', { name: 'Conduct safety check for Safety Forum' })).toBeVisible(); expect(screen.queryByRole('group', { name: 'Outcome for Safety Forum' })).not.toBeInTheDocument();
});

it('Safety UI AC3 / OFC AC2 AC3 - shows notes only for negative outcomes and preserves drafts without submitting hidden approval notes', async () => {
  // Arrange: switch outcomes without losing an unfinished explanation or silently posting it as an approval note.
  open('/safety/events/101/check'); await screen.findByRole('group', { name: 'Outcome for Safety Forum' });
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Reject'));
  const notes = screen.getByRole('textbox', { name: /Notes/ }); expect(notes).toHaveAttribute('maxlength', '4000'); expect(notes).toHaveAttribute('aria-required', 'true');
  fireEvent.change(notes, { target: { value: 'Check second exit' } }); fireEvent.click(screen.getByLabelText('Approve'));
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Request changes')); expect(screen.getByRole('textbox', { name: /Notes/ })).toHaveValue('Check second exit');
  fireEvent.click(screen.getByLabelText('Approve'));
  api.post.mockImplementation(async () => { queue = []; return { message: 'Safety check recorded.' }; });
  // Act / Assert: only visible approval intent is sent; the saved result removes the repeat-submission form.
  fireEvent.click(screen.getByRole('button', { name: 'Record safety check' }));
  expect(await screen.findByText('Safety check recorded.')).toBeVisible();
  expect(api.post).toHaveBeenCalledWith('/events/101/safety-checks', { outcome: 'approved', notes: '' }, 'officer');
  expect(await screen.findByText(/This event is no longer awaiting a safety check/)).toBeVisible();
});

it('Safety UI AC3 / OFC AC2 AC3 - required notes and revision stages still block incomplete change requests', async () => {
  // Arrange / Act: the conditional field must not remove the server-aligned client validation.
  open('/safety/events/101/check'); await screen.findByRole('group', { name: 'Outcome for Safety Forum' });
  fireEvent.click(screen.getByLabelText('Request changes')); fireEvent.click(screen.getByRole('button', { name: 'Record safety check' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Explain what is unsafe or what must change.');
  fireEvent.change(screen.getByRole('textbox', { name: /Notes/ }), { target: { value: 'Check second exit' } });
  fireEvent.click(screen.getByRole('button', { name: 'Record safety check' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Choose which planning stages need changes.'); expect(api.post).not.toHaveBeenCalled();
});

it('Safety UI AC2 AC3 - failed saves retain the form and retry prevents duplicate submissions', async () => {
  // Arrange: a failed read-back must not erase the officer's unsaved rejection or its explanation.
  api.post.mockRejectedValueOnce(new Error('Please retry'));
  open('/safety/events/101/check'); await screen.findByRole('group', { name: 'Outcome for Safety Forum' });
  fireEvent.click(screen.getByLabelText('Reject')); fireEvent.change(screen.getByRole('textbox', { name: /Notes/ }), { target: { value: 'Unsafe exit' } });
  fireEvent.click(screen.getByRole('button', { name: 'Record safety check' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Please retry'); expect(screen.getByRole('textbox', { name: /Notes/ })).toHaveValue('Unsafe exit');
  let finish; api.post.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  // Act / Assert: an in-flight retry disables the same control instead of creating another check.
  fireEvent.click(screen.getByRole('button', { name: 'Record safety check' }));
  expect(screen.getByRole('button', { name: 'Recording…' })).toBeDisabled(); expect(screen.getByRole('textbox')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Recording…' })); expect(api.post).toHaveBeenCalledTimes(2);
  queue = []; await act(async () => finish({ message: 'Rejected check recorded.' })); expect(screen.getByText('Rejected check recorded.')).toBeVisible();
});

it.each(['999', 'invalid'])('Safety UI AC2 - a direct link to unavailable event %s never exposes a review form', async id => {
  // Arrange / Act / Assert: the page only selects from the officer's authoritative ready queue.
  open(`/safety/events/${id}/check`);
  expect(await screen.findByText(/This event is no longer awaiting a safety check/)).toBeVisible(); expect(screen.queryByRole('button', { name: 'Record safety check' })).not.toBeInTheDocument();
});

it('Safety UI AC2 - a failed detail read can be retried without inventing an empty ready queue', async () => {
  // Arrange: keep the first read pending so both loading and transport failure are observable.
  let reject; const original = api.get.getMockImplementation();
  api.get.mockImplementation(path => path === '/safety/checks' ? new Promise((_, fail) => { reject = fail; }) : original(path));
  open('/safety/events/101/check'); expect(await screen.findByText('Loading safety checks...')).toBeVisible();
  await act(async () => reject(new Error('Checks unavailable'))); expect(screen.getByRole('alert')).toHaveTextContent('Checks unavailable');
  api.get.mockImplementation(original); fireEvent.click(screen.getByRole('button', { name: 'Retry safety checks' }));
  expect(await screen.findByRole('group', { name: 'Outcome for Safety Forum' })).toBeVisible();
});

it('Safety UI AC2 - degraded queue summaries identify missing values instead of inventing safety facts', async () => {
  // Arrange: synthetic HTTP contract degradation, not a claim that an event without a venue passes the server readiness gate.
  queue = [{ ...event, proposed_date: null, proposed_start_time: null, expected_attendance: null, venues: [] }];
  open(); const card = await screen.findByRole('article');
  // Assert: fallback values must stay explicit rather than presenting zero attendance or a fabricated venue.
  expect(card).toHaveTextContent('Date not specified'); expect(card).toHaveTextContent('Not specified expected attendees');
  expect(card).toHaveTextContent('Venue not recorded');
});

it.each(['attendee', 'event_coordinator'])('Safety UI AC2 - the protected check page denies the %s workspace', async role => {
  // Arrange / Act / Assert: external and other staff identities cannot load the private safety facts via a direct URL.
  useAuth.mockReturnValue({ token: 'other', user: { id: 8, role } }); open('/safety/events/101/check'); await act(async () => {});
  expect(api.get).not.toHaveBeenCalledWith('/safety/checks', 'other'); expect(screen.queryByRole('group', { name: 'Outcome for Safety Forum' })).not.toBeInTheDocument();
});
