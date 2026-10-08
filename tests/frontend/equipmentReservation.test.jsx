// File: Tests event-slot availability, quantity selection, reservation feedback, and audit display.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../../frontend/src/api/client';
import App from '../../frontend/src/App';
import { AuthProvider } from '../../frontend/src/context/AuthContext';
import EquipmentReservationSection from '../../frontend/src/pages/tech-support/EquipmentReservationSection';

vi.mock('../../frontend/src/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

const request = {
  id: 501,
  name: 'Community Workshop',
  proposed_date: '2026-10-12',
  proposed_start_time: '09:00:00',
  proposed_end_time: '12:00:00',
  venue_name: 'Innovation Hall',
  venue_location: 'Level 3',
  review_outcome: 'fully_fulfillable',
  review_reason: null,
};
const supportUser = {
  id: 41, full_name: 'Taylor Support', email: 'staff@example.com', role: 'technical_support',
};
const availableItems = [{
  item: 'Projector',
  requestedQuantity: 2,
  availableQuantity: 3,
  availableAssets: [{
    id: 31, asset_code: 'PROJ-001', name: 'Projector', specification: 'Full HD',
    quantity: 4, available_quantity: 3,
  }],
}];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

// Arrange a fully fulfillable review; Act check and reserve; Assert requested units and audit callback.
it('AC1 AC2 - reserves the requested quantity after slot availability is confirmed', async () => {
  api.get.mockResolvedValue({ availability: { items: availableItems } });
  api.post.mockResolvedValue({
    reservation: { id: 901, reserved_by: 41, reserved_at: '2026-10-08T12:00:00.000Z' },
    items: [{ inventoryId: 31, assetCode: 'PROJ-001', name: 'Projector', quantity: 2 }],
  });
  const onReserved = vi.fn();
  render(<EquipmentReservationSection requests={[request]} reservations={[]} token="staff-token" onReserved={onReserved} />);
  const candidate = screen.getByRole('article', { name: 'Community Workshop' });

  fireEvent.click(within(candidate).getByRole('button', { name: 'Check availability' }));
  const quantity = await within(candidate).findByLabelText('Quantity of PROJ-001 to reserve');
  expect(quantity.value).toBe('2');
  fireEvent.click(within(candidate).getByRole('button', { name: 'Confirm reservation' }));

  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/events/501/equipment-reservations', {
    selections: [{ inventoryId: 31, quantity: 2 }],
  }, 'staff-token'));
  expect(onReserved).toHaveBeenCalledWith(expect.objectContaining({
    id: 901,
    event_name: 'Community Workshop',
    items: [{ inventoryId: 31, assetCode: 'PROJ-001', name: 'Projector', quantity: 2 }],
  }));
});

// AC2 - A partial review can reserve only the available portion; quantities cannot exceed availability.
it('AC2 - caps a partial reservation to the remaining available quantity', async () => {
  const partialRequest = { ...request, review_outcome: 'partially_fulfillable', review_reason: 'Limited stock.' };
  api.get.mockResolvedValue({ availability: { items: [{ ...availableItems[0], availableQuantity: 1,
    availableAssets: [{ ...availableItems[0].availableAssets[0], available_quantity: 1 }] }] } });
  api.post.mockResolvedValue({ reservation: { id: 902 }, items: [] });
  render(<EquipmentReservationSection requests={[partialRequest]} reservations={[]} token="staff-token" onReserved={vi.fn()} />);
  const candidate = screen.getByRole('article', { name: 'Community Workshop' });

  fireEvent.click(within(candidate).getByRole('button', { name: 'Check availability' }));
  const quantity = await within(candidate).findByLabelText('Quantity of PROJ-001 to reserve');
  expect(quantity.value).toBe('0');
  fireEvent.change(quantity, { target: { value: '2' } });
  expect(quantity.value).toBe('1');
  fireEvent.click(within(candidate).getByRole('button', { name: 'Confirm reservation' }));

  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/events/501/equipment-reservations', {
    selections: [{ inventoryId: 31, quantity: 1 }],
  }, 'staff-token'));
});

// AC3 - Confirmed reservations remain visible with allocated quantity and reviewer identity/time.
it('AC3 - displays the reservation audit record and allocated stock', () => {
  render(<EquipmentReservationSection
    requests={[]}
    reservations={[{
      id: 901, event_name: 'Community Workshop', event_date: '2026-10-12',
      start_time: '09:00:00', end_time: '12:00:00', venue_name: 'Innovation Hall',
      reserved_by_name: 'Taylor Support', reserved_at: '2026-10-08T12:00:00.000Z',
      items: [{ assetCode: 'PROJ-001', name: 'Projector', quantity: 2 }],
    }]}
    token="staff-token"
    onReserved={vi.fn()}
  />);

  expect(screen.getByText(/Reserved by Taylor Support/)).toBeTruthy();
  expect(screen.getByText(/PROJ-001 — Projector \(×2\)/)).toBeTruthy();
});

// AC2 - A full review cannot be finalised unless all requested units remain available in the slot.
it('AC2 - blocks full reservation when the date and time have insufficient stock', async () => {
  api.get.mockResolvedValue({ availability: { items: [{
    ...availableItems[0],
    availableQuantity: 1,
    availableAssets: [{ ...availableItems[0].availableAssets[0], available_quantity: 1 }],
  }] } });
  const onReserved = vi.fn();
  render(<EquipmentReservationSection requests={[request]} reservations={[]} token="staff-token" onReserved={onReserved} />);
  const candidate = screen.getByRole('article', { name: 'Community Workshop' });

  fireEvent.click(within(candidate).getByRole('button', { name: 'Check availability' }));
  const quantity = await within(candidate).findByLabelText('Quantity of PROJ-001 to reserve');
  fireEvent.change(quantity, { target: { value: '1' } });
  expect(within(candidate).getByRole('status').textContent).toContain('Select all requested units');
  expect(within(candidate).getByRole('button', { name: 'Confirm reservation' }).disabled).toBe(true);
  expect(api.post).not.toHaveBeenCalled();
  expect(onReserved).not.toHaveBeenCalled();
});

