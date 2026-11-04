import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import AttendeeDashboard from '../../frontend/src/pages/attendee/AttendeeDashboard';
import { api } from '../../frontend/src/api/client';
vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../frontend/src/context/AuthContext', () => ({ useAuth: () => ({ token: 'attendee', user: { id: 8, role: 'attendee' } }) }));
const registered = { id: 7, event_id: 44, event_name: 'Arts Day', status: 'registered', event_status: 'confirmed',
  proposed_date: '2031-06-12', proposed_start_time: '09:30', withdrawal_deadline: '2031-06-12T01:30:00Z' };
let records, style;
beforeEach(() => {
  // Freeze the calendar and polling interval so the real withdrawal deadline and refresh rules never age with the test run.
  vi.resetAllMocks(); style = null; vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date('2031-06-01T00:00:00Z'));
  records = [registered, { ...registered, id: 8, event_id: 45, event_name: 'Waiting Forum', status: 'waitlisted' },
    { ...registered, id: 9, event_id: 46, event_name: 'Past withdrawal', status: 'withdrawn' }];
  api.get.mockImplementation(async path => path === '/registrations/mine' ? { registrations: records }
    : path === '/events/published' ? { events: [{ id: 50, name: 'Published workshop' }] } : { notifications: [], unreadCount: 0 });
});
afterEach(() => { cleanup(); vi.useRealTimers(); style?.remove(); });
/** Include the shared card rules so position-based stripes cannot mask a status-specific regression. */
function loadStyles() {
  style = document.createElement('style');
  style.textContent = readFileSync('src/index.css', 'utf8') + readFileSync('src/pages/attendee/AttendeeSections.css', 'utf8');
  document.head.append(style);
}
/** Exercise the real dashboard composition and drawers, replacing only HTTP and session boundaries. */
async function open() { render(<MemoryRouter><AttendeeDashboard /></MemoryRouter>); await screen.findByRole('heading', { name: 'Arts Day' }); }
/** Follow the accessible control relationship instead of depending on a component's CSS or DOM nesting. */
function toggle(title) { return screen.getByRole('button', { name: new RegExp(`^${title} \\(`) }); }
/** Resolves the public aria-controls target even when its closed region is absent from the accessibility tree. */
function body(title) { return document.getElementById(toggle(title).getAttribute('aria-controls')); }

it('Attendee UI AC1 AC2 - starts main and active groups expanded and withdrawn collapsed with accurate counts', async () => {
  // Arrange / Act: waitlisted registrations remain part of the active journey, not the withdrawn archive.
  await open();
  // Assert: all counts come from stored registration states, independently of the published catalogue.
  for (const name of ['My registrations', 'Published events', 'Registered']) expect(toggle(name)).toHaveAttribute('aria-expanded', 'true');
  expect(toggle('My registrations')).toHaveTextContent('(3)'); expect(toggle('Registered')).toHaveTextContent('(2)');
  expect(toggle('Withdrawn')).toHaveTextContent('(1)'); expect(toggle('Withdrawn')).toHaveAttribute('aria-expanded', 'false');
  expect(within(body('Registered')).getByRole('heading', { name: 'Waiting Forum' })).toBeVisible();
  expect(within(body('Withdrawn')).getByText('Past withdrawal')).not.toBeVisible();
  expect(toggle('Published events')).toHaveTextContent('(1)');
});

it('Attendee UI AC1 AC2 - independently toggles main and nested sections through accessible activation', async () => {
  // Arrange: native buttons provide keyboard semantics without a custom key handler.
  await open(); const main = toggle('My registrations'), published = toggle('Published events');
  // Act / Assert: browsers emit a zero-detail click for keyboard activation; jsdom has no native key default action.
  published.focus(); fireEvent.click(published, { detail: 0 });
  expect(published).toHaveFocus(); expect(body('Published events')).not.toBeVisible(); expect(body('My registrations')).toBeVisible();
  fireEvent.click(toggle('Withdrawn')); expect(body('Withdrawn')).toBeVisible();
  fireEvent.click(main); expect(body('My registrations')).not.toBeVisible();
  fireEvent.click(main); expect(body('Withdrawn')).toBeVisible(); expect(body('Published events')).not.toBeVisible();
  fireEvent.click(toggle('Registered')); expect(body('Registered')).not.toBeVisible();
  fireEvent.click(toggle('Registered')); fireEvent.click(published); expect(body('Registered')).toBeVisible(); expect(body('Published events')).toBeVisible();
});

