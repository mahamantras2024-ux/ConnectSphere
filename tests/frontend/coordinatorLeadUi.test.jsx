import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import App from '../../frontend/src/App';
import { api } from '../../frontend/src/api/client';
import { useAuth } from '../../frontend/src/context/AuthContext';
vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }));
vi.mock('../../frontend/src/context/AuthContext', () => ({ useAuth: vi.fn() }));
const base = { purpose: 'Community gathering', organiser_name: 'Alex', proposed_date: '2030-11-01', expected_attendance: 60, coordinator_id: 3, coordinator_name: 'Chris' };
const coordinators = [{ id: 3, full_name: 'Chris', email: 'chris@example.com' }, { id: 4, full_name: 'Sam', email: 'sam@example.com' }];
let events, style;
beforeEach(() => {
  vi.resetAllMocks(); style = document.createElement('style');
  // Load the real shared and scoped CSS: a flex card must remain hidden after collapse.
  style.textContent = readFileSync('src/index.css', 'utf8') + readFileSync('src/pages/coordinator/CoordinatorLeadDashboard.css', 'utf8'); document.head.append(style);
  useAuth.mockReturnValue({ token: 'lead', user: { id: 1, role: 'event_coordinator_lead' } });
  events = [{ ...base, id: 7, name: 'Planning Forum', status: 'planning' }, { ...base, id: 8, name: 'Second planning event', status: 'planning' },
    { ...base, id: 9, name: 'Waiting for assignment', status: 'submitted', coordinator_id: null, coordinator_name: null }];
  api.get.mockImplementation(async path => path === '/events/assignments' ? { events, coordinators } : { notifications: [], unreadCount: 0 });
});
afterEach(() => { cleanup(); vi.useRealTimers(); style?.remove(); });
/** Preserve the real protected route, cards and forms; only session and HTTP are external. */
async function open() { render(<MemoryRouter initialEntries={['/coordinator-lead/dashboard']}><App /></MemoryRouter>); await screen.findByRole('heading', { name: 'Planning Forum' }); }
/** The visible counted caption is the user's disclosure control, including for nested stages. */
function toggle(name) { return screen.getByRole('button', { name: new RegExp(`^${name} \\(`) }); }
/** Follow the public aria-controls relationship rather than matching implementation-specific nesting. */
function panel(name) { return document.getElementById(toggle(name).getAttribute('aria-controls')); }

it('Lead UI AC1 AC2 AC4 - larger parent sections contain smaller indented status sections with counts and compact details links', async () => {
  // Arrange: all six active lifecycle stages plus a second Planning record give explicit zero/one/two group oracles.
  events.push(...[['under_review', 'Under review event'], ['approved', 'Approved event'], ['confirmed', 'Confirmed event'],
    ['rejected', 'Rejected event'], ['submitted', 'Submitted event']].map(([status, name], index) => ({ ...base, id: index + 20, status, name })));
  await open();
  const assigned = toggle('Assigned active events'), planning = toggle('Planning');
  // Assert: hierarchy is semantic and visibly smaller, not merely a different label on an equally prominent control.
  expect(assigned.closest('h2')).not.toBeNull(); expect(planning.closest('h3')).not.toBeNull();
  expect(parseFloat(getComputedStyle(planning).fontSize)).toBeLessThan(parseFloat(getComputedStyle(assigned).fontSize));
  expect(parseFloat(getComputedStyle(planning.closest('.lead-assigned-stages')).paddingLeft)).toBeGreaterThan(0);
  expect(assigned).toHaveTextContent('(7)'); expect(toggle('Unassigned requests')).toHaveTextContent('(1)'); expect(planning).toHaveTextContent('(2)');
  for (const name of ['Unassigned requests', 'Assigned active events', 'Submitted', 'Under review', 'Approved', 'Planning', 'Confirmed', 'Rejected']) {
    expect(toggle(name)).toHaveAttribute('aria-expanded', 'true');
  }
  const card = screen.getByRole('heading', { name: 'Planning Forum' }).closest('article');
  const details = within(card).getByRole('link', { name: 'View details' });
  expect(details).toHaveClass('record-action'); expect(details).toHaveAttribute('href', '/events/7'); expect(details.querySelector('[aria-hidden="true"]')).toHaveTextContent('↗');
  expect(screen.queryByRole('button', { name: 'Registration information' })).not.toBeInTheDocument();
  expect(api.get.mock.calls.some(([path]) => path.endsWith('/lead-registrations'))).toBe(false);
});

