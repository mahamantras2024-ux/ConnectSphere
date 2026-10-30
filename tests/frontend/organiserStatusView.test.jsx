// SCRUM-93: the real status component and live-resource hook, replacing only authenticated HTTP/session boundaries.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import EventRequestStatus from '../../frontend/src/pages/events/EventRequestStatus';
import { api } from '../../frontend/src/api/client';
import { notificationTarget } from '../../frontend/src/notifications/notificationTarget';
vi.mock('../../frontend/src/context/AuthContext', () => ({ useAuth: () => ({ token: 'session' }) }));
vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn() } }));
const baseEvent = { id: 101, name: 'Workshop', status: 'submitted', can_manage: true, clarification_outstanding: false };
/** Opens the production status route; eventId props exercise the embedded owner-detail view. */
function open(props = {}) {
  return render(<MemoryRouter initialEntries={['/organizer/events/101/status']}><Routes><Route path="/organizer/events/:id/status" element={<EventRequestStatus {...props} />} /></Routes></MemoryRouter>);
}
beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('SCRUM-93 AC1/AC3 - colleague sees required submitter action without edit or response controls', async () => {
  api.get.mockResolvedValue({ event: { ...baseEvent, can_manage: false, clarification_outstanding: true } });
  open();
  expect(await screen.findByText(/The submitting organiser must respond/)).toBeVisible();
  expect(screen.queryByRole('link', { name: 'View details and respond' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Back to event requests' })).toHaveAttribute('href', '/organizer/events');
});
it('SCRUM-93 AC3 - submitter receives a response link when clarification is outstanding', async () => {
  api.get.mockResolvedValue({ event: { ...baseEvent, clarification_outstanding: true } });
  open();
  expect(await screen.findByText(/Please respond to the Coordinator/)).toBeVisible();
  expect(screen.getByRole('link', { name: 'View details and respond' })).toHaveAttribute('href', '/organizer/events/101');
});
for (const [status, decidedAt, reason, expected] of [
  ['approved', null, null, 'Initial request outcome: Approved.'],
  ['planning', '2030-01-01', null, 'Initial request outcome: Approved.'],
  ['rejected', '2030-01-01', 'No safe venue', 'Rejection reason: No safe venue'],
  ['rejected', '2030-01-01', null, 'Rejection reason: No reason was provided.'],
]) {
  it(`SCRUM-93 AC4 - ${status} retains its initial decision with reason ${reason}`, async () => {
    api.get.mockResolvedValue({ event: { ...baseEvent, status, decided_at: decidedAt, decision_reason: reason } });
    open();
    expect(await screen.findByText(text => text.includes(expected))).toBeVisible();
  });
}
it('SCRUM-93 AC5 - latest status and clarification clear by 10000ms and stay current at 10001ms', async () => {
  vi.useFakeTimers();
  let event = { ...baseEvent, clarification_outstanding: true };
  api.get.mockImplementation(async () => ({ event }));
  open(); await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(5001); });
  // A change immediately after a poll is the worst healthy polling interval, not a lucky immediate fetch.
  event = { ...baseEvent, status: 'planning' };
  await act(async () => { await vi.advanceTimersByTimeAsync(4998); });
  expect(screen.getByText('Submitted', { selector: 'strong' })).toBeVisible();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(screen.getByText('Planning', { selector: 'strong' })).toBeVisible();
  expect(screen.queryByText(/Action required/)).not.toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(screen.getByText('Planning', { selector: 'strong' })).toBeVisible();
});
it('SCRUM-93 AC5 - a stalled poll is retried and its late snapshot cannot undo the new status', async () => {
  vi.useFakeTimers(); let finish;
  api.get.mockResolvedValueOnce({ event: baseEvent }).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue({ event: { ...baseEvent, status: 'confirmed' } });
  open(); await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
  expect(screen.getByText('Confirmed', { selector: 'strong' })).toBeVisible();
  await act(async () => { finish({ event: baseEvent }); });
  expect(screen.getByText('Confirmed', { selector: 'strong' })).toBeVisible();
});
it('SCRUM-93 AC5/AC6 - transient errors retain status but revoked access clears private data', async () => {
  api.get.mockResolvedValueOnce({ event: baseEvent }).mockRejectedValueOnce(new Error('Offline'))
    .mockRejectedValue(Object.assign(new Error('Event not found.'), { status: 404 }));
  open(); await screen.findByText('Submitted', { selector: 'strong' });
  fireEvent(window, new Event('focus'));
  expect(await screen.findByText(/Offline/)).toBeVisible();
  expect(screen.getByText('Workshop')).toBeVisible();
  fireEvent(window, new Event('focus'));
  await screen.findByText(/Event not found/);
  expect(screen.queryByText('Workshop')).not.toBeInTheDocument();
});
it('SCRUM-93 AC5 - embedded status snapshots update owner lifecycle facts without navigation controls', async () => {
  const onSnapshot = vi.fn();
  api.get.mockResolvedValue({ event: baseEvent });
  open({ eventId: 101, onSnapshot });
  await screen.findByText('Submitted', { selector: 'strong' });
  expect(onSnapshot).toHaveBeenCalledWith(baseEvent);
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
it('SCRUM-93 AC5/AC6 - organisation status notices open the read-only status route', () => {
  expect(notificationTarget({ type: 'event_request_status_changed', event_id: 101 }, 'event_organiser')).toBe('/organizer/events/101/status');
  expect(notificationTarget({ type: 'event_request_status_changed', event_id: 101 }, 'event_coordinator')).toBe('/events/101');
  expect(notificationTarget({ type: 'event_request_status_changed', event_id: null }, 'event_organiser')).toBe('/organizer/dashboard');
});
