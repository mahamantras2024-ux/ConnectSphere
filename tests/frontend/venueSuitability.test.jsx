// File: Verifies event suitability inside real venue discovery, including grouping, comparison failures and booking actions.
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../frontend/src/api/client';
import App from '../../frontend/src/App';
import { AuthProvider } from '../../frontend/src/context/AuthContext';
import VenueSuitabilityResults, { VenueRequirementSummary } from '../../frontend/src/pages/venues/VenueSuitabilityResults';
import { readFileSync } from 'node:fs';
vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const event = { id: 101, name: 'Annual Gala', expected_attendance: 100, room_layout_preference: 'Banquet', accessibility_requirements: ['Ramp'] };
const hall = { id: 1, name: 'Hall A', location: 'Level 1', capacity: 120, availability_status: 'Available', suitable: true,
  checks: [{ met: true, message: 'Holds 100 expected guests (capacity 120).' }, { met: true, message: 'Banquet layout is supported.' }, { met: true, message: 'Ramp is listed.' }], unmet: [] };
const room = { id: 2, name: 'Room B', location: 'Level 2', capacity: 60, suitable: false,
  checks: [{ met: false, message: 'Expected attendance 100 exceeds capacity 60.' }, { met: true, message: 'Banquet layout is supported.' }, { met: false, message: 'Ramp is not listed.' }],
  unmet: [{ met: false, message: 'Expected attendance 100 exceeds capacity 60.' }] };
