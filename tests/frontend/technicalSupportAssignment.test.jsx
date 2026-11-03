import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
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

// AC2: remounting models a refresh; persisted data must restore both selection and saved controls.
it('AC2 - restores saved assignment controls on load and after refresh', () => {
  // Arrange: the API has already recorded Taylor as the assigned staff member.
  const props = { event, token: 'coordinator-token', staff, onSaved: vi.fn() };
  const firstVisit = render(<TechnicalSupportAssignment {...props} />);

  // Assert: loading a recorded assignment must not offer a redundant initial save.
  expect(screen.getByRole('checkbox', { name: 'Taylor Support' })).toBeChecked();
  for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toBeDisabled();
  // Native activation respects the disabled fieldset: neither the assigned nor the unassigned box can start an edit.
  screen.getByRole('checkbox', { name: 'Taylor Support' }).click();
  screen.getByRole('checkbox', { name: 'Morgan Support' }).click();
  expect(screen.getByRole('checkbox', { name: 'Taylor Support' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Morgan Support' })).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'Assignment saved' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Change assignment' })).toBeEnabled();

  // Act: discard all local component state, as a page refresh does.
  firstVisit.unmount();
  render(<TechnicalSupportAssignment {...props} />);

  // Assert: persisted assignment data restores the same UI without another PUT.
  expect(screen.getByRole('checkbox', { name: 'Taylor Support' })).toBeChecked();
  for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Assignment saved' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Change assignment' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Assign staff' })).toBeNull();
  expect(api.put).not.toHaveBeenCalled();
});

// AC2: polling returns new objects every five seconds; neither direction may replace an unsaved draft.
it.each([0, 1])('AC2 - preserves unsaved team replacement from staff index %s across refreshes', assignedIndex => {
  // Arrange: either staff member may be the currently persisted assignment.
  const assigned = staff[assignedIndex];
  const replacement = staff[1 - assignedIndex];
  const props = { token: 'coordinator-token', staff, onSaved: vi.fn() };
  const persistedEvent = { ...event, technical_support_staff: [assigned] };
  const view = render(<TechnicalSupportAssignment {...props} event={persistedEvent} />);

  // Act: replace the team locally, then simulate the next background API response.
  fireEvent.click(screen.getByRole('button', { name: 'Change assignment' }));
  fireEvent.click(screen.getByRole('checkbox', { name: assigned.full_name }));
  fireEvent.click(screen.getByRole('checkbox', { name: replacement.full_name }));
  view.rerender(<TechnicalSupportAssignment {...props} event={{ ...persistedEvent, technical_support_staff: [{ ...assigned }] }} />);

  // Assert: only an explicit save can replace the local draft with persisted state.
  expect(screen.getByRole('checkbox', { name: assigned.full_name })).not.toBeChecked();
  expect(screen.getByRole('checkbox', { name: replacement.full_name })).toBeChecked();
  expect(screen.getByRole('button', { name: 'Assign staff' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Change assignment' })).toBeNull();
  expect(api.put).not.toHaveBeenCalled();
});

// AC2: choosing to edit is meaningful even before the first checkbox is changed.
it('AC2 - preserves Change assignment editing mode across refreshes', () => {
  // Arrange: an event with a saved team.
  const props = { token: 'coordinator-token', staff, onSaved: vi.fn() };
  const view = render(<TechnicalSupportAssignment {...props} event={event} />);

  // Act: start editing and receive a fresh copy of the same persisted data.
  fireEvent.click(screen.getByRole('button', { name: 'Change assignment' }));
  for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toBeEnabled();
  view.rerender(<TechnicalSupportAssignment {...props} event={{ ...event, technical_support_staff: [{ ...staff[0] }] }} />);

  // Assert: polling must not close the edit session.
  for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Assign staff' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Change assignment' })).toBeNull();
});

