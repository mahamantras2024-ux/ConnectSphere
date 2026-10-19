import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../../frontend/src/context/AuthContext';
import MyRegistrations from '../../frontend/src/pages/registrations/MyRegistrations';
import AttendeeEventDetails from '../../frontend/src/pages/attendee/AttendeeEventDetails';
import { api } from '../../frontend/src/api/client';
vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const record = { id: 7, event_id: 44, event_name: 'Arts Day', proposed_date: '2031-06-12', proposed_start_time: '09:30',
  status: 'waitlisted', event_status: 'confirmed', withdrawal_deadline: '2031-06-12T01:30:00Z' };
let records;

/** Uses the real session, list, drawer and withdrawal composition with HTTP as the only external boundary. */
function open() {
  localStorage.setItem('cs_token', 'attendee-session');
  return render(<MemoryRouter><AuthProvider><MyRegistrations /></AuthProvider></MemoryRouter>);
}
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date('2031-06-01T00:00:00Z'));
  records = [record];
  api.get.mockImplementation(async path => path === '/auth/me' ? { user: { id: 8, role: 'attendee' } } : { registrations: records });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('Status AC1 - each registration displays its event name, date and correct status', async () => {
  // Arrange: cancellation affects active places; an attendee who already withdrew retains Withdrawn.
  records = [
    { ...record, id: 1, event_name: 'Registered event', status: 'registered' },
    { ...record, id: 2, event_name: 'Waitlisted event', proposed_date: '2031-06-13' },
    { ...record, id: 3, event_name: 'Withdrawn event', proposed_date: '2031-06-14', status: 'withdrawn', event_status: 'cancelled' },
    { ...record, id: 4, event_name: 'Cancelled event', proposed_date: '2031-06-15', status: 'registered', event_status: 'cancelled' },
  ];
  open(); await screen.findByRole('heading', { name: 'Registered event' });
  // Assert: each label belongs to the correct card, rather than merely existing elsewhere on the page.
  for (const [name, status, date] of [['Registered event', 'Registered', '2031-06-12'], ['Waitlisted event', 'Waitlisted', '2031-06-13'],
    ['Withdrawn event', 'Withdrawn', '2031-06-14'], ['Cancelled event', 'Cancelled by organiser', '2031-06-15']]) {
    const card = screen.getByRole('heading', { name }).closest('article');
    expect(within(card).getByText(status)).toBeInTheDocument();
    expect(within(card).getByText(new RegExp(date))).toBeInTheDocument();
  }
});
it('Status AC2 - promotion updates both the card and an already open drawer within ten seconds', async () => {
  open(); fireEvent.click(await screen.findByRole('button', { name: /View registration/ }));
  expect(screen.getAllByText('Waitlisted')).toHaveLength(2);
  // Act: the server changes after the initial read, without navigation or a user-triggered reload.
  records = [{ ...record, status: 'registered' }];
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  // Assert: a stale selected-record copy would leave the drawer Waitlisted and fail this assertion.
  expect(screen.getAllByText('Registered')).toHaveLength(2);
  expect(screen.queryByText('Waitlisted')).not.toBeInTheDocument();
});
it('Status AC2 - organiser cancellation replaces an active registration label on the next refresh', async () => {
  records = [{ ...record, status: 'registered' }]; open(); await screen.findByText('Registered');
  records = [{ ...record, status: 'registered', event_status: 'cancelled' }];
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.getByText('Cancelled by organiser')).toBeInTheDocument();
  expect(screen.queryByText('Registered')).not.toBeInTheDocument();
});
it('Status AC2 - a refresh failure keeps the last loaded registration and recovers on retry', async () => {
  open(); await screen.findByText('Waitlisted');
  api.get.mockRejectedValueOnce(new Error('Status refresh unavailable'));
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.getByRole('alert')).toHaveTextContent('Status refresh unavailable');
  expect(screen.getByText('Waitlisted')).toBeInTheDocument();
  records = [{ ...record, status: 'registered' }];
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.getByText('Registered')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('Status AC2 - returning to the window refreshes immediately and unmounting stops polling', async () => {
  const view = open(); await screen.findByText('Waitlisted');
  records = [{ ...record, status: 'registered' }];
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(screen.getByText('Registered')).toBeInTheDocument();
  view.unmount(); const count = api.get.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); window.dispatchEvent(new Event('focus')); });
  expect(api.get).toHaveBeenCalledTimes(count);
});
it('Status AC1/AC2 - event details and registration status both refresh when the organiser cancels', async () => {
  let cancelled = false;
  localStorage.setItem('cs_token', 'attendee-session');
  api.get.mockImplementation(async path => {
    if (path === '/auth/me') return { user: { id: 8, role: 'attendee' } };
    if (path === '/events/published/44') return { event: { id: 44, name: 'Arts Day', status: cancelled ? 'cancelled' : 'confirmed', registration_required: true } };
    return { registration: { id: 7, status: 'waitlisted' }, waitlistPosition: 1, event_status: cancelled ? 'cancelled' : 'confirmed' };
  });
  render(<MemoryRouter initialEntries={['/event/44']}><AuthProvider><Routes><Route path="/event/:id" element={<AttendeeEventDetails />} /></Routes></AuthProvider></MemoryRouter>);
  expect(await screen.findByText('Waitlisted')).toBeInTheDocument();
  cancelled = true;
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.getByText('Cancelled')).toBeInTheDocument();
  expect(screen.getByText('Cancelled by organiser')).toBeInTheDocument();
  expect(screen.queryByText(/Waitlist position:/)).not.toBeInTheDocument();
});
it('Status AC2 - event and registration refresh failures retain labelled snapshots and recover', async () => {
  let offline = false;
  localStorage.setItem('cs_token', 'attendee-session');
  api.get.mockImplementation(async path => {
    if (path === '/auth/me') return { user: { id: 8, role: 'attendee' } };
    if (offline) throw new Error('Refresh unavailable');
    if (path === '/events/published/44') return { event: { id: 44, name: 'Arts Day', status: 'confirmed', registration_required: true } };
    return { registration: { id: 7, status: 'registered' }, event_status: 'confirmed' };
  });
  render(<MemoryRouter initialEntries={['/event/44']}><AuthProvider><Routes><Route path="/event/:id" element={<AttendeeEventDetails />} /></Routes></AuthProvider></MemoryRouter>);
  await screen.findByText('Registered'); offline = true;
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.getByText('Registered')).toBeInTheDocument();
  expect(screen.getAllByRole('alert')).toHaveLength(2);
  expect(screen.getByText(/last loaded registration information/)).toBeInTheDocument();
  offline = false;
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