let user, catalogue, comparison, searchResults;
/** Uses real routing and session restoration; only the HTTP boundary is simulated. */
function open(path = '/coordinator/venues?eventId=101') {
  localStorage.setItem('cs_token', 'session-token');
  return render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>);
}
/** Clears the event defaults to compare the full catalogue, just as the page's explanatory hint instructs. */
async function fullCatalogue() {
  const view = open();
  fireEvent.click(await screen.findByRole('button', { name: 'Filters', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  await waitFor(() => expect(screen.getAllByRole('article', { hidden: true })).toHaveLength(catalogue.length));
  return view;
}
beforeEach(() => {
  localStorage.clear(); vi.resetAllMocks();
  user = { id: 30, full_name: 'Chris', role: 'event_coordinator' };
  catalogue = [hall, room]; searchResults = [hall];
  comparison = { requirements: { expectedAttendance: 100, layout: 'Banquet', accessibility: ['Ramp'] }, venues: [hall, room] };
  api.get.mockImplementation(async path => {
    if (path === '/auth/me') return { user };
    if (path === '/events') return { events: [event] };
    if (path === '/events/101') return { event };
    if (path === '/events/101/venue-suitability') return typeof comparison === 'function' ? comparison() : comparison;
    if (path.endsWith('/eligible-events')) return { events: [event] };
    if (path === '/venues') return catalogue;
    if (path.startsWith('/venues/search?')) return searchResults;
    return { bookings: [], notifications: [], unreadCount: 0, items: [] };
  });
  api.post.mockResolvedValue({ request: { id: 50 } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

/** Supplies the public card renderer while retaining the real grouping and requirement-summary components. */
function comparisonCard(venue, assessment) {
  return <article><h3>{venue.name}</h3>{assessment && <VenueRequirementSummary assessment={assessment} />}</article>;
}

// AC4/AC5: idle polling must preserve both choices, rather than forcing every refresh open or closed.
it.each([true, false])('VS AC4 AC5 - preserves Other venues expanded=%s across the 20-second idle refresh', async expanded => {
  // Arrange: retain real app routing, the polling hook and API calls; replace only time and network boundaries.
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  await fullCatalogue();
  let summary = await screen.findByText('Other venues (1) — requirements not met');
  fireEvent.click(summary);
  const matched = screen.getByText('Meets recorded requirements');
  const mismatched = screen.getByText('Requirements not met');
  // Each card has its own disclosure; exercise explicit open and closed choices before polling.
  for (const heading of [matched, mismatched]) {
    expect(heading.closest('details')).not.toBeNull();
    expect(heading.closest('details').open).toBe(false);
    fireEvent.click(heading);
    if (!expanded) fireEvent.click(heading);
  }
  // The closed case represents an explicit user collapse, not merely the initial default.
  if (!expanded) fireEvent.click(summary);
  const countComparisons = () => api.get.mock.calls.filter(([path]) => path === '/events/101/venue-suitability').length;
  const before = countComparisons();
  let finish;
  const updatedRoom = { ...room, capacity: 70, checks: [{ met: false, message: 'Expected attendance 100 exceeds capacity 70.' }] };
  catalogue = [hall, updatedRoom];
  comparison = () => new Promise(resolve => { finish = resolve; });

  // Act / Assert: just below the polling threshold there is no new comparison.
  await act(async () => vi.advanceTimersByTime(19999));
  expect(countComparisons()).toBe(before);
  // Exactly at the threshold, keep the visible groups while the comparison is pending.
  await act(async () => vi.advanceTimersByTime(1));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  summary = screen.getByText('Other venues (1) — requirements not met');
  expect(summary.closest('details').open).toBe(expanded);
  expect(screen.getByText('Meets recorded requirements').closest('details').open).toBe(expanded);
  expect(screen.getByText('Requirements not met').closest('details').open).toBe(expanded);
  expect(screen.getByText('Refreshing venue suitability…')).toBeVisible();
  if (expanded) expect(screen.getByRole('heading', { name: 'Room B' })).toBeVisible();
  else expect(screen.getByRole('heading', { name: 'Room B', hidden: true })).not.toBeVisible();

  // Act: complete the fresh comparison, then step just above the same polling boundary.
  await act(async () => finish({ requirements: { expectedAttendance: 100, layout: 'Banquet', accessibility: ['Ramp'] }, venues: [hall, updatedRoom] }));
  await act(async () => vi.advanceTimersByTime(1));
  // Assert: fresh reasons arrive without changing the coordinator's disclosure choice.
  expect(screen.getByText('Other venues (1) — requirements not met').closest('details').open).toBe(expanded);
  expect(screen.getByText('Meets recorded requirements').closest('details').open).toBe(expanded);
  expect(screen.getByText('Requirements not met').closest('details').open).toBe(expanded);
  expect(screen.getByText('Expected attendance 100 exceeds capacity 70.')).toBeInTheDocument();
  if (expanded) expect(screen.getByText('Expected attendance 100 exceeds capacity 70.')).toBeVisible();
  else expect(screen.getByText('Expected attendance 100 exceeds capacity 70.')).not.toBeVisible();
  expect(screen.queryByText('Refreshing venue suitability…')).toBeNull();
  expect(countComparisons()).toBe(before + 1);
});

// AC1/AC5: a failed read must stop claiming matches, while retry restores the user's disclosure choice.
it('VS AC1 AC5 - restores the expanded Other venues section after a failed refresh and retry', async () => {
  await fullCatalogue();
  fireEvent.click(await screen.findByText('Other venues (1) — requirements not met'));
  // Act: simulate a background comparison failure through the real focus-refresh path.
  comparison = () => { throw new Error('Background comparison unavailable'); };
  fireEvent(window, new Event('focus'));
  await screen.findByText('Background comparison unavailable');
  // Assert: browsing remains possible, but old suitability claims are not presented as current.
  expect(screen.getByRole('heading', { name: 'Room B' })).toBeVisible();
  expect(screen.queryByText('Requirements not met')).toBeNull();
  expect(screen.queryByText('Meets recorded requirements')).toBeNull();
  // Act / Assert: a successful retry restores the previously expanded group.
  comparison = { requirements: { expectedAttendance: 100, layout: 'Banquet', accessibility: ['Ramp'] }, venues: [hall, room] };
  fireEvent.click(screen.getByRole('button', { name: 'Retry comparison' }));
  expect((await screen.findByText('Other venues (1) — requirements not met')).closest('details').open).toBe(true);
  expect(screen.getByRole('heading', { name: 'Room B' })).toBeVisible();
});

// AC1: retained snapshots belong to one event and authenticated session, never to the next context.
it.each(['event', 'session'])('VS AC1 - resets disclosure and excludes stale assessments after changing %s', async scope => {
  const props = { eventId: 101, token: 'session-token', venues: [hall, room], renderVenue: comparisonCard, refreshKey: 0 };
  const view = render(<VenueSuitabilityResults {...props} />);
  fireEvent.click(await screen.findByText('Other venues (1) — requirements not met'));
  let finish;
  api.get.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  // Act: keep the component mounted to expose stale-cache bugs that remounting would conceal.
  view.rerender(<VenueSuitabilityResults {...props} eventId={scope === 'event' ? 102 : 101} token={scope === 'session' ? 'new-session' : 'session-token'} />);
  // Assert: while the new context loads, no old comparison is visible.
  expect(screen.queryByText('Requirements not met')).toBeNull();
  expect(screen.queryByText('Other venues (1) — requirements not met')).toBeNull();
  expect(screen.getByText('Loading venue suitability…')).toBeVisible();
  // Act / Assert: the new comparison has its own closed disclosure and current requirement facts.
  await act(async () => finish({ requirements: { expectedAttendance: 50, layout: 'Theatre', accessibility: [] },
    venues: [{ ...hall, checks: [{ met: true, message: 'Holds 50 expected guests (capacity 120).' }] },
      { ...room, checks: [{ met: false, message: 'Theatre layout is not listed.' }] }] }));
  expect((await screen.findByText('Other venues (1) — requirements not met')).closest('details').open).toBe(false);
  expect(screen.getByRole('list', { name: "Organiser's venue requirements" })).toHaveTextContent('50');
  expect(screen.queryByText('Expected attendance 100 exceeds capacity 60.')).toBeNull();
});

// AC3/AC5: show the requirement explanation without catalogue jargon, with distinct warning/pass/unchecked markers.
it('VS AC3 AC5 / UI - toggles both requirement lists with bold icons and no venue-list annotations', () => {
  const style = document.createElement('style');
  style.textContent = readFileSync('src/index.css', 'utf8'); document.head.append(style);
  const mismatch = { ...room, checks: [
    { met: false, message: 'Expected attendance 100 exceeds capacity 60.' },
    { met: false, message: 'Room layout "Hall" is not listed (venue lists: none).' },
    { met: false, message: 'Accessibility need "Ramp" is not listed (venue lists: Lift).' },
    { met: true, message: 'Banquet layout is supported.' },
    { met: null, message: 'A requirement was not checked.' },
  ] };
  try {
    // Act: render the real summaries with mixed comparison outcomes.
    render(<><VenueRequirementSummary assessment={mismatch} /><VenueRequirementSummary assessment={hall} /></>);
    // Assert / Act: both verdict headings start compact, then reveal their own list without an extra subheading.
    const matched = screen.getByText('Meets recorded requirements');
    const mismatched = screen.getByText('Requirements not met');
    for (const heading of [matched, mismatched]) {
      expect(heading.closest('details')).not.toBeNull();
      expect(heading.closest('details').open).toBe(false);
      expect(within(heading.closest('details')).getByRole('list', { hidden: true })).not.toBeVisible();
      fireEvent.click(heading);
      expect(within(heading.closest('details')).getByRole('list')).toBeVisible();
    }
    // Assert: both empty and populated catalogue annotations disappear, but the requirement explanation remains.
    expect(screen.getByText('Room layout "Hall" is not listed.')).toBeVisible();
    expect(screen.getByText('Accessibility need "Ramp" is not listed.')).toBeVisible();
    expect(screen.queryByText(/venue lists:/i)).toBeNull();
    const icons = screen.getAllByRole('img', { name: 'Requirement not met' });
    expect(icons).toHaveLength(3);
    for (const icon of icons) {
      expect(icon.querySelector('circle')).not.toBeNull();
      expect(icon).toHaveTextContent('!');
    }
    expect(screen.queryByText('✗')).toBeNull();
    expect(screen.getByText('–')).toBeVisible();
    expect(screen.queryByText('Requirements checked')).toBeNull();
    const passes = screen.getAllByRole('img', { name: 'Requirement met' });
    expect(passes).toHaveLength(3);
    for (const icon of passes) {
      expect(icon).toBeVisible();
      expect(icon.querySelector('path')).toHaveAttribute('stroke-width', '3');
      expect(getComputedStyle(icon.parentElement).color).toBe('rgb(66, 79, 25)');
    }
    expect(screen.getByText('Holds 100 expected guests (capacity 120).')).toBeVisible();
    expect(screen.getByText('Banquet layout is supported.')).toBeVisible();
    expect(screen.getByText('Ramp is listed.')).toBeVisible();
    expect(within(mismatched.closest('details')).queryByText('Banquet layout is supported.')).toBeNull();
    // Act / Assert: closing one card never closes the other, and both can be collapsed again.
    fireEvent.click(matched);
    expect(screen.getByText('Holds 100 expected guests (capacity 120).')).not.toBeVisible();
    expect(screen.getByText('Room layout "Hall" is not listed.')).toBeVisible();
    fireEvent.click(mismatched);
    expect(screen.getByText('Room layout "Hall" is not listed.')).not.toBeVisible();
  } finally { style.remove(); }
});

// Approved UI AC: met and unmet panels share a single readable scale and box geometry; only their colours differ.
it('VS AC3 AC5 / UI - gives both requirement panels matching typography and accented borders', () => {
  // Arrange: use actual production CSS so either an undersized success panel or missing accent fails the oracle.
  const style = document.createElement('style');
  style.textContent = readFileSync('src/index.css', 'utf8'); document.head.append(style);
  try {
    render(<><VenueRequirementSummary assessment={hall} /><VenueRequirementSummary assessment={room} /></>);
    // Act / Assert: the same explicit geometry is required for each outcome, not just equality between two wrong values.
    for (const [label, colour] of [['Meets recorded requirements', 'rgb(66, 79, 25)'], ['Requirements not met', 'rgb(148, 43, 32)']]) {
      const heading = screen.getByText(label);
      const panel = heading.closest('details');
      expect(panel).not.toBeNull();
      const box = getComputedStyle(panel);
      const title = getComputedStyle(heading);
      expect(title.fontSize).toBe('16px');
      expect(title.fontWeight).toBe('700');
      expect(title.lineHeight).toBe('1.5');
      expect(box.padding).toBe('1rem');
      expect(box.borderRadius).toBe('10px');
      expect(box.borderTopWidth).toBe('1px');
      expect(box.borderLeftWidth).toBe('4px');
      expect(box.borderLeftColor).toBe(colour);
      fireEvent.click(heading);
      expect(getComputedStyle(within(panel).getByRole('list')).fontSize).toBe('16px');
    }
  } finally { style.remove(); }
});

it('VS AC1 AC4 AC5 - Find Venues shows one requirements summary, suitable cards first and mismatches behind an expandable section', async () => {
  await fullCatalogue();
  const panel = await screen.findByRole('region', { name: 'Venue suitability' });
  const facts = within(panel).getByRole('list', { name: "Organiser's venue requirements" });
  expect(facts).toHaveTextContent('100'); expect(facts).toHaveTextContent('Banquet'); expect(facts).toHaveTextContent('Ramp');
  expect(screen.getByRole('heading', { name: 'Suitable venues (1)' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Hall A' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Room B' })).not.toBeVisible();
  fireEvent.click(screen.getByText('Other venues (1) — requirements not met'));
  expect(screen.getByRole('heading', { name: 'Room B' })).toBeVisible();
  fireEvent.click(screen.getByText('Requirements not met'));
  expect(screen.getByText('Expected attendance 100 exceeds capacity 60.')).toBeVisible();
  expect(screen.getAllByRole('article')).toHaveLength(2);
  fireEvent.click(screen.getByText('Meets recorded requirements'));
  expect(screen.getByText('Banquet layout is supported.')).toBeVisible();
  expect(screen.getByText(/Suitability does not confirm schedule availability/)).toBeVisible();
});

it('VS AC1 AC4 - the event Venue requests tab contains history and discovery navigation without suitability duplicates', async () => {
  open('/events/101?tab=venues');
  await screen.findByRole('heading', { name: event.name });
  expect(screen.getByRole('link', { name: 'Find a venue' })).toHaveAttribute('href', '/coordinator/venues?eventId=101');
  expect(screen.queryByRole('region', { name: 'Venue suitability' })).not.toBeInTheDocument();
  expect(api.get).not.toHaveBeenCalledWith('/events/101/venue-suitability', 'session-token');
});

it('VS AC4 / SCRUM-39 AC3 AC8 - filtered cards retain nearest-first order inside each suitability group', async () => {
  const near = { ...hall, id: 3, name: 'Near Hall', distance_m: 100 };
  const far = { ...hall, id: 4, name: 'Far Hall', distance_m: 900 };
  catalogue = [far, room, near]; searchResults = [near, room, far];
  comparison.venues = [far, room, near];
  open();
  const list = await screen.findByRole('list', { name: 'Suitable venues (2)' });
  expect(within(list).getAllByRole('heading', { level: 3 }).map(node => node.textContent)).toEqual(['Near Hall', 'Far Hall']);
  expect(screen.getAllByRole('article', { hidden: true })).toHaveLength(3);
});

it('VS AC4 AC5 - all suitable and all unsuitable catalogues have clear non-duplicated empty-group states', async () => {
  catalogue = [hall]; searchResults = [hall]; comparison.venues = [hall];
  const view = await fullCatalogue();
  await screen.findByRole('heading', { name: 'Suitable venues (1)' });
  expect(screen.queryByText(/Other venues \(/)).not.toBeInTheDocument();
  view.unmount(); catalogue = [room]; searchResults = [room]; comparison.venues = [room];
  await fullCatalogue();
  expect(await screen.findByText('No venue matches all recorded event requirements in these results.')).toBeVisible();
  fireEvent.click(screen.getByText('Other venues (1) — requirements not met'));
  expect(screen.getByRole('heading', { name: 'Room B' })).toBeVisible();
});

it('VS AC1 - missing event requirements are labelled as missing rather than invented', async () => {
  const unchecked = [{ met: null, message: 'Expected attendance is not recorded, so capacity was not checked.' }];
  comparison = { requirements: { expectedAttendance: null, layout: null, accessibility: [] }, venues: [hall, room].map(venue => ({ ...venue, suitable: true, checks: unchecked, unmet: [] })) };
  const original = api.get.getMockImplementation();
  api.get.mockImplementation(path => path === '/events/101' ? Promise.resolve({ event: { id: 101, name: event.name } }) : original(path));
  await fullCatalogue();
  const facts = await screen.findByRole('list', { name: "Organiser's venue requirements" });
  expect(facts).toHaveTextContent('Not recorded'); expect(facts).toHaveTextContent('No preference'); expect(facts).toHaveTextContent('None');
  fireEvent.click(within(screen.getByRole('heading', { name: 'Hall A' }).closest('article')).getByText('Meets recorded requirements'));
  expect(within(screen.getByRole('heading', { name: 'Hall A' }).closest('article')).getByText('Expected attendance is not recorded, so capacity was not checked.')).toBeVisible();
});

it('VS AC1 - comparison loading leaves catalogue controls usable and then groups the returned venues', async () => {
  let finish; comparison = () => new Promise(resolve => { finish = resolve; });
  open(); await screen.findByRole('searchbox', { name: 'Search location' });
  expect(screen.getByText('Loading venue suitability…')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Hall A' })).toBeVisible();
  await act(async () => finish({ requirements: { expectedAttendance: 100, layout: 'Banquet', accessibility: [] }, venues: [hall] }));
  expect(await screen.findByRole('list', { name: 'Suitable venues (1)' })).toBeVisible();
});

it.each([new Error('Comparison service unavailable'), { venues: [], requirements: {} }, null])('VS AC1 - comparison failure %j keeps browsing available and supports retry', async failure => {
  comparison = () => { if (failure instanceof Error) throw failure; return failure; };
  open();
  expect(await screen.findByText(failure?.message || 'Venue suitability is unavailable right now.')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Hall A' })).toBeVisible();
  comparison = { requirements: { expectedAttendance: 100, layout: 'Banquet', accessibility: [] }, venues: [hall] };
  fireEvent.click(screen.getByRole('button', { name: 'Retry comparison' }));
  expect(await screen.findByRole('list', { name: 'Suitable venues (1)' })).toBeVisible();
});

it('VS AC1 - a venue added after the comparison snapshot stays unassessed until comparison refreshes', async () => {
  const newcomer = { id: 5, name: 'New Venue', capacity: 110 };
  catalogue = [hall, newcomer]; searchResults = [hall, newcomer]; comparison.venues = [hall];
  await fullCatalogue();
  expect(await screen.findByRole('heading', { name: 'Not yet assessed (1)' })).toBeVisible();
  expect(within(screen.getByRole('heading', { name: 'New Venue' }).closest('article')).queryByText('Meets recorded requirements')).not.toBeInTheDocument();
  comparison.venues = [hall, { ...newcomer, suitable: true, checks: [{ met: true, message: 'Holds 100 guests.' }], unmet: [] }];
  fireEvent(window, new Event('focus'));
  expect(await screen.findByRole('list', { name: 'Suitable venues (2)' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Not yet assessed (1)' })).not.toBeInTheDocument();
});

it('VS AC1 / SCRUM-61 AC1 - independent browsing needs no event comparison and matching cards retain booking actions', async () => {
  const view = open('/coordinator/venues');
  await screen.findByRole('heading', { name: 'Hall A' });
  expect(api.get).not.toHaveBeenCalledWith('/events/101/venue-suitability', 'session-token');
  expect(screen.queryByRole('region', { name: 'Venue suitability' })).not.toBeInTheDocument();
  view.unmount(); open();
  await screen.findByRole('list', { name: 'Suitable venues (1)' });
  fireEvent.click(screen.getByRole('button', { name: 'Request Hall A' }));
  expect(await screen.findByRole('heading', { name: 'Request a venue booking' })).toBeVisible();
});

it.each(['resolve', 'reject'])('VS AC1 - changing events ignores a late comparison %s from the previous event', async outcome => {
  let finish;
  const smaller = { id: 102, name: 'Small meeting', expected_attendance: 50 };
  const original = api.get.getMockImplementation();
  comparison = () => new Promise((resolve, reject) => { finish = outcome === 'resolve' ? resolve : reject; });
  api.get.mockImplementation(path => {
    if (path === '/events') return Promise.resolve({ events: [event, smaller] });
    if (path === '/events/102') return Promise.resolve({ event: smaller });
    if (path === '/events/102/venue-suitability') return Promise.resolve({ requirements: { expectedAttendance: 50, layout: null, accessibility: [] },
      venues: [hall, room].map(venue => ({ ...venue, suitable: true, checks: [{ met: true, message: 'Holds 50 guests.' }], unmet: [] })) });
    if (path.includes('attendance=50')) return Promise.resolve(catalogue);
    return original(path);
  });
  open();
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  fireEvent.change(screen.getByLabelText('Booking for event'), { target: { value: '102' } });
  await screen.findByRole('list', { name: 'Suitable venues (2)' });
  await act(async () => finish(outcome === 'resolve' ? { requirements: { expectedAttendance: 100, layout: 'Banquet', accessibility: [] }, venues: [hall] } : new Error('Old comparison failed')));
  expect(screen.getByRole('list', { name: "Organiser's venue requirements" })).toHaveTextContent('50');
  expect(screen.queryByText('Old comparison failed')).not.toBeInTheDocument();
  expect(screen.getByRole('list', { name: 'Suitable venues (2)' })).toBeVisible();
});

it('VS AC4 / SCRUM-39 AC1 - a suitable venue can still have a separate unavailable schedule state', async () => {
  catalogue = [{ ...hall, availability_status: 'Unavailable' }]; searchResults = catalogue; comparison.venues = [hall];
  open();
  const list = await screen.findByRole('list', { name: 'Suitable venues (1)' });
  expect(within(list).getByText('Meets recorded requirements')).toBeVisible();
  expect(within(list).getByText('Unavailable', { selector: '.image-badge' })).toBeVisible();
  expect(screen.getByText(/Suitability does not confirm schedule availability/)).toBeVisible();
});

it('VS AC1 / SCRUM-39 AC8 - empty search results show an actionable filter state without fabricated suitability cards', async () => {
  searchResults = [];
  open();
  expect(await screen.findByRole('heading', { name: 'No venues match these requirements.' })).toBeVisible();
  expect(screen.queryByRole('article')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Filters', exact: true })).toBeEnabled();
});
