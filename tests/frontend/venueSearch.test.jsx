// Sprint 2 SCRUM-39: real search controls, filter dialogs and catalogue; only network/auth/map-renderer boundaries are replaced.
import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../frontend/src/api/client';
import { useAuth } from '../../frontend/src/context/AuthContext';
import VenueList from '../../frontend/src/pages/venues/VenueList';
import CoordinatorDashboard from '../../frontend/src/pages/coordinator/CoordinatorDashboard';
import App from '../../frontend/src/App';
vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn() } }));
vi.mock('../../frontend/src/context/AuthContext', () => ({ useAuth: vi.fn() }));
// Leaflet itself is separately tested; the renderer emits the same coordinate callback as a real map click.
vi.mock('../../frontend/src/pages/venues/VenueMap', () => ({ default: ({ onPick }) =>
  <button type="button" onClick={() => onPick({ latitude: 1.31, longitude: 103.86 })}>Choose map point</button> }));
const venues = [{ id: 7, name: 'Central Hall', capacity: 100, location: 'City Hall',
  supported_layouts: ['Theatre', 'Classroom'], accessibility_features: ['Ramp', 'Lift'], facilities: ['Wi-Fi', 'Projector'] },
  { id: 8, name: 'Airport Room', capacity: 30, location: 'Airport',
    supported_layouts: ['Banquet', 'Theatre'], accessibility_features: ['Ramp'], facilities: ['Stage'] }];
beforeEach(() => {
  useAuth.mockReturnValue({ token: 'coordinator', user: { role: 'event_coordinator' } });
  api.get.mockResolvedValue(venues);
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

// AC3: The toolbar exposes one location control; the map is a draft until the user confirms it.
it('SCRUM-39 AC3 - presents exactly one location bar and confirms the selected place before displaying it', async () => {
  render(<VenueList />);
  await screen.findByText('Central Hall');
  expect(screen.getAllByRole('searchbox')).toHaveLength(1);
  expect(screen.queryByLabelText('Location')).toBeNull();
  const location = screen.getByRole('searchbox', { name: 'Search location' });
  api.get.mockResolvedValue({ location: 'Selected venue, 188065', postalCode: '188065' });
  fireEvent.click(location);
  expect(screen.getByRole('button', { name: 'Use this location' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Choose map point' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Use this location' })).toBeEnabled());
  expect(location).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: 'Use this location' }));
  expect(location).toHaveValue('Selected venue, 188065');
  expect(screen.queryByRole('dialog')).toBeNull();
});

// AC3/accessibility: A read-only location field must act as a picker without submitting a venue search on Enter.
it.each(['Enter', ' '])('SCRUM-39 AC3 - opens the single location picker using keyboard key %s', async key => {
  await openSearch();
  const field = screen.getByRole('searchbox', { name: 'Search location' });
  fireEvent.keyDown(field, { key: 'ArrowDown' });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.keyDown(field, { key });
  expect(screen.getByRole('dialog', { name: 'Choose search location' })).toBeVisible();
  expect(api.get).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(field).toHaveValue('');
});

