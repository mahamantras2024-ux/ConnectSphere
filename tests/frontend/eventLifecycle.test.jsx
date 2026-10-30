// SCRUM-92: test lifecycle controls through the real decision component, mocking only HTTP and session boundaries.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import EventDecisionSection from '../../frontend/src/pages/events/EventDecisionSection';
import { api } from '../../frontend/src/api/client';
const session = vi.hoisted(() => ({ user: { id: 30, role: 'event_coordinator' }, token: 'session' }));
vi.mock('../../frontend/src/context/AuthContext', () => ({ useAuth: () => session }));
vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
let review;
const onDecided = vi.fn();
// Arrange a server response with a real stored status and its permitted manual action.
function open(status, transitions = [], coordinatorId = 30) {
  // Submitted and Under Review have no initial decision yet; later stages retain the recorded outcome.
  const outcome = ['submitted', 'under_review'].includes(status) ? null
    : { decision: status === 'rejected' ? 'rejected' : 'approved', decidedAt: '2030-01-01', decidedBy: 'Chris' };
  review = { status, outcome, readiness: [], transitions, allowed: { approved: !outcome, rejected: !outcome },
    blocked: { approved: outcome ? { message: 'Already decided.' } : null, rejected: outcome ? { message: 'Already decided.' } : null } };
  render(<EventDecisionSection event={{ id: 101, coordinator_id: coordinatorId }} onDecided={onDecided} />);
}
beforeEach(() => {
  session.user.role = 'event_coordinator';
  onDecided.mockReset();
  api.get.mockImplementation(async () => review);
});
afterEach(cleanup);
for (const [status, label] of [['submitted','Submitted'],['under_review','Under Review'],['approved','Approved'],['planning','Planning'],['confirmed','Confirmed'],['completed','Completed'],['cancelled','Cancelled'],['rejected','Rejected']]) {
  it(`SCRUM-92 AC1/AC2 - displays ${label} as the current status`, async () => {
    // Arrange / Act: load the recorded event; Assert: human-readable lifecycle label.
    open(status);
    expect(await screen.findByText(label, { selector: 'strong' })).toBeVisible();
  });
}
for (const [status, next, label] of [['submitted','under_review','Start review'],['approved','planning','Start planning'],['planning','confirmed','Confirm event'],['confirmed','completed','Mark completed']]) {
  it(`SCRUM-92 AC3/AC5/AC6/AC7/AC8 - ${label} saves and reloads the recorded status`, async () => {
    open(status, [{ status: next, blocked: null }]);
    api.post.mockImplementation(async () => { review = { ...review, status: next, transitions: [] }; return { event: { status: next }, message: 'Event status updated.' }; });
    // Act: use the explicit action. Assert: save target, parent update and fresh server read.
    fireEvent.click(await screen.findByRole('button', { name: label }));
    await waitFor(() => expect(onDecided).toHaveBeenCalledWith(next));
    expect(api.post).toHaveBeenCalledWith('/events/101/status', { status: next }, 'session');
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });
}
it('SCRUM-92 AC6 - confirmation is disabled with the server prerequisite explanation', async () => {
  open('planning', [{ status: 'confirmed', blocked: { code: 'VENUE_NOT_CONFIRMED', message: 'A venue is required.' } }, { status: 'completed', blocked: { code: 'INVALID_TRANSITION' } }]);
  expect(await screen.findByRole('button', { name: 'Confirm event' })).toBeDisabled();
  expect(screen.getByText('A venue is required.')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Mark completed' })).not.toBeInTheDocument();
});
it('SCRUM-92 AC8 - failed save reports the error without changing the recorded status', async () => {
  open('approved', [{ status: 'planning', blocked: null }]);
  api.post.mockRejectedValue(new Error('Status changed elsewhere.'));
  fireEvent.click(await screen.findByRole('button', { name: 'Start planning' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Status changed elsewhere.');
  expect(onDecided).not.toHaveBeenCalled();
  expect(screen.getByText('Approved', { selector: 'strong' })).toBeVisible();
});
it('SCRUM-92 AC9 - an organiser sees no status management controls', async () => {
  session.user.role = 'event_organiser';
  open('approved', [{ status: 'planning', blocked: null }]);
  await screen.findByText(/Approved by Chris/);
  expect(screen.queryByRole('button', { name: 'Start planning' })).not.toBeInTheDocument();
});

it('SCRUM-92 AC9 - a different coordinator sees no manual status actions', async () => {
  // Arrange a stale event view after reassignment; Act: load it; Assert: the new assignee alone may manage status.
  open('approved', [{ status: 'planning', blocked: null }], 31);
  await screen.findByText(/Approved by Chris/);
  expect(screen.queryByRole('button', { name: 'Start planning' })).not.toBeInTheDocument();
});
