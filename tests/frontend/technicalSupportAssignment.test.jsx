import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { useAuth } from '../../frontend/src/context/AuthContext';
import { api } from '../../frontend/src/api/client';
import EventList from '../../frontend/src/pages/events/EventList';
import TechnicalSupportAssignment from '../../frontend/src/pages/coordinator/TechnicalSupportAssignment';
import OnSiteSupportSection from '../../frontend/src/pages/tech-support/OnSiteSupportSection';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), put: vi.fn() } }));
vi.mock('../../frontend/src/context/AuthContext', () => ({ useAuth: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const staff = [
  { id: 41, full_name: 'Taylor Support', email: 'taylor@example.com' },
  { id: 42, full_name: 'Morgan Support', email: 'morgan@example.com' },
];
const event = { id: 7, name: 'Community Workshop', technical_support_required: true, technical_support_staff: [staff[0]] };

// AC2: the coordinator can select multiple staff and persist the complete assignment.
it('AC2 - assigns one or more Technical Support Staff members', async () => {
  const onSaved = vi.fn();
  api.put.mockResolvedValue({ message: 'Saved' });
  render(<TechnicalSupportAssignment event={event} token="coordinator-token" staff={staff} onSaved={onSaved} />);

  fireEvent.click(screen.getByLabelText(/Morgan Support/));
  fireEvent.click(screen.getByRole('button', { name: 'Assign staff' }));

  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/events/7/technical-support-assignment',
    { staffIds: [41, 42] }, 'coordinator-token'));
  expect(onSaved).toHaveBeenCalledWith(staff);
  expect(screen.queryByText('taylor@example.com')).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByRole('button', { name: 'Assignment saved' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Change assignment' }));
  fireEvent.click(screen.getByLabelText(/Taylor Support/));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Assign staff' }).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Assign staff' }));
  await waitFor(() => expect(api.put).toHaveBeenLastCalledWith('/events/7/technical-support-assignment',
    { staffIds: [42] }, 'coordinator-token'));
});

// AC2: an event without a prior assignment starts with no selected staff and cannot save an empty team.
it('AC2 - starts an unassigned event with no selected staff', async () => {
  const unassignedEvent = { id: 8, name: 'Open House' };
  render(<TechnicalSupportAssignment event={unassignedEvent} token="coordinator-token" staff={staff} onSaved={vi.fn()} />);

  const taylorCheckbox = screen.getByLabelText(/Taylor Support/);
  expect(taylorCheckbox.checked).toBe(false);
  fireEvent.click(taylorCheckbox);
  expect(taylorCheckbox.checked).toBe(true);
  fireEvent.click(taylorCheckbox);

  expect(taylorCheckbox.checked).toBe(false);
  expect(screen.getByRole('button', { name: 'Assign staff' }).disabled).toBe(true);
  expect(api.put).not.toHaveBeenCalled();
});

// AC2: when the staff directory is empty, the coordinator sees the empty state instead of unusable controls.
it('AC2 - explains when no Technical Support Staff are available', () => {
  render(<TechnicalSupportAssignment event={{ id: 8 }} token="coordinator-token" staff={[]} onSaved={vi.fn()} />);

  expect(screen.getByText('No Technical Support Staff are available.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Assign staff' })).toBeNull();
});

// AC1: a non-empty status label is rendered instead of the default fallback text.
it('AC1 - renders the assigned event status label when one is supplied', async () => {
  api.get.mockResolvedValue({
    events: [{
      id: 11,
      name: 'Status-tagged event',
      status: 'ready_for_on_site',
      proposed_date: '2026-10-12',
      proposed_start_time: '09:00:00',
      proposed_end_time: '12:00:00',
      venue_name: 'Innovation Hall',
      equipment_items: [],
    }],
  });
  render(<OnSiteSupportSection token="staff-token" />);

  expect(await screen.findByText('ready for on site')).toBeTruthy();
});

