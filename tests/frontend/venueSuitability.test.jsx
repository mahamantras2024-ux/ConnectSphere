// File: Tests the Check Venue Suitability story on the real event page: the organiser's venue requirements, venues
// highlighted as matches, and the unmet requirement for each venue that is not suitable.
// Test scope: Real App routes, AuthProvider, EventDetail and the new section; only the API client is replaced.
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../frontend/src/api/client';
import App from '../../frontend/src/App';
import { AuthProvider } from '../../frontend/src/context/AuthContext';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

let user;
let suitability;
const coordinator = { id: 30, email: 'chris@example.com', full_name: 'Chris', role: 'event_coordinator', roles: ['event_coordinator'] };
// Venues exactly as the API assesses them for 100 guests, a Banquet layout and a wheelchair ramp.
const hall = { id: 1, name: 'Hall A', location: 'Level 1', capacity: 120, suitable: true, unmet: [], checks: [
  { requirement: 'capacity', requested: 100, met: true, message: 'Holds 100 expected guests (capacity 120).' },
  { requirement: 'layout', requested: 'Banquet', met: true, message: 'Room layout "Banquet" is available as "Banquet hall".' },
  { requirement: 'accessibility', requested: 'Wheelchair ramps', met: true, message: 'Accessibility need "Wheelchair ramps" is listed as "Wheelchair ramp".' }] };
const roomChecks = [
  { requirement: 'capacity', requested: 100, met: false, message: 'Expected attendance 100 exceeds capacity 60.' },
  { requirement: 'layout', requested: 'Banquet', met: true, message: 'Room layout "Banquet" is available as "Banquet".' },
  { requirement: 'accessibility', requested: 'Wheelchair ramps', met: false, message: 'Accessibility need "Wheelchair ramps" is not listed (venue lists: Lift).' }];
const room = { id: 2, name: 'Room B', location: 'Level 2', capacity: 60, suitable: false, checks: roomChecks, unmet: [roomChecks[0], roomChecks[2]] };
const view = { requirements: { expectedAttendance: 100, layout: 'Banquet', accessibility: ['Wheelchair ramps'] }, venues: [hall, room] };

// Renders the application at a route with a stored session token.
function open(path) {
  localStorage.setItem('cs_token', 'session-token');
  render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AuthProvider><App /></AuthProvider></MemoryRouter>);
}
const section = () => screen.findByRole('region', { name: 'Venue suitability' });
// Reads the organiser's requirements (a labelled description list) as { label: value }.
const requirementFacts = (panel) => Object.fromEntries([...within(panel).getByLabelText("Organiser's venue requirements").querySelectorAll('dt')]
  .map((dt) => [dt.textContent, dt.nextElementSibling.textContent]));
const names = (list) => within(list).getAllByText(/./, { selector: 'strong' }).map((node) => node.textContent);
const lines = (list) => within(list).getAllByRole('listitem').map((item) => item.textContent);

beforeEach(() => {
  localStorage.clear();
  api.get.mockReset();
  user = coordinator; suitability = view;
  api.get.mockImplementation(async (path) => {
    if (path === '/auth/me') return { user };
    if (path === '/events/101') return { event: { id: 101, name: 'Annual Gala', organiser_id: 12, coordinator_id: 30, status: 'submitted', clarification_outstanding: false, clarification_requests: [] } };
    if (path === '/events/101/venue-suitability') return typeof suitability === 'function' ? suitability() : suitability;
    if (path === '/events/101/decision') return { status: 'submitted', outcome: null };
    if (path === '/notifications') return { notifications: [], unreadCount: 0 };
    throw new Error(`Unexpected request: ${path}`);
  });
});
afterEach(cleanup);

