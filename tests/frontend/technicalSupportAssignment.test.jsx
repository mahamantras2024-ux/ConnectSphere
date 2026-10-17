import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../frontend/src/api/client';
import TechnicalSupportAssignment from '../../frontend/src/pages/coordinator/TechnicalSupportAssignment';
import OnSiteSupportSection from '../../frontend/src/pages/tech-support/OnSiteSupportSection';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), put: vi.fn() } }));
afterEach(cleanup);

const staff = [
  { id: 41, full_name: 'Taylor Support', email: 'taylor@example.com' },
  { id: 42, full_name: 'Morgan Support', email: 'morgan@example.com' },
];
const event = { id: 7, name: 'Community Workshop', technical_support_required: true, technical_support_staff: [staff[0]] };

// AC2: the coordinator can select multiple staff and persist the complete assignment.
it('AC2 - assigns one or more Technical Support Staff members', async () => {
  const onSaved = vi.fn();
  api.put.mockResolvedValue({ message: 'Saved' });
  render(<TechnicalSupportAssignment event={event} token="coordinator-token" staff={staff} onSaved={onSaved} />);

  fireEvent.click(screen.getByLabelText(/Morgan Support/));
  fireEvent.click(screen.getByRole('button', { name: 'Assign staff' }));

  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/events/7/technical-support-assignment',
    { staffIds: [41, 42] }, 'coordinator-token'));
  expect(onSaved).toHaveBeenCalledWith(staff);
  expect(screen.queryByText('taylor@example.com')).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByRole('button', { name: 'Assignment saved' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Change assignment' }));
  fireEvent.click(screen.getByLabelText(/Taylor Support/));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Assign staff' }).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Assign staff' }));
  await waitFor(() => expect(api.put).toHaveBeenLastCalledWith('/events/7/technical-support-assignment',
    { staffIds: [42] }, 'coordinator-token'));
});

// AC1: assigned staff see schedule, venue and all equipment facts in the operational view.
it('AC1 - displays assigned event date time venue and equipment', async () => {
  api.get.mockResolvedValue({
    events: [{
      id: 7, name: 'Community Workshop', proposed_date: '2026-10-12',
      proposed_start_time: '09:00:00', proposed_end_time: '12:00:00',
      venue_name: 'Innovation Hall', venue_location: 'Level 3',
      equipment_items: [{ item: 'Projector', quantity: 2 }],
    }],
  });
  render(<OnSiteSupportSection token="staff-token" />);

  const card = await screen.findByRole('article', { name: 'Community Workshop' });
  expect(within(card).getByText('12 October 2026')).toBeTruthy();
  expect(within(card).getByText('09:00 – 12:00')).toBeTruthy();
  expect(within(card).getByText('Innovation Hall · Level 3')).toBeTruthy();
  expect(within(card).getByText('Projector')).toBeTruthy();
  expect(within(card).getByText('Qty. 2')).toBeTruthy();
});

// AC3: a failed assignment is visible and does not claim that the team was saved.
it('AC3 - reports assignment changes that fail', async () => {
  api.put.mockRejectedValue(new Error('Assignment changed. Refresh and try again.'));
  render(<TechnicalSupportAssignment event={event} token="coordinator-token" staff={staff} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Assign staff' }));
  expect((await screen.findByRole('alert')).textContent.includes('Assignment changed. Refresh and try again.')).toBe(true);
});
