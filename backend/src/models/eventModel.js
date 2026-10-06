// File: Stores organiser event requests and reads event lists/details with owner or coordinator scoping.
const pool = require('../config/db');

// Lists events owned by the supplied organiser, newest first.
async function listForOrganiser(organiserId) {
  const result = await pool.query(`
    SELECT e.id, e.name, e.purpose, e.status, e.organiser_id, e.coordinator_id, e.created_at, e.updated_at,
      EXISTS (SELECT 1 FROM event_clarification_requests cr WHERE cr.event_id=e.id AND cr.status='pending') AS clarification_outstanding
    FROM events e
    WHERE organiser_id = $1
    ORDER BY e.created_at DESC
  `, [organiserId]);

  return result.rows;
}

// Lists events assigned to the supplied coordinator, newest first.
async function listForCoordinator(coordinatorId) {
  const result = await pool.query(`
    SELECT e.id, e.name, e.purpose, e.status, e.organiser_id, e.coordinator_id, e.created_at, e.updated_at,
      EXISTS (SELECT 1 FROM event_clarification_requests cr WHERE cr.event_id=e.id AND cr.status='pending') AS clarification_outstanding
    FROM events e
    WHERE coordinator_id = $1
    ORDER BY e.created_at DESC
  `, [coordinatorId]);

  return result.rows;
}

// Reads event details and names only when the user owns or coordinates the requested event.
async function findAccessibleById(id, user) {
  const ownerColumn = user.role === 'event_organiser' ? 'organiser_id'
    : user.role === 'event_coordinator' ? 'coordinator_id' : null;
  if (!ownerColumn) return null;
  // The column is selected from the fixed allowlist above, never request input.
  const result = await pool.query(`
    SELECT e.id, e.organiser_id, e.coordinator_id, e.name, e.purpose,
      e.description, e.event_type, e.proposed_date::text AS proposed_date,
      e.proposed_start_time, e.proposed_end_time, e.expected_attendance,
      e.programme_details, e.room_layout_preference, e.accessibility_requirements,
      e.equipment_notes, e.registration_required, e.registration_capacity,
      e.special_arrangements, e.is_draft, e.status, e.created_at, e.updated_at,
      EXISTS (SELECT 1 FROM venue_bookings vb WHERE vb.event_id=e.id AND vb.status='approved') AS venue_confirmed,
      EXISTS (SELECT 1 FROM event_clarification_requests cr WHERE cr.event_id=e.id AND cr.status='pending') AS clarification_outstanding,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', cr.id, 'coordinator_id', cr.coordinator_id, 'organiser_id', cr.organiser_id,
        'information_needed', cr.information_needed, 'message', cr.message, 'status', cr.status,
        'organiser_response', cr.organiser_response, 'created_at', cr.created_at, 'responded_at', cr.responded_at
      ) ORDER BY cr.created_at DESC, cr.id DESC)
        FROM event_clarification_requests cr WHERE cr.event_id=e.id), '[]'::jsonb) AS clarification_requests,
      organiser.full_name AS organiser_name, coordinator.full_name AS coordinator_name
    FROM events e
    JOIN users organiser ON organiser.id = e.organiser_id
    LEFT JOIN users coordinator ON coordinator.id = e.coordinator_id
    WHERE e.id = $1 AND e.${ownerColumn} = $2`, [id, user.id]);
  return result.rows[0] || null;
}

// Inserts an organiser-owned event with validated request fields and draft/submitted status.
async function create(data) {
  const result = await pool.query(`
    INSERT INTO events (organiser_id, name, purpose, description, event_type,
      proposed_date, proposed_start_time, proposed_end_time, expected_attendance,
      programme_details, room_layout_preference, accessibility_requirements,
      equipment_notes, registration_required, registration_capacity,
      special_arrangements, is_draft, status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18)
    RETURNING *`, [data.organiserId, data.name, data.purpose, data.description,
      data.eventType, data.proposedDate, data.proposedStartTime, data.proposedEndTime,
      data.expectedAttendance, data.programmeDetails, data.roomLayoutPreference,
      JSON.stringify(data.accessibilityRequirements), data.equipmentNotes,
      data.registrationRequired, data.registrationCapacity, data.specialArrangements,
      data.isDraft, data.isDraft ? 'draft' : 'submitted']);
  return result.rows[0];
}

