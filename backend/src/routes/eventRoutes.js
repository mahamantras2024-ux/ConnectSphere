const express = require('express');
const router = express.Router();
const eventController = require('../controllers/eventController');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');

router.use(requireAuth);

router.post('/', requireRole('event_organiser'), eventController.createEvent);
router.get('/', eventController.listEvents);
router.get('/:id', eventController.getEvent);
router.patch('/:id', eventController.updateEvent);
router.post('/:id/submit', requireRole('event_organiser'), eventController.submitEvent);
router.post('/:id/assign-coordinator', requireRole('event_coordinator'), eventController.assignCoordinator);
router.post('/:id/status', requireRole('event_coordinator'), eventController.changeStatus);

module.exports = router;
