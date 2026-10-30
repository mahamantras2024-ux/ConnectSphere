// File: Tests the fixed equipment catalogue, filters, and search-triggered availability calendar.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import EquipmentInventorySection from '../../frontend/src/pages/tech-support/EquipmentInventorySection';

// Stable relative fixture dates must stay in the visible calendar month.
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date('2026-10-10T12:00:00Z'));
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-10T12:00:00Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function getDateOffset(days) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const availableDate = getDateOffset(1);
const reservedDate = getDateOffset(3);
const maintenanceDate = getDateOffset(5);

it('Calendar AC4 - opens an equipment calendar directly from inventory without a search or dropdown', () => {
  // The existing inventory is the selector; choosing its ID must also work before entering a search.
  render(<EquipmentInventorySection inventory={inventory} error="" />);
  expect(screen.queryByRole('region', { name: 'Availability calendar' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'View availability for MIC-001' }));
  expect(screen.getByRole('table', { name: 'MIC-001 monthly availability' })).toBeTruthy();
  expect(screen.queryByRole('combobox', { name: 'Calendar equipment' })).toBeNull();
  expect(screen.getByRole('heading', { name: 'MIC-001 — Wireless Microphone' })).toBeTruthy();
});

it('Calendar AC4 - shows one asset at a time and falls back when a new search excludes it', () => {
  // Distinct stock counts prove an inventory selection replaces the displayed calendar without a dropdown.
  render(<EquipmentInventorySection inventory={[inventory[0], { ...inventory[0], id: 2, asset_code: 'PROJ-002', quantity: 7, availabilities: [] }]} error="" />);
  const search = screen.getByRole('searchbox', { name: 'Search equipment by ID or name' });
  fireEvent.change(search, { target: { value: 'PROJ-' } });
  const region = screen.getByRole('region', { name: 'Availability calendar' });
  expect(within(region).getAllByRole('table')).toHaveLength(1);
  // Preserve the concurrent calendar improvements while replacing its stacked asset grids.
  const todayCell = within(region).getByLabelText('Availability on 10 October 2026 for PROJ-001');
  expect(todayCell.classList.contains('is-today')).toBe(true);
  expect(todayCell.dataset.weekday).toBe('Sat');
  expect(within(region).queryByText(/09:00–17:00/)).toBeNull();
  expect(within(region).getByText('1 available')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'View availability for PROJ-002' }));
  expect(screen.queryByRole('table', { name: 'PROJ-001 monthly availability' })).toBeNull();
  expect(within(screen.getByRole('table', { name: 'PROJ-002 monthly availability' })).getAllByText('7 available').length).toBeGreaterThan(0);
  fireEvent.change(search, { target: { value: 'PROJ-001' } });
  expect(within(region).getAllByRole('table')).toHaveLength(1);
  expect(screen.getByRole('table', { name: 'PROJ-001 monthly availability' })).toBeTruthy();
  expect(screen.queryByRole('combobox', { name: 'Calendar equipment' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(screen.queryByRole('region', { name: 'Availability calendar' })).toBeNull();
});

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

// SCRUM-54 AC3 - A complete interval uses the least stock available across changing reservation windows.
it('SCRUM-54 AC3 - reports availability across every overlapping reservation window', () => {
  const item = {
    ...inventory[0],
    quantity: 2,
    availabilities: [
      {
        date: availableDate, startTime: '09:00:00', endTime: '10:00:00',
        status: 'Available', availableQuantity: 1, reservedQuantity: 1, isScheduled: false,
      },
      {
        date: availableDate, startTime: '10:00:00', endTime: '11:00:00',
        status: 'Reserved', availableQuantity: 0, reservedQuantity: 2, isScheduled: false,
      },
    ],
  };
  render(<EquipmentInventorySection inventory={[item]} error="" />);

  // Act: request the full period, not just the interval with more free equipment.
  fireEvent.change(screen.getByLabelText('Filter equipment by date'), { target: { value: availableDate } });
  fireEvent.change(screen.getByLabelText('Available from'), { target: { value: '09:00' } });
  fireEvent.change(screen.getByLabelText('Available to'), { target: { value: '11:00' } });

  // Assert: zero units are free for the entire period because the later window is fully reserved.
  expect(within(getAssetRow('PROJ-001')).getAllByRole('cell')[3].textContent).toBe('0');
});

// AC2 - A date without a full time range reports the highest matching availability as an upper bound.
it('AC2 - labels date-only availability as an upper bound', () => {
  render(<EquipmentInventorySection inventory={inventory} error="" />);
  fireEvent.change(screen.getByLabelText('Filter equipment by date'), { target: { value: availableDate } });

  expect(within(getAssetRow('PROJ-001')).getAllByRole('cell')[3].textContent).toBe('Up to 1');
});

// AC2 - An explicitly available window without a quantity still counts as available and keeps default calendar logic green.
it('AC2 - treats an available calendar window with no quantity as available', () => {
  render(<EquipmentInventorySection inventory={[{
    ...inventory[0],
    availabilities: [{
      date: getDateOffset(8),
      startTime: '10:00:00',
      endTime: '11:00:00',
      status: 'Available',
      availableQuantity: null,
    }],
  }]} error="" />);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search equipment by ID or name' }), {
    target: { value: 'PROJ-001' },
  });

  expect(screen.getByRole('table', { name: 'PROJ-001 monthly availability' })).toBeTruthy();
  expect(within(screen.getByRole('table', { name: 'PROJ-001 monthly availability' })).getAllByText('Available').length).toBeGreaterThan(0);
});

