// File: Tests the fixed equipment catalogue, filters, and search-triggered availability calendar.
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import EquipmentInventorySection from '../../frontend/src/pages/tech-support/EquipmentInventorySection';

const inventory = [
  {
    id: 1,
    asset_code: 'PROJ-001',
    name: 'Projector',
    specification: 'Full HD 1080p, 4,000 lumens, HDMI',
    quantity: 3,
    availabilities: [
      { date: '2026-10-12', startTime: '09:00:00', endTime: '17:00:00', status: 'Available', availableQuantity: 3 },
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

// Arrange provisioned assets; Act render the catalogue; Assert its columns expose stock, not calendar rows.
it('AC1 - shows seeded asset identifiers, names, specifications, and quantities without availability columns', () => {
  render(<EquipmentInventorySection inventory={inventory} error="" />);
  const table = screen.getByRole('table', { name: 'Equipment catalogue' });

  expect(within(table).getByRole('columnheader', { name: 'ID' })).toBeTruthy();
  expect(within(table).getByRole('row', { name: /PROJ-001 Projector Full HD 1080p, 4,000 lumens, HDMI 3/ })).toBeTruthy();
  expect(within(table).queryByText('12 October 2026')).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Availability calendar' })).toBeNull();
});

// AC2 - Searching by asset ID or name filters the table and reveals the separate calendar.
it('AC2 - searches by ID or name and shows the matched asset calendar separately', () => {
  render(<EquipmentInventorySection inventory={inventory} error="" />);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search equipment by ID or name' }), {
    target: { value: 'PROJ-001' },
  });

  expect(screen.getByRole('table', { name: /Equipment matching filters/ })).toBeTruthy();
  expect(screen.getByRole('row', { name: /PROJ-001 Projector/ })).toBeTruthy();
  expect(screen.queryByRole('row', { name: /MIC-001 Wireless Microphone/ })).toBeNull();
  const calendar = screen.getByRole('table', { name: 'Equipment availability calendar' });
  expect(within(calendar).getByText(/09:00–17:00/)).toBeTruthy();
  expect(within(calendar).getByText('Town Hall')).toBeTruthy();
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
