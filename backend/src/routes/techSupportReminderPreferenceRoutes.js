// File: Serves the Technical Support member's own periodic reminder preference (AC4), backed by persistent storage.
const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
const controller = require('../controllers/techSupportReminderPreferenceController');

const router = express.Router();
// Scoped to a signed-in Technical Support member; preferences are always read/written for that member only.
router.use(requireAuth, requireRole('technical_support'));

router.get('/reminder-preference', asyncHandler(controller.getReminderPreference));
router.put('/reminder-preference', asyncHandler(controller.saveReminderPreference));

module.exports = router;
