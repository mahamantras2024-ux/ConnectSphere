// File: Registers Check Venue Suitability endpoints under /api/events (own router, mounted beside eventRoutes).
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
const suitability = require('../controllers/venueSuitabilityController');

const router = express.Router();
// Only the assigned Event Coordinator; the controller scopes the read to their own events.
router.get('/:id/venue-suitability', requireAuth, requireRole('event_coordinator'), suitability.getSuitability);

module.exports = router;
