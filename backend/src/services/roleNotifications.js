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
 * Tells every Safety Officer that an event has just become ready for its safety check. The transition guard prevents
 * duplicates while an event remains queued; the latest prior outcome identifies a re-review after requested revisions.
 * @param {{ query: Function }} db transaction client, read after the change has been written.
 * @param {number} eventId the event the change concerned.
 * @param {boolean} wasReady readiness measured on the same client just before the change.
 * @returns {Promise<object[]>} stored rows for delivery after commit (empty when nothing was sent).
 */
async function notifySafetyIfNewlyReady(db, eventId, wasReady) {
  if (wasReady) return [];
  const context = await eventDecisionModel.loadDecisionContext(db, eventId);
  if (!context || evaluateSafetyReview({ ...context, now: Date.now() })) return [];
  const reassessment = ['rejected', 'changes_requested'].includes(context.latest_safety_check?.outcome);
  const requirement = reassessment ? 'reassessment' : 'initial';
  return notifyRole(db, 'safety_officer', {
    eventId: context.id, type: 'safety_check_ready',
    title: reassessment ? `Ready for safety re-review: ${context.name}` : `Ready for safety check: ${context.name}`,
    message: reassessment
      ? `${context.name} has completed the requested arrangement revisions and is ready for operational safety re-review.`
      : `${context.name} has confirmed venue and technical arrangements and is ready for its operational safety check.`,
    details: { eventId: context.id, requirement },
  });
}

module.exports = { notifyLeadsOfSubmission, isReadyForSafetyCheck, notifySafetyIfNewlyReady };