// AC1 - An item with no matching available asset remains explicit and cannot be reserved.
it('AC1 - explains when no suitable asset is available for the event time', async () => {
  api.get.mockResolvedValue({ availability: { items: [{
    ...availableItems[0], availableQuantity: 0, availableAssets: [],
  }] } });
  render(<EquipmentReservationSection requests={[{ ...request, proposed_date: null }]}
    reservations={[]} token="staff-token" onReserved={vi.fn()} />);
  const candidate = screen.getByRole('article', { name: 'Community Workshop' });

  expect(within(candidate).getByText(/Not provided/)).toBeTruthy();
  fireEvent.click(within(candidate).getByRole('button', { name: 'Check availability' }));
  expect(await within(candidate).findByText(/No matching operational asset is available/)).toBeTruthy();
  expect(within(candidate).getByRole('button', { name: 'Confirm reservation' }).disabled).toBe(true);
});

// AC1/AC2 - Availability and reservation API errors remain visible and do not report success.
it('AC1 AC2 - reports failed availability checks and failed reservation writes', async () => {
  api.get.mockRejectedValueOnce(new Error('Availability unavailable.'));
  const onReserved = vi.fn();
  render(<EquipmentReservationSection requests={[{ ...request, review_outcome: 'partially_fulfillable' }]}
    reservations={[]} token="staff-token" onReserved={onReserved} />);
  const candidate = screen.getByRole('article', { name: 'Community Workshop' });

  fireEvent.click(within(candidate).getByRole('button', { name: 'Check availability' }));
  expect((await within(candidate).findByRole('alert')).textContent).toBe('Availability unavailable.');

  api.get.mockResolvedValueOnce({ availability: { items: availableItems } });
  fireEvent.click(within(candidate).getByRole('button', { name: 'Check availability' }));
  const quantity = await within(candidate).findByLabelText('Quantity of PROJ-001 to reserve');
  fireEvent.change(quantity, { target: { value: '1' } });
  api.post.mockRejectedValueOnce(new Error('Reservation write failed.'));
  fireEvent.click(within(candidate).getByRole('button', { name: 'Confirm reservation' }));

  expect((await within(candidate).findByRole('alert')).textContent).toBe('Reservation write failed.');
  expect(onReserved).not.toHaveBeenCalled();
});

// AC3 - The empty reservation state links staff back to review without fabricating a candidate.
it('AC3 - offers navigation back to request review when no items await reservation', () => {
  const onGoToReviews = vi.fn();
  render(<EquipmentReservationSection requests={[]} reservations={[]} token="staff-token"
    onReserved={vi.fn()} onGoToReviews={onGoToReviews} />);

  fireEvent.click(screen.getByRole('button', { name: 'Go to equipment request review' }));
  expect(onGoToReviews).toHaveBeenCalledOnce();
  expect(screen.getByText('No equipment requests are ready to reserve')).toBeTruthy();
});

// AC4 - The dashboard refreshes and displays the saved reservation after the reservation API succeeds.
it('AC4 - confirms a reservation through the dashboard and refreshes its audit record', async () => {
  localStorage.setItem('cs_token', 'support-token');
  let confirmed = false;
  api.get.mockImplementation(async path => {
    if (path === '/auth/me') return { user: supportUser };
    if (path === '/events/equipment-requests') return { requests: [] };
    if (path === '/events/equipment-inventory') return { inventory: [] };
    if (path === '/events/equipment-reservations') return confirmed
      ? { requests: [], reservations: [{
        id: 901, event_name: request.name, event_date: request.proposed_date,
        start_time: request.proposed_start_time, end_time: request.proposed_end_time,
        venue_name: request.venue_name, reserved_by_name: supportUser.full_name,
        reserved_at: '2026-10-08T12:00:00.000Z',
        items: [{ assetCode: 'PROJ-001', name: 'Projector', quantity: 2 }],
      }] }
      : { requests: [{ ...request, review_outcome: 'fully_fulfillable' }], reservations: [] };
    if (path === '/events/501/equipment-availability') return { availability: { items: availableItems } };
    throw new Error(`Unexpected API route: ${path}`);
  });
  api.post.mockImplementation(async () => {
    confirmed = true;
    return {
      reservation: { id: 901, reserved_by: supportUser.id, reserved_at: '2026-10-08T12:00:00.000Z' },
      items: [{ assetCode: 'PROJ-001', name: 'Projector', quantity: 2 }],
    };
  });
  render(<MemoryRouter initialEntries={['/tech-support/dashboard']}>
    <AuthProvider><App /></AuthProvider>
  </MemoryRouter>);
  fireEvent.click(await screen.findByRole('tab', { name: 'Equipment reservation' }));
  const candidate = await screen.findByRole('article', { name: 'Community Workshop' });

  fireEvent.click(within(candidate).getByRole('button', { name: 'Check availability' }));
  await within(candidate).findByLabelText('Quantity of PROJ-001 to reserve');
  fireEvent.click(within(candidate).getByRole('button', { name: 'Confirm reservation' }));

  expect(await screen.findByText('Equipment reservation confirmed for Community Workshop.')).toBeTruthy();
  expect(screen.getByText(/Reserved by Taylor Support/)).toBeTruthy();
  expect(screen.getByText(/PROJ-001 — Projector \(×2\)/)).toBeTruthy();
});