/** Opens the real compact search control after catalogue loading completes. */
async function openSearch() {
  const view = render(<VenueList />);
  await screen.findByRole('searchbox', { name: 'Search location' });
  return view;
}
/** MRT selection belongs inside the map picker, so the toolbar still exposes only one location field. */
function chooseMrt(name) {
  fireEvent.click(screen.getByRole('searchbox', { name: 'Search location' }));
  fireEvent.change(screen.getByLabelText('MRT station'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Use this location' }));
}
/** Uses the popup's Apply action when open; otherwise submits the visible search bar. */
function applySearch() {
  fireEvent.click(screen.queryByRole('button', { name: 'Apply filters' }) || screen.getByRole('button', { name: 'Search venues' }));
}
/** Chooses actual catalogue checkboxes through each dropdown's accessible group. */
function chooseRequirements(label, values) {
  fireEvent.click(screen.getByText(label, { selector: 'summary' }));
  const group = screen.getByRole('group', { name: label });
  for (const value of values) fireEvent.click(within(group).getByRole('checkbox', { name: value }));
}
/** The unfiltered catalogue remains complete while the search endpoint returns a narrower result set. */
function searchResults(records) { api.get.mockImplementation(async path => path === '/venues' ? venues : records); }

it('SCRUM-39 AC1 AC2 AC3 AC4 AC5 AC6 AC7 AC8 - combines all optional dropdown and schedule criteria with an MRT anchor', async () => {
  await openSearch();
  chooseMrt('City Hall');
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  for (const [label, value] of Object.entries({ 'Event date': '2030-10-10', 'Start time': '10:00', 'End time': '11:00',
    'Expected attendance': '100' })) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByText('Room layout', { selector: 'summary' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Theatre' }));
  chooseRequirements('Accessibility requirements', ['Ramp', 'Lift']);
  chooseRequirements('Required facilities', ['Wi-Fi', 'Projector']);
  searchResults([{ ...venues[0], distance_m: 120 }]);
  applySearch();
  await waitFor(() => expect(screen.queryByText('Airport Room')).not.toBeInTheDocument());
  const [url, token] = api.get.mock.lastCall;
  expect(Object.fromEntries(new URLSearchParams(url.split('?')[1]))).toEqual({
    date: '2030-10-10', startTime: '10:00', endTime: '11:00', attendance: '100', layout: 'Theatre',
    accessibility: 'Ramp,Lift', facilities: 'Wi-Fi,Projector', latitude: '1.293214', longitude: '103.851835',
  });
  expect(token).toBe('coordinator');
  expect(screen.getByText('0.12 km straight-line distance')).toBeVisible();
  expect(screen.getByText('1 space')).toBeVisible();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('SCRUM-39 AC8 - no matches keeps the search available and clearing restores every venue', async () => {
  await openSearch();
  chooseMrt('City Hall');
  searchResults([]);
  applySearch();
  expect(await screen.findByText('No venues match these requirements.')).toBeVisible();
  expect(screen.getByLabelText('Search location')).toHaveValue('City Hall');
  api.get.mockResolvedValue(venues);
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(await screen.findByText('Airport Room')).toBeVisible();
  expect(screen.getByLabelText('Search location')).toHaveValue('');
  expect(api.get).toHaveBeenLastCalledWith('/venues', 'coordinator');
});

it('SCRUM-39 AC1 AC8 - incomplete date criteria show an error and the retained popup values can be corrected', async () => {
  await openSearch();
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  fireEvent.change(screen.getByLabelText('Event date'), { target: { value: '2030-10-10' } });
  fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '10:00' } });
  api.get.mockRejectedValue(new Error('Enter a valid date and time range.'));
  applySearch();
  expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid date and time range.');
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  expect(screen.getByLabelText('Event date')).toHaveValue('2030-10-10');
  searchResults([venues[0]]);
  fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '10:00' } });
  fireEvent.change(screen.getByLabelText('End time'), { target: { value: '11:00' } });
  applySearch();
  expect(await screen.findByText('Central Hall')).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

// Date-only search deliberately omits both times; partial-day matches come from the real schedule service.
it('SCRUM-39 AC1 - submits a date without requiring start or end time', async () => {
  await openSearch();
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  expect(screen.getByText(/Choose a date to find venues with some free time/)).toBeVisible();
  fireEvent.change(screen.getByLabelText('Event date'), { target: { value: '2030-10-10' } });
  searchResults([venues[0]]);
  applySearch();
  await waitFor(() => expect(api.get.mock.lastCall[0]).toBe('/venues/search?date=2030-10-10'));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('Central Hall')).toBeVisible();
});

it('SCRUM-39 AC7 AC8 - refresh retains applied criteria and obsolete answers cannot replace newer matches', async () => {
  await openSearch();
  let finishOld;
  api.get.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  chooseMrt('City Hall');
  applySearch();
  await waitFor(() => expect(api.get.mock.lastCall[0]).toContain('latitude=1.293214'));
  searchResults([{ ...venues[1], distance_m: null }]);
  chooseMrt('Changi Airport');
  applySearch();
  expect(await screen.findByText('Airport Room')).toBeVisible();
  expect(screen.getByText(/Distance unavailable/)).toBeVisible();
  await act(async () => finishOld([venues[0]]));
  expect(screen.queryByText('Central Hall')).not.toBeInTheDocument();
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(api.get.mock.lastCall[0]).toContain('/venues/search?latitude='));
});

