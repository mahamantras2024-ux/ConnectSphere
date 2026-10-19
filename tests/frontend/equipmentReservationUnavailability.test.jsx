// File: Covers the inventory impact action and both sides of the replacement proposal workflow.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../frontend/src/api/client';
import { useAuth } from '../../frontend/src/context/AuthContext';
import EquipmentReservationIssuesSection from '../../frontend/src/pages/events/EquipmentReservationIssuesSection';
import EquipmentInventorySection from '../../frontend/src/pages/tech-support/EquipmentInventorySection';
import EquipmentReservationSection from '../../frontend/src/pages/tech-support/EquipmentReservationSection';
import TechSupportDashboard from '../../frontend/src/pages/tech-support/TechSupportDashboard';

vi.mock('../../frontend/src/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));
vi.mock('../../frontend/src/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

const inventory = [{
  id: 91, asset_code: 'PROJ-001', name: 'Projector', specification: 'Full HD',
  status: 'operational', availability_status: 'Available', quantity: 1, availabilities: [], status_history: [],
}];
const issue = {
  id: 601, reservation_id: 901, event_id: 501, event_name: 'Community Workshop',
  event_date: '2030-10-12', start_time: '09:00:00', end_time: '12:00:00',
  unavailable_asset_code: 'PROJ-001', equipment_name: 'Projector', quantity: 1,
  reason: 'Damaged during setup', alternatives: [{
    id: 92, assetCode: 'PROJ-002', name: 'Projector', specification: '4K', availableQuantity: 2,
  }], proposal: null,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function configureDashboardApi({ currentInventory = inventory, affectedReservations = [] } = {}) {
  api.get.mockImplementation(async endpoint => {
    if (endpoint === '/events/equipment-requests') return { requests: [] };
    if (endpoint === '/events/equipment-inventory') return { inventory: currentInventory };
    if (endpoint === '/events/equipment-reservations') return { requests: [], reservations: [] };
    if (endpoint === '/events/equipment-reservation-issues') return { affectedReservations };
    if (endpoint === '/events/on-site-support') return { events: [] };
    if (endpoint === '/notifications') return { notifications: [], unreadCount: 0 };
    throw new Error(`Unexpected GET ${endpoint}`);
  });
}

// AC1 - The inventory action records why a currently available item must be withdrawn.
it('AC1 - requires a reason and submits the equipment unavailability report', async () => {
  const onMarkUnavailable = vi.fn().mockResolvedValue({});
  render(<EquipmentInventorySection inventory={inventory} error="" onMarkUnavailable={onMarkUnavailable} />);
  const row = screen.getByRole('row', { name: /PROJ-001 Projector/ });

  fireEvent.change(within(row).getByLabelText('Status for PROJ-001'), { target: { value: 'Unavailable' } });
  fireEvent.click(within(row).getByRole('button', { name: 'Confirm unavailable' }));
  expect((await within(row).findByRole('alert')).textContent).toBe('Enter why this equipment is unavailable.');
  expect(onMarkUnavailable).not.toHaveBeenCalled();

  fireEvent.change(within(row).getByLabelText('Reason for unavailability of PROJ-001'), {
    target: { value: '  Damaged during setup  ' },
  });
  fireEvent.click(within(row).getByRole('button', { name: 'Confirm unavailable' }));

  await waitFor(() => expect(onMarkUnavailable).toHaveBeenCalledWith(
    expect.objectContaining({ id: 91, asset_code: 'PROJ-001' }),
    'Damaged during setup',
  ));
});

// UI AC1 - The compact status dropdown reflects inventory state and changing back cancels an unsubmitted transition.
it('UI AC1 - shows the current status and cancels a pending change when reset', () => {
  const onMarkUnavailable = vi.fn();
  render(<EquipmentInventorySection inventory={inventory} error="" onMarkUnavailable={onMarkUnavailable} />);
  const row = screen.getByRole('row', { name: /PROJ-001 Projector/ });
  const status = within(row).getByLabelText('Status for PROJ-001');

  expect(status.value).toBe('Available');
  expect(Array.from(status.options, option => option.value)).toEqual(['Available', 'Unavailable']);

  fireEvent.change(status, { target: { value: 'Unavailable' } });
  expect(within(row).getByLabelText('Reason for unavailability of PROJ-001')).toBeTruthy();
  fireEvent.change(status, { target: { value: 'Available' } });

  expect(within(row).queryByLabelText('Reason for unavailability of PROJ-001')).toBeNull();
  expect(onMarkUnavailable).not.toHaveBeenCalled();
});

// AC1 - A failed unavailability report stays visible and can be corrected before retrying.
it('AC1 - displays an unavailability failure and clears it when the reason changes', async () => {
  const onMarkUnavailable = vi.fn().mockRejectedValue({});
  render(<EquipmentInventorySection inventory={inventory} error="" onMarkUnavailable={onMarkUnavailable} />);
  const row = screen.getByRole('row', { name: /PROJ-001 Projector/ });

  fireEvent.change(within(row).getByLabelText('Status for PROJ-001'), { target: { value: 'Unavailable' } });
  fireEvent.change(within(row).getByLabelText('Reason for unavailability of PROJ-001'), {
    target: { value: 'Damaged during setup' },
  });
  fireEvent.click(within(row).getByRole('button', { name: 'Confirm unavailable' }));

  expect((await within(row).findByRole('alert')).textContent).toBe('Unable to mark equipment unavailable.');
  fireEvent.change(within(row).getByLabelText('Reason for unavailability of PROJ-001'), {
    target: { value: 'Maintenance required' },
  });
  expect(within(row).queryByRole('alert')).toBeNull();
});

// AC2 AC3 - Assigned support can see a flagged reservation and submit a same-type available replacement.
it('AC2 AC3 - shows the affected reservation and submits its alternative proposal', async () => {
  const onAlternativeProposed = vi.fn();
  api.post.mockResolvedValue({ proposal: { id: 701, status: 'pending' } });
  render(<EquipmentReservationSection
    requests={[]}
    reservations={[]}
    affectedReservations={[issue]}
    token="support-token"
    onReserved={vi.fn()}
    onAlternativeProposed={onAlternativeProposed}
  />);
  const card = screen.getByRole('article', { name: 'Community Workshop' });
  expect(within(card).getByText(/PROJ-001 — Projector × 1 is unavailable/)).toBeTruthy();
  fireEvent.change(within(card).getByLabelText('Propose available alternative'), { target: { value: '92' } });
  fireEvent.click(within(card).getByRole('button', { name: 'Send proposal to Coordinator' }));

  await waitFor(() => expect(api.post).toHaveBeenCalledWith(
    '/events/equipment-reservation-issues/601/proposals',
    { alternativeInventoryId: 92 },
    'support-token',
  ));
  expect(onAlternativeProposed).toHaveBeenCalledWith(issue);
});

// AC3 - Missing choices are rejected locally and an unavailable replacement list cannot be submitted.
it('AC3 - blocks a proposal without an available alternative', async () => {
  render(<EquipmentReservationSection
    requests={[]}
    reservations={[]}
    affectedReservations={[{ ...issue, alternatives: [] }]}
    token="support-token"
    onReserved={vi.fn()}
  />);
  const card = screen.getByRole('article', { name: 'Community Workshop' });

  expect(within(card).getByText('No matching alternative is available for this reservation.')).toBeTruthy();
  expect(within(card).getByRole('button', { name: 'Send proposal to Coordinator' }).hasAttribute('disabled')).toBe(true);
});

// AC3 - A proposal transport failure is surfaced rather than presented as a successful submission.
it('AC3 - displays a replacement proposal failure', async () => {
  api.post.mockRejectedValueOnce({});
  render(<EquipmentReservationSection
    requests={[]}
    reservations={[]}
    affectedReservations={[issue]}
    token="support-token"
    onReserved={vi.fn()}
  />);
  const card = screen.getByRole('article', { name: 'Community Workshop' });
  fireEvent.change(within(card).getByLabelText('Propose available alternative'), { target: { value: '92' } });
  fireEvent.click(within(card).getByRole('button', { name: 'Send proposal to Coordinator' }));

  expect((await within(card).findByRole('alert')).textContent).toBe('Unable to send the replacement proposal.');
});

// AC3 - A submission without a selected asset is rejected before reaching the proposal endpoint.
it('AC3 - requires a replacement selection before sending a proposal', async () => {
  render(<EquipmentReservationSection
    requests={[]}
    reservations={[]}
    affectedReservations={[issue]}
    token="support-token"
    onReserved={vi.fn()}
  />);
  const card = screen.getByRole('article', { name: 'Community Workshop' });

  fireEvent.click(within(card).getByRole('button', { name: 'Send proposal to Coordinator' }));

  expect((await within(card).findByRole('alert')).textContent).toBe('Choose an available alternative.');
  expect(api.post).not.toHaveBeenCalled();
});

// AC3 - A pending proposal is shown without exposing duplicate proposal controls.
it('AC3 - keeps a pending replacement proposal read-only for Technical Support', () => {
  render(<EquipmentReservationSection
    requests={[]}
    reservations={[]}
    affectedReservations={[{
      ...issue,
      proposal: { status: 'pending', assetCode: 'PROJ-002', name: 'Projector', quantity: 1 },
    }]}
    token="support-token"
    onReserved={vi.fn()}
  />);
  const card = screen.getByRole('article', { name: 'Community Workshop' });

  expect(within(card).getByText(/Awaiting Coordinator decision: PROJ-002/)).toBeTruthy();
  expect(within(card).queryByRole('button', { name: 'Send proposal to Coordinator' })).toBeNull();
});

// AC3 - A rejected proposal remains visible while support can submit a revised alternative.
it('AC3 - shows a rejected proposal and allows Technical Support to retry', async () => {
  api.post.mockResolvedValue({ proposal: { id: 702, status: 'pending' } });
  render(<EquipmentReservationSection
    requests={[]}
    reservations={[]}
    affectedReservations={[{
      ...issue,
      proposal: { status: 'rejected', assetCode: 'PROJ-002', name: 'Projector', quantity: 1 },
    }]}
    token="support-token"
    onReserved={vi.fn()}
  />);
  const card = screen.getByRole('article', { name: 'Community Workshop' });

  expect(within(card).getByText(/Latest proposal rejected: PROJ-002/)).toBeTruthy();
  fireEvent.change(within(card).getByLabelText('Propose available alternative'), { target: { value: '92' } });
  fireEvent.click(within(card).getByRole('button', { name: 'Send proposal to Coordinator' }));

  await waitFor(() => expect(api.post).toHaveBeenCalledWith(
    '/events/equipment-reservation-issues/601/proposals',
    { alternativeInventoryId: 92 },
    'support-token',
  ));
});

// AC1-AC3 - Dashboard actions persist unavailability and refresh the visible inventory and issue data.
it('AC1-AC3 - marks equipment unavailable and reports how many reservations were flagged', async () => {
  useAuth.mockReturnValue({ token: 'support-token' });
  const currentInventory = [...inventory, { ...inventory[0], id: 93, asset_code: 'STAND-001', name: 'Stand' }];
  configureDashboardApi({ currentInventory });
  api.put.mockImplementation(async () => {
    currentInventory[0] = { ...inventory[0], status: 'maintenance', availability_status: 'Unavailable' };
    return { equipment: currentInventory[0], affectedIssues: [issue] };
  });
  render(<TechSupportDashboard />);

  const row = await screen.findByRole('row', { name: /PROJ-001 Projector/ });
  fireEvent.change(within(row).getByLabelText('Status for PROJ-001'), { target: { value: 'Unavailable' } });
  fireEvent.change(within(row).getByLabelText('Reason for unavailability of PROJ-001'), {
    target: { value: 'Damaged during setup' },
  });
  fireEvent.click(within(row).getByRole('button', { name: 'Confirm unavailable' }));

  expect((await screen.findByRole('status')).textContent).toBe(
    'PROJ-001 marked unavailable. 1 reservation(s) flagged.',
  );
  expect(api.put).toHaveBeenCalledWith(
    '/events/equipment-inventory/91/unavailable',
    { reason: 'Damaged during setup' },
    'support-token',
  );
  expect(within(row).getByLabelText('Status for PROJ-001').value).toBe('Unavailable');
  expect(screen.getByRole('row', { name: /STAND-001 Stand/ })).toBeTruthy();
});

// AC3 - Dashboard refreshes the affected list and confirms the notification to the Coordinator.
it('AC3 - refreshes affected reservations after a replacement proposal is sent', async () => {
  useAuth.mockReturnValue({ token: 'support-token' });
  configureDashboardApi({ affectedReservations: [issue] });
  api.post.mockResolvedValue({ proposal: { id: 701, status: 'pending' } });
  render(<TechSupportDashboard />);
  fireEvent.click(await screen.findByRole('tab', { name: 'Equipment reservation' }));

  const card = await screen.findByRole('article', { name: 'Community Workshop' });
  fireEvent.change(within(card).getByLabelText('Propose available alternative'), { target: { value: '92' } });
  fireEvent.click(within(card).getByRole('button', { name: 'Send proposal to Coordinator' }));

  expect((await screen.findByRole('status')).textContent).toBe(
    'Replacement proposal sent to the Event Coordinator.',
  );
});

// AC4 - The assigned Coordinator can accept a proposal, after which the affected issue disappears on refresh.
it('AC4 - accepts the proposal from the event page and reloads the issue list', async () => {
  api.get.mockResolvedValueOnce({ affectedReservations: [{
    ...issue,
    proposals: [{ id: 701, status: 'pending', assetCode: 'PROJ-002', name: 'Projector', quantity: 1, proposedBy: 'Taylor' }],
  }] }).mockResolvedValueOnce({ affectedReservations: [] });
  api.post.mockResolvedValue({ decision: 'accepted' });
  render(<EquipmentReservationIssuesSection eventId={501} token="coordinator-token" />);

  const card = await screen.findByRole('listitem');
  expect(within(card).getByText(/Pending proposal: PROJ-002 — Projector × 1/)).toBeTruthy();
  fireEvent.click(within(card).getByRole('button', { name: 'Accept alternative' }));

  await waitFor(() => expect(api.post).toHaveBeenCalledWith(
    '/events/equipment-reservation-proposals/701/decision',
    { decision: 'accepted' },
    'coordinator-token',
  ));
  expect(await screen.findByText('No confirmed reservations are affected by unavailable equipment.')).toBeTruthy();
});

// AC4 - An event response without proposal metadata is rejected as malformed instead of rendered as success.
it('AC4 - reports malformed affected-reservation data from the event API', async () => {
  api.get.mockResolvedValue({ affectedReservations: [{ ...issue }] });
  render(<EquipmentReservationIssuesSection eventId={501} token="coordinator-token" />);

  expect((await screen.findByRole('alert')).textContent).toBe(
    'Affected reservation details are unavailable right now.',
  );
});

// AC4 - A transport error without a message uses the event issue panel's visible fallback.
it('AC4 - reports a fallback when affected reservations cannot be loaded', async () => {
  api.get.mockRejectedValue({});
  render(<EquipmentReservationIssuesSection eventId={501} token="coordinator-token" />);

  expect((await screen.findByRole('alert')).textContent).toBe('Unable to load affected reservations.');
});

// AC4 - A valid affected reservation with no proposals explains why no decision controls are shown.
it('AC4 - explains when Technical Support has not proposed an alternative', async () => {
  api.get.mockResolvedValue({ affectedReservations: [{ ...issue, proposals: [] }] });
  render(<EquipmentReservationIssuesSection eventId={501} token="coordinator-token" />);

  expect(await screen.findByText('Technical Support has not proposed an alternative yet.')).toBeTruthy();
});

// AC4 - Decision failures expose both the API message and the fallback for an unstructured rejection.
it('AC4 - keeps a proposal available and reports failed Coordinator decisions', async () => {
  api.get.mockResolvedValue({ affectedReservations: [{
    ...issue,
    proposals: [{ id: 701, status: 'pending', assetCode: 'PROJ-002', name: 'Projector', quantity: 1 }],
  }] });
  api.post.mockRejectedValueOnce(new Error('Decision service is unavailable.')).mockRejectedValueOnce({});
  render(<EquipmentReservationIssuesSection eventId={501} token="coordinator-token" />);

  let card = await screen.findByRole('listitem');
  fireEvent.click(within(card).getByRole('button', { name: 'Accept alternative' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Decision service is unavailable.');
  expect(within(card).getByRole('button', { name: 'Accept alternative' })).toBeTruthy();

  fireEvent.click(within(card).getByRole('button', { name: 'Reject alternative' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Unable to record the Coordinator decision.');
  expect(within(card).getByRole('button', { name: 'Reject alternative' })).toBeTruthy();
});

// AC4 - A rejection is recorded and keeps the flagged issue available for another proposal.
it('AC4 - rejects the proposal without hiding the affected reservation', async () => {
  api.get.mockResolvedValueOnce({ affectedReservations: [{
    ...issue,
    proposals: [{ id: 701, status: 'pending', assetCode: 'PROJ-002', name: 'Projector', quantity: 1 }],
  }] }).mockResolvedValueOnce({ affectedReservations: [{
    ...issue,
    proposals: [{ id: 701, status: 'rejected', assetCode: 'PROJ-002', name: 'Projector', quantity: 1 }],
  }] });
  api.post.mockResolvedValue({ decision: 'rejected' });
  render(<EquipmentReservationIssuesSection eventId={501} token="coordinator-token" />);

  const card = await screen.findByRole('listitem');
  fireEvent.click(within(card).getByRole('button', { name: 'Reject alternative' }));

  await waitFor(() => expect(api.post).toHaveBeenCalledWith(
    '/events/equipment-reservation-proposals/701/decision',
    { decision: 'rejected' },
    'coordinator-token',
  ));
  expect(await screen.findByText('Proposal rejected: PROJ-002 — Projector × 1')).toBeTruthy();
});
