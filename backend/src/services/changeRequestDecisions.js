// File: Applies an Event Coordinator's approve/reject decision on a change request in one transaction and notifies affected users.
const { pool } = require('../config/db');
const eventModel = require('../models/eventModel');
const notificationService = require('./notificationService');
const {
  isSupportedField, describeChanges, assessArrangements, recipientsFor, changeLines,
} = require('./changeRequestReview');

/** Builds an error carrying the HTTP status and optional machine-readable code for the controller. */
function failure(status, message, code) { return Object.assign(new Error(message), { status, code }); }

/**
 * Builds the notification rows for a decision; text is plain and rendered as text by the UI and email.
 * Messages name the event as it was when the request was made, so a rename does not leave recipients
 * looking for an event title they have not seen yet; the change lines show the new name.
 */
function notificationsFor({ request, decision, reason, changes, arrangements, recipients }) {
  const base = { eventId: request.event_id, changeRequestId: request.id };
  const event = request.event;
  const lines = changeLines(changes).join('\n');
  if (decision === 'rejected') {
    return [{ ...base, userId: request.organiser_id, type: 'change_request_rejected',
      title: `Change request not approved: ${event.name}`,
      message: `Your requested changes to ${event.name} were not approved. The confirmed details remain in effect.`
        + (reason ? `\nReason: ${reason}` : ''),
      details: { changes, reason } }];
  }
  const arrangementLines = arrangements.map((item) => `${item.venueName}: ${item.reasons.join(' ')}`).join('\n');
  const staffMessage = `The Event Coordinator approved changes to ${event.name}. Review your arrangements.\n${lines}`
    + (arrangementLines ? `\nArrangements needing attention:\n${arrangementLines}` : '');
  return [
    { ...base, userId: request.organiser_id, type: 'change_request_approved', title: `Change request approved: ${event.name}`,
      message: `Your requested changes to ${event.name} were approved and applied.\n${lines}` + (reason ? `\nNote: ${reason}` : ''),
      details: { changes, reason } },
    ...[...recipients.venueStaff, ...recipients.technicalSupport].map((userId) => ({ ...base, userId,
      type: 'event_details_changed', title: `Event details changed: ${event.name}`, message: staffMessage,
      details: { changes, arrangements } })),
  ];
}

/**
 * Approves (applies) or rejects a pending change request for the coordinator currently assigned to its event.
 * Everything that must stay consistent - event values, request status/reviewer/reason and every notification -
 * commits together, so recipients are informed immediately and never about a decision that rolled back.
 * Emails are sent only after commit and can fail without affecting the decision.
 * @param {number} requestId change request id.
 * @param {number} coordinatorId authenticated coordinator.
 * @param {'approved'|'rejected'} decision coordinator's decision.
 * @param {string|null} reason optional explanation (already validated and trimmed).
 * @returns {Promise<object>} decided request, event, changes, flagged arrangements and notified user ids by group.
 */
async function decideChangeRequest(requestId, coordinatorId, decision, reason) {
  const client = await pool.connect();
  let outcome;
  try {
    await client.query('BEGIN');
    // Locks the request and its event. Responsibility follows the event's current coordinator (the Lead can reassign
    // events), so a request inherited at handover is decided by the new coordinator and no longer by the previous one.
    const request = (await client.query(`
      SELECT r.id, r.event_id, r.organiser_id, r.coordinator_id, r.requested_changes, r.status, to_jsonb(e) AS event
      FROM event_change_requests r JOIN events e ON e.id=r.event_id
      WHERE r.id=$1 AND e.coordinator_id=$2
      FOR UPDATE OF r, e`, [requestId, coordinatorId])).rows[0];
    if (!request) throw failure(404, 'Change request not found.');
    if (request.status !== 'pending') throw failure(409, 'This change request has already been decided.', 'ALREADY_DECIDED');

    let event = request.event;
    const changes = describeChanges(event, request.requested_changes);
    let arrangements = [];
    let recipients = { organiser: [request.organiser_id], venueStaff: [], technicalSupport: [] };
    if (decision === 'approved') {
      // A field this release cannot store (e.g. from a newer client) must not be half-applied.
      const unsupported = Object.keys(request.requested_changes).filter((field) => !isSupportedField(field));
      if (unsupported.length) {
        throw failure(409, `This change request includes changes that cannot be applied yet: ${unsupported.join(', ')}.`, 'UNSUPPORTED_CHANGE');
      }
      event = await eventModel.applyChanges(client, request.event_id, request.requested_changes);
      const changedFields = changes.map((change) => change.field);
      const bookings = await eventModel.loadArrangements(client, request.event_id, true);
      arrangements = assessArrangements(event, changedFields, bookings, Date.now());
      // Role lists are only read when a rule could use them.
      const venueStaffIds = arrangements.some((item) => !item.decisionBy) ? await eventModel.userIdsWithRole(client, 'venue_staff') : [];
      const technicalSupportIds = event.equipment_notes?.trim() ? await eventModel.userIdsWithRole(client, 'technical_support') : [];
      recipients = recipientsFor({ event, changedFields, arrangements, venueStaffIds, technicalSupportIds });
    }

    const decided = (await client.query(`
      UPDATE event_change_requests SET status=$2, reviewed_at=now(), reviewed_by=$3, decision_reason=$4
      WHERE id=$1 RETURNING id, event_id, organiser_id, coordinator_id, requested_changes, status, submitted_at,
        reviewed_at, reviewed_by, decision_reason`, [request.id, decision, coordinatorId, reason])).rows[0];
    const stored = await notificationService.insertNotifications(client,
      notificationsFor({ request, decision, reason, changes, arrangements, recipients }));
    await client.query('COMMIT');
    outcome = { changeRequest: decided, event, changes, arrangements, notified: recipients, stored };
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

module.exports = { decideChangeRequest };