// AC1: assigned staff see schedule, venue and all equipment facts in the operational view.
it('AC1 - displays assigned event date time venue and equipment', async () => {
  api.get.mockResolvedValue({
    events: [{
      id: 7, name: 'Community Workshop', proposed_date: '2026-10-12',
      proposed_start_time: '09:00:00', proposed_end_time: '12:00:00',
      venue_name: 'Innovation Hall', venue_location: 'Level 3',
      equipment_items: [{ item: 'Projector', quantity: 2 }],
    }],
  });
  render(<OnSiteSupportSection token="staff-token" />);

  const card = await screen.findByRole('article', { name: 'Community Workshop' });
  expect(within(card).getByText('12 October 2026')).toBeTruthy();
  expect(within(card).getByText('09:00 – 12:00')).toBeTruthy();
  expect(within(card).getByText('Innovation Hall · Level 3')).toBeTruthy();
  expect(within(card).getByText('Projector')).toBeTruthy();
  expect(within(card).getByText('Qty. 2')).toBeTruthy();
});

// AC1: absent optional assignment data remains explicit, while supplied support notes remain visible.
it('AC1 - shows fallbacks for sparse on-site assignments and preserves supplied notes', async () => {
  api.get.mockResolvedValue({
    events: [
      {
        id: 8,
        name: '',
        purpose: null,
        status: null,
        proposed_date: null,
        proposed_start_time: null,
        proposed_end_time: null,
        venue_name: 'Main Hall',
        venue_location: '',
        equipment_items: [],
        equipment_notes: 'Bring the presentation adapter.',
        technical_support_details: 'Check the projector before guests arrive.',
      },
      {
        id: 9,
        name: 'Equipment-free event',
        equipment_items: [],
        equipment_notes: '',
      },
    ],
  });
  render(<OnSiteSupportSection token="staff-token" />);

  const sparseCard = await screen.findByRole('article', { name: 'Untitled Event' });
  expect(within(sparseCard).getByText('Assigned', { selector: '.status-badge' })).toBeTruthy();
  expect(within(sparseCard).getByText('No purpose provided')).toBeTruthy();
  expect(within(sparseCard).getByText('Not specified')).toBeTruthy();
  expect(within(sparseCard).getByText('Not specified – Not specified')).toBeTruthy();
  expect(within(sparseCard).getByText('Main Hall')).toBeTruthy();
  expect(within(sparseCard).getByText('Bring the presentation adapter.')).toBeTruthy();
  expect(within(sparseCard).getByText('Check the projector before guests arrive.')).toBeTruthy();
  expect(await screen.findByText('No equipment details provided.')).toBeTruthy();
});

// AC1: the assigned-events panel reports retrieval failures instead of presenting an empty queue.
it('AC1 - shows an error when on-site assignments cannot be loaded', async () => {
  api.get.mockRejectedValue(new Error('Unable to load on-site assignments.'));
  render(<OnSiteSupportSection token="staff-token" />);

  expect((await screen.findByRole('alert')).textContent).toBe('Unable to load on-site assignments.');
});

// AC1: a successful response with one assigned event uses singular wording in the badge.
it('AC1 - shows singular wording for a single assigned event', async () => {
  api.get.mockResolvedValue({
    events: [{
      id: 11,
      name: 'Single Event',
      proposed_date: '2026-10-12',
      proposed_start_time: '09:00:00',
      proposed_end_time: '12:00:00',
      venue_name: 'Main Hall',
      equipment_items: [],
    }],
  });
  render(<OnSiteSupportSection token="staff-token" />);

  expect(await screen.findByText('1 event')).toBeTruthy();
});

// AC1: a successful response with no events is distinct from a loading or failed state.
it('AC1 - shows an empty state when the response has no assigned events', async () => {
  api.get.mockResolvedValue({});
  render(<OnSiteSupportSection token="staff-token" />);

  expect(await screen.findByText('No assigned events yet.')).toBeTruthy();
  expect(screen.getByText('0 events')).toBeTruthy();
 });
it('AC1 - uses the fallback labels when event facts are missing', async () => {
  api.get.mockResolvedValue({
    events: [{
      id: 10,
      name: 'Last Minute Session',
      status: null,
      proposed_date: null,
      proposed_start_time: null,
      proposed_end_time: null,
      venue_name: 'TBD',
      venue_location: null,
      equipment_items: [{ item: 'Audio mixer', quantity: 1 }],
    }],
  });

  render(<OnSiteSupportSection token="staff-token" />);

  const card = await screen.findByRole('article', { name: 'Last Minute Session' });
  expect(within(card).getByText('Assigned')).toBeTruthy();
  expect(within(card).getByText('Not specified')).toBeTruthy();
  expect(within(card).getByText('TBD')).toBeTruthy();
  expect(within(card).getByText('Audio mixer')).toBeTruthy();
});

