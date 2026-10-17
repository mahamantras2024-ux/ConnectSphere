import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../../frontend/src/App';
import { AuthProvider } from '../../frontend/src/context/AuthContext';
import { api } from '../../frontend/src/api/client';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));

const owner = { id: 12, full_name: 'Alice Organiser', role: 'event_organiser' };
const event = { id: 101, name: 'Community Workshop', venue_capacity: 3 };
const summary = {
  headcount: 4, waitlist_count: 2, status_breakdown: { registered: 4, withdrawn: 1 },
  waitlist: [
    { registration_id: 4, attendee_name: 'Devi Koh', status: 'registered', registered_at: '2031-01-01T09:15:00Z', reason: 'Exceeds venue capacity' },
    { registration_id: 5, attendee_name: 'Eli Goh', status: 'waitlisted', registered_at: '2031-01-01T09:20:00Z', reason: 'Already waitlisted' },
  ],
};

/** Opens a real protected app route and mocks only the authenticated API boundary. */
function open(path = '/organizer/events/101/registrations') {
  localStorage.setItem('cs_token', 'organiser-session');
  return render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AuthProvider><App /></AuthProvider></MemoryRouter>);
}

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  api.get.mockImplementation(async path => {
    if (path === '/auth/me') return { user: owner };
    if (path === '/events/101/registrations') return { event, summary };
    if (path === '/events/101') return { event: { ...event, organiser_id: owner.id, registration_required: true, registration_capacity: 40 } };
    throw new Error(`Unexpected GET ${path}`);
  });
});

afterEach(cleanup);

describe('SCRUM-60 Event Organiser View Registration Details', () => {
  it('AC1 - shows headcount and the registered/withdrawn status breakdown for the organiser’s event', async () => {
    // Arrange / Act: open the protected event registration route as its owner.
    open();
    // Assert: each count uses the registration summary supplied for this event.
    expect(await screen.findByRole('heading', { name: 'Community Workshop registrations' })).toBeTruthy();
    const counts = screen.getByRole('region', { name: 'Registration summary' });
    expect(within(counts).getByText((_, element) => element.tagName === 'P' && element.textContent === 'Current headcount: 4')).toBeTruthy();
    expect(within(counts).getByText((_, element) => element.tagName === 'P' && element.textContent === 'Waitlist count: 2')).toBeTruthy();
    expect(within(counts).getByText('Registered').nextElementSibling.textContent).toBe('4');
    expect(within(counts).getByText('Withdrawn').nextElementSibling.textContent).toBe('1');
    expect(api.get).toHaveBeenCalledWith('/events/101/registrations', 'organiser-session');
  });

  it('AC2 - lists stored and capacity-overflow waitlisted attendees with their reasons', async () => {
    // Arrange / Act
    open();
    const waitlist = await screen.findByRole('region', { name: 'Waiting list' });
    // Assert: the organiser can identify both persisted and calculated waitlist entries.
    for (const name of ['Devi Koh', 'Eli Goh', 'Exceeds venue capacity', 'Already waitlisted']) {
      expect(within(waitlist).getByText(name)).toBeTruthy();
    }
  });

  it('AC2 - shows an empty waiting-list state when no attendees are over capacity', async () => {
    // Arrange
    api.get.mockImplementation(async path => {
      if (path === '/auth/me') return { user: owner };
      if (path === '/events/101/registrations') return { event: { ...event, venue_capacity: 4 }, summary: { ...summary, waitlist_count: 0, waitlist: [] } };
      throw new Error(`Unexpected GET ${path}`);
    });
    // Act
    open();
    // Assert
    expect(await screen.findByText('No attendees are currently on the waiting list.')).toBeTruthy();
  });

  it('AC1 - reports registration retrieval errors rather than displaying fabricated zero counts', async () => {
    // Arrange: the registration API is unavailable while session restoration still succeeds.
    api.get.mockImplementation(async path => {
      if (path === '/auth/me') return { user: owner };
      if (path === '/events/101/registrations') throw new Error('Registration details unavailable.');
      throw new Error(`Unexpected GET ${path}`);
    });
    // Act
    open();
    // Assert
    expect((await screen.findByRole('alert')).textContent).toContain('Registration details unavailable.');
  });

  it('AC1 - keeps a loading state visible until the current summary request completes', async () => {
    // Arrange: hold the details response so the loading state can be observed before any summary is available.
    let resolveSummary;
    api.get.mockImplementation(path => {
      if (path === '/auth/me') return Promise.resolve({ user: owner });
      if (path === '/events/101/registrations') return new Promise(resolve => { resolveSummary = resolve; });
      throw new Error(`Unexpected GET ${path}`);
    });
    // Act
    open();
    // Assert, then release the request to leave no pending UI work.
    expect(await screen.findByRole('status')).toBeTruthy();
    resolveSummary({ event, summary });
    expect(await screen.findByRole('heading', { name: 'Community Workshop registrations' })).toBeTruthy();
  });

  it('AC1 - gives an unavailable state when the owned event has no registration summary', async () => {
    // Arrange: the endpoint can return no usable summary if the source record is removed during navigation.
    api.get.mockImplementation(async path => {
      if (path === '/auth/me') return { user: owner };
      if (path === '/events/101/registrations') return {};
      throw new Error(`Unexpected GET ${path}`);
    });
    // Act
    open();
    // Assert
    expect(await screen.findByText('No registration details are available.')).toBeTruthy();
  });

  it('AC2 - identifies stored waitlist entries when no confirmed venue capacity is available', async () => {
    // Arrange: malformed optional venue information must not turn existing waitlisted attendees into overflow registrations.
    const unnamedWaitlistEntry = { ...summary.waitlist[1] };
    delete unnamedWaitlistEntry.attendee_name;
    const persistedOnly = { ...summary, waitlist: [unnamedWaitlistEntry], waitlist_count: 1 };
    api.get.mockImplementation(async path => {
      if (path === '/auth/me') return { user: owner };
      if (path === '/events/101/registrations') return { event: { id: 101, venue_capacity: null }, summary: persistedOnly };
      throw new Error(`Unexpected GET ${path}`);
    });
    // Act
    open();
    // Assert: the fallback title, attendee label, stored waitlist item, and unknown-capacity note remain clear.
    expect(await screen.findByRole('heading', { name: 'Event 101 registrations' })).toBeTruthy();
    const waitlist = screen.getByRole('region', { name: 'Waiting list' });
    expect(within(waitlist).getByText('Attendee')).toBeTruthy();
    expect(within(waitlist).getByText(/No confirmed venue capacity is recorded/)).toBeTruthy();
  });

  it('AC1 AC3 - links to registration details from the organiser event details page', async () => {
    // Arrange / Act: open the owner's event details, then follow its registration-view link.
    open('/organizer/events/101');
    const link = await screen.findByRole('link', { name: 'View registration details' });
    expect(link.getAttribute('href')).toBe('/organizer/events/101/registrations');
    fireEvent.click(link);
    // Assert: the destination loads registration information for the same event.
    expect(await screen.findByRole('heading', { name: 'Community Workshop registrations' })).toBeTruthy();
  });
});