it('Attendee UI AC2 / Withdraw AC1 - successful withdrawal moves only its card into the closed archive and preserves the drawer', async () => {
  // Arrange: the server confirms one withdrawal; another active registration must stay in place.
  api.post.mockResolvedValue({ registration: { id: 7, status: 'withdrawn' }, message: 'Your registration is now Withdrawn.' });
  await open(); fireEvent.click(within(body('Registered')).getAllByRole('button', { name: /View registration/ })[0]);
  // Act: use the real nested confirmation instead of invoking the list callback directly.
  fireEvent.click(screen.getByRole('button', { name: 'Withdraw registration' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm', exact: true }));
  await screen.findByRole('status');
  // Assert: counts, group membership and the current private drawer all reflect the same persisted result.
  expect(toggle('Registered')).toHaveTextContent('(1)'); expect(toggle('Withdrawn')).toHaveTextContent('(2)');
  expect(within(body('Registered')).queryByRole('heading', { name: 'Arts Day' })).not.toBeInTheDocument();
  expect(within(body('Registered')).getByRole('heading', { name: 'Waiting Forum' })).toBeVisible();
  expect(toggle('Withdrawn')).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByRole('dialog', { name: 'Registration details' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  expect(toggle('Withdrawn')).toHaveFocus(); fireEvent.click(toggle('Withdrawn'));
  expect(within(body('Withdrawn')).getByRole('heading', { name: 'Arts Day' })).toBeVisible();
  // Load styles at the visual assertion; repeated accessible interaction queries need not recalculate the entire shared sheet.
  // Newly archived cards must adopt the same blue treatment without a page reload.
  loadStyles();
  expect(getComputedStyle(within(body('Withdrawn')).getByRole('heading', { name: 'Arts Day' }).closest('article')).borderTopColor).toBe('rgb(36, 71, 106)');
  expect(api.post).toHaveBeenCalledWith('/registrations/events/44/withdraw', {}, 'attendee');
});

it('Attendee UI AC2 / Withdraw AC3 - failed withdrawal retains active membership and permits retry', async () => {
  // Arrange / Act: a rejected write must never optimistically archive the attendee's place.
  api.post.mockRejectedValue(new Error('Withdrawal unavailable')); await open();
  fireEvent.click(within(body('Registered')).getAllByRole('button', { name: /View registration/ })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Withdraw registration' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm', exact: true }));
  // Assert: the error stays in the confirmation while the card and both counts remain unchanged.
  expect(await screen.findByRole('alert')).toHaveTextContent('Withdrawal unavailable');
  expect(toggle('Registered')).toHaveTextContent('(2)'); expect(toggle('Withdrawn')).toHaveTextContent('(1)');
  expect(within(body('Registered')).getByRole('heading', { name: 'Arts Day' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
});

it('Attendee UI AC1 AC2 / Status AC2 - background promotion and withdrawal preserve disclosures and update the open drawer', async () => {
  // Arrange: open a waitlisted registration and make explicit disclosure choices before the next poll.
  await open(); fireEvent.click(toggle('Published events')); fireEvent.click(toggle('Withdrawn'));
  fireEvent.click(within(body('Registered')).getAllByRole('button', { name: /View registration/ })[1]);
  records = [{ ...registered, status: 'withdrawn' }, { ...records[1], status: 'registered' }, records[2]];
  // Act: use the production five-second refresh hook without remounting the dashboard.
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  // Assert: new data cannot reset the user's disclosure choices or leave the selected drawer stale.
  expect(toggle('Published events')).toHaveAttribute('aria-expanded', 'false'); expect(toggle('Withdrawn')).toHaveAttribute('aria-expanded', 'true');
  expect(toggle('Registered')).toHaveAttribute('aria-expanded', 'true'); expect(toggle('Registered')).toHaveTextContent('(1)');
  expect(within(screen.getByRole('dialog')).getByText('Registered')).toBeVisible();
  expect(within(body('Registered')).getByRole('heading', { name: 'Waiting Forum' })).toBeVisible();
  expect(within(body('Withdrawn')).getByRole('heading', { name: 'Arts Day' })).toBeVisible();
});

it('Attendee UI AC1 - failed refresh and empty recovery keep the main section choice', async () => {
  // Arrange: a transport outage should retain the known cards while the section stays collapsed.
  await open(); fireEvent.click(toggle('My registrations'));
  const original = api.get.getMockImplementation();
  api.get.mockImplementation(path => path === '/registrations/mine' ? Promise.reject(new Error('Offline')) : original(path));
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(toggle('My registrations')).toHaveAttribute('aria-expanded', 'false');
  // Act / Assert: re-open for the error, then recover to an explicit empty state without changing the main disclosure.
  fireEvent.click(toggle('My registrations')); expect(screen.getByRole('alert')).toHaveTextContent('Offline');
  records = []; api.get.mockImplementation(original);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(toggle('My registrations')).toHaveTextContent('(0)'); expect(toggle('My registrations')).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('heading', { name: 'No registrations yet' })).toBeVisible(); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('Attendee UI AC1 - parent controls are larger than visibly indented registration subgroups', async () => {
  // Arrange / Act: actual application styles are the oracle for the reported visual hierarchy.
  loadStyles(); await open();
  const parent = toggle('My registrations'), published = toggle('Published events');
  const nested = toggle('Registered'), withdrawn = toggle('Withdrawn');
  // Assert: semantic and visual nesting agree; equal-sized controls or a missing indent fails.
  expect(parent.closest('h2')).not.toBeNull(); expect(published.closest('h2')).not.toBeNull();
  for (const control of [nested, withdrawn]) {
    expect(control.closest('h3')).not.toBeNull();
    expect(getComputedStyle(control).fontSize).toBe('18px');
    expect(getComputedStyle(control.closest('section')).marginLeft).toBe('16px');
    expect(getComputedStyle(control.closest('section')).borderLeftWidth).toBe('2px');
  }
  expect(getComputedStyle(parent).fontSize).toBe('22px'); expect(getComputedStyle(published).fontSize).toBe('22px');
});

it.each([0, 1, 2])('Attendee UI AC2 - withdrawn blue styling follows status at archive position %s', async position => {
  // Arrange: move the same withdrawal across each of the shared grid's three positional stripe rules.
  const target = records[2];
  const archive = [10, 11].map(id => ({ ...target, id, event_name: `Other withdrawal ${id}` }));
  archive.splice(position, 0, target); records = [...records.slice(0, 2), ...archive];
  loadStyles(); await open(); fireEvent.click(toggle('Withdrawn'));
  // Assert: stored status determines both stripe and badge; active status colours are unaffected.
  const card = screen.getByRole('heading', { name: 'Past withdrawal' }).closest('article');
  expect(getComputedStyle(card).borderTopColor).toBe('rgb(36, 71, 106)');
  const badge = within(card).getByText('Withdrawn', { exact: true });
  expect(getComputedStyle(badge).color).toBe('rgb(36, 71, 106)');
  expect(getComputedStyle(badge).backgroundColor).toBe('rgb(231, 238, 247)');
  for (const label of ['Registered', 'Waitlisted']) {
    const activeBadge = within(body('Registered')).getByText(label, { exact: true });
    expect(getComputedStyle(activeBadge).backgroundColor).toBe('rgb(232, 237, 195)');
  }
});
