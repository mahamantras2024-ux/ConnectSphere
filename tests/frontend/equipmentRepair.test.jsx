// File: Verifies the Technical Support repair workflow from the inventory table through its authenticated API calls.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../frontend/src/api/client';
import { useAuth } from '../../frontend/src/context/AuthContext';
import TechSupportDashboard from '../../frontend/src/pages/tech-support/TechSupportDashboard';

vi.mock('../../frontend/src/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const unavailableEquipment = {
  id: 91,
  asset_code: 'REPAIR-DEMO-001',
  name: 'Repair Demo Laptop',
  specification: '16GB RAM, replacement display',
  status: 'maintenance',
  availability_status: 'Unavailable',
  quantity: 1,
  availabilities: [{
    date: '2026-10-25',
    startTime: '09:00:00',
    endTime: '17:00:00',
    status: 'Available',
    availableQuantity: 1,
  }],
  status_history: [{
    id: 7,
    status: 'Unavailable',
    note: 'Seeded damage reason: display cracked during setup.',
    changed_at: '2026-10-10T09:00:00.000Z',
    changed_by_name: null,
  }],
};

const availableEquipment = {
  ...unavailableEquipment,
  id: 92,
  asset_code: 'REPAIR-DEMO-002',
  name: 'Repair Demo Microphone',
  availability_status: 'Available',
  status: 'operational',
  status_history: [],
};
let affectedReservations;
let reservationLoadError;

const affectedReservation = overrides => ({
  id: 71,
  reservation_id: 301,
  inventory_id: 91,
  event_id: 401,
  event_name: 'Town Hall',
  event_date: '2026-11-18',
  start_time: '09:00:00',
  end_time: '12:00:00',
  quantity: 2,
  reason: 'Battery failed inspection',
  suggestion_status: 'awaiting_staff',
  original_asset_code: 'REPAIR-DEMO-001',
  original_name: 'Repair Demo Laptop',
  alternatives: [{
    id: 92,
    asset_code: 'REPAIR-DEMO-002',
    name: 'Repair Demo Microphone',
    available_quantity: 2,
  }],
  ...overrides,
});

// Builds the server's updated item while preserving its original damage audit entry.
function repairedEquipment(note) {
  return {
    ...unavailableEquipment,
    status: 'operational',
    availability_status: 'Available',
    status_history: [
      ...unavailableEquipment.status_history,
      {
        id: 8,
        status: 'Available',
        note,
        changed_at: '2026-10-17T11:00:00.000Z',
        changed_by_name: 'Taylor Support',
      },
    ],
  };
}

// Exercises the dashboard's inventory tab, not a detached form-only rendering.
async function openRepairForm() {
  render(<TechSupportDashboard />);
  const row = await screen.findByRole('row', { name: /REPAIR-DEMO-001 Repair Demo Laptop/ });
  fireEvent.change(within(row).getByRole('combobox', { name: 'Status for REPAIR-DEMO-001' }), {
    target: { value: 'Available' },
  });
  return row;
}

// Reads the newest audit badge without matching the dropdown's option text.
function getLatestHistoryStatus(row, assetCode) {
  const statuses = within(row)
    .getByRole('list', { name: `Status history for ${assetCode}` })
    .querySelectorAll('.equipment-status-history-status');
  return statuses.item(statuses.length - 1);
}

beforeEach(() => {
  affectedReservations = [];
  reservationLoadError = null;
  useAuth.mockReturnValue({ token: 'support-token' });
  vi.spyOn(api, 'get').mockImplementation(async endpoint => {
    if (endpoint === '/events/equipment-requests') return { requests: [] };
    if (endpoint === '/events/equipment-inventory') return { inventory: [unavailableEquipment, availableEquipment] };
    if (endpoint === '/events/equipment-reservations') {
      if (reservationLoadError) throw reservationLoadError;
      return { requests: [], reservations: [], affectedReservations };
    }
    if (endpoint === '/events/on-site-support') return { events: [] };
    if (endpoint === '/notifications') return { notifications: [], unreadCount: 0 };
    throw new Error(`Unexpected GET ${endpoint}`);
  });
  vi.spyOn(api, 'put').mockImplementation(async (endpoint, body) => {
    if (endpoint.endsWith('/unavailable')) {
      return {
        equipment: {
          ...availableEquipment,
          availability_status: 'Unavailable',
          status_history: [{
            id: 9,
            status: 'Unavailable',
            note: body.reason,
            changed_at: '2026-10-18T11:00:00.000Z',
            changed_by_name: 'Taylor Support',
          }],
        },
        affectedIssues: [{ id: 1, reservationId: 2, eventId: 3 }],
      };
    }
    if (endpoint.includes('/suggestion')) {
      affectedReservations = affectedReservations.map(issue => ({
        ...issue,
        suggestion_status: 'pending',
      }));
      return { message: 'Replacement suggestion sent to the Event Coordinator.' };
    }
    return { equipment: repairedEquipment(body.resolutionNote) };
  });
});

