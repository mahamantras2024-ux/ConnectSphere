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
  fireEvent.click(within(row).getByRole('button', { name: 'Mark Available' }));
  return row;
}

beforeEach(() => {
  useAuth.mockReturnValue({ token: 'support-token' });
  vi.spyOn(api, 'get').mockImplementation(async endpoint => {
    if (endpoint === '/events/equipment-requests') return { requests: [] };
    if (endpoint === '/events/equipment-inventory') return { inventory: [unavailableEquipment, availableEquipment] };
    if (endpoint === '/events/equipment-reservations') return { requests: [], reservations: [] };
    if (endpoint === '/events/on-site-support') return { events: [] };
    throw new Error(`Unexpected GET ${endpoint}`);
  });
  vi.spyOn(api, 'put').mockImplementation(async (_endpoint, body) => ({
    equipment: repairedEquipment(body.resolutionNote),
  }));
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
  await waitFor(() => expect(within(row).getByText('Available')).toBeTruthy());
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
  fireEvent.change(screen.getByRole('textbox', { name: 'Resolution note' }), {
    target: { value: 'Screen replaced' },
  });

  // Act
  fireEvent.click(within(row).getByRole('button', { name: 'Mark Available', exact: true }));

  // Assert: missing or overwritten audit entries would hide one of these distinct events.
  expect(await within(row).findByText('Screen replaced')).toBeTruthy();
  expect(within(row).getByText(/Seeded damage reason: display cracked during setup\./)).toBeTruthy();
  expect(within(row).getByText('Available')).toBeTruthy();
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
  expect(within(row).getByText('Unavailable')).toBeTruthy();
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
  await waitFor(() => expect(within(row).getByText('Available')).toBeTruthy());
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
  expect(within(row).getByText('Unavailable')).toBeTruthy();
});
