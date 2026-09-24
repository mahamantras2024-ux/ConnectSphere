const express = require('express');
const router = express.Router();
const eventController = require('../controllers/eventController');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');

router.use(requireAuth);

router.post('/', requireRole('event_organiser'), eventController.createEvent);

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