// AC2/AC3: an unresolved write must never look saved, even when a read arrives meanwhile.
it('AC2/AC3 - preserves the pending team and hides Change assignment until saving succeeds', async () => {
  // Arrange: hold the API response so assertions cover the actual pending period.
  let finishSave;
  api.put.mockImplementationOnce(() => new Promise(resolve => { finishSave = resolve; }));
  const onSaved = vi.fn();
  const props = { token: 'coordinator-token', staff, onSaved };
  const view = render(<TechnicalSupportAssignment {...props} event={event} />);

  // Act: submit a replacement team and receive the old persisted assignment during the write.
  fireEvent.click(screen.getByRole('button', { name: 'Change assignment' }));
  fireEvent.click(screen.getByRole('checkbox', { name: staff[0].full_name }));
  fireEvent.click(screen.getByRole('checkbox', { name: staff[1].full_name }));
  fireEvent.click(screen.getByRole('button', { name: 'Assign staff' }));
  view.rerender(<TechnicalSupportAssignment {...props} event={{ ...event, technical_support_staff: [{ ...staff[0] }] }} />);

  // Assert: disable edits and keep the submitted draft visible throughout the pending save.
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  expect(screen.getByRole('checkbox', { name: staff[1].full_name })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: staff[1].full_name })).toBeDisabled();
  expect(screen.getByRole('checkbox', { name: staff[0].full_name })).not.toBeChecked();
  expect(screen.queryByRole('button', { name: 'Change assignment' })).toBeNull();
  expect(onSaved).not.toHaveBeenCalled();

  // Act / Assert: saved controls become available only after the write succeeds.
  finishSave({ message: 'Saved' });
  expect(await screen.findByRole('button', { name: 'Assignment saved' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Change assignment' })).toBeEnabled();
  for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toBeDisabled();
  expect(onSaved).toHaveBeenCalledWith([staff[1]]);
  expect(api.put).toHaveBeenCalledWith('/events/7/technical-support-assignment', { staffIds: [42] }, 'coordinator-token');

  // Assert: after success, idle controls resume following genuinely changed persisted teams.
  view.rerender(<TechnicalSupportAssignment {...props} event={{ ...event, technical_support_staff: [{ ...staff[0] }] }} />);
  expect(screen.getByRole('checkbox', { name: staff[0].full_name })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: staff[1].full_name })).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'Assignment saved' })).toBeDisabled();
});

// AC2: the coordinator can select multiple staff and persist the complete assignment.
it('AC2 - assigns one or more Technical Support Staff members', async () => {
  const onSaved = vi.fn();
  api.put.mockResolvedValue({ message: 'Saved' });
  render(<TechnicalSupportAssignment event={event} token="coordinator-token" staff={staff} onSaved={onSaved} />);

  // Act: existing teams require an explicit edit action before adding another member.
  fireEvent.click(screen.getByRole('button', { name: 'Change assignment' }));
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
  // Assert: a first assignment needs no Change assignment step; empty teams still cannot be submitted.
  for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Assign staff' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Change assignment' })).toBeNull();
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

// TS status AC1/AC2: a valid review-stage event displays Planning rather than a raw database status.
it('TS status AC1/AC2 - maps an assigned under-review event to Planning', async () => {
  api.get.mockResolvedValue({
    events: [{
      id: 11,
      name: 'Status-tagged event',
      status: 'under_review',
      proposed_date: '2026-10-12',
      proposed_start_time: '09:00:00',
      proposed_end_time: '12:00:00',
      venue_name: 'Innovation Hall',
      equipment_items: [],
    }],
  });
  render(<OnSiteSupportSection token="staff-token" />);

  expect(await screen.findByText('Planning')).toBeTruthy();
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
  // Arrange: an existing assignment can be edited, but the first network save fails.
  const onSaved = vi.fn();
  api.put.mockRejectedValueOnce(new Error('Assignment changed. Refresh and try again.'))
    .mockResolvedValueOnce({ message: 'Saved' });
  render(<TechnicalSupportAssignment event={event} token="coordinator-token" staff={staff} onSaved={onSaved} />);
  // Act: enter editing mode and replace Taylor with Morgan before the failed save.
  fireEvent.click(screen.getByRole('button', { name: 'Change assignment' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Taylor Support' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Morgan Support' }));
  fireEvent.click(screen.getByRole('button', { name: 'Assign staff' }));
  // Assert: failures must not propagate success or prevent another attempt.
  expect((await screen.findByRole('alert')).textContent.includes('Assignment changed. Refresh and try again.')).toBe(true);
  expect(onSaved).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Assignment saved' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Assign staff' })).toBeEnabled();
  for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toBeEnabled();
  expect(screen.getByRole('checkbox', { name: 'Taylor Support' })).not.toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Morgan Support' })).toBeChecked();
  expect(screen.queryByRole('button', { name: 'Change assignment' })).toBeNull();

  // Act / Assert: retry submits the retained draft, locks the saved roster and clears the old error.
  fireEvent.click(screen.getByRole('button', { name: 'Assign staff' }));
  expect(await screen.findByRole('button', { name: 'Assignment saved' })).toBeDisabled();
  expect(api.put).toHaveBeenLastCalledWith('/events/7/technical-support-assignment', { staffIds: [42] }, 'coordinator-token');
  expect(onSaved).toHaveBeenCalledWith([staff[1]]);
  for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toBeDisabled();
  expect(screen.queryByRole('alert')).toBeNull();
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
  // Act: unlock the saved event's team through the real dashboard controls before editing.
  fireEvent.click(screen.getByRole('button', { name: 'Change assignment' }));
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
