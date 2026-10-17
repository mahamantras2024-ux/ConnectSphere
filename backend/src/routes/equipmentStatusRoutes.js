// File: Registers the equipment request status endpoint under /api/events (own router, mounted beside eventRoutes).
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
const { getEquipmentStatus } = require('../controllers/equipmentStatusController');

const router = express.Router();
// Only the assigned Event Coordinator; the controller scopes the read to their own events.
router.get('/:id/equipment-status', requireAuth, requireRole('event_coordinator'), getEquipmentStatus);

module.exports = router;