// AC2 - A missing quantity is available only when the window explicitly has Available status.
it('AC2 - keeps a null-quantity window unavailable when its status is not Available', () => {
  // Arrange: Pending avoids the explicit-available and blocked-status paths.
  // Freeze only Date: the target remains in the displayed month and async waits keep real timers.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-10T12:00:00Z'));
  const date = getDateOffset(8);
  const item = {
    ...inventory[0],
    availabilities: [{
      date,
      startTime: '10:00:00',
      endTime: '11:00:00',
      status: 'Pending',
      availableQuantity: null,
    }],
  };
  render(<EquipmentInventorySection inventory={[item]} error="" />);

  // Act: search the item to render its availability calendar.
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search equipment by ID or name' }), {
    target: { value: 'PROJ-001' },
  });
  const calendar = screen.getByRole('table', { name: 'PROJ-001 monthly availability' });
  const dateLabel = new Intl.DateTimeFormat('en-SG', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
  const day = within(calendar).getByLabelText(`Availability on ${dateLabel} for PROJ-001`);
  const availabilityWindow = within(day).getByRole('listitem');

  // Assert: absent quantity never presents an unconfirmed status as available.
  expect(availabilityWindow.classList.contains('is-unavailable')).toBe(true);
  expect(within(availabilityWindow).getByText('Pending')).toBeTruthy();
});

// AC2 - A missing status must not make a window with unknown stock look available.
it('AC2 - defaults an unspecified status to unavailable when quantity is unknown', () => {
  // Arrange: omitting status exercises the empty-string fallback rather than an explicit status.
  // Freeze only Date: the target remains in the displayed month and async waits keep real timers.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-10T12:00:00Z'));
  const date = getDateOffset(9);
  const item = {
    ...inventory[0],
    availabilities: [{
      date,
      startTime: '10:00:00',
      endTime: '11:00:00',
      availableQuantity: null,
    }],
  };
  render(<EquipmentInventorySection inventory={[item]} error="" />);

  // Act: find the item calendar and its window for the date with unknown stock.
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search equipment by ID or name' }), {
    target: { value: 'PROJ-001' },
  });
  const calendar = screen.getByRole('table', { name: 'PROJ-001 monthly availability' });
  const dateLabel = new Intl.DateTimeFormat('en-SG', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
  const day = within(calendar).getByLabelText(`Availability on ${dateLabel} for PROJ-001`);
  const availabilityWindow = within(day).getByRole('listitem');

  // Assert: only an explicit Available status can render an unknown quantity as available.
  expect(availabilityWindow.classList.contains('is-unavailable')).toBe(true);
  expect(within(availabilityWindow).getByText('Unavailable')).toBeTruthy();
});

