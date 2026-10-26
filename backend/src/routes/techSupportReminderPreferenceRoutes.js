// File: TEMPORARY MOCK — in-memory store for a Technical Support member's periodic reminder preference (AC4).
// This exists only so the frontend ReminderPreference control works end-to-end for a demo. It does NOT persist across
// restarts and has no database backing or reminder scheduler. The payload shape mirrors the Venue Staff reminder
// endpoint ({ preference: { dailyPendingReminders, reminderFrequencyDays } }) so the two dashboards stay consistent.
// Replace with a real controller + storage (and the AC4.5/4.6 emission scheduler) when the backend feature is
// implemented, then delete this file and its mount.
const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');

const router = express.Router();
// Every route here requires a signed-in Technical Support member; preferences are scoped to that member only.
router.use(requireAuth, requireRole('technical_support'));

// In-memory preferences keyed by user id. Lost on restart — acceptable for a temporary mock.
const preferencesByUserId = new Map();
// The default shown to a member who has never saved a preference (disabled, daily cadence) — matches the venue control.
const DEFAULT_PREFERENCE = { dailyPendingReminders: false, reminderFrequencyDays: 1 };
// Cadences the control offers, expressed in days: Daily (1), Every 3 days (3), Weekly (7).
const ALLOWED_FREQUENCY_DAYS = [1, 3, 7];

// GET returns the caller's stored preference, or the disabled/daily default when none is stored yet.
router.get('/reminder-preference', asyncHandler(async (req, res) => {
  res.json({ preference: preferencesByUserId.get(req.user.id) || DEFAULT_PREFERENCE });
}));

// PUT validates and stores { dailyPendingReminders, reminderFrequencyDays } for the caller, echoing it back.
router.put('/reminder-preference', asyncHandler(async (req, res) => {
  const { dailyPendingReminders, reminderFrequencyDays } = req.body || {};
  // Reject anything the control should never send, so the mock mirrors a real endpoint's input contract.
  if (typeof dailyPendingReminders !== 'boolean' || !ALLOWED_FREQUENCY_DAYS.includes(reminderFrequencyDays)) {
    return res.status(400).json({ message: 'Provide dailyPendingReminders (boolean) and reminderFrequencyDays (1, 3 or 7).' });
  }
  const preference = { dailyPendingReminders, reminderFrequencyDays };
  preferencesByUserId.set(req.user.id, preference);
  return res.json({ preference });
}));

module.exports = router;
