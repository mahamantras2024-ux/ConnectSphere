// File: Registers authenticated, role-restricted event creation/list/detail endpoints.
const express = require('express');
const router = express.Router();
const eventController = require('../controllers/eventController');
const eventReadController = require('../controllers/eventReadController');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');

router.use(requireAuth);

router.post('/', requireRole('event_organiser'), eventController.createEvent);

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
