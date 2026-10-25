import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../../frontend/src/App';
import { AuthProvider } from '../../frontend/src/context/AuthContext';
import { api } from '../../frontend/src/api/client';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

const publishedEvent = {
  id: 44, name: 'Community Arts Day', proposed_date: '2031-06-12', proposed_start_time: '09:30:00',
  proposed_end_time: '16:00:00', venue_name: 'Riverside Hall', location: '18 River Road',
  description: 'A day of art workshops and performances.', organiser_name: 'Morgan Lee',
  accessibility_requirements: ['Step-free entrance', 'Reserved wheelchair spaces'],
  special_arrangements: 'Wear comfortable clothes; materials are provided.',
};

let currentEvent;
let currentRegistrations;

/** Uses the real attendee routes and session gate while mocking only HTTP responses. */
function open(path = '/attendee/dashboard') {
  localStorage.setItem('cs_token', 'attendee-session');
  return render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>);
}

beforeEach(() => {
  currentEvent = { ...publishedEvent };
  currentRegistrations = [];
  localStorage.clear();
  vi.resetAllMocks();
  api.get.mockImplementation(async path => {
    if (path === '/auth/me') return { user: { id: 8, full_name: 'Casey Attendee', role: 'attendee' } };
    if (path === '/notifications') return { notifications: [], unreadCount: 0 };
    if (path === '/registrations/mine') return { registrations: currentRegistrations };
    if (path === '/events/published') return { events: [publishedEvent] };
    if (path === '/events/published/44') return { event: currentEvent };
    throw new Error(`Unexpected GET ${path}`);
  });
});

afterEach(cleanup);