it('Lead UI AC1 AC2 - parent and nested status sections toggle independently and preserve choices on reopening', async () => {
  // Arrange / Act: native keyboard activation emits a zero-detail click; jsdom does not synthesize that key default.
  await open(); const assigned = toggle('Assigned active events'); assigned.focus(); fireEvent.click(assigned, { detail: 0 });
  expect(assigned).toHaveFocus(); expect(panel('Assigned active events')).not.toBeVisible(); expect(panel('Unassigned requests')).toBeVisible();
  fireEvent.click(assigned); fireEvent.click(toggle('Planning'));
  expect(getComputedStyle(document.getElementById('lead-event-7')).display).toBe('none');
  expect(screen.queryByRole('heading', { name: 'Planning Forum' })).not.toBeInTheDocument();
  fireEvent.click(assigned); fireEvent.click(assigned);
  // Assert: opening a parent must not reset a nested choice or affect the other parent's count and content.
  expect(toggle('Planning')).toHaveAttribute('aria-expanded', 'false'); expect(panel('Unassigned requests')).toBeVisible();
  fireEvent.click(toggle('Planning')); expect(screen.getByRole('heading', { name: 'Planning Forum' })).toBeVisible();
  fireEvent.click(toggle('Unassigned requests')); expect(panel('Unassigned requests')).not.toBeVisible(); expect(panel('Assigned active events')).toBeVisible();
});

it('Lead UI AC2 - a live Planning to Confirmed move retains draft coordinator selections and disclosure choices', async () => {
  // Arrange: draft choices exist on two records before a server-side lifecycle update.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }); await open();
  fireEvent.change(screen.getByLabelText('Coordinator for Planning Forum'), { target: { value: '4' } });
  fireEvent.change(screen.getByLabelText('Coordinator for Second planning event'), { target: { value: '4' } });
  fireEvent.click(toggle('Planning')); fireEvent.click(toggle('Unassigned requests'));
  events = events.map(event => event.id === 7 ? { ...event, status: 'confirmed' } : event);
  // Act: refresh uses the shared live resource, with no remount or manually invoked component callback.
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  // Assert: stage counts move while the untouched record remains in its closed stage and both drafts survive.
  expect(toggle('Confirmed')).toHaveTextContent('(1)'); expect(toggle('Planning')).toHaveTextContent('(1)');
  expect(toggle('Planning')).toHaveAttribute('aria-expanded', 'false'); expect(toggle('Unassigned requests')).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('heading', { name: 'Planning Forum' })).toBeVisible();
  expect(screen.getByLabelText('Coordinator for Planning Forum')).toHaveValue('4'); expect(screen.getByLabelText('Coordinator for Second planning event')).toHaveValue('4');
});

it('Lead UI AC1 AC2 - manual refresh failure and retry preserve selection drafts and parent choices', async () => {
  // Arrange: the reviewed selection is still unsaved when a manual read fails.
  await open(); fireEvent.change(screen.getByLabelText('Coordinator for Planning Forum'), { target: { value: '4' } });
  fireEvent.click(toggle('Unassigned requests')); const original = api.get.getMockImplementation();
  api.get.mockImplementation(path => path === '/events/assignments' ? Promise.reject(new Error('Offline')) : original(path));
  // Act / Assert: an error is not a successful reassignment and recovery must not silently clear the draft.
  fireEvent.click(screen.getByRole('button', { name: 'Refresh assignments' })); expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
  api.get.mockImplementation(original); fireEvent.click(screen.getByRole('button', { name: 'Refresh assignments' }));
  await screen.findByRole('heading', { name: 'Planning Forum' }); expect(screen.getByLabelText('Coordinator for Planning Forum')).toHaveValue('4');
  expect(toggle('Unassigned requests')).toHaveAttribute('aria-expanded', 'false'); expect(api.put).not.toHaveBeenCalled();
});

