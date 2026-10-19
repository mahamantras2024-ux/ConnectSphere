import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../../frontend/src/api/client';
import { AuthProvider } from '../../frontend/src/context/AuthContext';
import VenueBookingDecisions from '../../frontend/src/pages/events/VenueBookingDecisions';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn() } }));

const bookings = [
  { id: 10, event_id: 44, venue_id: 6, venue_name: 'Studio East', status: 'pending', decision_notes: null, updated_at: '2030-04-04T10:00:00Z' },
  { id: 9, event_id: 44, venue_id: 6, venue_name: 'Studio East', status: 'rejected', decision_notes: 'Capacity is too small.', updated_at: '2030-04-03T10:30:00Z' },
  { id: 8, event_id: 44, venue_id: 5, venue_name: 'Hall North', status: 'approved', decision_notes: null, updated_at: '2030-04-02T11:00:00Z' },
];

/** Keeps session behavior real while controlling only the remote API boundary. */
function openDecisionHistory() {
  localStorage.setItem('cs_token', 'test-token');
  return render(<MemoryRouter><AuthProvider><VenueBookingDecisions eventId="44" /></AuthProvider></MemoryRouter>);
}

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  api.get.mockImplementation(async path => path === '/auth/me'
    ? { user: { id: 12, role: 'event_coordinator' } }
    : { bookings });
});

afterEach(cleanup);

describe('View Venue Booking Decision', () => {
  it('SCRUM-61 AC2 AC4 AC6 - displays saved requirements, periods and both cancellation preferences', async () => {
    // Arrange: historical rows receive migration defaults; newly submitted rows retain explicit requirements.
    api.get.mockImplementation(async path => path === '/auth/me'
      ? { user: { id: 12, role: 'event_coordinator' } }
      : { bookings: [
        { ...bookings[0], start_datetime: '2030-04-04T02:00:00Z', end_datetime: '2030-04-04T03:00:00Z',
          cancel_other_pending: true, requirements: { capacity: 40, layout: 'Theatre', accessibility: ['Ramp'], requiredFacilities: ['Projector'] } },
        { ...bookings[2], requirements: { capacity: null, layout: '', accessibility: [], requiredFacilities: [] } },
      ] });
    // Act / Assert: verify persisted values in their own request, rather than event defaults.
    openDecisionHistory();
    const latest = await screen.findByRole('listitem', { name: /Studio East.*Pending/i });
    for (const value of ['40', 'Theatre', 'Ramp', 'Projector']) expect(within(latest).getByText(value)).toBeTruthy();
    expect(within(latest).getByText(/2030/)).toBeTruthy();
    expect(within(latest).getByText('Other pending requests will be cancelled if this arrangement changes or is cancelled.')).toBeTruthy();
    const approved = screen.getByRole('listitem', { name: /Approved/i });
    expect(within(approved).getAllByText('Not specified')).toHaveLength(2);
    expect(within(approved).getAllByText('None specified')).toHaveLength(2);
    expect(within(approved).getByText('Other requests are kept if this arrangement changes or is cancelled.')).toBeTruthy();
  });
  it('AC1 AC2 AC4 AC5 - shows the latest booking first with its event, venue and decision status', async () => {
    // Arrange: API data contains the latest pending request followed by older decisions for this event.
    // Act
    openDecisionHistory();
    // Assert: visible order preserves the newest record and clearly associates each decision with a venue.
    expect(api.get).toHaveBeenCalledWith('/events/44/venue-bookings', 'test-token');
    const latest = await screen.findByRole('listitem', { name: /Studio East.*Pending/i });
    expect(within(latest).getByText('Pending')).toBeTruthy();
    const history = screen.getByRole('list', { name: 'Venue booking requests' });
    expect(within(history).getAllByRole('listitem').map(item => item.textContent)).toEqual([
      expect.stringContaining('Pending'), expect.stringContaining('Rejected'), expect.stringContaining('Approved'),
    ]);
    expect(screen.getAllByText('Studio East')).toHaveLength(2);
    expect(screen.getByText('Hall North')).toBeTruthy();
  });

  it('AC3 - displays staff rejection information and omits an empty reason', async () => {
    // Arrange / Act: render a rejected request alongside decisions with no note.
    openDecisionHistory();
    // Assert: only the rejected record displays a reason, so unrelated decisions cannot inherit the note.
    const rejected = await screen.findByRole('listitem', { name: /Rejected/i });
    expect(within(rejected).getByText('Capacity is too small.')).toBeTruthy();
    const approved = screen.getByRole('listitem', { name: /Approved/i });
    expect(within(approved).queryByText('Capacity is too small.')).toBeNull();
  });

  it('AC3 - does not render a reason when Venue Staff left the rejected booking note empty', async () => {
    // Arrange: a rejection is still useful to the coordinator when staff did not add a note.
    api.get.mockImplementation(async path => path === '/auth/me'
      ? { user: { id: 12, role: 'event_coordinator' } }
      : { bookings: [{ ...bookings[1], decision_notes: null }] });
    // Act
    openDecisionHistory();
    // Assert: an empty note does not create a confusing blank reason field.
    const rejected = await screen.findByRole('listitem', { name: /Rejected/i });
    expect(within(rejected).queryByText(/Venue Staff reason:/)).toBeNull();
  });

  it('AC1 - explains when the selected event has no venue booking requests', async () => {
    // Arrange: the API confirms an empty history for this event.
    api.get.mockImplementation(async path => path === '/auth/me'
      ? { user: { id: 12, role: 'event_coordinator' } } : {});
    // Act
    openDecisionHistory();
    // Assert: absence is explicit instead of appearing as a loading failure or blank panel.
    expect(await screen.findByText('No venue booking requests for this event.')).toBeTruthy();
  });

  it('AC1 - reports a booking history load failure', async () => {
    // Arrange: reject only the booking request after authentication succeeds.
    api.get.mockImplementation(async path => {
      if (path === '/auth/me') return { user: { id: 12, role: 'event_coordinator' } };
      throw new Error('Booking history is unavailable.');
    });
    // Act
    openDecisionHistory();
    // Assert: coordinators get a visible recovery-relevant error rather than a false empty state.
    expect((await screen.findByRole('alert')).textContent).toBe('Booking history is unavailable.');
  });
});
