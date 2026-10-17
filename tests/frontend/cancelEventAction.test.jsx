import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import CancelEventAction from '../../frontend/src/pages/events/CancelEventAction';
import { api } from '../../frontend/src/api/client';

vi.mock('../../frontend/src/api/client', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

afterEach(cleanup);

describe('SCRUM-90 event cancellation action', () => {
  it('AC4 - allows the organiser to confirm cancellation and reflects the committed result', async () => {
    // Arrange: the current attendee-facing event is owned by the signed-in organiser.
    const event = { id: 44, name: 'River Festival', status: 'approved', is_draft: false,
      registration_required: true, organiser_id: 8, coordinator_id: 12 };
    const user = { id: 8, role: 'event_organiser' };
    const onCancelled = vi.fn();
    const onMessage = vi.fn();
    api.post.mockResolvedValue({ event: { id: 44, name: 'River Festival', status: 'cancelled' },
      message: 'Event cancelled. Active attendees have been notified.' });
    render(<CancelEventAction event={event} user={user} token="session" onCancelled={onCancelled} onMessage={onMessage} />);
    // Act: confirm the destructive status change.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel event' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    // Assert: the API is called only after confirmation and the page receives the new public status.
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(api.post).toHaveBeenCalledWith('/events/44/cancel', {}, 'session');
    expect(onCancelled).toHaveBeenCalledWith({ id: 44, name: 'River Festival', status: 'cancelled' });
    expect(onMessage).toHaveBeenCalledWith('Event cancelled. Active attendees have been notified.');
  });

  it('AC3 AC6 - hides cancellation for an unrelated coordinator and for an internal planning status', () => {
    // Arrange: neither caller can cancel a different coordinator's event or an unpublished planning record.
    const event = { id: 44, status: 'planning', is_draft: false, registration_required: true,
      organiser_id: 8, coordinator_id: 12 };
    const onCancelled = vi.fn();
    // Act / Assert
    const { rerender } = render(<CancelEventAction event={event} user={{ id: 99, role: 'event_coordinator' }}
      token="session" onCancelled={onCancelled} onMessage={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Cancel event' })).toBeNull();
    rerender(<CancelEventAction event={{ ...event, status: 'approved' }} user={{ id: 99, role: 'event_coordinator' }}
      token="session" onCancelled={onCancelled} onMessage={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Cancel event' })).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('AC4 - exposes cancellation to the event\'s assigned coordinator', () => {
    // Arrange: the coordinator is assigned to a published and confirmed event.
    const event = { id: 44, status: 'confirmed', is_draft: false, registration_required: true,
      organiser_id: 8, coordinator_id: 12 };
    // Act
    render(<CancelEventAction event={event} user={{ id: 12, role: 'event_coordinator' }}
      token="session" onCancelled={vi.fn()} onMessage={vi.fn()} />);
    // Assert
    expect(screen.getByRole('button', { name: 'Cancel event' })).toBeTruthy();
  });

  it('AC4 AC5 - reports a failed cancellation and keeps the event action available for retry', async () => {
    // Arrange: a temporary API failure must not pretend the event was cancelled.
    const event = { id: 44, status: 'confirmed', is_draft: false, registration_required: true,
      organiser_id: 8, coordinator_id: 12 };
    api.post.mockRejectedValue(new Error('Cancellation unavailable'));
    render(<CancelEventAction event={event} user={{ id: 8, role: 'event_organiser' }}
      token="session" onCancelled={vi.fn()} onMessage={vi.fn()} />);
    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Cancel event' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    // Assert
    expect((await screen.findByRole('alert')).textContent).toBe('Cancellation unavailable');
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy();
  });

  it('AC4 - lets the user dismiss cancellation before changing the event status', () => {
    // Arrange: the event owner opens the cancellation confirmation but has not committed the action.
    const event = { id: 44, status: 'confirmed', is_draft: false, registration_required: true,
      organiser_id: 8, coordinator_id: 12 };
    render(<CancelEventAction event={event} user={{ id: 8, role: 'event_organiser' }}
      token="session" onCancelled={vi.fn()} onMessage={vi.fn()} />);
    // Act: close the confirmation rather than submit it.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel event' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    // Assert: the event remains available to cancel later and no status write occurred.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel event' })).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });
});