// AC3 - Fully reserved equipment remains visible with zero available for its selected slot.
it('AC3 - shows zero available when the selected date window is fully reserved', () => {
  render(<EquipmentInventorySection inventory={inventory} error="" />);
  fireEvent.change(screen.getByLabelText('Filter equipment by date'), { target: { value: reservedDate } });

  expect(within(getAssetRow('PROJ-001')).getAllByRole('cell')[3].textContent).toBe('Up to 0');
});

// AC3 - An unscheduled date is available for the requested time unless the asset itself is blocked.
it('AC3 - reports full stock for an unscheduled selected date and time', () => {
  const unscheduledDate = getDateOffset(4);
  const item = {
    ...inventory[0],
    quantity: 4,
    availabilities: [{
      date: getDateOffset(6),
      startTime: '09:00:00',
      endTime: '17:00:00',
      status: 'Available',
      availableQuantity: 4,
      isScheduled: true,
    }],
  };
  render(<EquipmentInventorySection inventory={[item]} error="" />);

  // Act: request a specific slot on a date with no schedule rows.
  fireEvent.change(screen.getByLabelText('Filter equipment by date'), { target: { value: unscheduledDate } });
  fireEvent.change(screen.getByLabelText('Available from'), { target: { value: '13:00' } });
  fireEvent.change(screen.getByLabelText('Available to'), { target: { value: '15:00' } });

  // Assert: inventory stays eligible and reports all stock, not zero for the absent window.
  expect(within(getAssetRow('PROJ-001')).getAllByRole('cell')[3].textContent).toBe('4');
});