it('Lead UI AC2 / Lead AC5 - an older poll cannot undo a committed assignment or drop unrelated cards', async () => {
  // Arrange: hold the next read before assigning the currently unassigned request.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }); await open(); let finishRead;
  const original = api.get.getMockImplementation();
  api.get.mockImplementation(path => path === '/events/assignments' ? new Promise(resolve => { finishRead = resolve; }) : original(path));
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  api.put.mockResolvedValue({ event: { id: 9, name: 'Waiting for assignment', coordinator_id: 4 }, message: 'Assigned.' });
  // Act: commit newer assignment evidence, then resolve the obsolete read with its literal pre-assignment snapshot.
  fireEvent.change(screen.getByLabelText('Coordinator for Waiting for assignment'), { target: { value: '4' } });
  fireEvent.click(screen.getByRole('button', { name: 'Assign coordinator' })); await screen.findByText('Assigned.');
  await act(async () => finishRead({ events, coordinators }));
  // Assert: the late response cannot resurrect an unassigned card or lose other assigned work.
  expect(toggle('Unassigned requests')).toHaveTextContent('(0)'); expect(toggle('Assigned active events')).toHaveTextContent('(3)');
  expect(screen.getByText('No unassigned requests.')).toBeVisible(); expect(screen.getByRole('heading', { name: 'Planning Forum' })).toBeVisible();
  expect(api.put).toHaveBeenCalledWith('/events/9/assignment', { coordinatorId: 4, expectedCoordinatorId: null }, 'lead');
});

it('Lead UI AC2 - a write finishing after access loss never restores removed private cards', async () => {
  // Arrange: a pending write can finish after a newer read has revoked access to the queue.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }); await open(); let finishWrite;
  api.put.mockImplementation(() => new Promise(resolve => { finishWrite = resolve; }));
  fireEvent.change(screen.getByLabelText('Coordinator for Planning Forum'), { target: { value: '4' } });
  fireEvent.click(within(screen.getByRole('heading', { name: 'Planning Forum' }).closest('article')).getByRole('button', { name: 'Reassign coordinator' }));
  const original = api.get.getMockImplementation();
  api.get.mockImplementation(path => path === '/events/assignments' ? Promise.reject(Object.assign(new Error('Access denied'), { status: 403 })) : original(path));
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); expect(screen.queryAllByRole('article')).toHaveLength(0);
  // Act / Assert: a successful response is not permission to reconstruct the entire old private queue.
  await act(async () => finishWrite({ event: { id: 7, name: 'Planning Forum', coordinator_id: 4 }, message: 'Assignment committed.' }));
  expect(screen.getByText('Assignment committed.')).toBeVisible(); expect(screen.queryAllByRole('article')).toHaveLength(0);
});

it('Lead UI AC2 - a missing status remains visible in an explicit Other section', async () => {
  // Arrange: HTTP contract degradation, not a valid new database lifecycle state or a new permission rule.
  events.push({ ...base, id: 90, name: 'Missing status record' }); await open();
  // Assert: incomplete metadata cannot silently discard an otherwise returned request.
  expect(toggle('Other')).toHaveTextContent('(1)'); expect(screen.getByRole('heading', { name: 'Missing status record' })).toBeVisible();
});

/** jsdom has no pointer pseudo-state engine; equivalent attributes exercise the unchanged stylesheet cascade and specificity. */
function setCssState(button, state) {
  style.textContent = style.textContent.replaceAll(':hover', '[data-css-hover]').replaceAll(':focus-visible', '[data-css-focus]');
  button.setAttribute(`data-css-${state}`, '');
}
/** Activate actual matching media rules because jsdom does not evaluate viewport media queries. */
function applyViewportRules(width) {
  const additions = Array.from(style.sheet.cssRules).filter(rule => {
    const match = /max-width:\s*(\d+)px/.exec(rule.conditionText || '');
    return match && width <= Number(match[1]);
  }).flatMap(rule => Array.from(rule.cssRules).map(child => child.cssText)).join('\n');
  style.textContent += additions;
}

