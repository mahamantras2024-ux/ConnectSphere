// File: Registers authenticated, role-restricted event creation/list/detail endpoints.
const express = require('express');
const router = express.Router();
const eventController = require('../controllers/eventController');
const eventReadController = require('../controllers/eventReadController');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');

router.use(requireAuth);

router.post('/', requireRole('event_organiser'), eventController.createEvent);
router.put('/:id/non-critical', requireRole('event_organiser'), eventController.updateEventInformation);
router.get('/change-requests', requireRole('event_coordinator'), eventController.listChangeRequests);
router.post('/change-requests/:id/decision', requireRole('event_coordinator'), eventController.decideChangeRequest);
router.post('/:id/clarifications', requireRole('event_coordinator'), eventController.createClarificationRequest);
router.post('/:id/clarifications/:clarificationId/respond', requireRole('event_organiser'), eventController.respondToClarification);

router.get(
  '/',
  requireRole('event_coordinator', 'event_organiser'),
  eventReadController.listEvents
);

router.get(
  '/:id',
  requireRole('event_coordinator', 'event_organiser'),
  eventReadController.getEvent
);

module.exports = router;
