// File: Records equipment status changes in transactions and notifies the assigned Event Coordinator (Tracks Equipment Request Status AC2).
const { pool } = require('../config/db');
const eventModel = require('../models/eventModel');
const statusModel = require('../models/equipmentStatusModel');
const notificationService = require('./notificationService');
const { STATUS_LABELS, OUTCOME_STATUS, requestedItems, affectedItemsError, affectedSummary } = require('./equipmentStatus');

/** Builds an expected business-rule failure carrying an HTTP status. */
function failure(status, message) { return Object.assign(new Error(message), { status }); }

/** Runs `work(client)` in one transaction and emails stored notifications only after commit. */
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

/** The coordinator's status-change notification, or none when no coordinator is assigned yet. */
function coordinatorNotice(event, status, lines) {
  if (!event.coordinator_id) return [];
  return [{
    userId: event.coordinator_id, eventId: event.id, changeRequestId: null, type: 'equipment_status_changed',
    title: `Equipment request ${STATUS_LABELS[status].toLowerCase()}: ${event.name}`,
    message: [`The equipment request for ${event.name} is now ${STATUS_LABELS[status].toLowerCase()}.`, ...lines].join('\n'),
    details: { status, version: event.equipment_requirements_version },
  }];
}

/**
 * Records Technical Support's review of the current request version and tells the assigned coordinator the new status
 * (AC2). A partial review must name the affected items (AC3), validated against what this version requested.
 * @returns {Promise<{ review: object|null, notifiedCoordinator: boolean }>} review is null when the version moved on.
 */
async function recordReview(eventId, reviewerId, { outcome, reason, requestVersion, affectedItems }) {
  return inTransaction(async (client) => {
    const event = await statusModel.lockRequest(client, eventId);
    // A changed or already-reviewed version is reported the same way as before: refresh the queue.
    if (!event || event.equipment_requirements_version !== requestVersion) return { review: null, notifiedCoordinator: false, stored: [] };
    const items = requestedItems(event);
    if (outcome === 'partially_fulfillable') {
      const problem = affectedItemsError(items, affectedItems);
      if (problem) throw failure(400, problem);
    }
    const affected = outcome === 'partially_fulfillable' ? affectedItems : [];
    const review = await eventModel.createEquipmentReview(eventId, { outcome, reason, requestVersion, affectedItems: affected }, reviewerId, client);
    if (!review) return { review: null, notifiedCoordinator: false, stored: [] };
    const lines = [
      ...(affected.length ? [`Affected items: ${affectedSummary(items, affected).join(', ')}.`] : []),
      ...(reason ? [`Reason: ${reason}`] : []),
    ];
    const notes = coordinatorNotice(event, OUTCOME_STATUS[outcome], lines);
    const stored = notes.length ? await notificationService.insertNotifications(client, notes) : [];
    return { review, notifiedCoordinator: notes.length > 0, stored };
  });
}

/**
 * Saves the organiser's edit to an unconfirmed request (a new version, so it is pending again). If the replaced version
 * had already been reviewed, its status changes back to pending and the coordinator is told (AC2).
 * @returns {Promise<object|null>} the updated event, or null when the request was confirmed meanwhile.
 */
async function resubmitRequest(eventId, organiserId, data) {
  return inTransaction(async (client) => {
    const before = await statusModel.lockRequest(client, eventId);
    const event = await eventModel.updateEquipment(eventId, organiserId, data, client);
    if (!event) return { event: null, stored: [] };
    const notes = before.reviewed ? coordinatorNotice(event, 'pending', ['The organiser changed the requirements, so Technical Support will review them again.']) : [];
    const stored = notes.length ? await notificationService.insertNotifications(client, notes) : [];
    return { event, stored };
  });
}

module.exports = { recordReview, resubmitRequest };