// AC1 - Only a successful repair transition changes the visible equipment state to Available.
it('AC1 - changes an unavailable item to Available after saving its repair', async () => {
  // Arrange
  const row = await openRepairForm();
  fireEvent.change(screen.getByRole('textbox', { name: 'Resolution note' }), {
    target: { value: 'Screen replaced' },
  });

  // Act
  fireEvent.click(screen.getByRole('button', { name: 'Mark Available', exact: true }));

  // Assert: stale status means the repair transition was not applied to the inventory row.
  await waitFor(() => expect(getLatestHistoryStatus(row, 'REPAIR-DEMO-001').textContent).toBe('Available'));
  expect(within(row).queryByRole('button', { name: 'Mark Available' })).toBeNull();
});

// AC2 - Empty and whitespace-only resolutions must not be sent to the status-transition API.
it('AC2 - rejects an empty resolution note before updating status', async () => {
  // Arrange
  const row = await openRepairForm();

  // Act
  fireEvent.click(within(row).getByRole('button', { name: 'Mark Available', exact: true }));

  // Assert: missing validation would persist a repair with no auditable explanation.
  expect((await screen.findByRole('alert')).textContent).toMatch(/Enter a brief resolution note/);
  expect(api.put).not.toHaveBeenCalled();
});

// AC2 - Whitespace is not a meaningful resolution note and is rejected without an API request.
it('AC2 - rejects a whitespace-only resolution note before updating status', async () => {
  // Arrange
  const row = await openRepairForm();
  fireEvent.change(screen.getByRole('textbox', { name: 'Resolution note' }), {
    target: { value: '   \n  ' },
  });

  // Act
  fireEvent.click(within(row).getByRole('button', { name: 'Mark Available', exact: true }));

  // Assert: trimming after persistence would incorrectly accept an empty history entry.
  expect((await screen.findByRole('alert')).textContent).toMatch(/Enter a brief resolution note/);
  expect(api.put).not.toHaveBeenCalled();
});

// AC2 - A meaningful note is trimmed at the form boundary and is included in the persisted request.
it('AC2 - submits the trimmed resolution note with the repair request', async () => {
  // Arrange
  const row = await openRepairForm();
  fireEvent.change(screen.getByRole('textbox', { name: 'Resolution note' }), {
    target: { value: '  Screen replaced  ' },
  });

  // Act
  fireEvent.click(within(row).getByRole('button', { name: 'Mark Available', exact: true }));

  // Assert: the API receives the human-entered reason without accidental surrounding whitespace.
  await waitFor(() => expect(api.put).toHaveBeenCalledWith(
    '/events/equipment-inventory/91/repair',
    { resolutionNote: 'Screen replaced' },
    'support-token',
  ));
});

// AC3 - Repaired equipment is present in the available inventory pool immediately after the save.
it('AC3 - keeps the repaired asset in inventory with Available status', async () => {
  // Arrange
  const row = await openRepairForm();
  fireEvent.change(screen.getByRole('textbox', { name: 'Resolution note' }), {
    target: { value: 'Routine maintenance completed' },
  });

  // Act
  fireEvent.click(within(row).getByRole('button', { name: 'Mark Available', exact: true }));

  // Assert: it remains in the inventory table and is no longer represented as unavailable.
  await waitFor(() => expect(within(row).getByText('Available')).toBeTruthy());
  expect(within(row).getByRole('rowheader', { name: 'REPAIR-DEMO-001' })).toBeTruthy();
});

// AC4 - The audit history displays both the seeded damage reason and the new repair resolution.
it('AC4 - shows the updated status and resolution note in equipment history', async () => {
  // Arrange
  const row = await openRepairForm();
  expect(within(row).getByRole('combobox', { name: 'Status for REPAIR-DEMO-001' })).toBeTruthy();
  fireEvent.change(screen.getByRole('textbox', { name: 'Resolution note' }), {
    target: { value: 'Screen replaced' },
  });

  // Act
  fireEvent.click(within(row).getByRole('button', { name: 'Mark Available', exact: true }));

  // Assert: missing or overwritten audit entries would hide one of these distinct events.
  expect(await within(row).findByText('Screen replaced')).toBeTruthy();
  expect(within(row).getByText(/Seeded damage reason: display cracked during setup\./)).toBeTruthy();
  expect(getLatestHistoryStatus(row, 'REPAIR-DEMO-001').textContent).toBe('Available');
  expect(within(row).getByText('10 Oct 2026')).toBeTruthy();
  const history = within(row).getByRole('list', { name: 'Status history for REPAIR-DEMO-001' });
  expect(history.querySelector('.equipment-status-history-status')).toBeTruthy();
  expect(history.querySelector('.equipment-status-history-meta')).toBeTruthy();
});

