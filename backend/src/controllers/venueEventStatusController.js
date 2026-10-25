// File: Exposes the Venue Staff-only event-status and configurable reminder-preference API.
const { pool } = require('../config/db');
const venueEventStatus = require('../services/venueEventStatus');

/** Returns the authenticated staff member's assigned-venue events without accepting a forgeable staff identifier. */
async function listRelevantEvents(req, res) {
  const events = await venueEventStatus.listRelevantVenueEvents(pool, req.user.id);
  return res.json({ events });
}

/** Reads the signed-in Venue Staff member's own preference. */
async function getReminderPreference(req, res) {
  return res.json({ preference: await venueEventStatus.getVenueReminderPreference(pool, req.user.id) });
}

/** Persists the signed-in Venue Staff member's opt-in and selected reminder cadence. */
async function saveReminderPreference(req, res) {
  return res.json({ preference: await venueEventStatus.updateVenueReminderPreference(
    pool, req.user.id, req.body.dailyPendingReminders, req.body.reminderFrequencyDays,
  ) });
}

module.exports = { listRelevantEvents, getReminderPreference, saveReminderPreference };
