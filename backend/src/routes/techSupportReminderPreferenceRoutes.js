// File: TEMPORARY MOCK — in-memory store for a Technical Support member's periodic reminder preference (AC4).
// This exists only so the frontend ReminderPreference control works end-to-end for a demo. It does NOT persist across
// restarts and has no database backing or reminder scheduler. Replace with a real controller + storage (and the
// AC4.5/4.6 emission scheduler) when the backend feature is implemented, then delete this file and its mount.
const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');

const router = express.Router();
// Every route here requires a signed-in Technical Support member; preferences are scoped to that member only.
router.use(requireAuth, requireRole('technical_support'));

// In-memory preferences keyed by user id. Lost on restart — acceptable for a temporary mock.
const preferencesByUserId = new Map();
// The default shown to a member who has never saved a preference (matches the frontend's empty-state default).
const DEFAULT_PREFERENCE = { enabled: false, frequency: 'weekly' };
const ALLOWED_FREQUENCIES = ['daily', 'weekly'];

// GET returns the caller's stored { enabled, frequency }, or the disabled/weekly default when none is stored yet.
router.get('/reminder-preference', asyncHandler(async (req, res) => {
  res.json(preferencesByUserId.get(req.user.id) || DEFAULT_PREFERENCE);
}));

// PUT validates and stores exactly { enabled, frequency } for the caller, then echoes the stored value back.
router.put('/reminder-preference', asyncHandler(async (req, res) => {
  const { enabled, frequency } = req.body || {};
  // Reject anything the control should never send, so the mock mirrors a real endpoint's input contract.
  if (typeof enabled !== 'boolean' || !ALLOWED_FREQUENCIES.includes(frequency)) {
    return res.status(400).json({ message: 'Provide enabled (boolean) and frequency (daily or weekly).' });
  }
  const preference = { enabled, frequency };
  preferencesByUserId.set(req.user.id, preference);
  return res.json(preference);
}));

module.exports = router;
