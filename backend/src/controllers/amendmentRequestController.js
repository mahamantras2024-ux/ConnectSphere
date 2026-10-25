// File: Post-submission amendment requests (Request All Post-Submission Amendments Through the Coordinator). After an
// event request is submitted, the organiser proposes changes with an explanation; the assigned Event Coordinator is
// notified and reviews them, and the accepted information stays in effect until then.
const asyncHandler = require('../utils/asyncHandler');
const eventModel = require('../models/eventModel');
const notificationService = require('../services/notificationService');
const { validateEventChanges } = require('../services/eventChangeValidation');
const { describeChanges, requestedChanges, changeLines } = require('../services/changeRequestReview');

/** Longest explanation accepted (also enforced by the database constraint in migration 019). */
const EXPLANATION_LIMIT = 2000;

/** True for a positive 32-bit integer id given as text. */
const validId = (id) => /^[1-9]\d*$/.test(id) && Number(id) <= 2147483647;

// POST /api/events/:id/amendment-requests stores the organiser's proposed changes and explanation as a pending request
// for the assigned coordinator (AC2, AC4). The event row is not changed (AC3).
const create = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!validId(id)) return res.status(400).json({ message: 'Choose a valid event.' });
  const { changes, explanation } = req.body;
  if (changes == null || typeof changes !== 'object' || Array.isArray(changes)) {
    return res.status(400).json({ message: 'Include the changes you are requesting.' });
  }
  // The coordinator needs the organiser's reason to review the change (AC2), so an explanation is required.
  const reason = typeof explanation === 'string' ? explanation.trim() : '';
  if (!reason || reason.length > EXPLANATION_LIMIT) {
    return res.status(400).json({ message: `Explain the amendment in 1 to ${EXPLANATION_LIMIT} characters.` });
  }
  const current = await eventModel.findAccessibleById(id, req.user);
  if (!current) return res.status(404).json({ message: 'Event not found.' });
  // A draft is still the organiser's to edit; amendments are only for submitted requests.
  if (current.is_draft || current.status === 'draft') {
    return res.status(409).json({ code: 'USE_DRAFT_EDIT', message: 'This event is still a draft. Edit it directly and submit it when ready.' });
  }
  if (eventModel.AMENDMENT_CLOSED_STATUSES.includes(current.status)) {
    return res.status(409).json({ code: 'AMENDMENT_CLOSED', message: `This event is ${current.status}, so amendments can no longer be requested.` });
  }
  // AC4 routes the request to the assigned coordinator; until the Lead assigns one there is nobody to review it.
  if (!current.coordinator_id) {
    return res.status(409).json({ code: 'COORDINATOR_NOT_ASSIGNED', message: 'An Event Coordinator must be assigned before you can request an amendment.' });
  }
  const { data, error } = validateEventChanges(changes, current, { allowEquipment: true });
  if (error) return res.status(400).json({ message: error });
  // Only values that actually differ are requested, so the coordinator reviews real changes only.
  const described = describeChanges(current, data);
  if (!described.length) return res.status(400).json({ message: 'Change at least one detail before requesting an amendment.' });
  const proposed = Object.fromEntries(described.map(({ field }) => [field, data[field]]));
  const notification = {
    title: `New amendment request: ${current.name}`,
    message: [`The Event Organiser requested amendments to ${current.name}.`, ...changeLines(described), `Explanation: ${reason}`].join('\n'),
    details: { changes: described, explanation: reason },
  };
  const created = await eventModel.createAmendmentRequest(id, req.user.id, current.coordinator_id, proposed, reason, notification);
  // No row means the coordinator, status or ownership changed between the read above and the insert.
  if (!created) {
    return res.status(409).json({ code: 'ARRANGEMENT_CHANGED', message: 'The event changed while you were requesting the amendment. Refresh the event and try again.' });
  }
  // The coordinator's address is only used for delivery and is never returned to the organiser.
  const { coordinator_email: coordinatorEmail, ...amendmentRequest } = created;
  await notificationService.emailNotifications([{ email: coordinatorEmail, ...notification }]);
  return res.status(202).json({
    amendmentRequest,
    message: 'Amendment request submitted. The current event information stays in effect until your Event Coordinator reviews it.',
  });
});

// GET /api/events/:id/amendment-requests lists the organiser's own requests for their event with each outcome.
const list = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!validId(id)) return res.status(400).json({ message: 'Choose a valid event.' });
  const event = await eventModel.findAccessibleById(id, req.user);
  if (!event) return res.status(404).json({ message: 'Event not found.' });
  const rows = await eventModel.listAmendmentRequests(id, req.user.id);
  const amendmentRequests = rows.map(({ requested_changes: requested, ...request }) => ({ ...request, changes: requestedChanges(requested) }));
  return res.json({ amendmentRequests });
});

module.exports = { create, list, EXPLANATION_LIMIT };
