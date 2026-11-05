// Organiser dashboard AC1–AC5: real stage filtering, router state and draft mutations; only HTTP is replaced.
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import OrganiserRequestList from '../../frontend/src/pages/events/OrganiserRequestList';
import App from '../../frontend/src/App';
import { AuthProvider } from '../../frontend/src/context/AuthContext';
import { api } from '../../frontend/src/api/client';
vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

const event = { id: 1, name: 'Workshop', status: 'draft', is_draft: true, can_manage: true, coordinator_id: null };
const records = [
  event,
  { id: 2, name: 'New request', status: 'submitted' },
  { id: 3, name: 'Assigned review', status: 'under_review', coordinator_id: 9 },
  { id: 4, name: 'Planning event', status: 'planning' },
  { id: 5, name: 'Confirmed event', status: 'confirmed' },
  { id: 6, name: 'Finished event', status: 'completed', coordinator_id: 9 },
  { id: 7, name: 'Rejected event', status: 'rejected', coordinator_id: 9 },
  { id: 8, name: 'Cancelled request', status: 'cancelled', coordinator_id: 9 },
  { id: 9, name: 'Unassigned review', status: 'under_review' },
  { id: 10, name: 'Flagged draft', status: 'submitted', is_draft: true, coordinator_id: 9 },
  { id: 11, name: 'Unassigned approval', status: 'approved' },
];

/** Reflects the real parent's functional event updates while exposing genuine router history for filter tests. */
function ListHarness({ initialEvents }) {
  const [events, setEvents] = useState(initialEvents);
  const location = useLocation(), navigate = useNavigate();
  return <><OrganiserRequestList events={events} onChange={setEvents} token="tabs-token" tabbed />
    <span aria-label="Current route">{location.pathname + location.search}</span>
    <button onClick={() => navigate(-1)}>Browser back</button><button onClick={() => navigate(1)}>Browser forward</button></>;
}

/** Keeps the production list, confirmation dialog and router mounted; the harness only owns supplied records. */
function open(events = records, path = '/organizer/dashboard') {
  return render(<MemoryRouter initialEntries={[path]}><ListHarness initialEvents={events} /></MemoryRouter>);
}
/** Finds a stage by its label independently of its changing visible count. */
function tab(label) { return screen.getByRole('tab', { name: new RegExp(`^${label}\\b`) }); }
/** Reads the one exposed panel, ensuring hidden stages cannot satisfy visible-card assertions. */
function panel() { return screen.getByRole('tabpanel'); }

beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); });
afterEach(cleanup);

it('Organiser dashboard AC1 AC2 - partitions every lifecycle stage once with correct counts and no View status action', () => {
  // Arrange: assignment cannot move completed/rejected records back into active work, and draft flags take precedence.
  open();
  const expected = [
    ['Draft', ['Workshop', 'Flagged draft']],
    ['Submitted', ['New request', 'Cancelled request', 'Unassigned review', 'Unassigned approval']],
    ['In progress', ['Assigned review', 'Planning event', 'Confirmed event']],
    ['Completed', ['Finished event']],
    ['Rejected', ['Rejected event']],
  ];
  // Act / Assert: select each group and compare its exact contents against the independent lifecycle table.
  expect(screen.getAllByRole('tab')).toHaveLength(5);
  for (const [label, names] of expected) {
    const control = tab(label);
    expect(within(control).getByText(String(names.length))).toBeVisible();
    fireEvent.click(control);
    expect(control).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tab').filter(item => item.getAttribute('aria-selected') === 'true')).toHaveLength(1);
    expect(within(panel()).getAllByRole('heading', { level: 3 }).map(item => item.textContent)).toEqual(names);
    expect(within(panel()).queryByRole('link', { name: 'View status' })).not.toBeInTheDocument();
  }
  expect(api.post).not.toHaveBeenCalled(); expect(api.delete).not.toHaveBeenCalled();
});

it('Organiser dashboard AC3 - keyboard navigation wraps at both ends and preserves unrelated query parameters', () => {
  // Arrange: an invalid bookmarked stage falls back to Draft when there are no records.
  open([], '/organizer/dashboard?keep=1&stage=unknown');
  const first = tab('Draft'); first.focus();
  expect(first).toHaveAttribute('tabindex', '0');
  expect(panel()).toHaveTextContent('No draft events.');
  // Act / Assert: horizontal tabs support arrows, Home and End; unrelated keys cannot change the selected stage.
  for (const [key, label] of [['ArrowLeft', 'Rejected'], ['ArrowRight', 'Draft'], ['End', 'Rejected'], ['Home', 'Draft'], ['ArrowRight', 'Submitted']]) {
    fireEvent.keyDown(document.activeElement, { key });
    expect(tab(label)).toHaveFocus(); expect(tab(label)).toHaveAttribute('aria-selected', 'true');
  }
  fireEvent.keyDown(document.activeElement, { key: 'Escape' });
  expect(tab('Submitted')).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByLabelText('Current route')).toHaveTextContent('/organizer/dashboard?keep=1&stage=submitted');
});

it('Organiser dashboard AC3 - bookmarks and browser history retain an explicitly selected empty stage', () => {
  // Arrange: the selected Completed stage stays open even though only a draft exists.
  open([event], '/organizer/dashboard?stage=completed');
  expect(tab('Completed')).toHaveAttribute('aria-selected', 'true');
  expect(panel()).toHaveTextContent('No completed events.');
  // Act / Assert: history selects the same stage instead of silently falling back to non-empty data.
  fireEvent.click(tab('Rejected'));
  fireEvent.click(screen.getByRole('button', { name: 'Browser back' }));
  expect(tab('Completed')).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Browser forward' }));
  expect(tab('Rejected')).toHaveAttribute('aria-selected', 'true');
  expect(panel()).toHaveTextContent('No rejected events.');
});

