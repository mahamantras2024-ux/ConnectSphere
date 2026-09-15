const express = require('express');
const router = express.Router();
const registrationController = require('../controllers/registrationController');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');

router.use(requireAuth);

router.post('/', requireRole('attendee'), registrationController.registerForEvent);
router.post('/:eventId/withdraw', requireRole('attendee'), registrationController.withdrawRegistration);
router.get('/mine', requireRole('attendee'), registrationController.listMine);
router.get('/event/:eventId', registrationController.listForEvent);

module.exports = router;
