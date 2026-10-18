// File: Registers the equipment request status endpoint under /api/events (own router, mounted beside eventRoutes).
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
const { getEquipmentStatus } = require('../controllers/equipmentStatusController');
const equipmentReservationUnavailability = require('../controllers/equipmentReservationUnavailabilityController');

const router = express.Router();
// Only the assigned Event Coordinator; the controller scopes the read to their own events.
router.get('/:id/equipment-status', requireAuth, requireRole('event_coordinator'), getEquipmentStatus);
router.post(
  '/:eventId/equipment-reservation-issues/:issueId/decision',
  requireAuth,
  requireRole('event_coordinator'),
  equipmentReservationUnavailability.decideAlternative,
);

module.exports = router;
