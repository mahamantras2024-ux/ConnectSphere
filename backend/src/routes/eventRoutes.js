const express = require('express');
const router = express.Router();
const eventController = require('../controllers/eventController');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

router.get(
  '/',
  requireRole('event_coordinator', 'event_organiser'),
  eventController.listEvents
);

router.get(
  '/:id',
  requireRole('event_coordinator', 'event_organiser'),
  eventController.getEvent
);

module.exports = router;
