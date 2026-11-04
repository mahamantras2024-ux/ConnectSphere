import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { RegistrationDetails } from '../../frontend/src/pages/events/CoordinatorRegistrations';
import { api } from '../../frontend/src/api/client';
vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn() } }));
let style;
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); style?.remove(); style = null; });
/** Explicit server snapshots keep HTTP external while the real polling hook and report remain under test. */
function report(headcount = 1, remaining = 1) {
  return { event: { name: 'Forum' }, headcount, remaining_spots: remaining, venue_capacity: 2,
    waitlist_count: 1, withdrawal_count: 1, overflow_count: 0, overflow: [],
    registered: [{ id: 1, attendee_name: 'Ari', status: 'registered' }],
    waitlist: [{ id: 2, attendee_name: 'Bea', status: 'waitlisted', registered_at: '2030-01-01T00:00:00Z' }],
    attendees: [{ id: 1, attendee_name: 'Ari', status: 'registered' }, { id: 2, attendee_name: 'Bea', status: 'waitlisted' }, { id: 3, attendee_name: 'Chen', status: 'withdrawn' }] };
}

it('Registration AC2 - separates metrics, capacity, attendee statuses, FIFO queue and overflow with borders', async () => {
  // Arrange / Act: render actual section styles so a missing divider is an observable regression.
  style = document.createElement('style'); style.textContent = readFileSync('src/pages/events/CoordinatorRegistrations.css', 'utf8'); document.head.append(style);
  const data = report();
  data.waitlist.push({ id: 4, attendee_name: 'Devi', registered_at: '2030-01-01T00:00:00Z' });
  data.attendees.push({ id: 4, attendee_name: 'Devi', status: 'waitlisted' });
  data.waitlist_count = 2;
  api.get.mockResolvedValue(data); render(<RegistrationDetails eventId={3} token="session" />);
  await screen.findByRole('heading', { name: 'Forum' });
  // Assert: each literal count and status catches a swapped metric or a table filtered to active attendees only.
  for (const [label, count] of [['Confirmed headcount', '1'], ['Waitlist', '2'], ['Withdrawals', '1']]) {
    expect(screen.getByText(label, { selector: 'dt' }).nextElementSibling).toHaveTextContent(count);
  }
  const table = screen.getByRole('table', { name: 'Attendees and registration statuses' });
  for (const name of ['Ari Registered', 'Bea Waitlisted', 'Chen Withdrawn', 'Devi Waitlisted']) expect(within(table).getByRole('row', { name })).toBeVisible();
  expect(screen.getByLabelText('Remaining spots')).toHaveTextContent('1');
  const queue = screen.getByRole('region', { name: 'Waitlist' });
  expect(within(queue).getAllByRole('listitem').map(row => row.textContent.split(' — ')[0])).toEqual(['Bea', 'Devi']);
  for (const name of ['Participation summary', 'Attendees and registration statuses', 'Waitlist', 'Exceeding capacity']) {
    expect(getComputedStyle(screen.getByRole('region', { name })).borderTopWidth).toBe('1px');
  }
});

it('Registration AC2 - live registration and withdrawal refresh counts and places without changing venue capacity', async () => {
  // Arrange: explicit snapshots model registration, then withdrawal with FIFO promotion, then a free place.
  vi.useFakeTimers();
  const initial = report();
  const full = { ...report(2, 0), registered: [...initial.registered, { id: 4, attendee_name: 'Devi', status: 'registered' }],
    attendees: [...initial.attendees, { id: 4, attendee_name: 'Devi', status: 'registered' }] };
  const promoted = { ...report(2, 0), waitlist_count: 0, withdrawal_count: 2,
    registered: [{ id: 2, attendee_name: 'Bea', status: 'registered' }, { id: 4, attendee_name: 'Devi', status: 'registered' }],
    waitlist: [], attendees: [{ id: 1, attendee_name: 'Ari', status: 'withdrawn' }, { id: 2, attendee_name: 'Bea', status: 'registered' },
      { id: 3, attendee_name: 'Chen', status: 'withdrawn' }, { id: 4, attendee_name: 'Devi', status: 'registered' }] };
  const freed = { ...promoted, headcount: 1, remaining_spots: 1, withdrawal_count: 3,
    registered: [promoted.registered[0]], attendees: promoted.attendees.map(row => row.id === 4 ? { ...row, status: 'withdrawn' } : row) };
  api.get.mockResolvedValueOnce(initial).mockResolvedValueOnce(full).mockResolvedValueOnce(promoted).mockResolvedValueOnce(freed);
  render(<RegistrationDetails eventId={3} token="session" />); await act(async () => {});
  // Act / Assert: real five-second polling must replace both counts and private rows, not only issue another read.
  await act(async () => { vi.advanceTimersByTime(5000); });
  expect(screen.getByLabelText('Remaining spots')).toHaveTextContent('0');
  expect(screen.getByText('Confirmed headcount').nextElementSibling).toHaveTextContent('2');
  await act(async () => { vi.advanceTimersByTime(5000); });
  expect(screen.getByRole('row', { name: 'Bea Registered' })).toBeVisible();
  expect(screen.getByRole('row', { name: 'Ari Withdrawn' })).toBeVisible();
  expect(screen.getByText('Waitlist', { selector: 'dt' }).nextElementSibling).toHaveTextContent('0');
  await act(async () => { vi.advanceTimersByTime(5000); });
  expect(screen.getByLabelText('Remaining spots')).toHaveTextContent('1');
  expect(screen.getByLabelText('Venue capacity')).toHaveTextContent('2');
});

it('Registration AC2 - transient refresh failure retains data but loss of access removes private identities', async () => {
  // Arrange: transport outages and revoked permissions have different privacy outcomes.
  vi.useFakeTimers(); api.get.mockResolvedValueOnce(report()).mockRejectedValueOnce(new Error('Offline'))
    .mockRejectedValueOnce(Object.assign(new Error('Access denied'), { status: 403 }));
  render(<RegistrationDetails eventId={3} token="session" />); await act(async () => {});
  await act(async () => { vi.advanceTimersByTime(5000); });
  expect(screen.getByRole('alert')).toHaveTextContent('Offline'); expect(screen.getByText('Chen')).toBeVisible();
  await act(async () => { vi.advanceTimersByTime(5000); });
  expect(screen.getByRole('alert')).toHaveTextContent('Access denied'); expect(screen.queryByText('Chen')).not.toBeInTheDocument();
});
