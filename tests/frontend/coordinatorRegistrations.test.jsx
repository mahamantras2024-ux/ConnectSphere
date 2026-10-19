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

it('AC1 AC2 - displays separate stored-status counts and waitlist timestamps without withdrawal or overflow fields', async () => {
  // Arrange: reproduce the requested 103 registered / 3 waitlisted example using disjoint source-status lists.
  api.get.mockResolvedValue({ event: { name: 'Workshop' }, headcount: 103, waitlist_count: 3,
    registered: Array.from({ length: 103 }, (_, id) => ({ id, attendee_name: id === 0 ? 'Registered Ari' : `Registered attendee ${id}` })),
    waitlist: [{ id: 201, attendee_name: 'Waiting Bea', registered_at: '2031-01-01T09:00:00Z' },
      { id: 202, attendee_name: 'Waiting Chen', registered_at: '2031-01-01T09:00:00Z' },
      { id: 203, attendee_name: 'Waiting Devi', registered_at: '2031-01-01T09:01:00Z' }] });
  // Act
  open();
  // Assert: exact totals and source timestamp catch swapped counts and fabricated joining dates.
  expect(await screen.findByLabelText('Registration summary')).toHaveProperty('textContent', '103 registered · 3 on waitlist');
  const registered = screen.getByRole('region', { name: 'Registered attendees' });
  expect(within(registered).getByText('Registered Ari')).toBeTruthy();
  expect(within(registered).getAllByRole('listitem')).toHaveLength(103);
  // Both independent lists must start at one; explicit decimal styling survives the application's CSS reset.
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
  expect(screen.queryByText(/Withdrawn|Exceeds venue capacity/)).toBeNull();
  expect(api.get).toHaveBeenCalledWith('/events/101/coordinator-registrations', 'coordinator-token');
});

it('AC1 AC2 - reports empty lists as zero and retains event context', async () => {
  // Arrange / Act
  api.get.mockResolvedValue({ event: { name: 'Empty event' }, headcount: 0, waitlist_count: 0, registered: [], waitlist: [] });
  open();
  // Assert
  expect(await screen.findByText('No registered attendees.')).toBeTruthy();
  expect(screen.getByText('No attendees on the waitlist.')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Empty event' })).toBeTruthy();
  expect(screen.getByLabelText('Registration summary').textContent).toBe('0 registered · 0 on waitlist');
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
