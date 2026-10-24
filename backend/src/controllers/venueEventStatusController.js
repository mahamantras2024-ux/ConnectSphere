// File: Exposes the Venue Staff-only event-status and daily reminder-preference API.
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

/** Persists the explicit daily reminder opt-in/out selection for the signed-in Venue Staff member. */
async function saveReminderPreference(req, res) {
  return res.json({ preference: await venueEventStatus.updateVenueReminderPreference(pool, req.user.id, req.body.dailyPendingReminders) });
}

module.exports = { listRelevantEvents, getReminderPreference, saveReminderPreference };