// AC3: a failed assignment is visible and does not claim that the team was saved.
it('AC3 - reports assignment changes that fail', async () => {
  api.put.mockRejectedValue(new Error('Assignment changed. Refresh and try again.'));
  render(<TechnicalSupportAssignment event={event} token="coordinator-token" staff={staff} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Assign staff' }));
  expect((await screen.findByRole('alert')).textContent.includes('Assignment changed. Refresh and try again.')).toBe(true);
});

it('AC2 - shows the empty roster state when no Technical Support Staff are available', () => {
  render(<TechnicalSupportAssignment event={event} token="coordinator-token" staff={[]} onSaved={vi.fn()} />);

  expect(screen.getByText('No Technical Support Staff are available.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Assign staff' })).toBeNull();
});

it('AC2 - accepts a fresh event that has no previously assigned support staff', async () => {
  const onSaved = vi.fn();
  api.put.mockResolvedValue({ message: 'Saved' });
  render(<TechnicalSupportAssignment event={{ id: 9, name: 'New Event', technical_support_required: true }} token="coordinator-token" staff={staff} onSaved={onSaved} />);

  // AC2: preserve the feature branch's empty-selection guard without duplicating the roster regression.
  expect(screen.getByRole('button', { name: 'Assign staff' }).disabled).toBe(true);
  expect(api.put).not.toHaveBeenCalled();

  fireEvent.click(screen.getByLabelText(/Taylor Support/));
  fireEvent.click(screen.getByRole('button', { name: 'Assign staff' }));

  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/events/9/technical-support-assignment', { staffIds: [41] }, 'coordinator-token'));
  expect(onSaved).toHaveBeenCalledWith([{ id: 41, full_name: 'Taylor Support', email: 'taylor@example.com' }]);
});

// AC2: Saving one assignment must preserve other event cards while replacing the selected event's team.
it('AC2 - updates the assigned event and preserves unrelated dashboard events', async () => {
  useAuth.mockReturnValue({ token: 'coordinator-token', user: { id: 9, role: 'event_coordinator' } });
  api.get.mockImplementation(async endpoint => {
    if (endpoint === '/events') {
      return {
        events: [{
          id: 7,
          name: 'Community Workshop',
          status: 'approved',
          technical_support_required: true,
          technical_support_staff: [{ id: 41, full_name: 'Taylor Support' }],
        }, {
          id: 8,
          name: 'Other Coordinator Event',
          status: 'pending',
          technical_support_required: false,
        }],
      };
    }
    if (endpoint === '/events/technical-support-staff') {
      return { staff };
    }
    if (endpoint === '/notifications') {
      return { notifications: [] };
    }
    if (endpoint === '/events/change-requests') {
      return { changeRequests: [] };
    }
    throw new Error(`Unexpected GET ${endpoint}`);
  });
  api.put.mockResolvedValue({ message: 'Saved' });

  render(<MemoryRouter><EventList dashboard /></MemoryRouter>);

  const morgan = await screen.findByLabelText(/Morgan Support/);
  fireEvent.click(morgan);
  fireEvent.click(screen.getByRole('button', { name: 'Assign staff' }));

  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/events/7/technical-support-assignment',
    { staffIds: [41, 42] }, 'coordinator-token'));
  expect(screen.getByRole('button', { name: 'Assignment saved' }).disabled).toBe(true);
  expect(screen.getByText('Taylor Support')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Other Coordinator Event' })).toBeTruthy();
});

