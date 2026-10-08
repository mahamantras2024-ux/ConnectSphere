// File: Registers the Safety Officer's Operational Safety Check queue under /api/safety.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
const decisions = require('../controllers/eventDecisionController');

const router = express.Router();
router.get('/checks', requireAuth, requireRole('safety_officer'), decisions.getSafetyQueue);

module.exports = router;
