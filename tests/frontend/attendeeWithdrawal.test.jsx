import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../frontend/src/context/AuthContext';
import WithdrawRegistrationAction from '../../frontend/src/pages/registrations/WithdrawRegistrationAction';
import MyRegistrations from '../../frontend/src/pages/registrations/MyRegistrations';
import { api } from '../../frontend/src/api/client';
vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const registration = { id: 7, event_id: 44, event_name: 'Arts Day', status: 'registered', event_status: 'confirmed',
  proposed_date: '2031-06-12', proposed_start_time: '09:30', withdrawal_deadline: '2031-06-12T01:30:00.000Z' };

/** Uses the actual session provider; only the HTTP boundary is replaced. */
function open(record = registration, onWithdrawn = vi.fn()) {
  localStorage.setItem('cs_token', 'attendee-session');
  return render(<MemoryRouter><AuthProvider><WithdrawRegistrationAction registration={record} onWithdrawn={onWithdrawn} /></AuthProvider></MemoryRouter>);
}
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  // Freeze Date only: UI promise/timer behavior remains real and tests do not age with the calendar.
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2031-06-01T00:00:00Z'));
  api.get.mockResolvedValue({ user: { id: 8, role: 'attendee' } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('Withdraw AC1 - cancelling the confirmation leaves registration untouched', async () => {
  // Arrange/Act
  open(); fireEvent.click(screen.getByRole('button', { name: 'Withdraw registration' }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
  // Assert: merely opening the dialogue cannot free a place.
  expect(api.post).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('Withdraw AC1 - confirming shows the persisted Withdrawn result and sends no attendee identity', async () => {
  const onWithdrawn = vi.fn();
  api.post.mockResolvedValue({ registration: { id: 7, status: 'withdrawn' }, message: 'Your registration is now Withdrawn.' });
  open(registration, onWithdrawn);
  fireEvent.click(screen.getByRole('button', { name: 'Withdraw registration' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm', exact: true }));
  expect(await screen.findByRole('status')).toHaveTextContent('Your registration is now Withdrawn.');
  expect(api.post).toHaveBeenCalledWith('/registrations/events/44/withdraw', {}, 'attendee-session');
  expect(onWithdrawn).toHaveBeenCalledWith({ id: 7, status: 'withdrawn' });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('Withdraw AC1/AC2 - a waitlisted attendee explicitly leaves the waitlist using the same protected endpoint', async () => {
  api.post.mockResolvedValue({ registration: { id: 7, status: 'withdrawn' }, message: 'Your registration is now Withdrawn.' });
  open({ ...registration, status: 'waitlisted' });
  fireEvent.click(screen.getByRole('button', { name: 'Leave waitlist' }));
  expect(screen.getByText('Are you sure you want to leave the waitlist?')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm', exact: true }));
  expect(await screen.findByRole('status')).toHaveTextContent('Withdrawn');
});
for (const offset of [-1, 0, 1]) {
  it(`Withdraw AC3 - deadline ${offset}ms ${offset < 0 ? 'offers' : 'blocks'} withdrawal with its cutoff displayed`, () => {
    vi.setSystemTime(new Date(Date.parse(registration.withdrawal_deadline) + offset));
    open();
    expect(screen.getByText(/Withdrawal deadline:/)).toHaveTextContent('12 Jun 2031');
    if (offset < 0) expect(screen.getByRole('button', { name: 'Withdraw registration' })).toBeEnabled();
    else {
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(screen.getByText('Withdrawal is no longer available for this event.')).toBeInTheDocument();
    }
  });
}
it.each(['cancelled', 'completed'])('Withdraw AC3 - a %s event never offers withdrawal', event_status => {
  open({ ...registration, event_status }); expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it.each([null, 'invalid'])('Withdraw AC3 - absent or invalid deadline %s cannot enable a withdrawal', withdrawal_deadline => {
  open({ ...registration, withdrawal_deadline }); expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('Withdraw AC1 - an already withdrawn registration has no repeated action', () => {
  open({ ...registration, status: 'withdrawn' }); expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('Withdraw AC3 - a deadline reached while the dialog is open is explained by the server and preserves the record', async () => {
  const onWithdrawn = vi.fn();
  api.post.mockRejectedValue(new Error('Withdrawal is no longer available. Withdrawal deadline: 12 Jun 2031, 9:30 am.'));
  open(registration, onWithdrawn); fireEvent.click(screen.getByRole('button', { name: 'Withdraw registration' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm', exact: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Withdrawal deadline: 12 Jun 2031');
  expect(onWithdrawn).not.toHaveBeenCalled();
});
it('Withdraw AC1 - an in-flight request disables duplicate submission until the persisted result arrives', async () => {
  let finish;
  api.post.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  open(); fireEvent.click(screen.getByRole('button', { name: 'Withdraw registration' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm', exact: true }));
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  await act(async () => finish({ registration: { id: 7, status: 'withdrawn' }, message: 'Withdrawn' }));
  expect(screen.getByRole('status')).toHaveTextContent('Withdrawn'); expect(api.post).toHaveBeenCalledTimes(1);
});
it('Withdraw AC1 - My Registrations updates the matching card and drawer immediately after withdrawal', async () => {
  // Arrange: a second card proves that the callback cannot change unrelated registration records.
  localStorage.setItem('cs_token', 'attendee-session');
  api.get.mockImplementation(async path => path === '/auth/me' ? { user: { id: 8, role: 'attendee' } }
    : { registrations: [registration, { ...registration, id: 8, event_id: 45, event_name: 'Another Event' }] });
  api.post.mockResolvedValue({ registration: { id: 7, status: 'withdrawn' }, message: 'Your registration is now Withdrawn.' });
  render(<MemoryRouter><AuthProvider><MyRegistrations /></AuthProvider></MemoryRouter>);
  // Act: use the actual drawer and nested confirmation composition.
  fireEvent.click((await screen.findAllByRole('button', { name: /View registration/ }))[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Withdraw registration' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm', exact: true }));
  // Assert: persisted status updates both views, while the second event remains registered.
  expect(await screen.findAllByText('Withdrawn')).toHaveLength(2);
  expect(screen.getByText('Registered')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.queryByRole('button', { name: 'Withdraw registration' })).not.toBeInTheDocument();
});