// Test case: The organiser's requirements, the venues highlighted as matches, and the unsuitable venues with what they miss.
it('VS AC1/AC4/AC5 - the coordinator sees the organiser\'s requirements, the matching venues and why others are not suitable', async () => {
  open('/events/101');
  const panel = await section();
  await within(panel).findByText('Suitable venues (1)');
  // AC1: what is compared.
  expect(requirementFacts(panel)).toEqual({ 'Expected attendance': '100', 'Room layout': 'Banquet', 'Accessibility needs': 'Wheelchair ramps' });
  // AC4: the matching venue is listed under "Suitable venues", badged and highlighted, with each requirement ticked.
  const matches = within(panel).getByRole('list', { name: 'Suitable venues (1)' });
  expect(names(matches)).toEqual(['Hall A']);
  expect(within(matches).getByText('Appears suitable')).toBeTruthy();
  expect(within(matches).getByText('Hall A').closest('li').classList.contains('venue-match')).toBe(true);
  expect(lines(within(matches).getByRole('list', { name: 'Requirements checked for Hall A' }))).toEqual([
    '✓ Holds 100 expected guests (capacity 120).', '✓ Room layout "Banquet" is available as "Banquet hall".',
    '✓ Accessibility need "Wheelchair ramps" is listed as "Wheelchair ramp".']);
  // AC5: the unsuitable venue marks exactly the requirements it fails.
  const others = within(panel).getByRole('list', { name: 'Not suitable (1)' });
  expect(within(others).getByText('Not suitable', { selector: '.status-badge' })).toBeTruthy();
  expect(within(others).getByText('Room B').closest('li').classList.contains('venue-match')).toBe(false);
  const roomLines = within(others).getAllByRole('listitem').filter((item) => item.closest('ul').getAttribute('aria-label') === 'Requirements checked for Room B');
  expect(roomLines.map((item) => [item.textContent, item.classList.contains('error-message')])).toEqual([
    ['✗ Expected attendance 100 exceeds capacity 60.', true], ['✓ Room layout "Banquet" is available as "Banquet".', false],
    ['✗ Accessibility need "Wheelchair ramps" is not listed (venue lists: Lift).', true]]);
});

// Test case: When nothing matches, the coordinator is told so; a requirement that could not be checked is marked as such.
it('VS AC4 - with no matching venue the coordinator is told none matches, and an unchecked attendance is marked', async () => {
  suitability = { requirements: { expectedAttendance: null, layout: null, accessibility: [] },
    venues: [{ ...room, checks: [{ requirement: 'capacity', requested: null, met: null, message: 'Expected attendance is not recorded, so capacity was not checked.' }, roomChecks[2]], unmet: [roomChecks[2]] }] };
  open('/events/101');
  const panel = await section();
  expect(await within(panel).findByText('No venue matches all of the organiser\'s venue requirements.')).toBeTruthy();
  expect(requirementFacts(panel)).toEqual({ 'Expected attendance': 'Not recorded', 'Room layout': 'No preference', 'Accessibility needs': 'None' });
  expect(lines(within(panel).getByRole('list', { name: 'Requirements checked for Room B' }))[0]).toBe('– Expected attendance is not recorded, so capacity was not checked.');
});

// Test case: When every venue matches, no "Not suitable" list is shown.
it('VS AC4 - when every venue matches there is no "Not suitable" list', async () => {
  suitability = { ...view, venues: [hall] };
  open('/events/101');
  const panel = await section();
  await within(panel).findByText('Suitable venues (1)');
  expect(within(panel).queryByText(/Not suitable \(/)).toBeNull();
});

// Section states: loading, no active venues, failed load and an unexpected response.
it('VS AC1 - the section distinguishes loading, no venues, a failed load and an unusable response', async () => {
  let release;
  // Create the pending response before rendering so the resolver is ready even if the request starts later.
  const suitabilityPromise = new Promise((resolve) => { release = resolve; });
  suitability = () => suitabilityPromise;
  open('/events/101');
  let panel = await section();
  expect(within(panel).getByText('Loading venue suitability...')).toBeTruthy();
  await waitFor(() => expect(typeof release).toBe('function'));
  await act(async () => { release({ ...view, venues: [] }); });
  expect(within(panel).getByText('No active venues are in the catalogue.')).toBeTruthy();
  cleanup();
  suitability = () => { throw new Error('Unable to load venues.'); };
  open('/events/101');
  panel = await section();
  expect(await within(panel).findByText('Unable to load venues.')).toBeTruthy();
  // A load failure is plain text, so it never masquerades as the page's own alert.
  expect(within(panel).queryByRole('alert')).toBeNull();
  cleanup();
  suitability = { requirements: {} };
  open('/events/101');
  expect(await within(await section()).findByText('Venue suitability is unavailable right now.')).toBeTruthy();
});

// Test case: The section belongs to the Event Coordinator; organisers and the Lead never request it.
it.each([
  ['event_organiser', { id: 12, full_name: 'Olivia', role: 'event_organiser', roles: ['event_organiser'] }],
  ['event_coordinator_lead', { id: 40, full_name: 'Lee', role: 'event_coordinator_lead', roles: ['event_coordinator_lead'] }],
])('VS AC1 - a %s viewing the event does not see venue suitability', async (role, account) => {
  user = account;
  open('/events/101');
  await screen.findByText('Annual Gala', { selector: 'h1' });
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/events/101', 'session-token'));
  expect(screen.queryByRole('region', { name: 'Venue suitability' })).toBeNull();
  expect(api.get.mock.calls.some(([path]) => path === '/events/101/venue-suitability')).toBe(false);
});