it.each(['Assigned active events', 'Planning'])('Lead presentation AC1 - %s has flat full-width hover and visible keyboard focus', async label => {
  // Arrange / Act: use both parent and nested controls with the real global orange-button rules present.
  await open(); const button = toggle(label); setCssState(button, 'hover'); fireEvent.mouseOver(button);
  // Assert: a generic orange pill or shadow returning through specificity would fail these computed-style checks.
  let appearance = getComputedStyle(button);
  expect(appearance.backgroundColor).toBe('rgb(243, 245, 235)');
  expect(appearance.boxShadow).toBe('none'); expect(appearance.borderTopWidth).toBe('0px');
  expect(appearance.width).toBe('100%'); expect(appearance.borderRadius).toBe('8px');
  button.focus(); setCssState(button, 'focus');
  appearance = getComputedStyle(button);
  expect(button).toHaveFocus(); expect(appearance.outline).toMatch(/^3px solid/); expect(appearance.outlineOffset).toBe('3px');
  expect(button).toHaveAttribute('aria-expanded', 'true');
});

it('Lead presentation AC2 - variable summaries share aligned card rows with compact facts and action spacing', async () => {
  // Arrange: short, missing and long purposes, wrapped titles/names, both queues and confirmed guidance all use one layout.
  const longPurpose = 'To showcase student-led technology projects and encourage networking between students, faculty, and industry professionals.';
  const longTitle = 'A long event title that wraps across multiple lines without hiding any words';
  const longOrganiser = 'An organiser with a lengthy organisation and display name';
  events = [events[0], { ...events[1], name: longTitle, purpose: null, organiser_name: longOrganiser },
    { ...events[2], purpose: longPurpose }, { ...base, id: 10, name: 'Another unassigned event', coordinator_id: null, purpose: null },
    { ...base, id: 11, name: 'Confirmed gathering', status: 'confirmed' }];
  await open();
  const cards = screen.getAllByRole('article');
  // Assert the actual layout contract, not invented geometry: jsdom cannot measure browser grid positions.
  for (const card of cards) {
    const summary = card.querySelector('.lead-card-summary');
    expect(summary).not.toBeNull();
    const facts = within(card).getByText('Organiser', { exact: true }).closest('dl');
    const action = within(card).getByRole('link', { name: 'View details' });
    const form = within(card).getByRole('combobox').closest('form');
    expect(Array.from(card.children)).toEqual([card.querySelector('.record-top'), summary, facts, action, form]);
    expect(getComputedStyle(card).display).toBe('grid'); expect(getComputedStyle(card).gridTemplateRows).toBe('subgrid');
    expect(getComputedStyle(card).gridRow).toBe('span 5'); expect(getComputedStyle(card).rowGap).toBe('16px');
    expect(getComputedStyle(facts).marginTop).toBe('0px'); expect(getComputedStyle(facts).marginBottom).toBe('0px');
    expect(getComputedStyle(action).marginTop).toBe('0px');
    expect(getComputedStyle(summary).overflow).toBe('visible');
    expect(getComputedStyle(summary).maxHeight).toBe('none');
  }
  // Every returned record retains its full content; visual alignment cannot be achieved by truncating descriptions.
  expect(cards).toHaveLength(5); expect(screen.getByText(longPurpose)).toBeVisible();
  expect(screen.getByRole('heading', { name: longTitle })).toBeVisible(); expect(screen.getByText(longOrganiser)).toBeVisible();
  expect(screen.getAllByText('Purpose not recorded')).toHaveLength(2);
  expect(screen.getByText(/Confirmed event details, venue bookings, technical arrangements and safety approvals stay unchanged/)).toBeVisible();
});

it.each([639, 640, 641])('Lead presentation AC2 - card grid and nested spacing respect the narrow-screen boundary at %s px', async width => {
  // Arrange / Act: just below, at and above the existing 640px design-system breakpoint.
  await open(); applyViewportRules(width);
  const grid = toggle('Planning').closest('.lead-assigned-stages');
  // Assert: narrow screens get one column and less indentation; desktop keeps the responsive multi-column grid.
  expect(getComputedStyle(grid).gridTemplateColumns).toBe(width <= 640 ? 'minmax(0, 1fr)' : 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))');
  expect(getComputedStyle(grid).paddingLeft).toBe(width <= 640 ? '8px' : '16px');
});