// AC1 - Selecting Unavailable requires an auditable reason and marks the inventory row through the impact API.
it('AC1 - marks equipment unavailable from the status dropdown and reports affected reservations', async () => {
  // Arrange
  render(<TechSupportDashboard />);
  const row = await screen.findByRole('row', { name: /REPAIR-DEMO-002 Repair Demo Microphone/ });
  fireEvent.change(within(row).getByRole('combobox', { name: 'Status for REPAIR-DEMO-002' }), {
    target: { value: 'Unavailable' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Reason for unavailability of REPAIR-DEMO-002' }), {
    target: { value: 'Battery failed inspection' },
  });

  // Act
  fireEvent.click(within(row).getByRole('button', { name: 'Mark Unavailable' }));

  // Assert: the affected reservation gets the next action, rather than leaving staff on an obsolete inventory view.
  await waitFor(() => expect(api.put).toHaveBeenCalledWith(
    '/events/equipment-inventory/92/unavailable',
    { reason: 'Battery failed inspection' },
    'support-token',
  ));
  expect(await screen.findByText(/Choose replacement suggestions for 1 affected reservation/)).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'Equipment reservation' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.queryByRole('row', { name: /REPAIR-DEMO-002 Repair Demo Microphone/ })).toBeNull();
});

// AC2 - Technical Support chooses an eligible replacement and sends it to the Event Coordinator.
it('AC2 - sends the selected replacement for an affected reservation', async () => {
  // Arrange
  affectedReservations = [affectedReservation({})];
  render(<TechSupportDashboard />);
  fireEvent.click(await screen.findByRole('tab', { name: 'Equipment reservation' }));
  const replacement = await screen.findByRole('combobox', {
    name: 'Replacement for REPAIR-DEMO-001 at Town Hall',
  });
  fireEvent.change(replacement, { target: { value: '92' } });

  // Act
  fireEvent.click(screen.getByRole('button', { name: 'Send suggestion to coordinator' }));

  // Assert: the selected stock identity is sent and staff see the pending-coordinator state after refresh.
  await waitFor(() => expect(api.put).toHaveBeenCalledWith(
    '/events/equipment-reservation-issues/71/suggestion',
    { alternativeInventoryId: 92 },
    'support-token',
  ));
  expect(await screen.findByText('Replacement suggestion sent. Waiting for the Event Coordinator.')).toBeTruthy();
});

// AC2 - Affected reservations without an eligible alternative stay visibly open for staff follow-up.
it('AC2 - tells Technical Support when no replacement is currently available', async () => {
  // Arrange
  affectedReservations = [affectedReservation({
    suggestion_status: 'no_alternative',
    alternatives: [],
  })];
  render(<TechSupportDashboard />);
  fireEvent.click(await screen.findByRole('tab', { name: 'Equipment reservation' }));

  // Act: inspect the affected reservation without selecting or submitting replacement equipment.

  // Assert: absence of candidates is explicit and does not present a misleading replacement selector.
  expect(await screen.findByText('No replacement equipment is currently available for this event slot.')).toBeTruthy();
  expect(screen.queryByRole('combobox', { name: /Replacement for REPAIR-DEMO-001/ })).toBeNull();
});

// AC1 - A failed reservation load must not be presented as a confirmed empty schedule.
it('AC1 - shows unavailable reservation state instead of empty results when loading fails', async () => {
  // Arrange
  reservationLoadError = new Error('ConnectSphere is waiting for a database update.');
  render(<TechSupportDashboard />);
  fireEvent.click(await screen.findByRole('tab', { name: 'Equipment reservation' }));

  // Act: wait until the API failure has been rendered by the reservation workspace.

  // Assert: the error is visible and neither failed dataset is incorrectly reported as empty.
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'ConnectSphere is waiting for a database update.',
  );
  expect(screen.getByText('Unable to verify whether reservations need replacement arrangements.')).toBeTruthy();
  expect(screen.getByText('Unable to verify upcoming equipment reservations.')).toBeTruthy();
  expect(screen.queryByText('No upcoming reservations need replacement arrangements.')).toBeNull();
  expect(screen.queryByText('No upcoming equipment reservations.')).toBeNull();
});

