// File: Exposes only the authenticated attendee's read-only registration summary in Sprint 1.
const express = require('express');
const router = express.Router();
const registrationController = require('../controllers/registrationReadController');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');

router.use(requireAuth);

router.get('/mine', requireRole('attendee'), registrationController.listMine);

module.exports = router;
