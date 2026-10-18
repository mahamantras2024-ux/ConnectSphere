import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../../frontend/src/context/AuthContext';
import AttendeeRegistration from '../../frontend/src/pages/registrations/AttendeeRegistration';
import AttendeeEventDetails from '../../frontend/src/pages/attendee/AttendeeEventDetails';
import { api } from '../../frontend/src/api/client';
vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const available = { registration: null, remaining: 1, capacity: 2, deadline: '2031-06-12T01:30:00Z', blocker: null };

/** Keeps the real session provider and component; only the HTTP boundary is simulated. */
function open(data = available) {
  localStorage.setItem('cs_token', 'attendee-session');
  api.get.mockImplementation(async path => path === '/auth/me' ? { user: { id: 8, role: 'attendee' } } : data);
  return render(<MemoryRouter><AuthProvider><AttendeeRegistration eventId="44" /></AuthProvider></MemoryRouter>);
}
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); });
afterEach(cleanup);

it('Register AC1 - confirms a persisted place and exposes the existing registration link', async () => {
  // Arrange: the API confirms the final free place; the browser must not manufacture success before the response.
  api.post.mockResolvedValue({ ...available, registration: { id: 7, status: 'registered' }, remaining: 0, message: 'Registration confirmed. Your spot is secured.' });
  open();
  // Act
  fireEvent.click(await screen.findByRole('button', { name: 'Register for event' }));
  // Assert: both status and confirmation are user-visible and the request carries no attendee identity.
  expect(await screen.findByText('Registered')).toBeInTheDocument();
  expect(screen.getByText('Registration confirmed. Your spot is secured.')).toBeInTheDocument();
  expect(api.post).toHaveBeenCalledWith('/registrations/events/44', { joinWaitlist: false }, 'attendee-session');
  expect(screen.getByRole('link', { name: 'View my registrations' })).toHaveAttribute('href', '/registrations');
});
it('Register AC2 - a full event offers an explicit waitlist choice and displays its persisted position', async () => {
  // Arrange
  api.post.mockResolvedValue({ ...available, registration: { status: 'waitlisted' }, waitlistPosition: 3, message: 'You have joined the waitlist.' });
  open({ ...available, remaining: 0 });
  // Act
  fireEvent.click(await screen.findByRole('button', { name: 'Join waitlist' }));
  // Assert: the position is provided by the queue, not guessed from capacity.
  expect(await screen.findByText('Waitlisted')).toBeInTheDocument();
  expect(screen.getByText('Waitlist position: 3')).toBeInTheDocument();
  expect(api.post).toHaveBeenCalledWith('/registrations/events/44', { joinWaitlist: true }, 'attendee-session');
});
it('Register AC2 - losing the last-seat race shows the full response and allows a separate waitlist opt-in', async () => {
  api.post.mockRejectedValue(Object.assign(new Error('This event is full.'), { details: { full: true } }));
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Register for event' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('This event is full.');
  expect(screen.getByRole('button', { name: 'Join waitlist' })).toBeEnabled();
  expect(api.post).toHaveBeenCalledTimes(1);
});
it('Register AC3 - closed registration displays the Singapore deadline without offering a write', async () => {
  open({ ...available, blocker: 'Registration closed.' });
  expect(await screen.findByText('Registration closed.')).toBeInTheDocument();
  expect(screen.getByText(/Registration deadline:/)).toHaveTextContent('12 Jun 2031');
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();
});
it.each(['registered', 'waitlisted'])('Register AC4 - existing %s record is shown without a duplicate action', async status => {
  open({ ...available, registration: { status }, waitlistPosition: 1 });
  expect(await screen.findByText(status === 'registered' ? 'Registered' : 'Waitlisted')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('Register AC1 - a failed write keeps the form retryable and never claims confirmation', async () => {
  api.post.mockRejectedValue(new Error('Registration unavailable'));
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Register for event' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Registration unavailable');
  expect(screen.getByRole('button', { name: 'Register for event' })).toBeEnabled();
  expect(screen.queryByText('Registered')).not.toBeInTheDocument();
});
it.each([true, false])('Register AC1/AC5 - event details offer registration only when registration_required is %s', async required => {
  // Arrange: real event-detail composition must honor the explicit event flag, not just a button's local state.
  localStorage.setItem('cs_token', 'attendee-session');
  api.get.mockImplementation(async path => {
    if (path === '/auth/me') return { user: { id: 8, role: 'attendee' } };
    if (path === '/events/published/44') return { event: { id: 44, name: 'Arts Day', status: 'confirmed', registration_required: required } };
    if (path === '/registrations/events/44') return available;
    throw new Error(`Unexpected request: ${path}`);
  });
  // Act
  render(<MemoryRouter initialEntries={['/event/44']}><AuthProvider><Routes><Route path="/event/:id" element={<AttendeeEventDetails />} /></Routes></AuthProvider></MemoryRouter>);
  // Assert: disabling registration removes the whole action panel and its API fetch.
  expect(await screen.findByRole('heading', { name: 'Arts Day' })).toBeInTheDocument();
  if (required) expect(await screen.findByRole('button', { name: 'Register for event' })).toBeInTheDocument();
  else {
    expect(screen.queryByRole('heading', { name: 'Your registration' })).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith('/registrations/events/44', 'attendee-session');
  }
});
it('Register AC1 - loading and write-in-progress states prevent submitting before the server responds', async () => {
  // Arrange: deferred HTTP promises make loading and duplicate-click prevention deterministic.
  let resolveRead, resolveWrite;
  api.get.mockReturnValue(new Promise(resolve => { resolveRead = resolve; }));
  const view = render(<MemoryRouter><AuthProvider><AttendeeRegistration eventId="44" /></AuthProvider></MemoryRouter>);
  expect(screen.getByRole('status')).toHaveTextContent('Loading registration');
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  await act(async () => resolveRead(available));
  api.post.mockReturnValue(new Promise(resolve => { resolveWrite = resolve; }));
  // Act
  fireEvent.click(screen.getByRole('button', { name: 'Register for event' }));
  // Assert
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  await act(async () => resolveWrite({ ...available, registration: { status: 'registered' }, message: 'Confirmed' }));
  expect(screen.getByText('Registered')).toBeInTheDocument();
  view.unmount();
});
it('Register AC1 - a failed initial read shows an error and offers no unverified registration action', async () => {
  api.get.mockRejectedValue(new Error('Registration details unavailable'));
  render(<MemoryRouter><AuthProvider><AttendeeRegistration eventId="44" /></AuthProvider></MemoryRouter>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Registration details unavailable');
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('Register AC4 - a previously withdrawn attendee can submit a new registration', async () => {
  open({ ...available, deadline: null, registration: { status: 'withdrawn' } });
  expect(await screen.findByText('Withdrawn')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Register for event' })).toBeEnabled();
});
it('Register AC4 - an unrecognised stored status is not presented as a confirmed place', async () => {
  // Arrange: legacy or incompatible data must not be guessed to mean Registered.
  open({ ...available, registration: { status: 'pending' } });
  expect(await screen.findByText('Status unavailable')).toBeInTheDocument();
  expect(screen.queryByText('Registered')).not.toBeInTheDocument();
});
