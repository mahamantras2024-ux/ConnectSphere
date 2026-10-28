// File: Covers the inventory impact action and both sides of the replacement proposal workflow.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../frontend/src/api/client';
import { useAuth } from '../../frontend/src/context/AuthContext';
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
    asset_code: 'PROJ-002', available_quantity: 2,
  }], proposal: null, suggestion_status: 'awaiting_staff',
  original_asset_code: 'PROJ-001', original_name: 'Projector',
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
  fireEvent.click(within(row).getByRole('button', { name: 'Mark Unavailable' }));
  expect((await within(row).findByRole('alert')).textContent).toBe('Enter why this equipment is unavailable.');
  expect(onMarkUnavailable).not.toHaveBeenCalled();

  fireEvent.change(within(row).getByLabelText('Reason for unavailability of PROJ-001'), {
    target: { value: '  Damaged during setup  ' },
  });
  fireEvent.click(within(row).getByRole('button', { name: 'Mark Unavailable' }));

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
  fireEvent.click(within(row).getByRole('button', { name: 'Mark Unavailable' }));

  expect((await within(row).findByRole('alert')).textContent).toBe('Unable to mark equipment unavailable.');
  fireEvent.change(within(row).getByLabelText('Reason for unavailability of PROJ-001'), {
    target: { value: 'Maintenance required' },
  });
  expect(within(row).queryByRole('alert')).toBeNull();
});

// AC2 AC3 - Staff can submit a same-type replacement using the current suggestion endpoint.
it('AC2 AC3 - submits a selected replacement suggestion', async () => {
  const onSuggestionSubmitted = vi.fn();
  api.put.mockResolvedValue({ message: 'Replacement suggestion sent to the Event Coordinator.' });
  render(<EquipmentReservationSection
    requests={[]}
    reservations={[]}
    affectedReservations={[issue]}
    token="support-token"
    onReserved={vi.fn()}
    onSuggestionSubmitted={onSuggestionSubmitted}
  />);
  const card = screen.getByRole('article', { name: 'Community Workshop' });
  fireEvent.change(within(card).getByLabelText('Replacement for PROJ-001 at Community Workshop'), {
    target: { value: '92' },
  });
  fireEvent.click(within(card).getByRole('button', { name: 'Send suggestion to coordinator' }));

  await waitFor(() => expect(api.put).toHaveBeenCalledWith(
    '/events/equipment-reservation-issues/601/suggestion',
    { alternativeInventoryId: 92 },
    'support-token',
  ));
  expect(onSuggestionSubmitted).toHaveBeenCalledOnce();
});

// AC3 - An unavailable alternative list is explicit and does not expose a submission control.
it('AC3 - explains when an awaiting-staff reservation has no replacement candidates', () => {
  render(<EquipmentReservationSection
    requests={[]}
    reservations={[]}
    affectedReservations={[{ ...issue, alternatives: [] }]}
    token="support-token"
  />);
  const card = screen.getByRole('article', { name: 'Community Workshop' });

  expect(within(card).getByText(
    'No replacements found for this event slot. The reservation remains flagged for staff follow-up.',
  )).toBeTruthy();
  expect(within(card).queryByRole('button', { name: 'Send suggestion to coordinator' })).toBeNull();
});

// AC1-AC3 - Dashboard actions persist unavailability and refresh the visible inventory and issue data.
it('AC1-AC3 - marks equipment unavailable and reports how many reservations were flagged', async () => {
  useAuth.mockReturnValue({ token: 'support-token' });
  const currentInventory = [...inventory, { ...inventory[0], id: 93, asset_code: 'STAND-001', name: 'Stand' }];
  configureDashboardApi({ currentInventory, affectedReservations: [issue] });
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
  fireEvent.click(within(row).getByRole('button', { name: 'Mark Unavailable' }));

  expect(await screen.findByText(
    'PROJ-001 marked unavailable. Choose replacement suggestions for 1 affected reservation(s).',
  )).toBeTruthy();
  expect(api.put).toHaveBeenCalledWith(
    '/events/equipment-inventory/91/unavailable',
    { reason: 'Damaged during setup' },
    'support-token',
  );
  expect(screen.getByRole('article', { name: 'Community Workshop' })).toBeTruthy();
});

// AC3 - Dashboard refreshes the affected list and confirms the notification to the Coordinator.
it('AC3 - refreshes affected reservations after a replacement proposal is sent', async () => {
  useAuth.mockReturnValue({ token: 'support-token' });
  configureDashboardApi({ affectedReservations: [issue] });
  api.put.mockResolvedValue({ message: 'Replacement suggestion sent to the Event Coordinator.' });
  render(<TechSupportDashboard />);
  fireEvent.click(await screen.findByRole('tab', { name: 'Equipment reservation' }));

  const card = await screen.findByRole('article', { name: 'Community Workshop' });
  fireEvent.change(within(card).getByLabelText('Replacement for PROJ-001 at Community Workshop'), {
    target: { value: '92' },
  });
  fireEvent.click(within(card).getByRole('button', { name: 'Send suggestion to coordinator' }));

  await waitFor(() => expect(api.put).toHaveBeenCalledWith(
    '/events/equipment-reservation-issues/601/suggestion',
    { alternativeInventoryId: 92 },
    'support-token',
  ));
  expect(await screen.findByText(
    'Replacement proposal sent to the Event Coordinator.',
  )).toBeTruthy();
});
