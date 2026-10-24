import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import OrganiserVenueDetails from '../../frontend/src/pages/events/OrganiserVenueDetails';
import { api } from '../../frontend/src/api/client';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn() } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const booking = { id: 1, venue_name: 'North Hall', address: '12 North Road', capacity: 120,
  start_datetime: '2030-04-04T16:30:00Z', end_datetime: '2030-04-04T18:30:00Z', status: 'approved',
  updated_at: '2030-04-01T10:00:00Z' };

// An invalid API response cannot establish the AC4 empty state.
it('SCRUM-104 AC1 AC4 - reports malformed booking data as a load error', async () => {
  // Arrange / Act
  api.get.mockResolvedValue({});
  render(<OrganiserVenueDetails eventId={44} token="token" />);
  // Assert
  expect(await screen.findByRole('alert')).toHaveTextContent('Venue arrangements are unavailable.');
  expect(screen.queryByText('No Venue Selected')).not.toBeInTheDocument();
});

// The clarified requirement permits only the latest approval even when historical approvals remain stored.
it.each([0, 1, 2, 3])('SCRUM-104 AC1 AC3 AC4 clarification - shows only the latest of %i approved arrangements', async count => {
  // Arrange: IDs decrease as approval times increase; all bookings share a scheduled date.
  api.get.mockResolvedValue({ bookings: Array.from({ length: count }, (_, i) => ({ ...booking,
    id: 10 - i, venue_name: `Hall ${i}`, updated_at: `2030-04-0${i + 1}T10:00:00Z` })) });
  // Act
  render(<OrganiserVenueDetails eventId={44} token="token" />);
  // Assert: capacity is the venue capacity; dates cross midnight in Singapore.
  if (!count) expect(await screen.findByText('No Venue Selected')).toBeInTheDocument();
  else {
    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(1);
    for (const item of items) {
      for (const text of [`Hall ${count - 1}`, '12 North Road', '120', '5 Apr 2030', '00:30 – 02:30 (SGT)', 'Confirmed']) {
        expect(within(item).getByText(text)).toBeInTheDocument();
      }
    }
    expect(screen.queryByText('No Venue Selected')).not.toBeInTheDocument();
  }
  expect(api.get).toHaveBeenCalledWith('/events/44/organiser-venue-bookings', 'token');
});

// Historical rejections and cancellations do not count as current venue arrangements.
it.each(['rejected', 'cancelled'])(
  'SCRUM-104 AC3 AC4 clarification - hides a %s request when no venue is confirmed', async status => {
    // Arrange / Act
    api.get.mockResolvedValue({ bookings: [{ ...booking, status }] });
    render(<OrganiserVenueDetails eventId={44} token="token" />);
    // Assert: a request alone does not establish a selected confirmed venue.
    expect(await screen.findByText('No Venue Selected')).toBeInTheDocument();
    expect(screen.queryByText('North Hall')).not.toBeInTheDocument();
  });

// Pending requests remain visible without displacing the single confirmed arrangement.
it('SCRUM-104 AC1 AC2 AC3 - displays pending requests alongside the latest tied approval', async () => {
  // Arrange: equal approval timestamps use the greater booking ID; pending has the newest update of all.
  api.get.mockResolvedValue({ bookings: [
    booking, { ...booking, id: 2, venue_name: 'Latest confirmed hall' },
    { ...booking, id: 3, venue_name: 'Pending hall', status: 'pending', updated_at: '2030-04-03T10:00:00Z' },
  ] });
  // Act
  render(<OrganiserVenueDetails eventId={44} token="token" />);
  // Assert: choosing a pending request as the confirmation or hiding it entirely both fail.
  expect(await screen.findByText('Latest confirmed hall')).toBeInTheDocument();
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  expect(screen.queryByText('North Hall')).not.toBeInTheDocument();
  const pending = screen.getByRole('heading', { name: 'Pending hall' }).closest('li');
  expect(within(pending).getByText('Pending Confirmation')).toBeInTheDocument();
  expect(screen.getAllByText('Confirmed')).toHaveLength(1);
});

// AC2 applies even before any venue has been approved; every pending booking needs its own details.
it.each([1, 2])('SCRUM-104 AC1 AC2 AC4 - displays %i pending arrangements without a confirmed venue', async count => {
  // Arrange: distinct addresses and capacities detect accidental reuse of another request's details.
  api.get.mockResolvedValue({ bookings: Array.from({ length: count }, (_, index) => ({ ...booking,
    id: index + 1, status: 'pending', venue_name: `Pending hall ${index + 1}`,
    address: `${index + 1} Pending Road`, capacity: 100 + index })) });
  // Act
  render(<OrganiserVenueDetails eventId={44} token="token" />);
  // Assert: pending requests are selected arrangements, so neither the empty state nor Confirmed applies.
  const items = await screen.findAllByRole('listitem');
  expect(items).toHaveLength(count);
  items.forEach((item, index) => {
    for (const value of [`Pending hall ${index + 1}`, `${index + 1} Pending Road`, String(100 + index),
      '5 Apr 2030', '00:30 – 02:30 (SGT)', 'Pending Confirmation']) {
      expect(within(item).getByText(value)).toBeInTheDocument();
    }
  });
  expect(screen.queryByText('Confirmed')).not.toBeInTheDocument();
  expect(screen.queryByText('No Venue Selected')).not.toBeInTheDocument();
});

// Loading and denied requests must never masquerade as a successful empty result.
it('SCRUM-104 AC1 AC4 AC5 - shows loading then access denial without an empty state', async () => {
  // Arrange
  let reject;
  api.get.mockReturnValue(new Promise((_, rejectRequest) => { reject = rejectRequest; }));
  // Act / Assert
  render(<OrganiserVenueDetails eventId={44} token="token" />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading venue arrangements');
  expect(screen.queryByText('No Venue Selected')).not.toBeInTheDocument();
  reject(new Error('Access denied.'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Access denied.');
  expect(screen.queryByText('North Hall')).not.toBeInTheDocument();
  expect(screen.queryByText('No Venue Selected')).not.toBeInTheDocument();
});

// Changing events must clear the old result and ignore late successes or failures from the previous event.
it.each(['resolve', 'reject'])('SCRUM-104 AC1 AC5 - ignores a stale %s after event navigation', async outcome => {
  // Arrange
  let resolveOld, rejectOld;
  api.get.mockReturnValueOnce(new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; }))
    .mockResolvedValueOnce({ bookings: [] });
  const view = render(<OrganiserVenueDetails eventId={44} token="token" />);
  // Act: a later event responds before the first event does.
  view.rerender(<OrganiserVenueDetails eventId={45} token="token" />);
  await screen.findByText('No Venue Selected');
  await act(async () => {
    if (outcome === 'resolve') resolveOld({ bookings: [booking] });
    else rejectOld(new Error('Old request failed'));
  });
  // Assert: neither private details nor an unrelated error can replace the new event state.
  expect(screen.getByText('No Venue Selected')).toBeInTheDocument();
  expect(screen.queryByText('North Hall')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

// Both calendar dates are necessary when a booking crosses Singapore midnight.
it('SCRUM-104 AC1 - preserves both dates for an overnight arrangement', async () => {
  // Arrange / Act
  api.get.mockResolvedValue({ bookings: [{ ...booking, start_datetime: '2030-04-04T15:30:00Z' }] });
  render(<OrganiserVenueDetails eventId={44} token="token" />);
  // Assert: truncating to the starting date would hide the overnight booking.
  expect(await screen.findByText('4 Apr 2030 – 5 Apr 2030')).toBeInTheDocument();
});
