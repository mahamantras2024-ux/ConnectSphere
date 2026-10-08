// File: Stores organiser event requests and reads event lists/details with owner or coordinator scoping.
const pool = require('../config/db');
const { EVENT_FIELDS } = require('../services/eventFields');

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

// Reads event details/contact for the owner, assigned coordinator, or lead reviewing an active submitted event.
async function findAccessibleById(id, user) {
  const ownerColumn = user.role === 'event_organiser' ? 'organiser_id'
    : user.role === 'event_coordinator' ? 'coordinator_id' : null;
  const lead = user.role === 'event_coordinator_lead';
  if (!ownerColumn && !lead) return null;
  // The column is selected from the fixed allowlist above, never request input.
  const result = await pool.query(`
    SELECT e.id, e.organiser_id, e.coordinator_id, e.name, e.purpose, e.attachments,
      e.description, e.event_type, e.proposed_date::text AS proposed_date,
      e.proposed_start_time, e.proposed_end_time, e.expected_attendance,
      e.programme_details, e.room_layout_preference, e.accessibility_requirements,
      e.equipment_notes, e.registration_required, e.registration_capacity,
      e.special_arrangements, e.is_draft, e.status, e.created_at, e.updated_at,
      e.equipment_items, e.technical_support_required, e.technical_support_details,
      e.video_conferencing_required, e.technical_specifications,
      e.equipment_confirmed_at IS NOT NULL AS equipment_confirmed,
      EXISTS (SELECT 1 FROM venue_bookings vb WHERE vb.event_id=e.id AND vb.status='approved') AS venue_confirmed,
      EXISTS (SELECT 1 FROM event_clarification_requests cr WHERE cr.event_id=e.id AND cr.status='pending') AS clarification_outstanding,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', cr.id, 'coordinator_id', cr.coordinator_id, 'organiser_id', cr.organiser_id,
        'information_needed', cr.information_needed, 'message', cr.message, 'status', cr.status,
        'organiser_response', cr.organiser_response, 'created_at', cr.created_at, 'responded_at', cr.responded_at
      ) ORDER BY cr.created_at DESC, cr.id DESC)
        FROM event_clarification_requests cr WHERE cr.event_id=e.id), '[]'::jsonb) AS clarification_requests,
      organiser.full_name AS organiser_name, organiser.email AS organiser_email, coordinator.full_name AS coordinator_name
    FROM events e
    JOIN users organiser ON organiser.id = e.organiser_id
    LEFT JOIN users coordinator ON coordinator.id = e.coordinator_id
    WHERE e.id = $1 AND ${lead ? "e.is_draft=false AND e.status NOT IN ('draft','cancelled','completed')" : `e.${ownerColumn} = $2`}`, lead ? [id] : [id, user.id]);
  return result.rows[0] || null;
}

// Inserts an organiser-owned event with validated request fields and draft/submitted status.
async function create(data) {
  const result = await pool.query(`
    INSERT INTO events (organiser_id, name, purpose, description, event_type,
      proposed_date, proposed_start_time, proposed_end_time, expected_attendance,
      programme_details, room_layout_preference, accessibility_requirements,
      equipment_notes, registration_required, registration_capacity,
      special_arrangements, is_draft, status, equipment_items, technical_support_required,
      technical_support_details, video_conferencing_required, technical_specifications, attachments)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18,$19::jsonb,$20,$21,$22,$23,$24::jsonb)
    RETURNING *`, [data.organiserId, data.name, data.purpose, data.description,
      data.eventType, data.proposedDate, data.proposedStartTime, data.proposedEndTime,
      data.expectedAttendance, data.programmeDetails, data.roomLayoutPreference,
      JSON.stringify(data.accessibilityRequirements), data.equipmentNotes,
      data.registrationRequired, data.registrationCapacity, data.specialArrangements,
      data.isDraft, data.isDraft ? 'draft' : 'submitted', JSON.stringify(data.equipmentItems),
      data.technicalSupportRequired, data.technicalSupportDetails, data.videoConferencingRequired,
      data.technicalSpecifications, JSON.stringify(data.attachments || {})]);
  return result.rows[0];
}

