// File: Reads equipment requests and their Technical Support reviews for status tracking, and locks an event's request
// while a review or resubmission is recorded.
const { pool } = require('../config/db');

const EQUIPMENT_COLUMNS = `e.id, e.name, e.organiser_id, e.coordinator_id, e.equipment_requirements_version, e.equipment_items,
  e.technical_support_required, e.video_conferencing_required, e.technical_specifications, e.equipment_notes`;

/** The event's current equipment request, only for its assigned coordinator (null otherwise, so other events stay private). */
async function findCoordinatedRequest(eventId, coordinatorId) {
  const result = await pool.query(`SELECT ${EQUIPMENT_COLUMNS} FROM events e WHERE e.id = $1 AND e.coordinator_id = $2`, [eventId, coordinatorId]);
  return result.rows[0] || null;
}

/** Every review of the event, newest request version first, with the reviewer's name. */
async function listReviews(eventId) {
  const result = await pool.query(`
    SELECT r.request_version, r.outcome, r.reason, r.affected_items, r.reviewed_at, reviewer.full_name AS reviewed_by_name
    FROM event_equipment_reviews r LEFT JOIN users reviewer ON reviewer.id = r.reviewed_by
    WHERE r.event_id = $1 ORDER BY r.request_version DESC`, [eventId]);
  return result.rows;
}

/**
 * Locks the event's equipment request inside a transaction and returns it with whether its current version has been
 * reviewed, so a review is decided against a request nobody else is changing.
 */
async function lockRequest(db, eventId) {
  const result = await db.query(`
    SELECT ${EQUIPMENT_COLUMNS},
      EXISTS (SELECT 1 FROM event_equipment_reviews r WHERE r.event_id = e.id AND r.request_version = e.equipment_requirements_version) AS reviewed
    FROM events e WHERE e.id = $1 FOR UPDATE OF e`, [eventId]);
  return result.rows[0] || null;
}

module.exports = { findCoordinatedRequest, listReviews, lockRequest };
