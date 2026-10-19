import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import CoordinatorRegistrations from '../../frontend/src/pages/events/CoordinatorRegistrations';
import { api } from '../../frontend/src/api/client';
vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn() } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

/** Uses real drawer and resource hooks; only the HTTP boundary is replaced. */
function open() {
  render(<CoordinatorRegistrations eventId={101} token="coordinator-token" />);
  expect(api.get).not.toHaveBeenCalled();
  const trigger = screen.getByRole('button', { name: 'Registration details' });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
}

it('AC1 AC2 - displays withdrawals and separate calculated overflow alongside numbered stored-status lists', async () => {
  // Arrange: 103 registered exceed 100 places; the 3 stored waitlist entries and 2 withdrawals remain separate.
  api.get.mockResolvedValue({ event: { name: 'Workshop' }, headcount: 103, waitlist_count: 3, withdrawal_count: 2, venue_capacity: 100, overflow_count: 3,
    overflow: [{ id: 100, attendee_name: 'Registered attendee 100', status: 'registered' },
      { id: 101, attendee_name: 'Registered attendee 101', status: 'registered' },
      { id: 102, attendee_name: 'Registered attendee 102', status: 'registered' }],
    registered: Array.from({ length: 103 }, (_, id) => ({ id, attendee_name: id === 0 ? 'Registered Ari' : `Registered attendee ${id}` })),
    waitlist: [{ id: 201, attendee_name: 'Waiting Bea', registered_at: '2031-01-01T09:00:00Z' },
      { id: 202, attendee_name: 'Waiting Chen', registered_at: '2031-01-01T09:00:00Z' },
      { id: 203, attendee_name: 'Waiting Devi', registered_at: '2031-01-01T09:01:00Z' }] });
  // Act
  open();
  // Assert: exact totals and source timestamp catch swapped counts and fabricated joining dates.
  expect(await screen.findByLabelText('Registration summary')).toHaveProperty('textContent', '103 registered · 3 on waitlist · 2 withdrawn');
  const registered = screen.getByRole('region', { name: 'Registered attendees' });
  expect(within(registered).getByText('Registered Ari')).toBeTruthy();
  expect(within(registered).getAllByRole('listitem')).toHaveLength(103);
  // Each list starts at one; explicit decimal styling survives the application's CSS reset.
  const registeredNames = within(registered).getByRole('list');
  expect(registeredNames.tagName).toBe('OL');
  expect(registeredNames.start).toBe(1);
  expect(registeredNames.classList.contains('list-decimal')).toBe(true);
  const list = screen.getByRole('region', { name: 'Waitlist' });
  expect(within(list).getByText(/Waiting Bea/)).toBeTruthy();
  const waitlistedNames = within(list).getByRole('list');
  expect(waitlistedNames.tagName).toBe('OL');
  expect(waitlistedNames.start).toBe(1);
  expect(waitlistedNames.classList.contains('list-decimal')).toBe(true);
  expect(within(list).getAllByRole('listitem').map(row => row.textContent.split(' — ')[0])).toEqual(['Waiting Bea', 'Waiting Chen', 'Waiting Devi']);
  expect(list.querySelector('time').dateTime).toBe('2031-01-01T09:00:00Z');
  expect(list.querySelector('time').textContent).toContain('5:00:00 pm');
  const overflow = screen.getByRole('region', { name: 'Exceeding capacity' });
  expect(within(overflow).getByText('Confirmed venue capacity: 100')).toBeTruthy();
  expect(within(overflow).getByText('Registered attendees exceeding confirmed venue capacity: 3')).toBeTruthy();
  expect(within(overflow).getAllByRole('listitem').map(row => row.textContent)).toEqual(['Registered attendee 100', 'Registered attendee 101', 'Registered attendee 102']);
  const overflowNames = within(overflow).getByRole('list');
  expect(overflowNames.tagName).toBe('OL');
  expect(overflowNames.start).toBe(1);
  expect(overflowNames.classList.contains('list-decimal')).toBe(true);
  expect(within(overflow).getByText('These attendees are included in the registered total. Their status remains Registered; they are not added to the stored waitlist.')).toBeTruthy();
  expect(within(list).queryByText('Registered attendee 100')).toBeNull();
  expect(api.get).toHaveBeenCalledWith('/events/101/coordinator-registrations', 'coordinator-token');
});