// Builds "column=$n" assignments from the shared allow-list; field names never come from SQL text supplied by clients.
function assignmentsFor(data, firstIndex = 1) {
  const fields = Object.keys(data);
  const values = fields.map((field) => EVENT_FIELDS[field].json ? JSON.stringify(data[field]) : data[field]);
  const assignments = fields.map((field, index) =>
    `${EVENT_FIELDS[field].column}=$${index + firstIndex}${EVENT_FIELDS[field].json ? '::jsonb' : ''}`);
  return { values, assignments };
}

// Updates a fixed set of event fields; critical changes are blocked once a venue is approved.
async function updateEditable(id, organiserId, data, hasCriticalChanges) {
  const { values, assignments } = assignmentsFor(data);
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

// Persists a pending critical-change request for an organiser-owned event with an approved venue and, in the
// same statement, the assigned coordinator's notification, so a request can never exist without its notification.
// Returns the request plus `coordinator_email` (for the follow-up email only; never sent to the organiser).
async function createChangeRequest(id, organiserId, coordinatorId, changes, notification) {
  const result = await pool.query(`
    WITH cr AS (
      INSERT INTO event_change_requests (event_id, organiser_id, coordinator_id, requested_changes)
      SELECT e.id, e.organiser_id, e.coordinator_id, $4::jsonb
      FROM events e
      WHERE e.id=$1 AND e.organiser_id=$2 AND e.coordinator_id=$3
        AND EXISTS (SELECT 1 FROM venue_bookings vb WHERE vb.event_id=e.id AND vb.status='approved')
      RETURNING id, event_id, organiser_id, coordinator_id, requested_changes, status, submitted_at
    ), notified AS (
      INSERT INTO notifications (user_id, event_id, change_request_id, type, title, message, details)
      SELECT cr.coordinator_id, cr.event_id, cr.id, 'change_request_submitted', $5, $6, $7::jsonb FROM cr
    )
    SELECT cr.*, coordinator.email AS coordinator_email FROM cr JOIN users coordinator ON coordinator.id=cr.coordinator_id`,
  [id, organiserId, coordinatorId, JSON.stringify(changes), notification.title, notification.message,
    JSON.stringify(notification.details)]);
  return result.rows[0] || null;
}

// Applies approved changes to an event inside the caller's transaction and returns the updated row as JSON
// (dates/times as plain text) so it can be compared and displayed consistently.
async function applyChanges(db, eventId, changes) {
  const { values, assignments } = assignmentsFor(changes, 2);
  const result = await db.query(`UPDATE events SET ${assignments.join(', ')}, updated_at=now()
    WHERE id=$1 RETURNING to_jsonb(events.*) AS event`, [eventId, ...values]);
  return result.rows[0].event;
}

// Reads the event's active and pending venue bookings with each venue's capacity, layouts and buffers.
// When `withPeriods` is true, every recorded booking/closure at those venues is attached for conflict checks.
async function loadArrangements(db, eventId, withPeriods) {
  const bookings = (await db.query(`
    SELECT vb.id, vb.venue_id, vb.status, vb.start_datetime, vb.end_datetime, vb.hold_expires_at, vb.decision_by,
      v.name AS venue_name, v.capacity, v.supported_layouts, v.setup_minutes, v.turnaround_minutes
    FROM venue_bookings vb JOIN venues v ON v.id=vb.venue_id
    WHERE vb.event_id=$1 AND vb.status IN ('pending', 'approved')
    ORDER BY vb.id`, [eventId])).rows;
  if (!withPeriods || !bookings.length) return bookings;
  const periods = (await db.query(`
    SELECT id, venue_id, 'booking' AS kind, status, start_datetime, end_datetime, hold_expires_at
    FROM venue_bookings WHERE venue_id = ANY($1::int[])
    UNION ALL
    SELECT id, venue_id, 'unavailability' AS kind, 'unavailable' AS status, start_datetime, end_datetime, NULL::timestamptz
    FROM venue_unavailability WHERE venue_id = ANY($1::int[])`, [[...new Set(bookings.map((booking) => booking.venue_id))]])).rows;
  return bookings.map((booking) => ({ ...booking, periods: periods.filter((period) => period.venue_id === booking.venue_id) }));
}

// Lists ids of every account holding the given role, as primary role or as an extra provisioned role.
async function userIdsWithRole(db, role) {
  const result = await db.query(`SELECT id FROM users
    WHERE role=$1 OR COALESCE(to_jsonb(users)->'roles', '[]'::jsonb) ? $1 ORDER BY id`, [role]);
  return result.rows.map((row) => row.id);
}

// Replaces an owned event's equipment requirements only while Technical Support has not confirmed them.
// The confirmation check lives in the UPDATE so a confirmation committed mid-edit cannot be overwritten.
async function updateEquipment(id, organiserId, data) {
  const result = await pool.query(`
    UPDATE events SET equipment_items=$3::jsonb, technical_support_required=$4, technical_support_details=$5,
      video_conferencing_required=$6, technical_specifications=$7, updated_at=now()
    WHERE id=$1 AND organiser_id=$2 AND equipment_confirmed_at IS NULL
    RETURNING *`, [id, organiserId, JSON.stringify(data.equipmentItems), data.technicalSupportRequired,
    data.technicalSupportDetails, data.videoConferencingRequired, data.technicalSpecifications]);
  return result.rows[0] || null;
}

// Persists a pending equipment change request once arrangements are confirmed, leaving the event untouched, and stores
// the assigned coordinator's notification in the same statement (as createChangeRequest does for other critical fields).
// Returns the request plus `coordinator_email` (for the follow-up email only; never sent to the organiser).
async function createEquipmentChangeRequest(id, organiserId, coordinatorId, changes, notification) {
  const result = await pool.query(`
    WITH cr AS (
      INSERT INTO event_change_requests (event_id, organiser_id, coordinator_id, requested_changes)
      SELECT e.id, e.organiser_id, e.coordinator_id, $4::jsonb
      FROM events e
      WHERE e.id=$1 AND e.organiser_id=$2 AND e.coordinator_id=$3 AND e.equipment_confirmed_at IS NOT NULL
      RETURNING id, event_id, organiser_id, coordinator_id, requested_changes, status, submitted_at
    ), notified AS (
      INSERT INTO notifications (user_id, event_id, change_request_id, type, title, message, details)
      SELECT cr.coordinator_id, cr.event_id, cr.id, 'change_request_submitted', $5, $6, $7::jsonb FROM cr
    )
    SELECT cr.*, coordinator.email AS coordinator_email FROM cr JOIN users coordinator ON coordinator.id=cr.coordinator_id`,
  [id, organiserId, coordinatorId, JSON.stringify(changes), notification.title, notification.message,
    JSON.stringify(notification.details)]);
  return result.rows[0] || null;
}

// Lists pending critical changes for the event's current coordinator, including work inherited at handover.
async function listPendingChangeRequests(coordinatorId) {
  const result = await pool.query(`
    SELECT r.id, r.event_id, e.name AS event_name, r.organiser_id,
      organiser.full_name AS organiser_name, r.requested_changes, r.status, r.submitted_at,
      to_jsonb(e) AS event_record
    FROM event_change_requests r
    JOIN events e ON e.id=r.event_id
    JOIN users organiser ON organiser.id=r.organiser_id
    -- Keep historical request recipients intact while transferring the actionable inbox with responsibility.
    WHERE e.coordinator_id=$1 AND r.status='pending'
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
  updateEquipment,
  createEquipmentChangeRequest,
  createChangeRequest,
  applyChanges,
  loadArrangements,
  userIdsWithRole,
  listPendingChangeRequests,
  createClarificationRequest,
  respondToClarification,
  findAccessibleById,
  listForOrganiser,
  listForCoordinator
};
