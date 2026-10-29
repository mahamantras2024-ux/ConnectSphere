// File: Applies coordinator decisions and Safety Officer checks in transactions and notifies the people affected.
const { pool } = require('../config/db');
const eventDecisionModel = require('../models/eventDecisionModel');
const notificationService = require('./notificationService');
const { notifySafetyIfNewlyReady } = require('./roleNotifications');
const { notifyVenueStaffOfEventStatus } = require('./venueEventStatus');
const { evaluateDecision, evaluateSafetyReview, needsTechnicalArrangements, resolutionBlocker } = require('./eventDecisionPolicy');

/** Plain-language names of the planning stages a Safety Officer can reopen, used in notifications. */
const STAGE_LABELS = { venue: 'venue arrangements', technical: 'technical arrangements', event_details: 'event details' };

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

/** Builds an owner-addressed outcome notice; initial approval is explicitly separate from final confirmation (AC2). */
function decisionNotification(event, decision, reason) {
  const labels = { approved: 'initially approved', confirmed: 'finally confirmed', rejected: 'rejected' };
  const messages = {
    approved: `Your event request ${event.name} has been initially approved by the Event Coordinator. This is not final confirmation.`,
    confirmed: `Your event ${event.name} has been finally confirmed. Open the event for the latest arrangements.`,
    rejected: `Your event request ${event.name} was not approved by the Event Coordinator.${reason ? `\nReason: ${reason}` : ''}`,
  };
  return {
    userId: event.organiser_id, eventId: event.id, changeRequestId: null,
    type: { approved: 'event_approved', confirmed: 'event_confirmed', rejected: 'event_rejected' }[decision],
    // Event names may already use all 255 characters allowed by the notification title column.
    title: `Event ${labels[decision]}: ${event.name}`.slice(0, 255),
    message: messages[decision], details: { decision, reason, status: decision },
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
    // SCRUM-92: initial approval does not announce final confirmation to venue staff.
    return { event, stored };
  });
}

/**
 * Records a Safety Officer's Operational Safety Check (Week 7 change 6) once venue and technical arrangements are
 * confirmed and no earlier requested change is outstanding, and tells the assigned coordinator the outcome.
 * A change request (Operational Feasibility Check AC3) also reopens the named planning stages in the same transaction
 * and tells the organiser what must change, so the event cannot be checked again until those stages are complete (AC4).
 * @param {number} eventId validated event id.
 * @param {number} safetyOfficerId authenticated Safety Officer.
 * @param {'approved'|'rejected'|'changes_requested'} outcome the check's result.
 * @param {string|null} notes trimmed notes (required by the controller unless approving).
 * @param {string[]} changeAreas validated stages to reopen; empty unless changes are requested.
 */
async function recordSafetyCheck(eventId, safetyOfficerId, outcome, notes, changeAreas = []) {
  return inTransaction(async (client) => {
    const context = await eventDecisionModel.loadDecisionContext(client, eventId, { lock: true });
    if (!context) throw failure(404, 'Event not found.');
    const blocked = evaluateSafetyReview({ ...context, now: Date.now() });
    if (blocked) throw failure(409, blocked.message, blocked.code);
    // Technical Support only reviews events that asked for something technical, so that stage could never be completed.
    if (changeAreas.includes('technical') && !needsTechnicalArrangements(context)) {
      throw failure(409, 'This event requested no equipment or technical support; ask for event detail changes instead.', 'TECHNICAL_NOT_REQUESTED');
    }
    const safetyCheck = await eventDecisionModel.insertSafetyCheck(client, eventId, safetyOfficerId, outcome, notes, changeAreas);
    if (changeAreas.length) await eventDecisionModel.reopenStages(client, eventId, changeAreas);
    const label = { approved: 'passed', rejected: 'failed', changes_requested: 'needs changes' }[outcome];
    const stages = changeAreas.map((area) => STAGE_LABELS[area]).join(', ');
    const stageLine = stages ? `\nChanges needed to: ${stages}.` : '';
    const notesLine = notes ? `\nNotes: ${notes}` : '';
    const notifications = context.coordinator_id ? [{
      userId: context.coordinator_id, eventId: context.id, changeRequestId: null, type: 'safety_check_recorded',
      title: `Safety check ${label}: ${context.name}`,
      message: `The Safety Officer recorded the operational safety check for ${context.name}: ${label}.${stageLine}${notesLine}`,
      details: { outcome, notes, changeAreas },
    }] : [];
    // The organiser must make event-detail and equipment changes, so they are told whenever revisions are requested.
    if (changeAreas.length) {
      notifications.push({
        userId: context.organiser_id, eventId: context.id, changeRequestId: null, type: 'safety_check_recorded',
        title: `Changes needed for your event: ${context.name}`,
        message: `The Safety Officer requested changes to ${context.name} before it can proceed.${stageLine}${notesLine}`,
        details: { outcome, notes, changeAreas },
      });
    }
    const stored = notifications.length ? await notificationService.insertNotifications(client, notifications) : [];
    return { safetyCheck, notifiedCoordinator: Boolean(context.coordinator_id), stored };
  });
}

/**
 * Marks one stage reopened by the Safety Officer as complete, for the event's assigned coordinator only (AC3/AC4).
 * The stage's own requirement must be met again (e.g. the venue re-confirmed), checked inside the row lock.
 * @returns {Promise<{ open: string[] }>} the stages still waiting; when empty the event is back in the safety queue.
 */
async function resolveSafetyChange(eventId, coordinatorId, area) {
  return inTransaction(async (client) => {
    const context = await eventDecisionModel.loadDecisionContext(client, eventId, { coordinatorId, lock: true });
    if (!context) throw failure(404, 'Event not found.');
    const blocked = resolutionBlocker(area, { ...context, now: Date.now() });
    if (blocked) throw failure(409, blocked.message, blocked.code);
    const open = await eventDecisionModel.resolveStage(client, eventId, area);
    // While a stage was open the event could not be checked, so completing the last one may make it ready again.
    const stored = open.length ? [] : await notifySafetyIfNewlyReady(client, eventId, false);
    return { open, stored };
  });
}

/** Persists one manual lifecycle action under the assignment-scoped row lock, preventing stale or concurrent changes. */
async function transitionEvent(eventId, coordinatorId, status) {
  const { evaluateTransition } = require('./eventLifecyclePolicy');
  return inTransaction(async (client) => {
    const context = await eventDecisionModel.loadDecisionContext(client, eventId, { coordinatorId, lock: true });
    if (!context) throw failure(404, 'Event not found.');
    const blocked = evaluateTransition(status, { ...context, now: Date.now() });
    if (blocked) throw failure(409, blocked.message, blocked.code);
    // Keep the initial decision's author, time and reason intact throughout planning and final confirmation.
    const result = await client.query('UPDATE events SET status=$2, updated_at=now() WHERE id=$1 RETURNING id, status', [eventId, status]);
    const event = result.rows[0];
    // Venue staff receive the actual lifecycle change only after all confirmation prerequisites pass.
    const stored = status === 'confirmed' ? [
      ...await notificationService.insertNotifications(client, [decisionNotification(context, status, null)]),
      ...await notifyVenueStaffOfEventStatus(client, { ...context, ...event }, status),
    ] : [];
    return { event, stored };
  });
}
module.exports = { decideEvent, recordSafetyCheck, resolveSafetyChange, transitionEvent };
