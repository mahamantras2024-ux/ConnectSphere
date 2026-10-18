// File: Tests the fixed equipment catalogue, filters, and search-triggered availability calendar.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import EquipmentInventorySection from '../../frontend/src/pages/tech-support/EquipmentInventorySection';

afterEach(cleanup);

// The catalogue has no caption, so scope to its region and use the first table before the calendar.
function getInventoryTable() {
  return within(screen.getByRole('region', { name: 'Equipment inventory' })).getAllByRole('table')[0];
}

// Locates an asset without coupling status and history assertions to the full row's accessible name.
function getAssetRow(assetCode) {
  return within(getInventoryTable()).getByRole('row', { name: new RegExp(assetCode) });
}

const inventory = [
  {
    id: 1,
    asset_code: 'PROJ-001',
    name: 'Projector',
    specification: 'Full HD 1080p, 4,000 lumens, HDMI',
    quantity: 3,
    availabilities: [
      { date: '2026-10-12', startTime: '09:00:00', endTime: '17:00:00', status: 'Available', availableQuantity: 1 },
      { date: '2026-10-14', startTime: '09:00:00', endTime: '18:00:00', status: 'Reserved', availableQuantity: 0, eventName: 'Town Hall' },
    ],
  },
  {
    id: 2,
    asset_code: 'MIC-001',
    name: 'Wireless Microphone',
    specification: 'Handheld, UHF, 8-hour battery',
    quantity: 2,
    availabilities: [
      { date: '2026-10-12', startTime: '08:00:00', endTime: '18:00:00', status: 'Available', availableQuantity: 2 },
    ],
  },
];

// AC1 - Without a selected date, the catalogue presents total stock rather than slot availability.
it('AC1 - shows total quantity until a date is selected', () => {
  render(<EquipmentInventorySection inventory={[
    ...inventory,
    { ...inventory[0], id: 4, asset_code: 'UNKNOWN-001', availabilities: null },
  ]} error="" />);
  const table = getInventoryTable();

  expect(within(table).getByRole('columnheader', { name: 'ID' })).toBeTruthy();
  expect(within(table).getByRole('columnheader', { name: 'Total quantity' })).toBeTruthy();
  expect(within(table).queryByRole('columnheader', { name: 'Available quantity' })).toBeNull();
  const projectorRow = getAssetRow('PROJ-001');
  expect(projectorRow).toBeTruthy();
  expect(within(projectorRow).getAllByRole('cell')[3].textContent).toBe('3');
  expect(within(table).queryByText('12 October 2026')).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Availability calendar' })).toBeNull();
});

// AC1 - Legacy maintenance records without the new availability field remain visibly unavailable.
it('AC1 - maps legacy maintenance status to Unavailable', () => {
  // Arrange
  render(<EquipmentInventorySection
    inventory={[{ ...inventory[0], status: 'maintenance' }]}
    error=""
  />);

  // Act
  const row = getAssetRow('PROJ-001');

  // Assert: dropping this fallback would present unrepaired legacy stock as available.
  expect(within(row).getByLabelText('Status for PROJ-001').value).toBe('Unavailable');
});

// AC2 - Availability is deducted for reservations overlapping the chosen date and time.
it('AC2 - shows the remaining quantity for a selected date and time range', () => {
  render(<EquipmentInventorySection inventory={inventory} error="" />);
  fireEvent.change(screen.getByLabelText('Filter equipment by date'), { target: { value: '2026-10-12' } });
  fireEvent.change(screen.getByLabelText('Available from'), { target: { value: '09:00' } });
  fireEvent.change(screen.getByLabelText('Available to'), { target: { value: '17:00' } });

  const table = getInventoryTable();
  expect(within(table).getByRole('columnheader', { name: 'Available quantity' })).toBeTruthy();
  expect(within(getAssetRow('PROJ-001')).getAllByRole('cell')[3].textContent).toBe('1');
});

// AC2 - A date without a full time range reports the highest matching availability as an upper bound.
it('AC2 - labels date-only availability as an upper bound', () => {
  render(<EquipmentInventorySection inventory={inventory} error="" />);
  fireEvent.change(screen.getByLabelText('Filter equipment by date'), { target: { value: '2026-10-12' } });

  expect(within(getAssetRow('PROJ-001')).getAllByRole('cell')[3].textContent).toBe('Up to 1');
});

// AC3 - Fully reserved equipment remains visible with zero available for its selected slot.
it('AC3 - shows zero available when the selected date window is fully reserved', () => {
  render(<EquipmentInventorySection inventory={inventory} error="" />);
  fireEvent.change(screen.getByLabelText('Filter equipment by date'), { target: { value: '2026-10-14' } });

  expect(within(getAssetRow('PROJ-001')).getAllByRole('cell')[3].textContent).toBe('Up to 0');
});