// AC3 - Zero total stock stays eligible on an unscheduled date and is reported as zero in both views.
it('AC3 - reports zero stock for an unscheduled date in inventory and calendar', () => {
  const unscheduledDate = getDateOffset(4);
  const item = { ...inventory[0], quantity: 0, availabilities: [] };
  render(<EquipmentInventorySection inventory={[item]} error="" />);

  // Arrange and Act: request a slot on a date with no schedule or reservation windows.
  fireEvent.change(screen.getByLabelText('Filter equipment by date'), { target: { value: unscheduledDate } });
  fireEvent.change(screen.getByLabelText('Available from'), { target: { value: '13:00' } });
  fireEvent.change(screen.getByLabelText('Available to'), { target: { value: '15:00' } });
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search equipment by ID or name' }), {
    target: { value: 'PROJ-001' },
  });

  // Assert: zero stock is preserved rather than becoming an empty result or an undefined quantity.
  expect(within(getAssetRow('PROJ-001')).getAllByRole('cell')[3].textContent).toBe('0');
  const calendar = screen.getByRole('table', { name: 'PROJ-001 monthly availability' });
  const dateLabel = new Intl.DateTimeFormat('en-SG', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${unscheduledDate}T00:00:00Z`));
  const day = within(calendar).getByLabelText(`Availability on ${dateLabel} for PROJ-001`);
  expect(within(day).getByText('0 available')).toBeTruthy();
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
  // The date filter and visible month are independent controls; a +5 day fixture can cross a month boundary.
  if (maintenanceDate.slice(0, 7) !== getDateOffset(0).slice(0, 7)) {
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
  }
  const calendar = screen.getByRole('table', { name: 'PROJ-001 monthly availability' });
  expect(within(calendar).getAllByText(/Maintenance/).length).toBeGreaterThan(0);
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
  expect(within(calendar).queryByText(/09:00–17:00/)).toBeNull();
  expect(within(calendar).getByText('1 available')).toBeTruthy();
  expect(within(calendar).queryByText('Town Hall')).toBeNull();
  expect(within(calendar).queryByText('Available')).toBeNull();
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
  expect(screen.queryByText(/Unscheduled dates are available/)).toBeNull();
  expect(screen.queryByRole('list', { name: 'Availability legend' })).toBeNull();
  expect(within(calendar).getAllByText('3 available').length).toBeGreaterThan(1);
  const longDate = date => new Intl.DateTimeFormat('en-SG', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));

  for (let page = 0; page < 3; page += 1) {
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
  }
  calendar = screen.getByRole('table', { name: 'PROJ-001 monthly availability' });
  expect(within(calendar).getByLabelText(`Availability on ${longDate(getDateOffset(89))} for PROJ-001`)).toBeTruthy();
  expect(within(calendar).queryByLabelText(`Availability on ${longDate(getDateOffset(90))} for PROJ-001`)).toBeNull();
  expect(within(calendar).queryByText(/09:00–10:00/)).toBeNull();
  expect(within(calendar).getByText('1 available')).toBeTruthy();
  expect(within(calendar).queryByText('—')).toBeNull();
  expect(screen.getByRole('button', { name: 'Next month' }).disabled).toBe(true);
});

// AC1 - The current month shows only the remaining calendar weeks instead of blank past weeks.
it('Calendar AC1 AC2 - removes the note and gives unscheduled days one stock label', () => {
  // Arrange: an operational asset with no windows uses its total available stock.
  render(<EquipmentInventorySection inventory={[{ ...inventory[0], availabilities: [] }]} error="" />);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search equipment by ID or name' }), { target: { value: 'PROJ-001' } });
  const calendar = screen.getByRole('table', { name: 'PROJ-001 monthly availability' });
  const day = within(calendar).getAllByRole('cell').find(cell => cell.hasAttribute('aria-label'));
  // Assert: the former adjacent Available/3 available pair must not return.
  expect(within(day).getByText('3 available')).toBeTruthy();
  expect(within(day).queryByText('Available')).toBeNull();
  expect(day.querySelectorAll('.equipment-calendar-status')).toHaveLength(1);
  expect(screen.queryByText(/Unscheduled dates are available/)).toBeNull();
});

it('Calendar AC3 - icon-only month controls keep accessible names and navigation limits', () => {
  // Arrange a calendar at the start of the rolling horizon.
  render(<EquipmentInventorySection inventory={[inventory[0]]} error="" />);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search equipment by ID or name' }), { target: { value: 'PROJ-001' } });
  const previous = screen.getByRole('button', { name: 'Previous month' });
  const next = screen.getByRole('button', { name: 'Next month' });
  // Assert appearance through semantic markup: icons are decorative and names remain on the buttons.
  for (const button of [previous, next]) {
    expect(button.textContent.trim()).toBe('');
    expect(button.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
  }
  expect(previous.disabled).toBe(true);
  // Act: the same compact controls must still move forward and back.
  fireEvent.click(next);
  expect(screen.getByText('November 2026')).toBeTruthy();
  expect(previous.disabled).toBe(false);
  fireEvent.click(previous);
  expect(screen.getByText('October 2026')).toBeTruthy();
  expect(previous.disabled).toBe(true);
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

// AC1 - The monthly calendar lets staff step back into the prior month while still inside the rolling horizon.
it('AC1 - moves back to the previous month in the rolling availability horizon', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2025-04-15T12:00:00Z'));
  render(<EquipmentInventorySection inventory={[inventory[0]]} error="" />);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search equipment by ID or name' }), {
    target: { value: 'PROJ-001' },
  });

  fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
  expect(screen.getByText('May 2025')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
  expect(screen.getByText('April 2025')).toBeTruthy();
});

// AC1: the rolling calendar hides dates that fall outside its horizon after the month changes.
it('AC1 - keeps an expired calendar month empty when the availability horizon advances', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2025-01-31T12:00:00Z'));
  const { rerender } = render(<EquipmentInventorySection inventory={[inventory[0]]} error="" />);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search equipment by ID or name' }), {
    target: { value: 'PROJ-001' },
  });

  vi.setSystemTime(new Date('2025-02-01T12:00:00Z'));
  rerender(<EquipmentInventorySection inventory={[inventory[0]]} error="" />);

  const calendar = screen.getByRole('table', { name: 'PROJ-001 monthly availability' });
  expect(calendar.querySelectorAll('tbody tr')).toHaveLength(0);
  expect(screen.getByRole('button', { name: 'Next month' }).disabled).toBe(false);
});

// AC2: legacy operational records and status-history reasons produce truthful calendar details.
it('AC2 - uses legacy availability and audit details for calendar windows', () => {
  const date = getDateOffset(1);
  const statusFixtures = [
    {
      ...inventory[0],
      id: 11,
      asset_code: 'STATUS-OPERATIONAL',
      status: 'operational',
      availability_status: undefined,
      status_history: [{ id: 1, status: 'Available', changed_at: null, note: 'Checked today.' }],
      availabilities: [{ date, startTime: '09:00:00', endTime: '10:00:00', status: 'Available', availableQuantity: null }],
    },
    {
      ...inventory[0],
      id: 12,
      asset_code: 'STATUS-HISTORY',
      availability_status: 'Unavailable',
      status_history: [{ id: 2, status: 'Unavailable', changed_at: null, note: 'Cable is damaged.' }],
      availabilities: [{ date, startTime: '10:00:00', endTime: '11:00:00', status: 'Available', availableQuantity: 0 }],
    },
    {
      ...inventory[0],
      id: 13,
      asset_code: 'STATUS-FALLBACK',
      availability_status: 'Unavailable',
      status_history: [],
      availabilities: [{ date, startTime: '11:00:00', endTime: '12:00:00', status: 'Available', availableQuantity: 0 }],
    },
  ];
  render(<EquipmentInventorySection inventory={statusFixtures} error="" />);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search equipment by ID or name' }), {
    target: { value: 'STATUS-' },
  });

  const operationalCalendar = screen.getByRole('table', { name: 'STATUS-OPERATIONAL monthly availability' });
  expect(within(operationalCalendar).getAllByText('Available').length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: 'View availability for STATUS-HISTORY' }));
  const historyCalendar = screen.getByRole('table', { name: 'STATUS-HISTORY monthly availability' });
  expect(within(historyCalendar).getAllByText('Cable is damaged.').length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: 'View availability for STATUS-FALLBACK' }));
  const fallbackCalendar = screen.getByRole('table', { name: 'STATUS-FALLBACK monthly availability' });
  expect(within(fallbackCalendar).getAllByText('Equipment is unavailable.').length).toBeGreaterThan(0);
  expect(within(getAssetRow('STATUS-OPERATIONAL')).getByText('Date unavailable')).toBeTruthy();
});

// AC2: selecting the already-current status closes transition forms without requesting a write.
it('AC2 - leaves an available asset unchanged when its current status is reselected', () => {
  const onRepairEquipment = vi.fn();
  const onMarkUnavailable = vi.fn();
  render(<EquipmentInventorySection
    inventory={[{ ...inventory[0], availability_status: 'Available' }]}
    error=""
    onRepairEquipment={onRepairEquipment}
    onMarkUnavailable={onMarkUnavailable}
  />);

  fireEvent.change(screen.getByRole('combobox', { name: 'Status for PROJ-001' }), {
    target: { value: 'Available' },
  });

  expect(screen.queryByRole('textbox', { name: 'Resolution note' })).toBeNull();
  expect(screen.queryByRole('textbox', { name: 'Reason for unavailability of PROJ-001' })).toBeNull();
  expect(onRepairEquipment).not.toHaveBeenCalled();
  expect(onMarkUnavailable).not.toHaveBeenCalled();
});

// AC2 - A reason is mandatory before an unavailable equipment record is committed.
it('AC2 - requires a reason before marking equipment unavailable', async () => {
  const onMarkUnavailable = vi.fn();
  render(<EquipmentInventorySection
    inventory={[{ ...inventory[0], availability_status: 'Available' }]}
    error=""
    onMarkUnavailable={onMarkUnavailable}
  />);

  fireEvent.change(screen.getByRole('combobox', { name: 'Status for PROJ-001' }), {
    target: { value: 'Unavailable' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Mark Unavailable' }));

  expect((await screen.findByRole('alert')).textContent).toMatch(/Enter why this equipment is unavailable\./);
  expect(onMarkUnavailable).not.toHaveBeenCalled();
});

// AC2 - A valid unavailability reason is sent to the status callback when the change is confirmed.
it('AC2 - submits the unavailability reason to the inventory callback', async () => {
  const onMarkUnavailable = vi.fn().mockResolvedValue();
  render(<EquipmentInventorySection
    inventory={[{ ...inventory[0], availability_status: 'Available' }]}
    error=""
    onMarkUnavailable={onMarkUnavailable}
  />);

  fireEvent.change(screen.getByRole('combobox', { name: 'Status for PROJ-001' }), {
    target: { value: 'Unavailable' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Reason for unavailability of PROJ-001' }), {
    target: { value: 'Cable damaged during setup.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Mark Unavailable' }));

  await waitFor(() => expect(onMarkUnavailable).toHaveBeenCalledWith(
    expect.objectContaining({ id: 1, asset_code: 'PROJ-001' }),
    'Cable damaged during setup.',
  ));
});

// AC2 - A failed save without a message still surfaces a usable fallback error to the staff member.
it('AC2 - shows a fallback error when the unavailable save fails without a message', async () => {
  const onMarkUnavailable = vi.fn().mockRejectedValue(new Error(''));
  render(<EquipmentInventorySection
    inventory={[{ ...inventory[0], availability_status: 'Available' }]}
    error=""
    onMarkUnavailable={onMarkUnavailable}
  />);

  fireEvent.change(screen.getByRole('combobox', { name: 'Status for PROJ-001' }), {
    target: { value: 'Unavailable' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Reason for unavailability of PROJ-001' }), {
    target: { value: 'Cable damaged during setup.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Mark Unavailable' }));

  expect((await screen.findByRole('alert')).textContent).toBe('Unable to mark equipment unavailable.');
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
  expect(within(calendar).queryByText('Available')).toBeNull();
  expect(within(calendar).queryByText('Partially reserved')).toBeNull();
  expect(within(calendar).queryByTitle(/Partially reserved/)).toBeNull();
  expect(within(calendar).queryByText('Fully reserved')).toBeNull();
  expect(within(calendar).queryByText(/\d{2}:\d{2}/)).toBeNull();
  expect(within(calendar).getAllByText('3 available').length).toBeGreaterThan(0);
  expect(within(calendar).getByText('2 reserved · 1 available')).toBeTruthy();
  expect(within(calendar).getByText('3 reserved · 0 available')).toBeTruthy();
  expect(within(calendar).queryByText('Town Hall')).toBeNull();
  expect(within(calendar).queryByText('Gala')).toBeNull();
  const windows = within(calendar).getAllByRole('listitem');
  expect(windows[0].classList.contains('is-available')).toBe(true);
  expect(windows[1].classList.contains('is-available')).toBe(true);
  expect(windows[2].classList.contains('is-unavailable')).toBe(true);
  for (const [index, window] of windows.entries()) {
    const dot = window.querySelector('.equipment-calendar-status');
    expect(dot).toBeTruthy();
    expect(dot.classList.contains(index === 2 ? 'is-unavailable' : 'is-available')).toBe(true);
  }
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
      isScheduled: false,
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
  expect(within(day).queryByText('14:00–16:00')).toBeNull();
  expect(within(day).queryByText('Community Workshop')).toBeNull();
  expect(within(day).getByText('1 reserved · 1 available')).toBeTruthy();

  // AC3: A synthetic reservation reduces overlapping unscheduled slots, while a slot after it has full stock.
  fireEvent.change(screen.getByLabelText('Filter equipment by date'), { target: { value: reservationDate } });
  fireEvent.change(screen.getByLabelText('Available from'), { target: { value: '14:30' } });
  fireEvent.change(screen.getByLabelText('Available to'), { target: { value: '15:30' } });
  expect(within(getAssetRow('MIC-001')).getAllByRole('cell')[3].textContent).toBe('1');
  fireEvent.change(screen.getByLabelText('Available from'), { target: { value: '16:00' } });
  fireEvent.change(screen.getByLabelText('Available to'), { target: { value: '17:00' } });
  expect(within(getAssetRow('MIC-001')).getAllByRole('cell')[3].textContent).toBe('2');
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
        status: 'Unavailable', availableQuantity: 0, reservedQuantity: 1,
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
  expect(within(calendar).getAllByText('Maintenance / damage blocked').length).toBeGreaterThan(0);
  expect(within(calendar).getAllByText('Damage: cracked lens').length).toBeGreaterThan(0);
  expect(within(calendar).getByText('Damage: cracked lens · 1 reserved · 0 available')).toBeTruthy();
  expect(within(calendar).getAllByRole('listitem').every(window => window.classList.contains('is-unavailable'))).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'View availability for PROJ-002' }));
  const legacyCalendar = screen.getByRole('table', { name: 'PROJ-002 monthly availability' });
  expect(within(legacyCalendar).getAllByText('Equipment is unavailable.').length).toBeGreaterThan(0);

  // AC3: Equipment marked unavailable remains blocked even when the selected date has no schedule rows.
  fireEvent.change(screen.getByLabelText('Filter equipment by date'), { target: { value: getDateOffset(4) } });
  fireEvent.change(screen.getByLabelText('Available from'), { target: { value: '09:00' } });
  fireEvent.change(screen.getByLabelText('Available to'), { target: { value: '11:00' } });
  expect(within(getAssetRow('PROJ-001')).getAllByRole('cell')[3].textContent).toBe('0');
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

// AC3: A one-sided interval must exclude windows ending/starting at its boundary, not only earlier/later windows.
it('AC3 - excludes windows outside a single time boundary', () => {
  render(<EquipmentInventorySection inventory={inventory} error="" />);
  fireEvent.change(screen.getByLabelText('Available from'), { target: { value: '07:59' } });
  expect(screen.queryByRole('table')).toBeNull();
  fireEvent.change(screen.getByLabelText('Available from'), { target: { value: '18:00' } });
  expect(screen.queryByRole('table')).toBeNull();
  fireEvent.change(screen.getByLabelText('Available from'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Available to'), { target: { value: '08:00' } });
  expect(screen.queryByRole('table')).toBeNull();
});

// AC2 AC3: The calendar shows unscheduled dates as available and keeps same-day schedule windows distinct.
it('AC2 AC3 - keeps separate calendar windows and marks unscheduled days available under a date filter', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-10T12:00:00Z'));
  const assets = [{ ...inventory[0], availabilities: [
    { date: '2026-10-12', startTime: '09:00', endTime: '10:00', status: 'Available' },
    { date: '2026-10-12', startTime: '09:00', endTime: '11:00', status: 'Available' },
    { date: '2026-10-12', startTime: '10:00', endTime: '11:00', status: 'Available' },
  ] }, { ...inventory[1], name: 'Projector B', availabilities: [
    { date: '2026-10-14', startTime: '09:00', endTime: '11:00', status: 'Available' },
  ] }, { id: 3, asset_code: 'PROJ-003', name: 'Projector C', quantity: 1 }];
  render(<EquipmentInventorySection inventory={assets} error="" />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'projector' } });
  const calendar = screen.getByRole('table', { name: 'PROJ-001 monthly availability' });
  expect(within(calendar).getAllByText('3 available').length).toBeGreaterThan(0);
  fireEvent.change(screen.getByLabelText('Filter equipment by date'), { target: { value: '2026-10-12' } });
  const day = within(calendar).getByRole('cell', { name: 'Availability on 12 October 2026 for PROJ-001' });
  expect(day.className).toContain('is-filtered-date');
  expect(within(day).getAllByRole('listitem')).toHaveLength(3);
  expect(within(day).getAllByText('Available')).toHaveLength(3);
  expect(within(day).queryByText(/\d{2}:\d{2}/)).toBeNull();
});
