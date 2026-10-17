// File: Reads the facts Check Venue Suitability compares: the event's venue requirements and the active venues.
const { pool } = require('../config/db');

/** The organiser's venue requirements, only for the event's assigned coordinator (null otherwise, so other events stay private). */
async function findCoordinatedEvent(eventId, coordinatorId) {
  const result = await pool.query(`
    SELECT id, expected_attendance, room_layout_preference, accessibility_requirements
    FROM events WHERE id = $1 AND coordinator_id = $2`, [eventId, coordinatorId]);
  return result.rows[0] || null;
}

/** Venues currently offered in the catalogue; deactivated venues cannot be chosen, so they are never assessed. */
async function listActiveVenues() {
  const result = await pool.query(`
    SELECT id, name, location, capacity, facilities, supported_layouts, accessibility_features
    FROM venues WHERE is_active = true ORDER BY id`);
  return result.rows;
}

module.exports = { findCoordinatedEvent, listActiveVenues };