// AC1 - An empty unavailability reason is rejected before sending a transition request.
it('AC1 - requires a reason before marking equipment unavailable', async () => {
  // Arrange
  render(<TechSupportDashboard />);
  const row = await screen.findByRole('row', { name: /REPAIR-DEMO-002 Repair Demo Microphone/ });
  fireEvent.change(within(row).getByRole('combobox', { name: 'Status for REPAIR-DEMO-002' }), {
    target: { value: 'Unavailable' },
  });

  // Act
  fireEvent.click(within(row).getByRole('button', { name: 'Mark Unavailable' }));

  // Assert: no unavailability may be recorded without a reason in status history.
  expect((await screen.findByRole('alert')).textContent).toContain('Enter why this equipment is unavailable.');
  expect(api.put).not.toHaveBeenCalled();
});

// AC1 - A failed unavailable transition leaves the old status visible and surfaces the API error.
it('AC1 - keeps equipment available and shows an error when marking it unavailable fails', async () => {
  // Arrange
  api.put.mockRejectedValueOnce(new Error('Status service is unavailable.'));
  render(<TechSupportDashboard />);
  const row = await screen.findByRole('row', { name: /REPAIR-DEMO-002 Repair Demo Microphone/ });
  fireEvent.change(within(row).getByRole('combobox', { name: 'Status for REPAIR-DEMO-002' }), {
    target: { value: 'Unavailable' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Reason for unavailability of REPAIR-DEMO-002' }), {
    target: { value: 'Battery failed inspection' },
  });

  // Act
  fireEvent.click(within(row).getByRole('button', { name: 'Mark Unavailable' }));

  // Assert: failure must not optimistically update inventory or masquerade as a successful transition.
  expect((await screen.findByRole('alert')).textContent).toContain('Status service is unavailable.');
  expect(within(row).getByRole('combobox', { name: 'Status for REPAIR-DEMO-002' }).value).toBe('Available');
});

// AC1 - A failed server response leaves the item unavailable and exposes the service error.
it('AC1 - keeps the item unavailable and displays a repair failure', async () => {
  // Arrange
  api.put.mockRejectedValueOnce(new Error('Repair service is unavailable.'));
  const row = await openRepairForm();
  fireEvent.change(screen.getByRole('textbox', { name: 'Resolution note' }), {
    target: { value: 'Screen replaced' },
  });

  // Act
  fireEvent.click(within(row).getByRole('button', { name: 'Mark Available', exact: true }));

  // Assert: failed persistence must not create a success-shaped local status transition.
  expect((await screen.findByRole('alert')).textContent).toBe('Repair service is unavailable.');
  expect(getLatestHistoryStatus(row, 'REPAIR-DEMO-001').textContent).toBe('Unavailable');
});

// AC1 - The save action communicates its pending state while the database update is in flight.
it('AC1 - disables repair submission until the status update completes', async () => {
  // Arrange
  let finishSave;
  api.put.mockReturnValueOnce(new Promise(resolve => { finishSave = resolve; }));
  const row = await openRepairForm();
  fireEvent.change(screen.getByRole('textbox', { name: 'Resolution note' }), {
    target: { value: 'Screen replaced' },
  });

  // Act
  fireEvent.click(within(row).getByRole('button', { name: 'Mark Available', exact: true }));

  // Assert the control communicates that duplicate transitions cannot be submitted concurrently.
  expect(within(row).getByRole('button', { name: 'Saving repair…' }).hasAttribute('disabled')).toBe(true);
  finishSave({ equipment: repairedEquipment('Screen replaced') });
  await waitFor(() => expect(getLatestHistoryStatus(row, 'REPAIR-DEMO-001').textContent).toBe('Available'));
});

// AC1 - An unstructured transport failure still produces a visible, non-silent error.
it('AC1 - shows a fallback message when repair fails without a server message', async () => {
  // Arrange
  api.put.mockRejectedValueOnce({});
  const row = await openRepairForm();
  fireEvent.change(screen.getByRole('textbox', { name: 'Resolution note' }), {
    target: { value: 'Screen replaced' },
  });

  // Act
  fireEvent.click(within(row).getByRole('button', { name: 'Mark Available', exact: true }));

  // Assert: unknown failures must not appear as successful repairs or disappear silently.
  expect((await screen.findByRole('alert')).textContent).toBe('Unable to update equipment status.');
  expect(getLatestHistoryStatus(row, 'REPAIR-DEMO-001').textContent).toBe('Unavailable');
});
