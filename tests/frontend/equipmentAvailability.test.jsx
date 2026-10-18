// File: Tests the fixed equipment catalogue, filters, and search-triggered availability calendar.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import EquipmentInventorySection from '../../frontend/src/pages/tech-support/EquipmentInventorySection';

afterEach(cleanup);

function getDateOffset(days) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const availableDate = getDateOffset(1);
const reservedDate = getDateOffset(3);
const maintenanceDate = getDateOffset(5);

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
      { date: availableDate, startTime: '09:00:00', endTime: '17:00:00', status: 'Available', availableQuantity: 1 },
      { date: reservedDate, startTime: '09:00:00', endTime: '18:00:00', status: 'Reserved', availableQuantity: 0, eventName: 'Town Hall' },
    ],
  },
  {
    id: 2,
    asset_code: 'MIC-001',
    name: 'Wireless Microphone',
    specification: 'Handheld, UHF, 8-hour battery',
    quantity: 2,
    availabilities: [
      { date: availableDate, startTime: '08:00:00', endTime: '18:00:00', status: 'Available', availableQuantity: 2 },
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
  expect(within(row).getByRole('combobox', { name: 'Status for PROJ-001' }).value).toBe('Unavailable');
});

// AC2 - Availability is deducted for reservations overlapping the chosen date and time.
it('AC2 - shows the remaining quantity for a selected date and time range', () => {
  render(<EquipmentInventorySection inventory={inventory} error="" />);
  fireEvent.change(screen.getByLabelText('Filter equipment by date'), { target: { value: availableDate } });
  fireEvent.change(screen.getByLabelText('Available from'), { target: { value: '09:00' } });
  fireEvent.change(screen.getByLabelText('Available to'), { target: { value: '17:00' } });

  const table = getInventoryTable();
  expect(within(table).getByRole('columnheader', { name: 'Available quantity' })).toBeTruthy();
  expect(within(getAssetRow('PROJ-001')).getAllByRole('cell')[3].textContent).toBe('1');
});

// AC2 - A date without a full time range reports the highest matching availability as an upper bound.
it('AC2 - labels date-only availability as an upper bound', () => {
  render(<EquipmentInventorySection inventory={inventory} error="" />);
  fireEvent.change(screen.getByLabelText('Filter equipment by date'), { target: { value: availableDate } });

  expect(within(getAssetRow('PROJ-001')).getAllByRole('cell')[3].textContent).toBe('Up to 1');
});

// AC3 - Fully reserved equipment remains visible with zero available for its selected slot.
it('AC3 - shows zero available when the selected date window is fully reserved', () => {
  render(<EquipmentInventorySection inventory={inventory} error="" />);
  fireEvent.change(screen.getByLabelText('Filter equipment by date'), { target: { value: reservedDate } });

  expect(within(getAssetRow('PROJ-001')).getAllByRole('cell')[3].textContent).toBe('Up to 0');
});

