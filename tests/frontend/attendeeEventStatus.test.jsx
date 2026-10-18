import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../../frontend/src/App';
import { AuthProvider } from '../../frontend/src/context/AuthContext';
import { api } from '../../frontend/src/api/client';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

const publicEvent = { id: 45, name: 'Public Festival', status: 'confirmed', proposed_date: '2031-08-20',
  proposed_start_time: '10:00:00', proposed_end_time: '16:00:00', venue_name: 'Civic Hall', location: 'Main Street',
  description: 'A public arts festival.', organiser_name: 'Avery Kim', accessibility_requirements: [], special_arrangements: '' };
const cancelledEvent = { ...publicEvent, id: 44, name: 'River Festival', status: 'cancelled' };

/** Opens the actual attendee route and auth guard while replacing only the HTTP boundary. */
function open(path = '/attendee/dashboard') {
  localStorage.setItem('cs_token', 'attendee-session');
  return render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>);
}

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  api.get.mockImplementation(async path => {
    if (path === '/auth/me') return { user: { id: 8, full_name: 'Casey Attendee', role: 'attendee' } };
    if (path === '/notifications') return { unreadCount: 1, notifications: [{ id: 2, event_id: 44, type: 'event_cancelled',
      title: 'Event cancelled: River Festival', message: 'River Festival has been cancelled. Please check the event details in ConnectSphere for the latest information.',
      created_at: '2031-08-01T09:00:00Z', read_at: null }] };
    if (path === '/registrations/mine') return { registrations: [{ id: 9, event_id: 44, event_name: 'River Festival',
      status: 'registered', event_status: 'cancelled', proposed_date: '2031-08-20', proposed_start_time: '10:00:00' }] };
    if (path === '/events/published') return { events: [publicEvent] };
    if (path === '/events/published/44') return { event: cancelledEvent };
    throw new Error(`Unexpected GET ${path}`);
  });
});

afterEach(cleanup);

describe('SCRUM-90 Attendee Views Status of Events Available to Them', () => {
  it('AC1 AC2 - shows published events as Confirmed and displays only public status labels', async () => {
    // Arrange / Act: open the dashboard with one published event and one personal cancelled registration.
    open();
    // Assert: public listing and registration summary show attendee-facing statuses without internal labels.
    expect(await screen.findByText('Confirmed')).toBeTruthy();
    expect(screen.getByText('Cancelled')).toBeTruthy();
    expect(screen.queryByText(/approved|planning|under review|submitted|rejected/i)).toBeNull();
  });

  it('AC4 AC5 - shows a cancellation alert and opens the latest cancelled event details from My Registrations', async () => {
    // Arrange: the attendee has an active registration and an unread cancellation notice.
    open();
    const notification = await screen.findByRole('region', { name: 'Notifications' });
    // Assert notification copy is visible in the attendee dashboard.
    expect(await within(notification).findByText('Event cancelled: River Festival')).toBeTruthy();
    // Act: open the registration, then its current event details.
    const registrationCard = screen.getByText('River Festival').closest('article');
    fireEvent.click(within(registrationCard).getByRole('button', { name: /view registration/i }));
    fireEvent.click(await screen.findByRole('link', { name: 'View current event details' }));
    // Assert: the details route re-reads the latest event status from the API.
    expect(await screen.findByRole('heading', { name: 'River Festival' })).toBeTruthy();
    expect(screen.getByText('Cancelled')).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('/events/published/44', 'attendee-session');
  });

  it('AC3 AC6 - replaces an unknown or internal status with an attendee-safe fallback', async () => {
    // Arrange: guard the page against an unexpected backend status rather than printing it for attendees.
    api.get.mockImplementation(async path => {
      if (path === '/auth/me') return { user: { id: 8, full_name: 'Casey Attendee', role: 'attendee' } };
      if (path === '/events/published/44') return { event: { ...cancelledEvent, status: 'planning' } };
      throw new Error(`Unexpected GET ${path}`);
    });
    // Act
    open('/attendee/events/44');
    // Assert: internal planning text is never rendered as the event's public status.
    expect(await screen.findByText('Status unavailable')).toBeTruthy();
    expect(screen.queryByText('planning')).toBeNull();
  });
});
