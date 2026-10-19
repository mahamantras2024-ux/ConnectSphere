import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../../frontend/src/App';
import { api } from '../../frontend/src/api/client';
import { useAuth } from '../../frontend/src/context/AuthContext';
vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../frontend/src/context/AuthContext', () => ({ useAuth: vi.fn() }));
const event = { id: 3, name: 'Community Forum', proposed_date: '2030-10-10', proposed_start_time: '10:00:00', proposed_end_time: '11:00:00', expected_attendance: 40, room_layout_preference: 'Theatre', accessibility_requirements: ['Ramp'], required_facilities: ['Wi-Fi'] };
const venue = { id: 8, name: 'South Hall', facilities: ['Wi-Fi'], supported_layouts: ['Theatre'], accessibility_features: ['Ramp'], capacity: 100 };
/** Runs real route transitions, filters and booking forms; mocks only session and HTTP boundaries. */
function open(path = '/events') { return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>); }
beforeEach(() => {
  useAuth.mockReturnValue({ token: 'coordinator', user: { role: 'event_coordinator' } });
  api.get.mockImplementation(async path => {
    if (path === '/events') return { events: [event] };
    if (path === '/events/3') return { event };
    if (path.startsWith('/venues')) return [venue];
    return { bookings: [], notifications: [], unreadCount: 0, requests: [], items: [] };
  });
  api.post.mockResolvedValue({ request: { id: 20 } });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('Workspace AC1 AC2 - event opens as a full page with separate tabs and a working return to Assigned Events', async () => {
  // Arrange / Act: open the actual card, not a direct component mount.
  open(); fireEvent.click(await screen.findByRole('link', { name: /View details/ }));
  await screen.findByRole('heading', { name: event.name });
  // Assert: the crowded request form is absent, and tabs expose distinct event responsibilities.
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Request a venue booking' })).not.toBeInTheDocument();
  for (const name of ['Overview', 'Venue requests', 'Equipment', 'Activity']) expect(screen.getByRole('tab', { name })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Venue requests' }));
  expect(await screen.findByRole('heading', { name: 'Venue booking decisions' })).toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: 'Equipment' }));
  expect(screen.getByRole('tab', { name: 'Equipment' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
  expect(screen.getByRole('heading', { name: 'Clarification requests' })).toBeVisible();
  fireEvent.click(screen.getByRole('link', { name: 'Back to Assigned Events' }));
  expect(await screen.findByRole('heading', { name: 'Event Coordinator Dashboard' })).toBeInTheDocument();
});

it('SCRUM-39 AC1 AC2 AC4 AC5 AC6 / SCRUM-61 AC1 AC2 - Find a venue carries editable event requirements into discovery', async () => {
  open('/events/3'); await screen.findByRole('heading', { name: event.name });
  fireEvent.click(screen.getByRole('tab', { name: 'Venue requests' }));
  fireEvent.click(screen.getByRole('link', { name: 'Find a venue' }));
  expect(await screen.findByLabelText('Booking for event')).toHaveValue('3');
  fireEvent.click(await screen.findByRole('button', { name: 'Filters', exact: true }));
  expect(screen.getByLabelText('Event date')).toHaveValue('2030-10-10');
  expect(screen.getByLabelText('Expected attendance')).toHaveValue(40);
  expect(screen.getByRole('radio', { name: 'Theatre' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Ramp' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Wi-Fi' })).toBeChecked();
  fireEvent.change(screen.getByLabelText('Expected attendance'), { target: { value: '30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  await waitFor(() => expect(api.get.mock.calls.some(([path]) => path.includes('attendance=30'))).toBe(true));
});

it('SCRUM-61 AC1 AC2 AC3 AC4 AC5 AC6 - browse independently, select an event, request chosen venue and continue to history or another venue', async () => {
  open('/coordinator/venues');
  await screen.findByRole('heading', { name: 'South Hall' });
  fireEvent.click(screen.getByRole('button', { name: 'Request South Hall' }));
  expect(screen.getByText('Choose an assigned event to request this venue.')).toBeVisible();
  fireEvent.change(screen.getByLabelText('Booking for event'), { target: { value: '3' } });
  const form = await screen.findByRole('heading', { name: 'Request a venue booking' });
  expect(within(form.parentElement).getByLabelText('Venue')).toHaveValue('8');
  fireEvent.click(screen.getByRole('checkbox', { name: /Automatically cancel/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Request venue', exact: true }));
  expect(await screen.findByText('Venue request submitted.')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Request venue', exact: true })).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Request submitted actions' })).toBeVisible();
  expect(api.post).toHaveBeenCalledWith('/venues/8/requests', expect.objectContaining({ eventId: 3, capacity: 40, cancelOtherPending: true }), 'coordinator');
  expect(screen.getByRole('link', { name: 'View event requests' })).toHaveAttribute('href', '/events/3?tab=venues');
  fireEvent.click(screen.getByRole('button', { name: 'Find another venue' }));
  expect(await screen.findByRole('heading', { name: 'South Hall' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Request a venue booking' })).not.toBeInTheDocument();
});

it('Workspace AC3 - direct Find Venues URLs deny non-coordinator access', async () => {
  useAuth.mockReturnValue({ token: 'organiser', user: { role: 'event_organiser' } });
  open('/coordinator/venues');
  expect(await screen.findByRole('heading', { name: 'Event Organiser Dashboard' })).toBeInTheDocument();
  expect(api.get).not.toHaveBeenCalledWith('/venues', 'organiser');
});



it.each([['ArrowRight', 'Venue requests'], ['ArrowLeft', 'Activity'], ['Home', 'Overview'], ['End', 'Activity'], ['x', 'Overview']])('Workspace AC2 - keyboard %s selects %s without opening a popup', async (key, selected) => {
  // Keyboard navigation must select and focus the same visible section as a pointer click.
  open('/events/3');
  const overview = await screen.findByRole('tab', { name: 'Overview' });
  overview.focus(); fireEvent.keyDown(overview, { key });
  expect(screen.getByRole('tab', { name: selected })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: selected })).toHaveFocus();
  expect(screen.getByRole('tabpanel', { name: selected })).toBeVisible();
});

it('Workspace AC3 / SCRUM-61 AC1 - failed assignment loading can retry without an unverified booking action', async () => {
  // An API outage must not make a guessed event available for booking.
  api.get.mockRejectedValueOnce(new Error('Assigned events unavailable'));
  open('/coordinator/venues');
  expect(await screen.findByText('Assigned events unavailable')).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Request a venue booking' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry events' }));
  await waitFor(() => expect(screen.getByLabelText('Booking for event')).toBeEnabled());
  expect(screen.getByRole('option', { name: event.name })).toBeInTheDocument();
});

it('SCRUM-61 AC1 - an unassigned event URL cannot become a booking context and selecting an assigned event recovers', async () => {
  open('/coordinator/venues?eventId=999');
  expect(await screen.findByText('Choose an event assigned to you.')).toBeVisible();
  expect(api.get).not.toHaveBeenCalledWith('/events/999', 'coordinator');
  fireEvent.change(screen.getByLabelText('Booking for event'), { target: { value: '3' } });
  await screen.findByRole('link', { name: 'View event requests' });
  expect(screen.queryByText('Choose an event assigned to you.')).not.toBeInTheDocument();
});

it('SCRUM-39 AC7 AC8 / SCRUM-61 AC2 - clears prefilled filters without clearing the booking event, and supports returning to independent browsing', async () => {
  open('/coordinator/venues?eventId=3');
  fireEvent.click(await screen.findByRole('button', { name: 'Filters', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(screen.getByLabelText('Booking for event')).toHaveValue('3');
  fireEvent.click(screen.getByRole('button', { name: 'Filters', exact: true }));
  expect(screen.getByLabelText('Event date')).toHaveValue('');
  expect(screen.getByLabelText('Expected attendance')).toHaveValue(null);
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  fireEvent.change(screen.getByLabelText('Booking for event'), { target: { value: '' } });
  await waitFor(() => expect(screen.getByLabelText('Booking for event')).toBeEnabled());
  expect(screen.queryByRole('link', { name: 'View event requests' })).not.toBeInTheDocument();
});

it('SCRUM-61 AC1 AC2 - a deactivated chosen venue never falls back silently to another venue', async () => {
  // Direct review links can outlive catalogue records; submitting a different venue would be a serious mismatch.
  open('/coordinator/venues?eventId=3&venueId=999');
  expect(await screen.findByText('This venue is no longer available. Choose another venue.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Request venue', exact: true })).toBeDisabled();
  expect(screen.getByLabelText('Venue')).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: 'Back to venues' }));
  expect(await screen.findByRole('heading', { name: 'South Hall' })).toBeVisible();
  expect(api.post).not.toHaveBeenCalled();
});

it('SCRUM-61 AC3 - a failed request keeps the selected context and editable requirements for retry', async () => {
  api.post.mockRejectedValueOnce(new Error('Request service unavailable'));
  open('/coordinator/venues?eventId=3&venueId=8');
  fireEvent.click(await screen.findByRole('button', { name: 'Request venue', exact: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Request service unavailable');
  expect(screen.getByLabelText('Venue')).toHaveValue('8');
  fireEvent.change(screen.getByLabelText('Expected attendance / capacity'), { target: { value: '30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Request venue', exact: true }));
  expect(await screen.findByText('Venue request submitted.')).toBeVisible();
  expect(api.post).toHaveBeenLastCalledWith('/venues/8/requests', expect.objectContaining({ eventId: 3, capacity: 30 }), 'coordinator');
});

it('SCRUM-61 AC1 - empty assignments still allow browsing but never expose a booking form', async () => {
  api.get.mockImplementation(async path => path === '/events' ? {} : [venue]);
  open('/coordinator/venues');
  fireEvent.click(await screen.findByRole('button', { name: 'Request South Hall' }));
  expect(screen.getByText('Choose an assigned event to request this venue.')).toBeVisible();
  expect(screen.getAllByRole('option')).toHaveLength(1);
  expect(screen.queryByRole('heading', { name: 'Request a venue booking' })).not.toBeInTheDocument();
});

it.each(['resolve', 'reject'])('Workspace AC3 - a late assignment %s after leaving discovery cannot replace the assigned-events screen', async outcome => {
  // Delayed requests represent real navigation races, not mocked business rules.
  let finish;
  api.get.mockImplementationOnce(() => new Promise((resolve, reject) => { finish = outcome === 'resolve' ? resolve : reject; }));
  open('/coordinator/venues');
  expect(screen.getByText('Loading assigned events…')).toBeVisible();
  fireEvent.click(screen.getByRole('link', { name: 'Assigned Events' }));
  await screen.findByRole('heading', { name: 'Event Coordinator Dashboard' });
  await act(async () => finish(outcome === 'resolve' ? { events: [event] } : new Error('Late failure')));
  expect(screen.queryByLabelText('Booking for event')).not.toBeInTheDocument();
  expect(screen.queryByText('Late failure')).not.toBeInTheDocument();
});

it('Workspace AC3 - late details cannot reopen booking review after the coordinator leaves discovery', async () => {
  let finish;
  const original = api.get.getMockImplementation();
  api.get.mockImplementation(path => path === '/events/3' ? new Promise(resolve => { finish = resolve; }) : original(path));
  open('/coordinator/venues?eventId=3&venueId=8');
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/events/3', 'coordinator'));
  fireEvent.click(screen.getByRole('link', { name: 'Assigned Events' }));
  await act(async () => finish({ event }));
  expect(await screen.findByRole('heading', { name: 'Event Coordinator Dashboard' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Request a venue booking' })).not.toBeInTheDocument();
});

it.each([{}, { proposed_date: '2030-10-10' }, { proposed_date: '2030-10-10', proposed_start_time: '10:00:00' }])('SCRUM-39 AC1 AC7 - sparse event schedule %j never applies an incomplete time filter', async fields => {
  const original = api.get.getMockImplementation();
  api.get.mockImplementation(path => path === '/events/3' ? Promise.resolve({ event: { id: 3, name: event.name, ...fields } }) : original(path));
  open('/coordinator/venues?eventId=3');
  fireEvent.click(await screen.findByRole('button', { name: 'Filters', exact: true }));
  expect(screen.getByLabelText('Event date')).toHaveValue(fields.proposed_date || '');
  expect(screen.getByLabelText('Start time')).toHaveValue('');
  expect(screen.getByLabelText('End time')).toHaveValue('');
  expect(screen.getByLabelText('Expected attendance')).toHaveValue(null);
  expect(screen.getByRole('radio', { name: 'Any layout' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Ramp' })).not.toBeChecked();
});

it('Workspace AC1 / SCRUM-61 AC1 - full-page navigation reveals the page header after leaving a long list', async () => {
  // jsdom has no layout engine; replace only the browser scroll boundary while retaining real route transitions.
  const previous = Element.prototype.scrollIntoView;
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  try {
    open();
    fireEvent.click(await screen.findByRole('link', { name: /View details/ }));
    await screen.findByRole('heading', { name: event.name });
    expect(scroll).toHaveBeenLastCalledWith({ block: 'start' });
    expect(scroll).toHaveBeenCalledTimes(2);
  } finally { Element.prototype.scrollIntoView = previous; }
});

it('SCRUM-39 AC4 AC5 AC6 / SCRUM-61 AC2 - catalogue spelling differences still show editable event requirements as selected', async () => {
  // Search is case-insensitive; the visible defaults must agree with the search rather than hide active requirements.
  const original = api.get.getMockImplementation();
  api.get.mockImplementation(path => path === '/events/3' ? Promise.resolve({ event: { ...event,
    room_layout_preference: ' theatre ', accessibility_requirements: ['ramp'], required_facilities: ['wi-fi'] } }) : original(path));
  open('/coordinator/venues?eventId=3');
  fireEvent.click(await screen.findByRole('button', { name: 'Filters', exact: true }));
  expect(screen.getByRole('radio', { name: 'Theatre' })).toBeChecked();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Ramp' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Wi-Fi' }));
  expect(screen.getByRole('checkbox', { name: 'Ramp' })).not.toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Wi-Fi' })).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  await waitFor(() => expect(api.get.mock.calls.filter(([path]) => path.includes('/venues/search?')).at(-1)[0]).not.toMatch(/accessibility=|facilities=/));
});
