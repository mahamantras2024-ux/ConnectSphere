// SCRUM-61: exercises request requirements and policy through the actual form; only HTTP is mocked.
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api } from '../../frontend/src/api/client';
import VenueBookingRequest from '../../frontend/src/pages/events/VenueBookingRequest';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('SCRUM-61 AC2 AC3 AC5 AC6 - submits requirements and opt-in, confirms success, then allows another request', async () => {
  // Arrange: event requirements seed editable request fields; two venues represent independent alternatives.
  api.get.mockResolvedValue([{ id: 7, name: 'North' }, { id: 8, name: 'South' }]);
  api.post.mockResolvedValue({ request: { id: 21 } });
  const saved = vi.fn();
  render(<VenueBookingRequest token="token" onSubmitted={saved} event={{ id: 3, proposed_date: '2030-10-10', proposed_start_time: '10:00:00', proposed_end_time: '11:00:00', expected_attendance: 40, room_layout_preference: 'Theatre', accessibility_requirements: ['Step-free'] }} />);
  await screen.findByLabelText('Venue');
  // Act: add facilities and explicitly choose cascading cancellation.
  fireEvent.change(screen.getByLabelText('Required facilities'), { target: { value: 'Projector, Wi-Fi' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /automatically cancel/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Request venue' }));
  // Assert: exact requirements prevent a passing test if any field or policy is silently dropped.
  await screen.findByText('Venue request submitted.');
  expect(api.post).toHaveBeenCalledWith('/venues/7/requests', expect.objectContaining({
    capacity: 40, layout: 'Theatre', accessibility: ['Step-free'], requiredFacilities: ['Projector', 'Wi-Fi'], cancelOtherPending: true,
  }), 'token');
  expect(saved).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('Venue'), { target: { value: '8' } });
  fireEvent.click(screen.getByRole('button', { name: 'Request venue' }));
  await screen.findByText('Venue request submitted.');
  expect(api.post.mock.calls[1][0]).toBe('/venues/8/requests');
});

it('SCRUM-61 AC2 AC6 - editable requirements and an unchecked preference are sent without stale defaults', async () => {
  // Arrange: a sparse legacy event has no seeded requirements, while cancellation must stay off.
  api.get.mockResolvedValue([{ id: 7, name: 'North' }]);
  api.post.mockResolvedValue({ request: { id: 22 } });
  render(<VenueBookingRequest token="token" event={{ id: 3 }} />);
  await screen.findByLabelText('Venue');
  // Act: edit every new field, including repeated/empty list entries.
  fireEvent.change(screen.getByLabelText('Expected attendance / capacity'), { target: { value: '50' } });
  fireEvent.change(screen.getByLabelText('Room layout'), { target: { value: ' Classroom ' } });
  fireEvent.change(screen.getByLabelText('Accessibility requirements'), { target: { value: 'Ramp, Ramp, , Hearing loop' } });
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2030-10-10' } });
  fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '10:00' } });
  fireEvent.change(screen.getByLabelText('End time'), { target: { value: '11:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Request venue' }));
  // Assert: exact values catch uncontrolled fields, stale state and accidental opt-in.
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/venues/7/requests', {
    eventId: 3, startDatetime: '2030-10-10T10:00:00+08:00', endDatetime: '2030-10-10T11:00:00+08:00',
    capacity: 50, layout: 'Classroom', accessibility: ['Ramp', 'Hearing loop'], requiredFacilities: [], cancelOtherPending: false,
  }, 'token'));
});
