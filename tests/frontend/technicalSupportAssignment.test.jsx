import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../frontend/src/api/client';
import TechnicalSupportAssignment from '../../frontend/src/pages/coordinator/TechnicalSupportAssignment';
import OnSiteSupportSection from '../../frontend/src/pages/tech-support/OnSiteSupportSection';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), put: vi.fn() } }));
afterEach(cleanup);

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

// AC4: a failed assignment is visible and does not claim that the team was saved.
it('AC4 - reports assignment changes that fail', async () => {
  api.put.mockRejectedValue(new Error('Assignment changed. Refresh and try again.'));
  render(<TechnicalSupportAssignment event={event} token="coordinator-token" staff={staff} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Assign staff' }));
  expect((await screen.findByRole('alert')).textContent.includes('Assignment changed. Refresh and try again.')).toBe(true);
});

// AC2: an empty team selection is an invalid boundary and must not reach the assignment API.
it('AC2 - prevents saving an assignment when no staff are selected', () => {
  const unassignedEvent = { ...event, technical_support_staff: [] };
  render(<TechnicalSupportAssignment event={unassignedEvent} token="coordinator-token" staff={staff} onSaved={vi.fn()} />);

  expect(screen.getByRole('button', { name: 'Assign staff' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Assign staff' }));

  expect(api.put).not.toHaveBeenCalled();
});

// AC2: the event's latest assigned team is authoritative when the parent refreshes its data.
it('AC2 - synchronizes selected staff when the event assignment changes', async () => {
  const onSaved = vi.fn();
  const { rerender } = render(
    <TechnicalSupportAssignment event={event} token="coordinator-token" staff={staff} onSaved={onSaved} />,
  );

  fireEvent.click(screen.getByLabelText(/Morgan Support/));
  rerender(
    <TechnicalSupportAssignment
      event={{ ...event, technical_support_staff: [staff[1]] }}
      token="coordinator-token"
      staff={staff}
      onSaved={onSaved}
    />,
  );

  await waitFor(() => {
    expect(screen.getByLabelText(/Taylor Support/).checked).toBe(false);
    expect(screen.getByLabelText(/Morgan Support/).checked).toBe(true);
  });
});

// AC2: no available technicians is a distinct state with no unusable assignment controls.
it('AC2 - explains when no Technical Support Staff are available', () => {
  render(<TechnicalSupportAssignment event={event} token="coordinator-token" staff={[]} onSaved={vi.fn()} />);

  expect(screen.getByText('No Technical Support Staff are available.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Assign staff' })).toBeNull();
});

// AC2: a pending save disables repeat edits until the API confirms the complete assignment.
it('AC2 - disables assignment controls while saving', async () => {
  let resolveSave;
  api.put.mockImplementation(() => new Promise(resolve => { resolveSave = resolve; }));
  render(<TechnicalSupportAssignment event={event} token="coordinator-token" staff={staff} onSaved={vi.fn()} />);

  fireEvent.click(screen.getByRole('button', { name: 'Assign staff' }));

  const savingButton = await screen.findByRole('button', { name: 'Saving…' });
  expect(savingButton.disabled).toBe(true);
  expect(screen.getByRole('group', { name: 'Technical Support Staff' }).disabled).toBe(true);
  resolveSave({ message: 'Saved' });

  expect(await screen.findByRole('button', { name: 'Assignment saved' })).toBeTruthy();
});

// AC1: pending, empty, and failed support retrieval have different accessible feedback.
it('AC1 - shows the loading state before an empty support response', async () => {
  let resolveEvents;
  api.get.mockImplementation(() => new Promise(resolve => { resolveEvents = resolve; }));
  render(<OnSiteSupportSection token="staff-token" />);

  expect(screen.getByRole('status').textContent).toBe('Loading support assignments...');
  resolveEvents({});

  expect(await screen.findByRole('heading', { name: 'No assigned events yet.' })).toBeTruthy();
  expect(screen.getByText('0 events')).toBeTruthy();
});

// AC1: an unavailable support endpoint is reported rather than shown as an empty assignment list.
it('AC1 - reports support assignment retrieval failures', async () => {
  api.get.mockRejectedValue(new Error('Support assignments are unavailable.'));
  render(<OnSiteSupportSection token="staff-token" />);

  expect((await screen.findByRole('alert')).textContent).toBe('Support assignments are unavailable.');
  expect(screen.queryByRole('heading', { name: 'No assigned events yet.' })).toBeNull();
});

// AC1: optional schedule, venue, equipment, and note fields use explicit fallbacks without hiding provided details.
it('AC1 - displays event and equipment fallbacks alongside available support details', async () => {
  api.get.mockResolvedValue({
    events: [
      {
        id: 8,
        name: '',
        purpose: '',
        status: 'under_review',
        proposed_start_time: '09:45:00',
        venue_name: 'Studio West',
        venue_location: 'Level 2',
        equipment_items: [],
        equipment_notes: 'Bring adapters',
        technical_support_details: 'Use the side entrance.',
      },
      {
        id: 9,
        name: 'Evening Session',
        purpose: 'Panel discussion',
        venue_name: 'Main Hall',
        venue_location: '',
        equipment_items: null,
        equipment_notes: '',
        technical_support_details: '',
      },
    ],
  });
  render(<OnSiteSupportSection token="staff-token" />);

  expect(await screen.findByText('2 events')).toBeTruthy();
  const unnamedEvent = screen.getByRole('article', { name: 'Untitled Event' });
  expect(within(unnamedEvent).getByText('No purpose provided')).toBeTruthy();
  expect(within(unnamedEvent).getByText('under review')).toBeTruthy();
  expect(within(unnamedEvent).getByText('Not specified')).toBeTruthy();
  expect(within(unnamedEvent).getByText('09:45 – Not specified')).toBeTruthy();
  expect(within(unnamedEvent).getByText('Studio West · Level 2')).toBeTruthy();
  expect(within(unnamedEvent).getByText('Bring adapters')).toBeTruthy();
  expect(within(unnamedEvent).getByText('Use the side entrance.')).toBeTruthy();

  const eventWithoutOptionalDetails = screen.getByRole('article', { name: 'Evening Session' });
  expect(within(eventWithoutOptionalDetails).getByText('Assigned')).toBeTruthy();
  expect(within(eventWithoutOptionalDetails).getByText('Not specified – Not specified')).toBeTruthy();
  expect(within(eventWithoutOptionalDetails).getByText('Main Hall')).toBeTruthy();
  expect(within(eventWithoutOptionalDetails).getByText('No equipment details provided.')).toBeTruthy();
  expect(within(eventWithoutOptionalDetails).queryByText('Support notes')).toBeNull();
});