it('AC3 - shows the support staff error and hides the assignment controls when the roster fails', async () => {
  useAuth.mockReturnValue({ token: 'coordinator-token', user: { id: 9, role: 'event_coordinator' } });
  api.get.mockImplementation(async endpoint => {
    if (endpoint === '/events') {
      return {
        events: [{
          id: 7,
          name: 'Community Workshop',
          status: 'approved',
          technical_support_required: true,
          technical_support_staff: [{ id: 41, full_name: 'Taylor Support' }],
        }],
      };
    }
    if (endpoint === '/events/technical-support-staff') {
      throw new Error('Support staff roster unavailable.');
    }
    if (endpoint === '/notifications') {
      return { notifications: [] };
    }
    if (endpoint === '/events/change-requests') {
      return { changeRequests: [] };
    }
    throw new Error(`Unexpected GET ${endpoint}`);
  });

  render(<MemoryRouter><EventList dashboard /></MemoryRouter>);

  expect(await screen.findByText('Support staff roster unavailable.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Assign staff' })).toBeNull();
});

it('AC3 - shows a support staff roster error without rendering a stale assignment form', async () => {
  useAuth.mockReturnValue({ token: 'coordinator-token', user: { id: 9, role: 'event_coordinator' } });
  api.get.mockImplementation(async endpoint => {
    if (endpoint === '/events') {
      return {
        events: [{
          id: 7,
          name: 'Community Workshop',
          status: 'approved',
          technical_support_required: true,
          technical_support_staff: [],
        }],
      };
    }
    if (endpoint === '/events/technical-support-staff') {
      throw new Error('Support staff roster unavailable.');
    }
    if (endpoint === '/notifications') {
      return { notifications: [] };
    }
    if (endpoint === '/events/change-requests') {
      return { changeRequests: [] };
    }
    throw new Error(`Unexpected GET ${endpoint}`);
  });

  render(<MemoryRouter><EventList dashboard /></MemoryRouter>);

  expect(await screen.findByText('Support staff roster unavailable.')).toBeTruthy();
});

it('AC1 - shows the loading and empty support-event states', async () => {
  let resolveRequest;
  api.get.mockImplementation(() => new Promise(resolve => {
    resolveRequest = resolve;
  }));

  render(<OnSiteSupportSection token="staff-token" />);
  expect(screen.getByRole('status').textContent).toContain('Loading support assignments...');

  resolveRequest({ events: [] });
  await waitFor(() => expect(screen.getByText('No assigned events yet.')).toBeTruthy());
});

// AC1: An API response without an events array is an empty assignment list, not a render failure.
it('AC1 - shows the empty state when the support response omits events', async () => {
  api.get.mockResolvedValue({});

  render(<OnSiteSupportSection token="staff-token" />);

  expect(await screen.findByText('No assigned events yet.')).toBeTruthy();
});

it('AC1 - renders the alternate equipment and venue fallbacks for assigned events', async () => {
  api.get.mockResolvedValue({
    events: [
      {
        id: 8,
        name: 'Community Workshop',
        status: 'approved',
        purpose: 'Community support session',
        proposed_date: null,
        proposed_start_time: null,
        proposed_end_time: null,
        venue_name: 'Innovation Hall',
        venue_location: '',
        equipment_items: [],
        equipment_notes: 'Bring the portable projector setup.',
        technical_support_details: 'Bring a backup HDMI cable.',
      },
      {
        id: 9,
        name: null,
        equipment_items: [],
      },
    ],
  });

  render(<OnSiteSupportSection token="staff-token" />);

  const eventCard = await screen.findByRole('article', { name: 'Community Workshop' });
  expect(within(eventCard).getByText('Not specified')).toBeTruthy();
  expect(within(eventCard).getByText('Innovation Hall')).toBeTruthy();
  expect(within(eventCard).getByText('Bring the portable projector setup.')).toBeTruthy();
  expect(within(eventCard).getByText('Bring a backup HDMI cable.')).toBeTruthy();
  const unnamedEvent = screen.getByRole('article', { name: 'Untitled Event' });
  expect(within(unnamedEvent).getByText('No equipment details provided.')).toBeTruthy();
});

it('AC1 - reports when the staff support roster cannot be loaded', async () => {
  api.get.mockRejectedValue(new Error('Support assignments are unavailable.'));
  render(<OnSiteSupportSection token="staff-token" />);

  expect((await screen.findByRole('alert')).textContent).toBe('Support assignments are unavailable.');
});
