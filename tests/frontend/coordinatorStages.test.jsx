// Approved stage-group AC7: retain real card/assignment state while the HTTP boundary supplies live snapshots.
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CoordinatorEventCards from '../../frontend/src/pages/coordinator/CoordinatorEventCards';
vi.mock('../../frontend/src/api/client', () => ({ api: { put: vi.fn() } }));
afterEach(cleanup);
const props = { token: 'session', staff: [{ id: 8, full_name: 'Tom' }], onSaved: vi.fn(), returnTo: '/coordinator', grouped: true };
/** A real router preserves the card links while rerendering simulates the existing polling boundary. */
function cards(events) { return <MemoryRouter><CoordinatorEventCards {...props} events={events} /></MemoryRouter>; }

it('Dashboard AC7 - preserves the flat ordinary event list and its legacy missing-value fallbacks', () => {
  // Arrange / Act: grouping belongs to the dashboard; another event-list entry point keeps its existing presentation.
  render(<MemoryRouter><CoordinatorEventCards events={[{ id: 5 }]} returnTo="/events" /></MemoryRouter>);
  // Assert: missing legacy fields remain readable and no status disclosure is introduced outside the dashboard.
  expect(screen.getByRole('heading', { name: 'Untitled Event' })).toBeVisible();
  expect(screen.getByText('Draft')).toBeVisible();
  expect(screen.getByText('No purpose provided')).toBeVisible();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: /View details/ })).toHaveAttribute('href', '/events/5');
});

it('Dashboard AC7 - groups every stage in process order with terminal stages initially collapsed', () => {
  // Arrange: reverse the input so API order cannot accidentally satisfy the stage order.
  const statuses = ['submitted', 'under_review', 'approved', 'planning', 'confirmed', 'completed', 'rejected', 'cancelled', 'draft', 'legacy'];
  render(cards(statuses.map((status, id) => ({ id, name: `Event ${status}`, status })).reverse()));
  // Assert: counts and heading order follow the agreed workflow; empty stages are omitted.
  expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual([
    'Submitted (1)', 'Under review (1)', 'Approved (1)', 'Planning (1)', 'Confirmed (1)', 'Completed (1)', 'Rejected (1)', 'Cancelled (1)', 'Draft (1)', 'Other (1)']);
  for (const status of ['completed', 'rejected', 'cancelled']) expect(screen.getByText(`Event ${status}`)).not.toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Completed (1)' }));
  expect(screen.getByText('Event completed')).toBeVisible();
  expect(screen.getByText('Event rejected')).not.toBeVisible();
});

it('Dashboard AC7 - moves a live card between stages without losing its unsaved assignment or disclosure choices', () => {
  // Arrange: editing starts in Planning while Confirmed is deliberately collapsed.
  const event = { id: 3, name: 'Forum', status: 'planning', technical_support_required: true, technical_support_staff: [] };
  const other = { id: 4, name: 'Other', status: 'confirmed' };
  const view = render(cards([event, other]));
  const originalCard = screen.getByRole('heading', { name: 'Forum' }).closest('article');
  fireEvent.click(within(originalCard).getByRole('checkbox', { name: 'Tom' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmed (1)' }));
  // Act: the background snapshot has not saved the local checkbox choice.
  view.rerender(cards([{ ...event, status: 'confirmed' }, other]));
  expect(screen.queryByRole('button', { name: 'Planning (1)' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Confirmed (2)' })).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(screen.getByRole('button', { name: 'Confirmed (2)' }));
  // Assert: an updated persisted snapshot must not overwrite the coordinator's unsaved assignment during a move.
  const movedCard = screen.getByRole('heading', { name: 'Forum' }).closest('article');
  expect(within(movedCard).getByRole('checkbox', { name: 'Tom' })).toBeChecked();
  expect(within(movedCard).getByRole('button', { name: 'Assign staff' })).toBeEnabled();
});
