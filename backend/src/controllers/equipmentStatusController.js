// File: HTTP handler for the Event Coordinator's view of an event's equipment request status.
const asyncHandler = require('../utils/asyncHandler');
const statusModel = require('../models/equipmentStatusModel');
const { requestedItems, statusOf, itemStatuses, OUTCOME_STATUS } = require('../services/equipmentStatus');
const reservationUnavailability = require('../services/equipmentReservationUnavailability');

// Event ids are PostgreSQL INTEGER keys.
const validId = (id) => /^[1-9]\d*$/.test(id) && Number(id) <= 2147483647;

/** The public part of a stored review. */
const reviewView = (review) => (review ? {
  outcome: review.outcome, reason: review.reason, reviewedAt: review.reviewed_at, reviewedBy: review.reviewed_by_name,
} : null);

// GET /api/events/:id/equipment-status - the current request's status and each requested item's status (AC1), with
// the affected items of a partial review (AC3) and earlier reviews. Only the event's assigned coordinator can see it.
const getEquipmentStatus = asyncHandler(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message: 'Choose a valid event.' });
  const event = await statusModel.findCoordinatedRequest(Number(req.params.id), req.user.id);
  if (!event) return res.status(404).json({ message: 'Event not found.' });
  const reviews = await statusModel.listReviews(event.id);
  const version = event.equipment_requirements_version;
  const current = reviews.find((review) => review.request_version === version) || null;
  const items = requestedItems(event);
  const replacementSuggestions = await reservationUnavailability.listEventIssues(event.id);
  return res.json({
    status: statusOf(items, current),
    version,
    review: reviewView(current),
    items: itemStatuses(items, current),
    replacementSuggestions,
    // Earlier versions' requirements are not stored, so their affected items are shown by count, not name.
    history: reviews.filter((review) => review.request_version < version).map((review) => ({
      version: review.request_version, status: OUTCOME_STATUS[review.outcome], ...reviewView(review), affectedCount: review.affected_items.length,
    })),
  });
});

module.exports = { getEquipmentStatus };