// AC2 - partial time filters and reserved calendar windows retain truthful availability states.
it('AC2 - handles one-sided time filters, empty calendar days, and non-booked unavailable windows', () => {
  const edgeInventory = [{
    ...inventory[0],
    availabilities: [
      ...inventory[0].availabilities,
      { date: '2026-10-15', startTime: '10:00:00', endTime: '12:00:00', status: 'Maintenance', availableQuantity: 0 },
    ],
  }];
  render(<EquipmentInventorySection inventory={edgeInventory} error="" />);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search equipment by ID or name' }), { target: { value: 'PROJ-001' } });
  fireEvent.change(screen.getByLabelText('Available from'), { target: { value: '10:00' } });
  expect(screen.getByRole('row', { name: /PROJ-001 Projector/ })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Available from'), { target: { value: '11:00' } });
  expect(screen.getByRole('row', { name: /PROJ-001 Projector/ })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Available from'), { target: { value: '17:00' } });
  expect(screen.queryByRole('row', { name: /PROJ-001 Projector/ })).toBeNull();
  fireEvent.change(screen.getByLabelText('Available from'), { target: { value: '08:00' } });
  expect(screen.queryByRole('row', { name: /PROJ-001 Projector/ })).toBeNull();
  fireEvent.change(screen.getByLabelText('Available from'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Available to'), { target: { value: '10:00' } });
  expect(screen.getByRole('row', { name: /PROJ-001 Projector/ })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Available from'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Available to'), { target: { value: '08:00' } });
  expect(screen.queryByRole('row', { name: /PROJ-001 Projector/ })).toBeNull();
  fireEvent.change(screen.getByLabelText('Filter equipment by date'), { target: { value: '2026-10-15' } });
  const calendar = screen.getByRole('table', { name: 'Equipment availability calendar' });
  expect(within(calendar).getByText(/Maintenance/)).toBeTruthy();
});

// AC2 - Searching by asset ID or name filters the table and reveals the separate calendar.
it('AC2 - searches by ID or name and shows the matched asset calendar separately', () => {
  render(<EquipmentInventorySection inventory={[
    ...inventory,
    { ...inventory[0], id: 3, asset_code: 'PROJ-002', availabilities: [{ ...inventory[0].availabilities[0], date: '2026-10-16' }] },
  ]} error="" />);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search equipment by ID or name' }), {
    target: { value: 'Projector' },
  });

  expect(getInventoryTable()).toBeTruthy();
  expect(screen.getByRole('row', { name: /PROJ-001 Projector/ })).toBeTruthy();
  expect(screen.queryByRole('row', { name: /MIC-001 Wireless Microphone/ })).toBeNull();
  const calendar = screen.getByRole('table', { name: 'Equipment availability calendar' });
  expect(within(calendar).getAllByText(/09:00–17:00/).length).toBeGreaterThan(0);
  expect(within(calendar).getByText('Town Hall')).toBeTruthy();
  expect(within(calendar).getAllByText('—').length).toBeGreaterThan(0);
});

// AC3 - Date and time filters only retain an asset whose available window covers the requested range.
it('AC3 - applies available date, from, and to filters and rejects a reversed time range', () => {
  render(<EquipmentInventorySection inventory={inventory} error="" />);
  fireEvent.change(screen.getByLabelText('Filter equipment by date'), { target: { value: '2026-10-12' } });
  fireEvent.change(screen.getByLabelText('Available from'), { target: { value: '09:00' } });
  fireEvent.change(screen.getByLabelText('Available to'), { target: { value: '17:00' } });

  expect(screen.getByRole('row', { name: /PROJ-001 Projector/ })).toBeTruthy();
  expect(screen.getByRole('row', { name: /MIC-001 Wireless Microphone/ })).toBeTruthy();

  fireEvent.change(screen.getByLabelText('Available to'), { target: { value: '08:00' } });
  expect(screen.getByRole('alert').textContent).toContain('must be later');
  expect(screen.queryByRole('row', { name: /PROJ-001 Projector/ })).toBeNull();
});

// AC3 - Time-only filters work without a date and the clear action restores the complete fixed catalogue.
it('AC3 - filters by either time boundary and clears all inventory filters', () => {
  render(<EquipmentInventorySection inventory={inventory} error="" />);
  fireEvent.change(screen.getByLabelText('Available from'), { target: { value: '09:00' } });
  expect(screen.getByRole('row', { name: /PROJ-001 Projector/ })).toBeTruthy();
  expect(screen.getByRole('row', { name: /MIC-001 Wireless Microphone/ })).toBeTruthy();

  fireEvent.change(screen.getByLabelText('Available from'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Available to'), { target: { value: '17:30' } });
  expect(screen.queryByRole('row', { name: /PROJ-001 Projector/ })).toBeNull();
  expect(screen.getByRole('row', { name: /MIC-001 Wireless Microphone/ })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Available to'), { target: { value: '08:00' } });
  expect(screen.queryByRole('row', { name: /PROJ-001 Projector/ })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(getInventoryTable()).toBeTruthy();
  expect(screen.getAllByRole('row')).toHaveLength(3);
});

// AC1 - Missing catalogue data and API failures render distinct, explicit states.
it('AC1 - distinguishes an empty catalogue from a failed inventory request', () => {
  const { rerender } = render(<EquipmentInventorySection inventory={[]} error="" />);
  expect(screen.getByText('No equipment catalogue is available.')).toBeTruthy();

  rerender(<EquipmentInventorySection inventory={[]} error="Catalogue unavailable." />);
  expect(screen.getByRole('alert').textContent).toBe('Catalogue unavailable.');
  expect(screen.queryByText('No equipment catalogue is available.')).toBeNull();
});
