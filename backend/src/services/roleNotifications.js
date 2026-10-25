// File: Notifications for the two roles that had none (parent notification system): the Coordinator Lead hears about new
// requests to assign, and the Safety Officer hears when an event becomes ready for its safety check.
const eventModel = require('../models/eventModel');
const eventDecisionModel = require('../models/eventDecisionModel');
const notificationService = require('./notificationService');
const { evaluateSafetyReview } = require('./eventDecisionPolicy');

/** One notification per holder of `role`, inserted on the caller's transaction client; returns the stored rows. */
async function notifyRole(db, role, note) {
  const userIds = await eventModel.userIdsWithRole(db, role);
  if (!userIds.length) return [];
  return notificationService.insertNotifications(db, userIds.map((userId) => ({ ...note, userId, changeRequestId: null })));
}

/**
 * Tells every Coordinator Lead that a submitted request is waiting to be assigned to an Event Coordinator.
 * @param {{ query: Function }} db transaction client, so the submission and its notification commit together.
 * @param {{ id: number, name: string }} event the event that was just submitted.
 * @returns {Promise<object[]>} stored rows (with emails) for delivery after commit.
 */
function notifyLeadsOfSubmission(db, event) {
  return notifyRole(db, 'event_coordinator_lead', {
    eventId: event.id, type: 'event_awaiting_assignment',
    title: `New request to assign: ${event.name}`,
    message: `${event.name} was submitted and needs an Event Coordinator.`,
    details: { eventId: event.id },
  });
}

/** True when the event can be safety checked now (the same rule as the Safety Officer's queue and API). */
async function isReadyForSafetyCheck(db, eventId) {
  const context = await eventDecisionModel.loadDecisionContext(db, eventId);
  return Boolean(context) && !evaluateSafetyReview({ ...context, now: Date.now() });
}

/**
 * Tells every Safety Officer that an event has just become ready for its safety check. Only a change from not ready to
 * ready notifies, so later edits to an event that was already waiting do not repeat the message.
 * @param {{ query: Function }} db transaction client, read after the change has been written.
 * @param {number} eventId the event the change concerned.
 * @param {boolean} wasReady readiness measured on the same client just before the change.
 * @returns {Promise<object[]>} stored rows for delivery after commit (empty when nothing was sent).
 */
async function notifySafetyIfNewlyReady(db, eventId, wasReady) {
  if (wasReady || !await isReadyForSafetyCheck(db, eventId)) return [];
  const { rows: [event] } = await db.query('SELECT id, name FROM events WHERE id = $1', [eventId]);
  return notifyRole(db, 'safety_officer', {
    eventId: event.id, type: 'safety_check_ready',
    title: `Ready for safety check: ${event.name}`,
    message: `${event.name} has confirmed venue and technical arrangements and is ready for its operational safety check.`,
    details: { eventId: event.id },
  });
}

module.exports = { notifyLeadsOfSubmission, isReadyForSafetyCheck, notifySafetyIfNewlyReady };