it('AC1 AC2 - reports empty lists as zero and retains event context', async () => {
  // Arrange / Act
  api.get.mockResolvedValue({ event: { name: 'Empty event' }, headcount: 0, waitlist_count: 0, withdrawal_count: 0, venue_capacity: 0, overflow_count: 0, overflow: [], registered: [], waitlist: [] });
  open();
  // Assert
  expect(await screen.findByText('No registered attendees.')).toBeTruthy();
  expect(screen.getByText('No attendees on the waitlist.')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Empty event' })).toBeTruthy();
  expect(screen.getByText('Confirmed venue capacity: 0')).toBeTruthy();
  expect(screen.getByText('No registered attendees exceed confirmed venue capacity.')).toBeTruthy();
  expect(screen.getByLabelText('Registration summary').textContent).toBe('0 registered · 0 on waitlist · 0 withdrawn');
});

it('AC1 AC3 - shows loading then access errors without invented counts', async () => {
  // Arrange: hold the response to observe both states.
  let reject;
  api.get.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
  open();
  expect(screen.getByRole('status').textContent).toBe('Loading registrations...');
  // Act / Assert
  reject(Object.assign(new Error('Access denied.'), { status: 403 }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Access denied.');
  expect(screen.queryByLabelText('Registration summary')).toBeNull();
});

for (const method of ['Close dialog', 'Back to list', 'Escape', 'backdrop']) {
  it(`AC1 - closes drawer using ${method} and restores trigger focus`, () => {
    // Arrange
    api.get.mockReturnValue(new Promise(() => {}));
    const trigger = open();
    // Act
    if (method === 'Escape') fireEvent.keyDown(document, { key: 'Escape' });
    else if (method === 'backdrop') fireEvent.click(screen.getByRole('dialog').parentElement);
    else fireEvent.click(screen.getByRole('button', { name: method }));
    // Assert: no navigation is necessary to return to the same event.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
}

for (const [count, overflowNames] of [[99, []], [100, []], [101, ['Attendee 100']]]) {
  it(`AC2 - ${count} registered against capacity 100 displays the exact calculated overflow`, async () => {
    // Arrange: just below, exactly at and just above capacity have explicitly agreed expected names.
    api.get.mockResolvedValue({ event: { name: 'Workshop' }, headcount: count, waitlist_count: 0,
      withdrawal_count: 0, venue_capacity: 100, overflow_count: overflowNames.length,
      overflow: overflowNames.map(attendee_name => ({ id: 100, attendee_name })),
      registered: Array.from({ length: count }, (_, id) => ({ id, attendee_name: `Attendee ${id}` })), waitlist: [] });
    // Act
    open();
    // Assert: one extra person is a subset of Registered, never an inflated stored waitlist.
    const overflow = await screen.findByRole('region', { name: 'Exceeding capacity' });
    expect(screen.getByLabelText('Registration summary').textContent).toBe(`${count} registered · 0 on waitlist · 0 withdrawn`);
    expect(within(overflow).getByText('Confirmed venue capacity: 100')).toBeTruthy();
    expect(within(overflow).queryAllByRole('listitem').map(row => row.textContent)).toEqual(overflowNames);
    if (count <= 100) expect(within(overflow).getByText('No registered attendees exceed confirmed venue capacity.')).toBeTruthy();
    else expect(within(overflow).getByText('Registered attendees exceeding confirmed venue capacity: 1')).toBeTruthy();
  });
}

it('AC2 - existing registrations and stored waitlist remain visible without a confirmed venue', async () => {
  // Arrange: missing capacity must not be shown as zero or classify an existing attendee as overflow.
  api.get.mockResolvedValue({ event: { name: 'Unconfirmed venue' }, headcount: 1, waitlist_count: 1,
    withdrawal_count: 0, venue_capacity: null, overflow_count: null, overflow: [],
    registered: [{ id: 1, attendee_name: 'Registered Ari' }],
    waitlist: [{ id: 2, attendee_name: 'Waiting Bea', registered_at: '2031-01-01T09:00:00Z' }] });
  // Act
  open();
  // Assert
  expect(await screen.findByText('No confirmed venue capacity is available. Overflow cannot be calculated.')).toBeTruthy();
  expect(screen.getByText('Registered Ari')).toBeTruthy();
  expect(screen.getByText(/Waiting Bea/)).toBeTruthy();
  const overflow = screen.getByRole('region', { name: 'Exceeding capacity' });
  expect(within(overflow).queryByText('Confirmed venue capacity: 0')).toBeNull();
  expect(within(overflow).queryAllByRole('listitem')).toHaveLength(0);
});
