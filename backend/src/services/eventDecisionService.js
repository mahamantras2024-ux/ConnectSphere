// File: Applies coordinator decisions and Safety Officer checks in transactions and notifies the people affected.
const { pool } = require('../config/db');
const eventDecisionModel = require('../models/eventDecisionModel');
const notificationService = require('./notificationService');
const { evaluateDecision, evaluateSafetyReview } = require('./eventDecisionPolicy');

/** Builds an expected business-rule failure carrying an HTTP status and machine-readable code. */
function failure(status, message, code) { return Object.assign(new Error(message), { status, code }); }

/**
 * Runs `work(client)` in one transaction and emails the stored notifications only after commit, so nobody is told
 * about a change that rolled back and a mail outage can never undo the change itself.
 */
async function inTransaction(work) {
  const client = await pool.connect();
  let outcome;
  try {
    await client.query('BEGIN');
    outcome = await work(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await notificationService.emailNotifications(outcome.stored);
  const { stored, ...result } = outcome;
  return result;
}

/** Plain-text organiser notification for a decision; the rejection reason is included when given (AC3/AC6). */
function decisionNotification(event, decision, reason) {
  const approved = decision === 'approved';
  return {
    userId: event.organiser_id, eventId: event.id, changeRequestId: null,
    type: approved ? 'event_approved' : 'event_rejected',
    title: approved ? `Event approved: ${event.name}` : `Event request not approved: ${event.name}`,
    message: approved
      ? `Your event request ${event.name} has been approved by the Event Coordinator and can proceed.`
      : `Your event request ${event.name} was not approved by the Event Coordinator.${reason ? `\nReason: ${reason}` : ''}`,
    details: { decision, reason },
  };
}

/**
 * Approves or rejects an event for its assigned coordinator (AC1-AC7). The event row is locked so two decisions
 * cannot both succeed, every rule is re-checked inside the lock, and the organiser's notification commits with it.
 * @param {number} eventId validated event id.
 * @param {number} coordinatorId authenticated coordinator; only the event's assigned coordinator may decide.
 * @param {'approved'|'rejected'} decision the coordinator's decision.
 * @param {string|null} reason trimmed rejection reason, or null.
 */
async function decideEvent(eventId, coordinatorId, decision, reason) {
  return inTransaction(async (client) => {
    const context = await eventDecisionModel.loadDecisionContext(client, eventId, { coordinatorId, lock: true });
    if (!context) throw failure(404, 'Event not found.');
    const blocked = evaluateDecision(decision, { ...context, now: Date.now() });
    if (blocked) throw failure(409, blocked.message, blocked.code);
    const event = await eventDecisionModel.recordDecision(client, eventId, decision, reason, coordinatorId);
    const stored = await notificationService.insertNotifications(client, [decisionNotification(event, decision, reason)]);
    return { event, stored };
  });
}

/**
 * Records a Safety Officer's Operational Safety Check (Week 7 change 6) once venue and technical arrangements are
 * confirmed, and tells the assigned coordinator so they know whether the event can now be approved.
 */
async function recordSafetyCheck(eventId, safetyOfficerId, outcome, notes) {
  return inTransaction(async (client) => {
    const context = await eventDecisionModel.loadDecisionContext(client, eventId, { lock: true });
    if (!context) throw failure(404, 'Event not found.');
    const blocked = evaluateSafetyReview({ ...context, now: Date.now() });
    if (blocked) throw failure(409, blocked.message, blocked.code);
    const safetyCheck = await eventDecisionModel.insertSafetyCheck(client, eventId, safetyOfficerId, outcome, notes);
    const label = { approved: 'passed', rejected: 'failed', changes_requested: 'needs changes' }[outcome];
    const stored = context.coordinator_id ? await notificationService.insertNotifications(client, [{
      userId: context.coordinator_id, eventId: context.id, changeRequestId: null, type: 'safety_check_recorded',
      title: `Safety check ${label}: ${context.name}`,
      message: `The Safety Officer recorded the operational safety check for ${context.name}: ${label}.${notes ? `\nNotes: ${notes}` : ''}`,
      details: { outcome, notes },
    }]) : [];
    return { safetyCheck, notifiedCoordinator: Boolean(context.coordinator_id), stored };
  });
}

module.exports = { decideEvent, recordSafetyCheck };
