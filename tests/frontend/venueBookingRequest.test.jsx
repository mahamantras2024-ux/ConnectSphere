import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api } from '../../frontend/src/api/client';
import VenueBookingRequest from '../../frontend/src/pages/events/VenueBookingRequest';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

const venues = [{ id: 7, name: 'Hall North' }, { id: 8, name: 'Studio East' }];
const event = { id: 3, proposed_date: '2030-10-10', proposed_start_time: '10:00:00', proposed_end_time: '11:00:00' };

/** Renders the coordinator request flow with only venue API calls controlled by the test. */
function openRequest() {
  return render(<VenueBookingRequest event={event} token="coordinator-token" />);
}

beforeEach(() => {
  vi.resetAllMocks();
  api.get.mockResolvedValue(venues);
});

afterEach(cleanup);

describe('Booking Conflict Detection', () => {
  it('AC2 AC3 - warns about an unavailable venue and retains edits so the coordinator can retry', async () => {
    // Arrange: the first venue/time conflicts; a second venue and period are available.
    api.post.mockRejectedValueOnce(Object.assign(new Error('The requested period is unavailable.'), { status: 409 }))
      .mockResolvedValueOnce({ request: { id: 21, status: 'pending' } });
    openRequest();
    const venue = await screen.findByLabelText('Venue');
    const date = screen.getByLabelText('Date');
    const start = screen.getByLabelText('Start time');
    const end = screen.getByLabelText('End time');

    // Act: submit the conflicting selection, then revise it and submit again.
    fireEvent.click(screen.getByRole('button', { name: 'Request venue' }));
    const warning = await screen.findByRole('alert');
    // Assert: the warning explains the conflict and the original selection remains editable.
    expect(warning.textContent).toMatch(/Hall North is unavailable for the requested period/i);
    expect(venue.value).toBe('7');
    expect(date.value).toBe('2030-10-10');
    expect(start.value).toBe('10:00');
    expect(end.value).toBe('11:00');

    fireEvent.change(venue, { target: { value: '8' } });
    fireEvent.change(date, { target: { value: '2030-10-11' } });
    fireEvent.change(start, { target: { value: '14:00' } });
    fireEvent.change(end, { target: { value: '15:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request venue' }));

    // Assert: the revised values, rather than stale conflicting values, reach the request endpoint.
    await screen.findByText(/venue request submitted/i);
    expect(api.post).toHaveBeenNthCalledWith(2, '/venues/8/requests', {
      eventId: 3,
      startDatetime: '2030-10-11T14:00:00+08:00',
      endDatetime: '2030-10-11T15:00:00+08:00',
    }, 'coordinator-token');
  });

  it('AC4 - submits a non-overlapping venue and period without showing a conflict warning', async () => {
    // Arrange: no confirmed booking intersects the coordinator's selected venue and time.
    api.get.mockResolvedValue({ venues });
    api.post.mockResolvedValue({ request: { id: 21, status: 'pending' } });
    openRequest();

    // Act
    fireEvent.click(await screen.findByRole('button', { name: 'Request venue' }));

    // Assert: the request is accepted and the user sees success rather than a false conflict.
    expect(await screen.findByText(/venue request submitted/i)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/venues/7/requests', {
      eventId: 3,
      startDatetime: '2030-10-10T10:00:00+08:00',
      endDatetime: '2030-10-10T11:00:00+08:00',
    }, 'coordinator-token'));
  });

  it('AC3 - keeps the current selection and displays an actionable message when request submission fails', async () => {
    // Arrange: a service failure is not an availability conflict, so its message should remain accurate.
    api.post.mockRejectedValue(new Error('Venue request service unavailable.'));
    openRequest();
    const venue = await screen.findByLabelText('Venue');
    const date = screen.getByLabelText('Date');

    // Act
    fireEvent.change(venue, { target: { value: '8' } });
    fireEvent.change(date, { target: { value: '2030-10-12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request venue' }));

    // Assert: a failed submission does not discard editable values or mislabel the failure as a conflict.
    expect((await screen.findByRole('alert')).textContent).toBe('Venue request service unavailable.');
    expect(venue.value).toBe('8');
    expect(date.value).toBe('2030-10-12');
  });

  it('AC3 - provides a fallback message when the booking service fails without details', async () => {
    // Arrange: the transport error has no usable message and cannot be classified as an overlap.
    api.post.mockRejectedValue(new Error(''));
    openRequest();

    // Act
    fireEvent.click(await screen.findByRole('button', { name: 'Request venue' }));

    // Assert: the coordinator still receives a useful response and can correct the form.
    expect((await screen.findByRole('alert')).textContent).toBe('Unable to submit the venue request.');
  });

  it('AC3 - reports when there are no active venues to select', async () => {
    // Arrange: an empty catalogue gives the coordinator no valid venue to request.
    api.get.mockResolvedValue([]);

    // Act
    openRequest();

    // Assert: no request form is shown without a selectable venue.
    expect(await screen.findByText('No active venues are available to request.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Request venue' })).toBeNull();
  });

  it('AC2 - identifies the period conflict when the selected venue has no display name', async () => {
    // Arrange: legacy venue data can omit a name, but a conflict still needs a useful warning.
    api.get.mockResolvedValue([{ id: 7 }]);
    api.post.mockRejectedValue(Object.assign(new Error('Conflict.'), { status: 409 }));
    openRequest();

    // Act
    fireEvent.click(await screen.findByRole('button', { name: 'Request venue' }));

    // Assert: missing catalogue text does not hide the action the coordinator can take.
    expect((await screen.findByRole('alert')).textContent).toMatch(/^This venue is unavailable for the requested period/);
  });

  it('AC3 - explains when the active venue catalogue cannot be loaded', async () => {
    // Arrange: the catalogue request fails before a venue can be selected.
    api.get.mockRejectedValue(new Error(''));

    // Act
    openRequest();

    // Assert: the coordinator sees a recoverable load message instead of a permanent loading state.
    expect((await screen.findByRole('alert')).textContent).toBe('Unable to load venues.');
  });

  it('AC3 - handles a legacy event without proposed dates and a catalogue response without venue records', async () => {
    // Arrange: older event rows and empty object-shaped catalogue responses may omit optional fields.
    api.get.mockResolvedValue({});

    // Act
    render(<VenueBookingRequest event={{ id: 3 }} token="coordinator-token" />);

    // Assert: absent optional data is treated as no choices, not rendered as invalid text or a broken form.
    expect(await screen.findByText('No active venues are available to request.')).toBeTruthy();
  });
});