// AC2 - partial time filters and reserved calendar windows retain truthful availability states.
it('AC2 - handles one-sided time filters, empty calendar days, and non-booked unavailable windows', () => {
  const edgeInventory = [{
    ...inventory[0],
    availabilities: [
      ...inventory[0].availabilities,
      { date: maintenanceDate, startTime: '10:00:00', endTime: '12:00:00', status: 'Maintenance', availableQuantity: 0 },
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
  fireEvent.change(screen.getByLabelText('Filter equipment by date'), { target: { value: maintenanceDate } });
  const calendar = screen.getByRole('table', { name: 'PROJ-001 monthly availability' });
  expect(within(calendar).getByText(/Maintenance/)).toBeTruthy();
});

// AC1 - Selecting an asset by ID or name reveals its separate reservation calendar.
it('AC1 - searches by ID or name and shows the matched asset calendar separately', () => {
  render(<EquipmentInventorySection inventory={[
    ...inventory,
    { ...inventory[0], id: 3, asset_code: 'PROJ-002', availabilities: [{ ...inventory[0].availabilities[0], date: getDateOffset(6) }] },
  ]} error="" />);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search equipment by ID or name' }), {
    target: { value: 'Projector' },
  });

  expect(getInventoryTable()).toBeTruthy();
  expect(screen.getByRole('row', { name: /PROJ-001 Projector/ })).toBeTruthy();
  expect(screen.queryByRole('row', { name: /MIC-001 Wireless Microphone/ })).toBeNull();
  const calendar = screen.getByRole('table', { name: 'PROJ-001 monthly availability' });
  expect(within(calendar).getAllByText(/09:00–17:00/).length).toBeGreaterThan(0);
  expect(within(calendar).queryByText('Town Hall')).toBeNull();
  expect(within(calendar).getAllByText('Available').length).toBeGreaterThan(0);
  expect(within(calendar).getAllByRole('columnheader')).toHaveLength(7);
});

// AC1 - The calendar pages through the rolling horizon and marks unscheduled in-range dates available.
it('AC1 - pages month by month and shows unscheduled in-range dates as available', () => {
  const item = {
    ...inventory[0],
    availabilities: [
      { date: getDateOffset(-1), startTime: '09:00:00', endTime: '10:00:00', status: 'Available', availableQuantity: 1 },
      { date: getDateOffset(0), startTime: '09:00:00', endTime: '10:00:00', status: 'Available', availableQuantity: 1 },
      { date: getDateOffset(89), startTime: '09:00:00', endTime: '10:00:00', status: 'Available', availableQuantity: 1 },
      { date: getDateOffset(90), startTime: '09:00:00', endTime: '10:00:00', status: 'Available', availableQuantity: 1 },
    ],
  };
  render(<EquipmentInventorySection inventory={[item]} error="" />);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search equipment by ID or name' }), {
    target: { value: 'PROJ-001' },
  });

  let calendar = screen.getByRole('table', { name: 'PROJ-001 monthly availability' });
  expect(within(calendar).getByLabelText(`Availability on ${new Intl.DateTimeFormat('en-SG', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${getDateOffset(0)}T00:00:00Z`))} for PROJ-001`)).toBeTruthy();
  expect(screen.getByText(/Unscheduled dates are available/)).toBeTruthy();
  expect(screen.queryByRole('list', { name: 'Availability legend' })).toBeNull();
  expect(within(calendar).getAllByText('Available').length).toBeGreaterThan(1);
  const longDate = date => new Intl.DateTimeFormat('en-SG', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));

  for (let page = 0; page < 3; page += 1) {
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
  }
  calendar = screen.getByRole('table', { name: 'PROJ-001 monthly availability' });
  expect(within(calendar).getByLabelText(`Availability on ${longDate(getDateOffset(89))} for PROJ-001`)).toBeTruthy();
  expect(within(calendar).queryByLabelText(`Availability on ${longDate(getDateOffset(90))} for PROJ-001`)).toBeNull();
  expect(within(calendar).getByText(/09:00–10:00/)).toBeTruthy();
  expect(within(calendar).queryByText('—')).toBeNull();
  expect(screen.getByRole('button', { name: 'Next month' }).disabled).toBe(true);
});

// AC1 - The current month shows only the remaining calendar weeks instead of blank past weeks.
it('AC1 - keeps the current month calendar compact from today onward', () => {
  // Arrange
  render(<EquipmentInventorySection inventory={[inventory[0]]} error="" />);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search equipment by ID or name' }), {
    target: { value: 'PROJ-001' },
  });
  const calendar = screen.getByRole('table', { name: 'PROJ-001 monthly availability' });
  const today = new Date();
  const lastDayOfCurrentMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
  const horizonEnd = new Date(today);
  horizonEnd.setUTCDate(today.getUTCDate() + 89);
  const lastVisibleDate = new Date(Math.min(lastDayOfCurrentMonth.getTime(), horizonEnd.getTime()));
  const remainingDates = (lastVisibleDate.getTime() - today.getTime()) / 86400000 + 1;
  const expectedWeeks = Math.ceil((today.getUTCDay() + remainingDates) / 7);

  // Assert: fully elapsed weeks should not consume vertical space in the current-month view.
  expect(calendar.querySelectorAll('tbody tr')).toHaveLength(expectedWeeks);
});

// AC2 - The calendar shows reservation quantities without exposing event names.
it('AC2 - never displays event names for reserved calendar windows', () => {
  const item = {
    ...inventory[0],
    quantity: 3,
    availabilities: [
      { date: getDateOffset(0), startTime: '08:00:00', endTime: '09:00:00', status: 'Available', availableQuantity: 3, reservedQuantity: 0 },
      { date: getDateOffset(1), startTime: '09:00:00', endTime: '10:00:00', status: 'Available', availableQuantity: 1, reservedQuantity: 2, eventName: 'Town Hall' },
      { date: getDateOffset(2), startTime: '10:00:00', endTime: '11:00:00', status: 'Reserved', availableQuantity: 0, reservedQuantity: 3, eventName: 'Gala' },
    ],
  };
  render(<EquipmentInventorySection inventory={[item]} error="" />);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search equipment by ID or name' }), {
    target: { value: 'PROJ-001' },
  });

  const calendar = screen.getByRole('table', { name: 'PROJ-001 monthly availability' });
  expect(within(calendar).getAllByText('Available').length).toBeGreaterThan(0);
  expect(screen.queryByText('Partially reserved')).toBeNull();
  expect(screen.queryByText('Fully reserved')).toBeNull();
  expect(within(calendar).getByText('3 available')).toBeTruthy();
  expect(within(calendar).getByText('2 reserved · 1 available')).toBeTruthy();
  expect(within(calendar).getByText('3 reserved · 0 available')).toBeTruthy();
  expect(within(calendar).queryByText('Town Hall')).toBeNull();
  expect(within(calendar).queryByText('Gala')).toBeNull();
  const windows = within(calendar).getAllByRole('listitem');
  expect(windows[0].classList.contains('is-available')).toBe(true);
  expect(windows[1].classList.contains('is-available')).toBe(true);
  expect(windows[2].classList.contains('is-unavailable')).toBe(true);
  fireEvent.change(screen.getByLabelText('Filter equipment by date'), { target: { value: getDateOffset(1) } });
  expect(windows[0].classList.contains('is-available')).toBe(true);
});

// AC2 - A confirmed reservation on an unscheduled date is shown as a timed calendar window without event identity.
it('AC2 - displays a reservation window when the date has no availability schedule', () => {
  // Arrange: an API window represents the confirmed booking, despite no schedule row for its date.
  const reservationDate = getDateOffset(3);
  const item = {
    ...inventory[1],
    quantity: 2,
    availabilities: [{
      date: reservationDate,
      startTime: '14:00:00',
      endTime: '16:00:00',
      status: 'Available',
      availableQuantity: 1,
      reservedQuantity: 1,
      eventName: 'Community Workshop',
    }],
  };
  render(<EquipmentInventorySection inventory={[item]} error="" />);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search equipment by ID or name' }), {
    target: { value: 'MIC-001' },
  });

  // Act: inspect the reservation date in the monthly calendar.
  const calendar = screen.getByRole('table', { name: 'MIC-001 monthly availability' });

  // Assert: the reserved time and stock counts appear without exposing the event name.
  const day = within(calendar).getByLabelText(
    `Availability on ${new Intl.DateTimeFormat('en-SG', {
      day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
    }).format(new Date(`${reservationDate}T00:00:00Z`))} for MIC-001`,
  );
  expect(within(day).getByText('14:00–16:00')).toBeTruthy();
  expect(within(day).queryByText('Community Workshop')).toBeNull();
  expect(within(day).getByText('1 reserved · 1 available')).toBeTruthy();
});

// AC3 - Current maintenance/damage status blocks scheduled windows and exposes its recorded reason.
it('AC3 - marks maintenance windows blocked and displays the recorded damage reason', () => {
  const item = {
    ...inventory[0],
    status: 'maintenance',
    availability_status: 'Unavailable',
    status_history: [{ id: 1, status: 'Unavailable', note: 'Damage: cracked lens', changed_at: '2026-10-09T12:00:00Z' }],
    availabilities: [
      {
        date: getDateOffset(1), startTime: '09:00:00', endTime: '11:00:00',
        status: 'Unavailable', availableQuantity: 0, reservedQuantity: 0,
        blockReason: 'Damage: cracked lens',
      },
      {
        date: getDateOffset(2), startTime: '09:00:00', endTime: '11:00:00',
        status: 'Available', availableQuantity: 1, reservedQuantity: 0,
      },
    ],
  };
  const legacyUnavailableItem = {
    ...item,
    id: 2,
    asset_code: 'PROJ-002',
    status: 'operational',
    status_history: [],
    availabilities: [{
      date: getDateOffset(3), startTime: '09:00:00', endTime: '11:00:00',
      status: 'Available', availableQuantity: 0, reservedQuantity: 0,
    }],
  };
  render(<EquipmentInventorySection inventory={[item, legacyUnavailableItem]} error="" />);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search equipment by ID or name' }), {
    target: { value: 'PROJ-' },
  });

  const calendar = screen.getByRole('table', { name: 'PROJ-001 monthly availability' });
  const legacyCalendar = screen.getByRole('table', { name: 'PROJ-002 monthly availability' });
  expect(within(calendar).getAllByText('Unavailable').length).toBeGreaterThan(0);
  expect(within(calendar).getAllByText('Damage: cracked lens').length).toBeGreaterThan(0);
  expect(within(legacyCalendar).getByText('Equipment is unavailable.')).toBeTruthy();
  expect(within(calendar).getAllByRole('listitem').every(window => window.classList.contains('is-unavailable'))).toBe(true);
});

// AC3 - Date and time filters only retain an asset whose available window covers the requested range.
it('AC3 - applies available date, from, and to filters and rejects a reversed time range', () => {
  render(<EquipmentInventorySection inventory={inventory} error="" />);
  fireEvent.change(screen.getByLabelText('Filter equipment by date'), { target: { value: availableDate } });
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
