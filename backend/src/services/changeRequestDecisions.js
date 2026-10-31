// File: Applies an Event Coordinator's approve/reject decision on a change (amendment) request, or an amendment the
// coordinator agreed with the organiser offline, in one transaction, and notifies affected users.
const { pool } = require('../config/db');
const notificationService = require('./notificationService');
const { isReadyForSafetyCheck, notifySafetyIfNewlyReady } = require('./roleNotifications');
const { describeChanges, changeLines } = require('./changeRequestReview');
const { applyAmendment, amendmentRecipients, amendmentNotifications } = require('./agreedAmendments');

/** Builds an error carrying the HTTP status and optional machine-readable code for the controller. */
function failure(status, message, code) { return Object.assign(new Error(message), { status, code }); }

/** Caps the stored rejection title; the message retains the complete name, changes and reason. */
function rejectionNotice(request, changes, reason) {
  return [{ eventId: request.event_id, changeRequestId: request.id, userId: request.organiser_id, type: 'change_request_rejected',
    title: (`Change request not approved: ${request.event.name}`).slice(0, 255),
    message: `Your requested changes to ${request.event.name} were not approved. The confirmed details remain in effect.`
      + `\n${changeLines(changes).join('\n')}` + (reason ? `\nReason: ${reason}` : ''),
    details: { changes, reason } }];
}

/**
 * Applies an amendment on the caller's locked transaction, then stores its history (before -> after and the checks it
 * reopened, AC3/AC5) on the request and the notifications for everyone affected (AC4). Readiness is measured before and
 * after, so Safety Officers still hear when the change makes the event ready (parent notification system AC1).
 */
async function applyAndRecord(client, { request, source, reason, explanation }) {
  const wasReady = await isReadyForSafetyCheck(client, request.event_id);
  const applied = await applyAmendment(client, request.event, request.requested_changes);
  const recipients = await amendmentRecipients(client, applied.event, applied);
  const history = applied.changes.map(({ field, label, current, requested }) => ({ field, label, before: current, after: requested }));
  await client.query('UPDATE event_change_requests SET applied_changes = $2::jsonb, rechecks = $3::jsonb WHERE id = $1',
    [request.id, JSON.stringify(history), JSON.stringify(applied.rechecks)]);
  const notes = amendmentNotifications({ eventId: request.event_id, changeRequestId: request.id, eventName: request.event.name, source,
    reason, explanation, changes: applied.changes, arrangements: applied.arrangements, rechecks: applied.rechecks, recipients });
  const stored = [...await notificationService.insertNotifications(client, notes),
    ...await notifySafetyIfNewlyReady(client, request.event_id, wasReady)];
  return { ...applied, recipients, stored };
}

/** Runs `work(client)` in one transaction and emails the stored notifications only after commit. */
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

/**
 * Approves (applies) or rejects a pending change request for the coordinator currently assigned to its event.
 * Everything that must stay consistent - event values, request status/history and every notification - commits
 * together, so recipients are informed immediately and never about a decision that rolled back.
 * @param {number} requestId change request id.
 * @param {number} coordinatorId authenticated coordinator.
 * @param {'approved'|'rejected'} decision coordinator's decision.
 * @param {string|null} reason optional explanation (already validated and trimmed).
 * @returns {Promise<object>} decided request, event, changes, booking warnings, re-checks and notified user ids by group.
 */
function decideChangeRequest(requestId, coordinatorId, decision, reason) {
  return inTransaction(async (client) => {
    // Locks the request and its event. Responsibility follows the event's current coordinator (the Lead can reassign
    // events), so a request inherited at handover is decided by the new coordinator and no longer by the previous one.
    const request = (await client.query(`
      SELECT r.id, r.event_id, r.organiser_id, r.coordinator_id, r.requested_changes, r.status, r.explanation, to_jsonb(e) AS event
      FROM event_change_requests r JOIN events e ON e.id=r.event_id
      WHERE r.id=$1 AND e.coordinator_id=$2
      FOR UPDATE OF r, e`, [requestId, coordinatorId])).rows[0];
    if (!request) throw failure(404, 'Change request not found.');
    if (request.status !== 'pending') throw failure(409, 'This change request has already been decided.', 'ALREADY_DECIDED');

    let result;
    if (decision === 'approved') {
      result = await applyAndRecord(client, { request, source: 'organiser_request', reason, explanation: request.explanation });
    } else {
      const changes = describeChanges(request.event, request.requested_changes);
      const stored = await notificationService.insertNotifications(client, rejectionNotice(request, changes, reason));
      result = { event: request.event, changes, arrangements: [], rechecks: null,
        recipients: { organiser: [request.organiser_id], venueStaff: [], technicalSupport: [], safetyOfficers: [] }, stored };
    }
    const decided = (await client.query(`
      UPDATE event_change_requests SET status=$2, reviewed_at=now(), reviewed_by=$3, decision_reason=$4
      WHERE id=$1 RETURNING id, event_id, organiser_id, coordinator_id, requested_changes, status, submitted_at,
        reviewed_at, reviewed_by, decision_reason`, [request.id, decision, coordinatorId, reason])).rows[0];
    return { changeRequest: decided, event: result.event, changes: result.changes, arrangements: result.arrangements,
      rechecks: result.rechecks, notified: result.recipients, stored: result.stored };
  });
}

/**
 * Applies an amendment the assigned coordinator agreed with the organiser (for example in an offline clarification):
 * it is recorded as an approved amendment from the coordinator, with what was agreed, and applied like an approved
 * organiser request (history, re-checks and notifications).
 * @param {number} eventId the event (already validated).
 * @param {number} coordinatorId authenticated coordinator; must be the event's current coordinator.
 * @param {{ changes: object, explanation: string, clarificationId: number|null }} input validated changes (camelCase),
 *   what was agreed, and the clarification the agreement came from (optional).
 * @returns {Promise<object>} the recorded amendment, event, changes, re-checks and notified user ids by group.
 */
function applyAgreedAmendment(eventId, coordinatorId, { changes, explanation, clarificationId }) {
  return inTransaction(async (client) => {
    const event = (await client.query('SELECT to_jsonb(e) AS event FROM events e WHERE e.id = $1 AND e.coordinator_id = $2 FOR UPDATE OF e',
      [eventId, coordinatorId])).rows[0]?.event;
    if (!event) throw failure(404, 'Assigned event not found.');
    if (clarificationId != null) {
      const linked = await client.query('SELECT 1 FROM event_clarification_requests WHERE id = $1 AND event_id = $2', [clarificationId, eventId]);
      if (!linked.rowCount) throw failure(400, 'Choose a clarification recorded for this event.');
    }
    const request = (await client.query(`
      INSERT INTO event_change_requests (event_id, organiser_id, coordinator_id, requested_changes, explanation, status, source,
        clarification_id, reviewed_by, reviewed_at)
      VALUES ($1, $2, $3, $4::jsonb, $5, 'approved', 'coordinator_agreed', $6, $3, now())
      RETURNING id, event_id, organiser_id, coordinator_id, requested_changes, explanation, status, source, clarification_id,
        submitted_at, reviewed_at, reviewed_by`, [eventId, event.organiser_id, coordinatorId, JSON.stringify(changes), explanation, clarificationId])).rows[0];
    const result = await applyAndRecord(client, { request: { ...request, event }, source: 'coordinator_agreed', reason: null, explanation });
    return { amendment: request, event: result.event, changes: result.changes, rechecks: result.rechecks, notified: result.recipients,
      stored: result.stored };
  });
}

module.exports = { decideChangeRequest, applyAgreedAmendment };
