// File: Registers event approve/reject decision and Operational Safety Check endpoints under /api/events.
// Kept in its own router (mounted beside eventRoutes) so decision work does not collide with other event features.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
const decisions = require('../controllers/eventDecisionController');

const router = express.Router();
router.get('/:id/decision', requireAuth, requireRole('event_organiser', 'event_coordinator', 'event_coordinator_lead'), decisions.getDecision);
router.post('/:id/decision', requireAuth, requireRole('event_coordinator'), decisions.postDecision);
router.post('/:id/safety-checks', requireAuth, requireRole('safety_officer'), decisions.postSafetyCheck);

module.exports = router;
