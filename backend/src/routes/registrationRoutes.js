// File: Exposes attendee-scoped registration summaries, registration and confirmed withdrawal actions.
const express = require('express');
const router = express.Router();
const registrationController = require('../controllers/registrationReadController');
const attendeeRegistration = require('../controllers/attendeeRegistrationController');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');

router.use(requireAuth);

router.get('/mine', requireRole('attendee'), registrationController.listMine);
router.get('/events/:eventId', requireRole('attendee'), attendeeRegistration.get);
router.post('/events/:eventId', requireRole('attendee'), attendeeRegistration.create);
router.post('/events/:eventId/withdraw', requireRole('attendee'), attendeeRegistration.withdraw);

module.exports = router;
