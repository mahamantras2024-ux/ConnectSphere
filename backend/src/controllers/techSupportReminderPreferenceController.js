// File: Reads and persists a Technical Support member's periodic reminder preference (AC4). Mirrors the Venue Staff
// reminder controller: both return/accept { preference: { dailyPendingReminders, reminderFrequencyDays } } so the two
// dashboards share one contract.
const { pool } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const {
  getTechSupportReminderPreference,
  updateTechSupportReminderPreference,
} = require('../services/techSupportReminderPreferences');

/** Returns the signed-in member's stored preference, or the disabled/daily default when none exists. */
const getReminderPreference = asyncHandler(async (req, res) => {
  res.json({ preference: await getTechSupportReminderPreference(pool, req.user.id) });
});

/** Persists the member's opt-in and selected cadence; a bad payload is reported as a 400 by the service. */
const saveReminderPreference = asyncHandler(async (req, res) => {
  try {
    const preference = await updateTechSupportReminderPreference(
      pool, req.user.id, req.body?.dailyPendingReminders, req.body?.reminderFrequencyDays,
    );
    res.json({ preference });
  } catch (error) {
    // The service throws a tagged 400 for an invalid opt-in/cadence; surface it as a client error, not a 500.
    if (error.status) return res.status(error.status).json({ message: error.message });
    throw error;
  }
});

module.exports = { getReminderPreference, saveReminderPreference };