it('SCRUM-39 AC8 - all filters may remain blank, closing a popup preserves drafts, and other roles have no search control', async () => {
  const view = await openSearch();
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  for (const input of screen.getByRole('dialog').querySelectorAll('input,select')) expect(input.required).toBe(false);
  applySearch();
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  expect(api.get).toHaveBeenLastCalledWith('/venues', 'coordinator');
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  expect(screen.queryByRole('button', { name: 'Back to search' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  expect(screen.queryByRole('dialog', { name: 'Filter venues' })).toBeNull();
  expect(screen.getByRole('searchbox', { name: 'Search location' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Search and filter venues' })).toBeNull();
  view.unmount();
  useAuth.mockReturnValue({ token: 'staff', user: { role: 'venue_staff' } });
  render(<VenueList />);
  await screen.findByText('Central Hall');
  expect(screen.queryByRole('searchbox', { name: 'Search location' })).not.toBeInTheDocument();
});

it('SCRUM-39 AC4 AC5 AC6 - choices come from all venues and remain after results narrow', async () => {
  await openSearch();
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  fireEvent.click(screen.getByText('Room layout', { selector: 'summary' }));
  expect(within(screen.getByRole('group', { name: 'Room layout' })).getAllByRole('radio').map(option => option.closest('label').textContent))
    .toEqual(['Any layout', 'Banquet', 'Classroom', 'Theatre']);
  chooseRequirements('Accessibility requirements', ['Ramp', 'Lift']);
  const group = screen.getByRole('group', { name: 'Accessibility requirements' });
  fireEvent.click(within(group).getByRole('checkbox', { name: 'Ramp' }));
  searchResults([venues[0]]);
  applySearch();
  await waitFor(() => expect(screen.queryByText('Airport Room')).toBeNull());
  expect(api.get.mock.lastCall[0]).toContain('accessibility=Lift');
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  fireEvent.click(screen.getByText('Room layout', { selector: 'summary' }));
  expect(within(screen.getByRole('group', { name: 'Room layout' })).getByRole('radio', { name: 'Banquet' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

// Single-choice layout uses the same expandable surface as other requirements without introducing AND layout semantics.
it('SCRUM-39 AC5 AC7 - changes one room layout at a time and Any layout removes the criterion', async () => {
  await openSearch();
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  fireEvent.click(screen.getByText('Room layout', { selector: 'summary' }));
  expect(screen.getByRole('radio', { name: 'Any layout' })).toBeChecked();
  fireEvent.click(screen.getByRole('radio', { name: 'Theatre' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Classroom' }));
  expect(screen.getByRole('radio', { name: 'Theatre' })).not.toBeChecked();
  expect(screen.getByRole('radio', { name: 'Classroom' })).toBeChecked();
  applySearch();
  await waitFor(() => expect(api.get.mock.lastCall[0]).toBe('/venues/search?layout=Classroom'));
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  fireEvent.click(screen.getByText('Room layout', { selector: 'summary' }));
  expect(screen.getByRole('radio', { name: 'Classroom' })).toBeChecked();
  fireEvent.click(screen.getByRole('radio', { name: 'Any layout' }));
  applySearch();
  await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/venues', 'coordinator'));
});

it('SCRUM-39 AC4 AC6 - missing recorded choices produce honest empty dropdowns', async () => {
  api.get.mockResolvedValue([{ id: 7, name: 'Sparse hall' }]);
  await openSearch();
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  chooseRequirements('Accessibility requirements', []);
  chooseRequirements('Required facilities', []);
  expect(screen.getAllByText('No recorded options.')).toHaveLength(2);
});

it('SCRUM-39 AC3 - includes MRT/LRT interchange stations and permits clearing an MRT selection', async () => {
  await openSearch();
  fireEvent.click(screen.getByRole('searchbox', { name: 'Search location' }));
  const select = screen.getByLabelText('MRT station');
  for (const name of ['Bukit Panjang MRT', 'Choa Chu Kang MRT', 'Punggol MRT', 'Sengkang MRT'])
    expect(within(select).getByRole('option', { name })).toBeTruthy();
  fireEvent.change(select, { target: { value: 'Sengkang' } });
  fireEvent.click(screen.getByRole('button', { name: 'Use this location' }));
  expect(screen.getByLabelText('Search location')).toHaveValue('Sengkang');
  fireEvent.click(screen.getByRole('searchbox', { name: 'Search location' }));
  fireEvent.change(screen.getByLabelText('MRT station'), { target: { value: '' } });
  expect(screen.getByRole('button', { name: 'Use this location' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByLabelText('Search location')).toHaveValue('Sengkang');
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(screen.getByLabelText('Search location')).toHaveValue('');
});

it.each([['Selected park', 'Selected park'], [null, '188065']])('SCRUM-39 AC3 - confirmed map selection displays place %s or its postal code when unnamed', async (location, label) => {
  await openSearch();
  api.get.mockImplementation(async path => path.includes('/locations/resolve')
    ? { postalCode: '188065', location } : venues);
  fireEvent.click(screen.getByRole('searchbox', { name: 'Search location' }));
  fireEvent.click(screen.getByRole('button', { name: 'Choose map point' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Use this location' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Use this location' }));
  expect(screen.getByLabelText('Search location')).toHaveValue(label);
  applySearch();
  await waitFor(() => expect(api.get.mock.lastCall[0]).toBe('/venues/search?latitude=1.31&longitude=103.86'));
});

it.each([new Error('Map service offline'), {}])('SCRUM-39 AC3 - map service failures remain visible and selections can be cancelled', async failure => {
  await openSearch();
  chooseMrt('City Hall');
  api.get.mockRejectedValue(failure);
  fireEvent.click(screen.getByRole('searchbox', { name: 'Search location' }));
  fireEvent.click(screen.getByRole('button', { name: 'Choose map point' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(failure.message || 'Unable to find this map location. Try again.');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByLabelText('Search location')).toHaveValue('City Hall');
});

it.each(['success', 'failure'])('SCRUM-39 AC3 - ignores a late map %s after the map closes', async outcome => {
  await openSearch();
  let finish;
  api.get.mockImplementationOnce(() => new Promise((resolve, reject) => { finish = outcome === 'success' ? resolve : reject; }));
  fireEvent.click(screen.getByRole('searchbox', { name: 'Search location' }));
  fireEvent.click(screen.getByRole('button', { name: 'Choose map point' }));
  expect(screen.getByRole('status')).toHaveTextContent('Finding location details');
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  await act(async () => finish({ postalCode: '188065' }));
  expect(screen.getByLabelText('Search location')).toHaveValue('');
  expect(screen.queryByRole('alert')).toBeNull();
});

// Keep event work and venue discovery separate so each navigation tab has one purpose.
it('SCRUM-39 AC8 - keeps venue search out of Assigned Events', async () => {
  api.get.mockImplementation(async path => path === '/venues' ? venues : { events: [], notifications: [], changeRequests: [] });
  render(<MemoryRouter><CoordinatorDashboard /></MemoryRouter>);
  expect(await screen.findByRole('heading', { name: 'Event Coordinator Dashboard' })).toBeVisible();
  expect(screen.queryByRole('searchbox', { name: 'Search location' })).toBeNull();
  expect(api.get.mock.calls.some(([path]) => path === '/venues')).toBe(false);
});

// Exercise real navigation and protection rather than replacing the route components.
it('SCRUM-39 AC8 - opens venue search and filters from the Find venues tab', async () => {
  api.get.mockImplementation(async path => path === '/venues' ? venues : { events: [], notifications: [], changeRequests: [] });
  render(<MemoryRouter initialEntries={['/coordinator/dashboard']}><App /></MemoryRouter>);
  fireEvent.click(screen.getByRole('link', { name: 'Find venues' }));
  expect(await screen.findByRole('searchbox', { name: 'Search location' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  expect(screen.getByRole('dialog', { name: 'Filter venues' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Event Coordinator Dashboard' })).toBeNull();
});

it('SCRUM-39 AC8 - denies attendee access to coordinator venue discovery', async () => {
  useAuth.mockReturnValue({ token: 'attendee', user: { role: 'attendee' } });
  api.get.mockResolvedValue({ events: [], registrations: [], notifications: [] });
  render(<MemoryRouter initialEntries={['/coordinator/venues']}><App /></MemoryRouter>);
  expect(await screen.findByRole('heading', { name: 'Attendee Dashboard' })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Find venues' })).toBeNull();
  expect(screen.queryByRole('searchbox', { name: 'Search location' })).toBeNull();
});