it('Organiser dashboard AC4 - confirmed draft submission and retried deletion update counts without losing other events', async () => {
  // Arrange: functional parent updates must preserve both another draft and completed history.
  open([event, { ...event, id: 2, name: 'Other draft' }, { id: 3, name: 'History', status: 'completed' }], '/organizer/dashboard?stage=draft');
  api.post.mockResolvedValue({ event: { ...event, status: 'submitted', is_draft: false }, message: 'Submitted.' });
  api.delete.mockRejectedValueOnce(new Error('Please retry deletion')).mockResolvedValueOnce({ message: 'Deleted.' });
  // Act: only explicit confirmation persists submission, and the selected Draft stage remains selected.
  fireEvent.click(within(screen.getByRole('heading', { name: 'Workshop' }).closest('li')).getByRole('button', { name: 'Submit draft' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await screen.findByText('Submitted.'); fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(api.post).toHaveBeenCalledWith('/events/1/submit', {}, 'tabs-token');
  expect(within(tab('Draft')).getByText('1')).toBeVisible(); expect(within(tab('Submitted')).getByText('1')).toBeVisible();
  // Assert error/cancel/retry behavior before deleting the remaining draft.
  fireEvent.click(screen.getByRole('button', { name: 'Delete draft' }));fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(api.delete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Delete draft' }));fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Please retry deletion');
  expect(within(panel()).getByRole('heading', { name: 'Other draft' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));await screen.findByText('Deleted.');fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(api.delete).toHaveBeenLastCalledWith('/events/2/draft', 'tabs-token');
  expect(panel()).toHaveTextContent('No draft events.');
  fireEvent.click(tab('Submitted'));expect(within(panel()).getByRole('heading', { name: 'Workshop' })).toBeVisible();
  fireEvent.click(tab('Completed'));expect(within(panel()).getByRole('heading', { name: 'History' })).toBeVisible();
});

it('Organiser dashboard AC2 AC5 - colleague status stays visible without exposing private detail or draft actions', () => {
  // Arrange / Act: organisation visibility does not imply permission to open or mutate another submitter's draft.
  open([{ ...event, can_manage: false }]);
  expect(within(panel()).getByText('Draft', { selector: '.status-badge' })).toBeVisible();
  // Assert: removing View status must not grant submitter-only details as a replacement.
  for (const name of ['View status', 'View details']) expect(within(panel()).queryByRole('link', { name })).not.toBeInTheDocument();
  for (const name of ['Submit draft', 'Delete draft']) expect(within(panel()).queryByRole('button', { name })).not.toBeInTheDocument();
});

it('Organiser dashboard AC4 - a live completed status moves the record and counts without resetting the selected stage', async () => {
  // Arrange: retain real authentication, polling/focus refresh and dashboard components.
  let live = [{ id: 9, name: 'Live event', status: 'planning', coordinator_id: 4 }];
  localStorage.setItem('cs_token', 'tabs-live');
  api.get.mockImplementation(async path => path === '/auth/me' ? { user: { id: 7, role: 'event_organiser' } }
    : path === '/events' ? { events: live } : { notifications: [], unreadCount: 0 });
  render(<MemoryRouter initialEntries={['/organizer/dashboard?stage=progress']}><AuthProvider><App /></AuthProvider></MemoryRouter>);
  await screen.findByRole('heading', { name: 'Live event' });
  // Act: a genuine resource refresh supplies a completed lifecycle state for the same assigned event.
  live = [{ ...live[0], status: 'completed' }];
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  // Assert: selection is retained while the event and its count move to Completed exactly once.
  await screen.findByText('No in progress events.');expect(tab('In progress')).toHaveAttribute('aria-selected', 'true');
  expect(within(tab('In progress')).getByText('0')).toBeVisible();expect(within(tab('Completed')).getByText('1')).toBeVisible();
  fireEvent.click(tab('Completed'));expect(within(panel()).getByRole('heading', { name: 'Live event' })).toBeVisible();
});

it('Organiser dashboard AC3 AC5 - View details returns to the same bookmarked stage', async () => {
  // Arrange: a managed completed event has a real detail page, and the dashboard retains its filter in history state.
  const completed = { id: 42, name: 'Completed outing', status: 'completed', is_draft: false, can_manage: true,
    organiser_id: 7, coordinator_id: 9, registration_required: false, accessibility_requirements: [], attachments: {} };
  localStorage.setItem('cs_token', 'tabs-details');
  api.get.mockImplementation(async path => path === '/auth/me' ? { user: { id: 7, role: 'event_organiser' } }
    : path === '/events' ? { events: [completed] }
    : ['/events/42', '/events/42/request-status'].includes(path) ? { event: completed }
    : { notifications: [], unreadCount: 0, bookings: [], clarifications: [], changeRequests: [], amendmentRequests: [] });
  render(<MemoryRouter initialEntries={['/organizer/dashboard?stage=completed&keep=1']}><AuthProvider><App /></AuthProvider></MemoryRouter>);
  // Act / Assert: returning from the actual owner detail page restores the category rather than dropping its query.
  fireEvent.click(await screen.findByRole('link', { name: 'View details', exact: true }));
  await screen.findByRole('heading', { name: 'Completed outing' });
  const back = screen.getByRole('link', { name: 'Back to Events' });
  expect(back).toHaveAttribute('href', '/organizer/dashboard?stage=completed&keep=1');
  fireEvent.click(back);
  await screen.findByRole('tab', { name: /^Completed/ });
  expect(tab('Completed')).toHaveAttribute('aria-selected', 'true');
  expect(within(panel()).getByRole('heading', { name: 'Completed outing' })).toBeVisible();
});