// Updates a fixed set of event fields; critical changes are blocked once a venue is approved.
async function updateEditable(id, organiserId, data, hasCriticalChanges) {
  const columns = {
    name: 'name', purpose: 'purpose', description: 'description', eventType: 'event_type',
    proposedDate: 'proposed_date', proposedStartTime: 'proposed_start_time', proposedEndTime: 'proposed_end_time',
    expectedAttendance: 'expected_attendance', programmeDetails: 'programme_details',
    roomLayoutPreference: 'room_layout_preference', accessibilityRequirements: 'accessibility_requirements',
    equipmentNotes: 'equipment_notes', registrationRequired: 'registration_required',
    registrationCapacity: 'registration_capacity', specialArrangements: 'special_arrangements'
  };
  const fields = Object.keys(data);
  const values = fields.map((field) => field === 'accessibilityRequirements' ? JSON.stringify(data[field]) : data[field]);
  const assignments = fields.map((field, index) => `${columns[field]}=$${index + 1}${field === 'accessibilityRequirements' ? '::jsonb' : ''}`);
  const idIndex = values.length + 1;
  const organiserIndex = values.length + 2;
  const criticalIndex = values.length + 3;
  const result = await pool.query(`
    UPDATE events SET ${assignments.join(', ')}, updated_at=now()
    WHERE id=$${idIndex} AND organiser_id=$${organiserIndex}
      AND (NOT $${criticalIndex} OR NOT EXISTS (
        SELECT 1 FROM venue_bookings vb WHERE vb.event_id=events.id AND vb.status='approved'
      ))
    RETURNING *`, [...values, id, organiserId, hasCriticalChanges]);
  return result.rows[0] || null;
}

// Persists a pending critical-change request for an organiser-owned event with an approved venue.
async function createChangeRequest(id, organiserId, coordinatorId, changes) {
  const result = await pool.query(`
    INSERT INTO event_change_requests (event_id, organiser_id, coordinator_id, requested_changes)
    SELECT e.id, e.organiser_id, e.coordinator_id, $4::jsonb
    FROM events e
    WHERE e.id=$1 AND e.organiser_id=$2 AND e.coordinator_id=$3
      AND EXISTS (SELECT 1 FROM venue_bookings vb WHERE vb.event_id=e.id AND vb.status='approved')
    RETURNING id, event_id, organiser_id, coordinator_id, requested_changes, status, submitted_at`,
  [id, organiserId, coordinatorId, JSON.stringify(changes)]);
  return result.rows[0] || null;
}

// Lists pending critical-change notifications only for their assigned coordinator.
async function listPendingChangeRequests(coordinatorId) {
  const result = await pool.query(`
    SELECT r.id, r.event_id, e.name AS event_name, r.organiser_id,
      organiser.full_name AS organiser_name, r.requested_changes, r.status, r.submitted_at
    FROM event_change_requests r
    JOIN events e ON e.id=r.event_id
    JOIN users organiser ON organiser.id=r.organiser_id
    WHERE r.coordinator_id=$1 AND r.status='pending'
    ORDER BY r.submitted_at DESC, r.id DESC`, [coordinatorId]);
  return result.rows;
}

// Saves a coordinator's clarification request only for an event assigned to them.
async function createClarificationRequest(id, coordinatorId, informationNeeded, message) {
  const result = await pool.query(`
    INSERT INTO event_clarification_requests (event_id, coordinator_id, organiser_id, information_needed, message)
    SELECT e.id, e.coordinator_id, e.organiser_id, $3::jsonb, $4
    FROM events e WHERE e.id=$1 AND e.coordinator_id=$2
    RETURNING id, event_id, coordinator_id, organiser_id, information_needed, message, status, organiser_response, created_at, responded_at`,
  [id, coordinatorId, JSON.stringify(informationNeeded), message]);
  return result.rows[0] || null;
}

// Records an organiser's response or amendment and resolves that outstanding request.
async function respondToClarification(eventId, clarificationId, organiserId, response) {
  const result = await pool.query(`
    UPDATE event_clarification_requests SET status='responded', organiser_response=$4, responded_at=now()
    WHERE event_id=$1 AND id=$2 AND organiser_id=$3 AND status='pending'
    RETURNING id, event_id, coordinator_id, organiser_id, information_needed, message, status, organiser_response, created_at, responded_at`,
  [eventId, clarificationId, organiserId, response]);
  return result.rows[0] || null;
}

module.exports = {
  create,
  updateEditable,
  createChangeRequest,
  listPendingChangeRequests,
  createClarificationRequest,
  respondToClarification,
  findAccessibleById,
  listForOrganiser,
  listForCoordinator
};
