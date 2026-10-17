// File: Applies owner/coordinator event cancellations and notifies active attendees after the status commits.
const { pool } = require('../config/db');
const eventCancellationModel = require('../models/eventCancellationModel');
const notificationService = require('./notificationService');

/** Creates an HTTP-aware error for expected authorization and lifecycle conflicts. */
function failure(status, message, code) { return Object.assign(new Error(message), { status, code }); }

/**
 * Cancels a published event for its organiser or assigned coordinator. The event update and in-app notifications
 * commit together; email delivery runs afterward so a mail outage cannot undo the cancellation.
 */
async function cancelEvent(eventId, user) {
  const scope = user.role === 'event_organiser' ? { organiserId: user.id } : { coordinatorId: user.id };
  const client = await pool.connect();
  let event;
  let stored = [];
  try {
    await client.query('BEGIN');
    const context = await eventCancellationModel.loadCancellationContext(client, eventId, scope);
    if (!context) throw failure(404, 'Event not found.');
    if (context.is_draft || !context.registration_required || !['approved', 'confirmed'].includes(context.status)) {
      throw failure(409, 'Only a published, confirmed event can be cancelled.', 'EVENT_NOT_CANCELLABLE');
    }

    event = await eventCancellationModel.recordCancellation(client, eventId);
    if (!event) throw failure(409, 'The event status changed. Refresh and try again.', 'EVENT_STATUS_CHANGED');
    const attendees = await eventCancellationModel.listActiveAttendees(client, eventId);
    const notes = attendees.map(({ attendee_id: userId }) => ({
      userId,
      eventId,
      changeRequestId: null,
      type: 'event_cancelled',
      title: `Event cancelled: ${event.name}`,
      message: `${event.name} has been cancelled. Please check the event details in ConnectSphere for the latest information.`,
      details: { status: 'cancelled' },
    }));
    if (notes.length) stored = await notificationService.insertNotifications(client, notes);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  await notificationService.emailNotifications(stored);
  return { event, notifiedCount: stored.length };
}

module.exports = { cancelEvent };