describe('SCRUM-35 Attendee View Event Details', () => {
  it('AC1 - shows a loading state while the published event list is being fetched', async () => {
    // Arrange: hold the catalogue response so the user-facing loading state can be observed.
    let resolveEvents;
    api.get.mockImplementation(path => {
      if (path === '/auth/me') return Promise.resolve({ user: { id: 8, full_name: 'Casey Attendee', role: 'attendee' } });
      if (path === '/notifications') return Promise.resolve({ notifications: [], unreadCount: 0 });
      if (path === '/registrations/mine') return Promise.resolve({ registrations: [] });
      if (path === '/events/published') return new Promise(resolve => { resolveEvents = resolve; });
      throw new Error(`Unexpected GET ${path}`);
    });
    // Act
    open();
    // Assert
    expect(await screen.findByRole('status')).toBeTruthy();
    resolveEvents({ events: [] });
  });

  it('AC1 - shows a useful error when the published event list cannot be loaded', async () => {
    // Arrange: simulate the public catalogue API failing at its HTTP boundary.
    api.get.mockImplementation(async path => {
      if (path === '/auth/me') return { user: { id: 8, full_name: 'Casey Attendee', role: 'attendee' } };
      if (path === '/registrations/mine') return { registrations: [] };
      if (path === '/events/published') throw new Error('Catalogue unavailable');
      throw new Error(`Unexpected GET ${path}`);
    });
    // Act
    open();
    // Assert: the failure is surfaced, not rendered as an empty catalogue.
    expect((await screen.findByRole('alert')).textContent).toContain('Catalogue unavailable');
  });

  it('AC1 - explains when no published events accept registration', async () => {
    // Arrange
    api.get.mockImplementation(async path => {
      if (path === '/auth/me') return { user: { id: 8, full_name: 'Casey Attendee', role: 'attendee' } };
      if (path === '/registrations/mine') return { registrations: [] };
      if (path === '/events/published') return { events: [] };
      throw new Error(`Unexpected GET ${path}`);
    });
    // Act
    open();
    // Assert
    expect(await screen.findByText('No published events are open for registration.')).toBeTruthy();
  });

  it('AC1 - labels a published event whose source record has no proposed date', async () => {
    // Arrange: the public list must stay usable even if an approved source record has an incomplete date.
    api.get.mockImplementation(async path => {
      if (path === '/auth/me') return { user: { id: 8, full_name: 'Casey Attendee', role: 'attendee' } };
      if (path === '/registrations/mine') return { registrations: [] };
      if (path === '/events/published') return { events: [{ id: 45, name: 'Undated Workshop' }] };
      throw new Error(`Unexpected GET ${path}`);
    });
    // Act
    open();
    // Assert: the missing date is identified instead of leaving an ambiguous blank card.
    const eventCard = await screen.findByRole('article');
    expect(within(eventCard).getByText('Undated Workshop')).toBeTruthy();
    expect(within(eventCard).getByText('Date not specified')).toBeTruthy();
  });

  it('AC1 - opens a published event and shows current core details from the source data', async () => {
    // Arrange: the published event includes the venue and organiser data attendees need to plan.
    // Act
    open();
    fireEvent.click(await screen.findByRole('link', { name: 'View event details' }));
    // Assert: each displayed fact matches the API record rather than registration-summary placeholders.
    expect(await screen.findByRole('heading', { name: 'Community Arts Day' })).toBeTruthy();
    for (const value of ['2031-06-12', '09:30–16:00', /Riverside Hall · 18 River Road/,
      'A day of art workshops and performances.', 'Morgan Lee']) expect(screen.getByText(value)).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('/events/published/44', 'attendee-session');
  });

  it('UI AC1/AC2 - presents the attendee overview below a coordinator-style event heading without staff controls', async () => {
    // Arrange: staff-only values must not become visible when adopting the staff page's visual layout.
    currentEvent = { ...publishedEvent, status: 'confirmed', internal_notes: 'Private review notes' };
    // Act: use the actual attendee route and public event response.
    open('/attendee/events/44');
    const title = await screen.findByRole('heading', { level: 1, name: 'Community Arts Day' });
    const overview = screen.getByRole('region', { name: 'Event overview' });
    // Assert: a separate page header and named overview replace the former all-in-one record card.
    expect(title.closest('header')).toHaveTextContent('Event Detail');
    expect(title.closest('header')).toHaveTextContent('Confirmed');
    expect(within(overview).getByText('09:30–16:00')).toBeInTheDocument();
    expect(within(overview).getByText('Morgan Lee')).toBeInTheDocument();
    expect(screen.queryByText('Private review notes')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Registration details|Approve|Edit event/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Equipment|Venue requests|Activity/i })).not.toBeInTheDocument();
  });

  it('UI AC3 - My registrations returns attendees to their homepage using an explicit back link', async () => {
    // Arrange / Act: arrive at the same registrations route linked from event details.
    open('/registrations');
    const back = await screen.findByRole('link', { name: 'Back to events' });
    expect(back).toHaveAttribute('href', '/attendee/dashboard');
    fireEvent.click(back);
    // Assert: the link goes to the attendee homepage even when there is no browser history.
    expect(await screen.findByRole('heading', { level: 1, name: 'Attendee Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Published events' })).toBeInTheDocument();
  });

  it('UI AC4 - the dashboard labels personal registrations above their event cards', async () => {
    // Arrange: a real personal record separates this section from the published catalogue.
    currentRegistrations = [{ id: 7, event_id: 44, event_name: 'My booked workshop', status: 'registered', event_status: 'confirmed' }];
    // Act
    open();
    const cardTitle = await screen.findByRole('heading', { name: 'My booked workshop' });
    const heading = screen.getByRole('heading', { level: 2, name: 'My registrations' });
    // Assert: the section heading precedes the personal card, not the published events list alone.
    expect(heading.compareDocumentPosition(cardTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('UI AC5 - published event status badges stay compact and align right like registration badges', async () => {
    // Arrange / Act: open the public catalogue inside the actual attendee homepage.
    open();
    const catalogue = await screen.findByRole('region', { name: 'Published events' });
    const badge = await within(catalogue).findByText('Confirmed');
    // Assert: flex-end keeps the badge compact on the right, matching personal registration cards.
    expect(getComputedStyle(badge).alignSelf).toBe('flex-end');
    expect(badge.tagName).toBe('SPAN');
  });

  it('AC2 - revisiting event details fetches updated source data instead of stale values', async () => {
    // Arrange: load the original details, then change the source record before revisiting the route.
    open('/attendee/events/44');
    expect(await screen.findByText('A day of art workshops and performances.')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Back to events' }));
    await screen.findByRole('heading', { name: 'Published events' });
    currentEvent = { ...publishedEvent, description: 'Updated programme and performance schedule.', location: '20 River Road' };
    fireEvent.click(screen.getByRole('link', { name: 'View event details' }));
    // Assert: the second page visit requests fresh details and reflects the changed description/location.
    expect(await screen.findByText('Updated programme and performance schedule.')).toBeTruthy();
    expect(screen.getByText(/Riverside Hall · 20 River Road/)).toBeTruthy();
    expect(api.get.mock.calls.filter(([path]) => path === '/events/published/44')).toHaveLength(2);
  });

  it('AC3 - shows accessibility notes and other specific attendee-facing information', async () => {
    // Arrange / Act: open details with both structured accessibility notes and freeform attendee information.
    open('/attendee/events/44');
    const information = await screen.findByRole('region', { name: 'Accessibility and attendee information' });
    // Assert: none of the stored preparation details are dropped or mixed into the event description.
    for (const value of [...publishedEvent.accessibility_requirements, publishedEvent.special_arrangements]) {
      expect(within(information).getByText(value)).toBeTruthy();
    }
  });

  it('AC1 AC3 - gives clear fallbacks when optional source details are missing', async () => {
    // Arrange: optional fields may be absent in older or incomplete source records.
    currentEvent = {
      id: 44, name: 'Community Arts Day', accessibility_requirements: null,
      special_arrangements: '   ', proposed_start_time: '09:30:00',
    };
    // Act
    open('/attendee/events/44');
    // Assert: missing fields remain understandable and a single time is not discarded.
    expect(await screen.findByText('Date not specified')).toBeTruthy();
    expect(screen.getByText('09:30')).toBeTruthy();
    expect(screen.getByText('Venue not confirmed')).toBeTruthy();
    expect(screen.getByText('No description provided.')).toBeTruthy();
    expect(screen.getByText('Organiser not specified')).toBeTruthy();
    expect(screen.getByText('No specific accessibility information provided.')).toBeTruthy();
    expect(screen.getByText('No additional attendee information provided.')).toBeTruthy();
  });

  it('AC1 AC3 - handles non-text time and attendee information in an incomplete source record', async () => {
    // Arrange: reject malformed optional source values rather than rendering them as attendee guidance.
    currentEvent = {
      id: 44, name: 'Community Arts Day', proposed_start_time: 42,
      proposed_end_time: null, special_arrangements: { dressCode: 'casual' },
    };
    // Act
    open('/attendee/events/44');
    // Assert: only valid text fields are presented, with explicit fallback labels for the rest.
    expect(await screen.findByText('Time not specified')).toBeTruthy();
    expect(screen.getByText('No additional attendee information provided.')).toBeTruthy();
  });

  it('AC1 - shows an unavailable message when a published event has no detail record', async () => {
    // Arrange: the current event could be unpublished between catalogue and details requests.
    api.get.mockImplementation(async path => {
      if (path === '/auth/me') return { user: { id: 8, full_name: 'Casey Attendee', role: 'attendee' } };
      if (path === '/events/published/44') return {};
      throw new Error(`Unexpected GET ${path}`);
    });
    // Act
    open('/attendee/events/44');
    // Assert
    expect(await screen.findByText('No event details available.')).toBeTruthy();
  });

  it('AC1 - shows an error and return link when event details cannot be loaded', async () => {
    // Arrange
    api.get.mockImplementation(async path => {
      if (path === '/auth/me') return { user: { id: 8, full_name: 'Casey Attendee', role: 'attendee' } };
      if (path === '/events/published/44') throw new Error('Event unavailable');
      throw new Error(`Unexpected GET ${path}`);
    });
    // Act
    open('/attendee/events/44');
    // Assert
    expect((await screen.findByRole('alert')).textContent).toContain('Event unavailable');
    expect(screen.getByRole('link', { name: 'Back to events' })).toBeTruthy();
  });
});
