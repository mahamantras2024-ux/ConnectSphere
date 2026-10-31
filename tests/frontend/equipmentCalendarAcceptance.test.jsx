// SCRUM-54: missing calendar selection and independent maintenance/damage acceptance cases.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import EquipmentInventorySection from '../../frontend/src/pages/tech-support/EquipmentInventorySection';

beforeEach(() => {
  // Freeze the clock so the fixture date always falls inside the visible calendar month.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-10T12:00:00Z'));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

// A projector category is represented by the shared equipment name in the current search UI.
const equipment = (id, assetCode, name, startTime, quantity = 1) => ({
  id, asset_code: assetCode, name, specification: 'Acceptance fixture',
  status: 'operational', availability_status: 'Available', quantity,
  availabilities: [{
    date: '2026-10-11', startTime, endTime: '17:00:00',
    status: 'Available', availableQuantity: quantity, reservedQuantity: 0,
  }],
});
const catalogue = [
  equipment(1, 'PROJ-001', 'Projector', '09:00:00'),
  equipment(2, 'PROJ-002', 'Projector', '13:00:00', 2),
  equipment(3, 'MIC-001', 'Microphone', '08:00:00'),
];

// Drive the actual search control, retaining component filtering and calendar rendering.
function search(value) {
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search equipment by ID or name' }), {
    target: { value },
  });
}

it('SCRUM-54 AC1 - category search keeps both schedules selectable without mixing their calendars', () => {
  render(<EquipmentInventorySection inventory={catalogue} error="" />);
  search('Projector');
  const assets = within(screen.getByRole('region', { name: 'Equipment inventory' })).getAllByRole('table')[0];
  // Both category matches remain in inventory; the current UI displays only the selected asset's calendar.
  expect(within(assets).getByRole('row', { name: /PROJ-001/ })).toBeTruthy();
  expect(within(assets).getByRole('row', { name: /PROJ-002/ })).toBeTruthy();
  const first = screen.getByRole('table', { name: 'PROJ-001 monthly availability' });
  expect(within(first).getAllByText('1 available').length).toBeGreaterThan(0);
  expect(within(first).queryByText('2 available')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'View calendar for PROJ-002' }));
  const second = screen.getByRole('table', { name: 'PROJ-002 monthly availability' });
  expect(within(second).getAllByText('2 available').length).toBeGreaterThan(0);
  expect(within(second).queryByText('1 available')).toBeNull();
  expect(screen.queryByRole('table', { name: 'PROJ-001 monthly availability' })).toBeNull();
  expect(screen.queryByRole('table', { name: 'MIC-001 monthly availability' })).toBeNull();
  expect(within(assets).queryByRole('row', { name: /MIC-001/ })).toBeNull();
  // Times are no longer printed in cells; exercise the real interval filters to prove the schedules stay distinct.
  fireEvent.change(screen.getByLabelText('Filter equipment by date'), { target: { value: '2026-10-11' } });
  fireEvent.change(screen.getByLabelText('Available from'), { target: { value: '09:00' } });
  fireEvent.change(screen.getByLabelText('Available to'), { target: { value: '10:00' } });
  expect(within(within(assets).getByRole('row', { name: /PROJ-001/ })).getAllByRole('cell')[3].textContent).toBe('1');
  expect(within(assets).queryByRole('row', { name: /PROJ-002/ })).toBeNull();
  fireEvent.change(screen.getByLabelText('Available to'), { target: { value: '14:00' } });
  fireEvent.change(screen.getByLabelText('Available from'), { target: { value: '13:00' } });
  expect(within(within(assets).getByRole('row', { name: /PROJ-002/ })).getAllByRole('cell')[3].textContent).toBe('2');
});

it('SCRUM-54 AC1 - switching the selected equipment removes the previous item calendar', () => {
  // Arrange: first display one uniquely identifiable equipment schedule.
  render(<EquipmentInventorySection inventory={catalogue} error="" />);
  search('PROJ-001');
  expect(screen.getByRole('table', { name: 'PROJ-001 monthly availability' })).toBeTruthy();
  // Act: select another equipment item through the same control.
  search('PROJ-002');
  // Assert: stale calendars and mismatched time windows cannot pass.
  const calendar = screen.getByRole('table', { name: 'PROJ-002 monthly availability' });
  expect(within(calendar).getAllByText('2 available').length).toBeGreaterThan(0);
  expect(within(calendar).queryByText('1 available')).toBeNull();
  expect(screen.queryByRole('table', { name: 'PROJ-001 monthly availability' })).toBeNull();
});

it.each([
  ['maintenance', 'maintenance', 'Routine maintenance: lamp inspection'],
  ['damage', 'operational', 'Damage: cracked lens'],
])('SCRUM-54 AC3 - displays a %s block independently on scheduled and unscheduled dates', (_, status, reason) => {
  // Arrange: explicit Unavailable status must block even operational stock with a damage report.
  // Deliberately stale positive schedule stock must never override the equipment-level block.
  const blocked = {
    ...catalogue[0], status, availability_status: 'Unavailable',
    status_history: [{ id: 1, status: 'Unavailable', note: reason, changed_at: '2026-10-10T10:00:00Z' }],
    availabilities: [{ ...catalogue[0].availabilities[0], blockReason: reason }],
  };
  render(<EquipmentInventorySection inventory={[blocked]} error="" />);
  // Act: view both a recorded schedule and a day with no schedule rows.
  search('PROJ-001');
  const calendar = screen.getByRole('table', { name: 'PROJ-001 monthly availability' });
  for (const date of ['11 October 2026', '12 October 2026']) {
    const day = within(calendar).getByLabelText(`Availability on ${date} for PROJ-001`);
    // Assert: hiding a block, losing its reason or presenting it as available fails the test.
    expect(day.querySelector('.equipment-calendar-status.is-unavailable')).toBeTruthy();
    expect(within(day).queryByText('1 available')).toBeNull();
    expect(day.textContent).toContain(reason);
    expect(within(day).queryByText('Available', { exact: true })).toBeNull();
  }
  expect(within(calendar).getAllByRole('listitem').every(window => window.classList.contains('is-unavailable'))).toBe(true);
  fireEvent.change(screen.getByLabelText('Filter equipment by date'), { target: { value: '2026-10-12' } });
  fireEvent.change(screen.getByLabelText('Available from'), { target: { value: '09:00' } });
  fireEvent.change(screen.getByLabelText('Available to'), { target: { value: '11:00' } });
  const inventory = screen.getByRole('region', { name: 'Equipment inventory' });
  const row = within(within(inventory).getAllByRole('table')[0]).getByRole('row', { name: /PROJ-001/ });
  expect(within(row).getAllByRole('cell')[3].textContent).toBe('0');
});
