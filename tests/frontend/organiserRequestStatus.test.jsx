// SCRUM-93: render the real organiser list; only HTTP is replaced for draft actions.
import { act, cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import EventList from '../../frontend/src/pages/events/EventList';
import { api } from '../../frontend/src/api/client';
import OrganiserRequestList from '../../frontend/src/pages/events/OrganiserRequestList';
vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../../frontend/src/context/AuthContext', () => ({ useAuth: () => ({ token: 'session', user: { role: 'event_organiser' } }) }));
afterEach(() => { cleanup(); vi.useRealTimers(); });
for (const [status, label] of [['draft','Draft'],['submitted','Submitted'],['under_review','Under Review'],['approved','Approved'],['planning','Planning'],['confirmed','Confirmed'],['completed','Completed'],['cancelled','Cancelled'],['rejected','Rejected']]) {
  it(`SCRUM-93 AC1/AC2 - shows ${label} instead of an assignment-derived status`, () => {
    // Arrange / Act: assignment must not hide the actual lifecycle stage.
    render(<MemoryRouter><OrganiserRequestList events={[{ id: 1, name: 'Workshop', status, coordinator_id: 30 }]} token="session" onChange={vi.fn()} /></MemoryRouter>);
    expect(screen.getByText(label, { selector: '.status-badge' })).toBeVisible();
  });
}
it('SCRUM-93 AC1/AC6 - a colleague can view status but cannot submit or delete another organiser draft', () => {
  render(<MemoryRouter><OrganiserRequestList events={[{ id: 2, name: 'Colleague draft', status: 'draft', can_manage: false }]} token="session" onChange={vi.fn()} /></MemoryRouter>);
  expect(screen.getByRole('link', { name: 'View status' })).toHaveAttribute('href', '/organizer/events/2/status');
  expect(screen.queryByRole('button', { name: 'Submit draft' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Delete draft' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'View details' })).not.toBeInTheDocument();
});
it('SCRUM-93 AC3 - outstanding clarification explicitly identifies required organiser action', () => {
  render(<MemoryRouter><OrganiserRequestList events={[{ id: 1, name: 'Workshop', status: 'planning', clarification_outstanding: true }]} token="session" onChange={vi.fn()} /></MemoryRouter>);
  expect(screen.getByText(/Action required.*clarification/i)).toBeVisible();
});

it('SCRUM-93 AC5 - event list refreshes at the 10000ms deadline without a page reload', async () => {
  vi.useFakeTimers();
  let status = 'submitted'; api.get.mockImplementation(async () => ({ events: [{ id: 1, name: 'Workshop', status }] }));
  render(<MemoryRouter><EventList /></MemoryRouter>); await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(5001); }); status = 'under_review';
  await act(async () => { await vi.advanceTimersByTimeAsync(4998); });
  expect(screen.getByText('Submitted', { selector: '.status-badge' })).toBeVisible();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(screen.getByText('Under Review', { selector: '.status-badge' })).toBeVisible();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(screen.getByText('Under Review', { selector: '.status-badge' })).toBeVisible();
});
