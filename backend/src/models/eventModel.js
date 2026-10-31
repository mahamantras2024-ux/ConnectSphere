// File: Stores organiser event requests and reads event lists/details with owner or coordinator scoping.
const pool = require('../config/db');
const { pool: databasePool } = require('../config/db');
const { EVENT_FIELDS } = require('../services/eventFields');
const { responsibilityScope } = require('../services/technicalEventStatus');
const { ORGANISATION_STATUS_SCOPE } = require('./organiserRequestStatusModel');

// Lists own and same-organisation request statuses; can_manage preserves submitter-only mutation controls.
async function listForOrganiser(organiserId) {
  const result = await pool.query(`
    SELECT e.id, e.name, e.purpose, e.status, e.organiser_id, e.coordinator_id, e.created_at, e.updated_at,
      (e.organiser_id=$1) AS can_manage,
      EXISTS (SELECT 1 FROM event_clarification_requests cr WHERE cr.event_id=e.id AND cr.status='pending') AS clarification_outstanding
    FROM events e
    WHERE organiser_id = $1 OR ${ORGANISATION_STATUS_SCOPE}
    ORDER BY e.created_at DESC
  `, [organiserId]);

  return result.rows;
}

// Lists events assigned to the supplied coordinator, newest first.
async function listForCoordinator(coordinatorId) {
  const result = await pool.query(`
    SELECT e.id, e.name, e.purpose, e.status, e.organiser_id, e.coordinator_id, e.created_at, e.updated_at,
      EXISTS (SELECT 1 FROM event_clarification_requests cr WHERE cr.event_id=e.id AND cr.status='pending') AS clarification_outstanding,
      e.technical_support_required,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', u.id, 'full_name', u.full_name) ORDER BY u.full_name)
        FROM event_technical_support_assignments a JOIN users u ON u.id=a.staff_id
        WHERE a.event_id=e.id), '[]'::jsonb) AS technical_support_staff
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
      e.registration_deadline,e.withdrawal_deadline,e.registration_open,
      e.special_arrangements, e.is_draft, e.status, e.created_at, e.updated_at,
      e.safety_recheck_required_at,
      e.equipment_items, e.technical_support_required, e.technical_support_details,
      e.video_conferencing_required, e.technical_specifications,
      e.equipment_confirmed_at IS NOT NULL AS equipment_confirmed,
      (EXISTS (SELECT 1 FROM venue_bookings vb WHERE vb.event_id=e.id AND vb.status='approved')
        AND NOT EXISTS (SELECT 1 FROM venue_booking_disruptions d JOIN venue_bookings vb ON vb.id=d.booking_id WHERE vb.event_id=e.id AND d.resolved_at IS NULL)) AS venue_confirmed,
      EXISTS (SELECT 1 FROM event_clarification_requests cr WHERE cr.event_id=e.id AND cr.status='pending') AS clarification_outstanding,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', cr.id, 'coordinator_id', cr.coordinator_id, 'organiser_id', cr.organiser_id,
        'information_needed', cr.information_needed, 'message', cr.message, 'status', cr.status,
        'organiser_response', cr.organiser_response, 'created_at', cr.created_at, 'responded_at', cr.responded_at,
        'source', cr.source, 'outcome', cr.outcome, 'coordinator_comments', cr.coordinator_comments,
        'resolved_at', cr.resolved_at, 'resolved_by_name', resolver.full_name,
        'resolution_outcome', cr.resolution_outcome, 'resolution_comments', cr.resolution_comments
      ) ORDER BY cr.created_at DESC, cr.id DESC)
        FROM event_clarification_requests cr LEFT JOIN users resolver ON resolver.id = cr.resolved_by
        WHERE cr.event_id=e.id), '[]'::jsonb) AS clarification_requests,
      organiser.full_name AS organiser_name, organiser.email AS organiser_email, coordinator.full_name AS coordinator_name
    FROM events e
    JOIN users organiser ON organiser.id = e.organiser_id
    LEFT JOIN users coordinator ON coordinator.id = e.coordinator_id
    WHERE e.id = $1 AND ${lead ? "e.is_draft=false AND e.status NOT IN ('draft','cancelled','completed')" : `e.${ownerColumn} = $2`}`, lead ? [id] : [id, user.id]);
  return result.rows[0] || null;
}

// Inserts an organiser-owned event with validated request fields and draft/submitted status.
// `db` may be a transaction client so a submitted request and its Coordinator Lead notification commit together.
async function create(data, db = pool) {
  const result = await db.query(`
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

// Updates an organiser's own draft. A submitted request is never edited directly (amendment story AC1), and the
// draft condition is repeated here so an edit racing the submission cannot change the submitted record.
async function updateEditable(id, organiserId, data) {
  const { values, assignments } = assignmentsFor(data);
  const result = await pool.query(`
    UPDATE events SET ${assignments.join(', ')}, updated_at=now()
    WHERE id=$${values.length + 1} AND organiser_id=$${values.length + 2} AND is_draft=true AND status='draft'
    RETURNING *`, [...values, id, organiserId]);
  return result.rows[0] || null;
}

// Event statuses that no longer take amendments: the request is finished or withdrawn.
const AMENDMENT_CLOSED_STATUSES = ['cancelled', 'completed', 'rejected'];

/**
 * Stores a pending amendment request with the organiser's explanation and, in the same statement, the assigned
 * coordinator's notification, so a request can never exist without its notification (AC2, AC4). The event row itself is
 * not touched: its accepted information stays in effect until the coordinator approves (AC3).
 * The guard repeats the controller's rules (owner, current coordinator, submitted and still open) so a submission racing
 * a reassignment, cancellation or decision stores nothing.
 * @returns {Promise<object|null>} the request plus `coordinator_email` (delivery only; never sent to the organiser).
 */
async function createAmendmentRequest(id, organiserId, coordinatorId, changes, explanation, notification) {
  const result = await pool.query(`
    WITH cr AS (
      INSERT INTO event_change_requests (event_id, organiser_id, coordinator_id, requested_changes, explanation)
      SELECT e.id, e.organiser_id, e.coordinator_id, $4::jsonb, $5
      FROM events e
      WHERE e.id=$1 AND e.organiser_id=$2 AND e.coordinator_id=$3
        AND e.is_draft=false AND e.status <> ALL($9::text[])
      RETURNING id, event_id, organiser_id, coordinator_id, requested_changes, explanation, status, submitted_at
    ), notified AS (
      INSERT INTO notifications (user_id, event_id, change_request_id, type, title, message, details)
      SELECT cr.coordinator_id, cr.event_id, cr.id, 'change_request_submitted', $6, $7, $8::jsonb FROM cr
    )
    SELECT cr.*, coordinator.email AS coordinator_email FROM cr JOIN users coordinator ON coordinator.id=cr.coordinator_id`,
  [id, organiserId, coordinatorId, JSON.stringify(changes), explanation, notification.title, notification.message,
    JSON.stringify(notification.details), [...AMENDMENT_CLOSED_STATUSES, 'draft']]);
  return result.rows[0] || null;
}

/**
 * An event's amendment history, newest first: organiser requests and amendments the coordinator applied, with the
 * decision, who made it, what an applied amendment changed and the checks it reopened. Callers check access first.
 * @returns {Promise<Array<object>>} rows with requested/applied changes, explanation, status, source and review details.
 */
async function listAmendmentRequests(eventId) {
  const result = await pool.query(`
    SELECT r.id, r.requested_changes, r.applied_changes, r.explanation, r.status, r.source, r.clarification_id, r.rechecks,
      r.submitted_at, r.reviewed_at, r.decision_reason, reviewer.full_name AS reviewed_by_name
    FROM event_change_requests r
    LEFT JOIN users reviewer ON reviewer.id = r.reviewed_by
    WHERE r.event_id=$1
    ORDER BY r.submitted_at DESC, r.id DESC`, [eventId]);
  return result.rows;
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
    WHERE vb.event_id=$1 AND vb.status IN ('pending', 'tentative', 'approved')
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
    WHERE vb.event_id=$1 AND vb.status IN ('pending', 'tentative', 'approved')
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

// Replaces an owned draft's equipment requirements and advances its reviewable version. After submission equipment
// changes are amendment requests (amendment story AC1); the draft check lives in the UPDATE so a submission committed
// mid-edit cannot be overwritten.
async function updateEquipment(id, organiserId, data) {
  const result = await pool.query(`
    UPDATE events SET equipment_items=$3::jsonb, technical_support_required=$4, technical_support_details=$5,
      video_conferencing_required=$6, technical_specifications=$7,
      equipment_requirements_version=equipment_requirements_version+1, updated_at=now()
    WHERE id=$1 AND organiser_id=$2 AND is_draft=true AND status='draft'
    RETURNING *`, [id, organiserId, JSON.stringify(data.equipmentItems), data.technicalSupportRequired,
    data.technicalSupportDetails, data.videoConferencingRequired, data.technicalSpecifications]);
  return result.rows[0] || null;
}

/**
 * Lists upcoming active equipment requests that have not been reviewed at their current version.
 * @returns {Promise<Array<object>>} event, venue, and organiser-submitted technical requirements.
 */
async function listPendingEquipmentRequests() {
  const result = await pool.query(`
    SELECT e.id, e.name, e.proposed_date::text AS proposed_date, e.proposed_start_time,
      e.proposed_end_time, e.equipment_items, e.equipment_notes, e.technical_support_required,
      e.technical_support_details, e.video_conferencing_required, e.technical_specifications,
      e.equipment_requirements_version AS request_version,
      venue.name AS venue_name, venue.location AS venue_location
    FROM events e
    LEFT JOIN LATERAL (
      SELECT v.name, v.location
      FROM venue_bookings vb
      JOIN venues v ON v.id=vb.venue_id
      WHERE vb.event_id=e.id AND vb.status IN ('approved', 'pending')
      ORDER BY CASE WHEN vb.status='approved' THEN 0 ELSE 1 END, vb.start_datetime DESC, vb.id DESC
      LIMIT 1
    ) venue ON true
    WHERE e.is_draft=false AND e.proposed_date >= CURRENT_DATE
      AND (e.proposed_date > CURRENT_DATE OR e.proposed_end_time > LOCALTIME)
      AND e.status NOT IN ('draft', 'cancelled', 'completed', 'rejected')
      AND (
        jsonb_array_length(e.equipment_items) > 0
        OR COALESCE(length(trim(e.equipment_notes)), 0) > 0
        OR e.technical_support_required
        OR e.video_conferencing_required
        OR COALESCE(length(trim(e.technical_specifications)), 0) > 0
      )
      AND NOT EXISTS (
        SELECT 1 FROM event_equipment_reviews r
        WHERE r.event_id=e.id AND r.request_version=e.equipment_requirements_version
      )
    ORDER BY e.proposed_date, e.proposed_start_time, e.id
  `);
  return result.rows;
}

/**
 * Adds a review only when the submitted request version is still current and pending.
 * A fully fulfillable decision confirms equipment so later organiser edits become change requests.
 * @param {number} eventId submitted event identifier.
 * @param {object} data decision, optional reason, and the version shown to the reviewer.
 * @param {number} reviewerId authenticated Technical Support user identifier.
 * @returns {Promise<object|null>} saved audit entry, or null when the request is no longer eligible.
 */
async function createEquipmentReview(eventId, data, reviewerId) {
  const result = await pool.query(`
    WITH target AS (
      SELECT e.id, e.equipment_requirements_version
      FROM events e
      WHERE e.id=$1 AND e.equipment_requirements_version=$5
        AND e.is_draft=false AND e.proposed_date >= CURRENT_DATE
        AND (e.proposed_date > CURRENT_DATE OR e.proposed_end_time > LOCALTIME)
        AND e.status NOT IN ('draft', 'cancelled', 'completed', 'rejected')
        AND (
          jsonb_array_length(e.equipment_items) > 0
          OR COALESCE(length(trim(e.equipment_notes)), 0) > 0
          OR e.technical_support_required
          OR e.video_conferencing_required
          OR COALESCE(length(trim(e.technical_specifications)), 0) > 0
        )
        AND NOT EXISTS (
          SELECT 1 FROM event_equipment_reviews existing
          WHERE existing.event_id=e.id AND existing.request_version=e.equipment_requirements_version
        )
      FOR UPDATE
    ), saved_review AS (
      INSERT INTO event_equipment_reviews (event_id, request_version, outcome, reason, reviewed_by)
      SELECT id, equipment_requirements_version, $2, $3, $4 FROM target
      ON CONFLICT (event_id, request_version) DO NOTHING
      RETURNING id, event_id, request_version, outcome, reason, reviewed_by, reviewed_at
    ), confirmed AS (
      UPDATE events e SET equipment_confirmed_at=now()
      FROM saved_review r
      WHERE e.id=r.event_id AND r.outcome='fully_fulfillable'
      RETURNING e.id
    )
    SELECT r.id, r.event_id, r.request_version, r.outcome, r.reason, r.reviewed_by, r.reviewed_at
    FROM saved_review r
    LEFT JOIN confirmed c ON c.id=r.event_id
  `, [eventId, data.outcome, data.reason, reviewerId, data.requestVersion]);
  return result.rows[0] || null;
}

/** Lists seeded stock counts and availability windows with remaining units per slot. */
/** Returns inventory with scheduled windows and reserved windows on otherwise unscheduled dates. */
async function listEquipmentInventory() {
  const result = await pool.query(`
    SELECT stock.id, stock.asset_code, stock.name, stock.specification, stock.status,
      stock.availability_status, stock.quantity,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', history.id,
          'status', history.status,
          'note', history.note,
          'changed_at', history.changed_at,
          'changed_by_name', staff.full_name
        ) ORDER BY history.changed_at, history.id)
        FROM equipment_status_history history
        LEFT JOIN users staff ON staff.id=history.changed_by
        WHERE history.inventory_id=stock.id
      ), '[]'::jsonb) AS status_history,
      COALESCE(jsonb_agg(jsonb_build_object(
        'date', availability.available_date::text,
        'startTime', availability.start_time::text,
        'endTime', availability.end_time::text,
        'status', CASE WHEN COALESCE(reserved.quantity, 0) < stock.quantity THEN 'Available' ELSE 'Reserved' END,
        'availableQuantity', GREATEST(stock.quantity - COALESCE(reserved.quantity, 0), 0),
        'eventName', reserved.event_names
      ) ORDER BY availability.available_date, availability.start_time)
        FILTER (WHERE availability.id IS NOT NULL), '[]'::jsonb) AS availabilities
    FROM equipments stock
    LEFT JOIN LATERAL (
      SELECT schedule.id, schedule.available_date, schedule.start_time, schedule.end_time
      FROM technical_equipment_availability schedule
      WHERE schedule.inventory_id=stock.id
      UNION ALL
      SELECT -row_number() OVER (
        ORDER BY reservation_slot.available_date, reservation_slot.start_time, reservation_slot.end_time
      ) AS id,
        reservation_slot.available_date, reservation_slot.start_time, reservation_slot.end_time
      FROM (
        SELECT DISTINCT reservation.event_date AS available_date,
          reservation.start_time, reservation.end_time
        FROM event_equipment_reservations reservation
        JOIN event_equipment_reservation_items reserved_item
          ON reserved_item.reservation_id=reservation.id
        WHERE reserved_item.inventory_id=stock.id AND reservation.status='reserved'
      ) reservation_slot
      WHERE NOT EXISTS (
        SELECT 1
        FROM technical_equipment_availability scheduled_date
        WHERE scheduled_date.inventory_id=stock.id
          AND scheduled_date.available_date=reservation_slot.available_date
      )
    ) availability ON TRUE
    LEFT JOIN LATERAL (
      SELECT sum(reserved_item.quantity)::integer AS quantity,
        string_agg(DISTINCT event.name, ', ' ORDER BY event.name) AS event_names
      FROM event_equipment_reservations reservation
      JOIN event_equipment_reservation_items reserved_item ON reserved_item.reservation_id=reservation.id
      JOIN events event ON event.id=reservation.event_id
      WHERE reserved_item.inventory_id=stock.id AND reservation.status='reserved'
        AND reservation.event_date=availability.available_date
        AND reservation.start_time < availability.end_time
        AND reservation.end_time > availability.start_time
    ) reserved ON availability.id IS NOT NULL
    GROUP BY stock.id
    ORDER BY stock.asset_code
  `);
  return result.rows;
}

/**
 * Lists reviewed requests with equipment that still needs reservation, including the event's full technical requirements.
 */
async function listEquipmentReservationCandidates() {
  const result = await pool.query(`
    SELECT e.id, e.name, e.proposed_date::text AS proposed_date,
      e.proposed_start_time, e.proposed_end_time, e.equipment_items, e.equipment_notes,
      e.technical_support_required, e.technical_support_details,
      e.video_conferencing_required, e.technical_specifications,
      e.equipment_requirements_version AS request_version,
      review.outcome AS review_outcome, review.reason AS review_reason,
      venue.name AS venue_name, venue.location AS venue_location
    FROM events e
    JOIN event_equipment_reviews review
      ON review.event_id=e.id AND review.request_version=e.equipment_requirements_version
    LEFT JOIN LATERAL (
      SELECT v.name, v.location
      FROM venue_bookings vb JOIN venues v ON v.id=vb.venue_id
      WHERE vb.event_id=e.id AND vb.status IN ('approved', 'pending')
      ORDER BY CASE WHEN vb.status='approved' THEN 0 ELSE 1 END, vb.start_datetime DESC, vb.id DESC
      LIMIT 1
    ) venue ON true
    WHERE e.is_draft=false AND e.proposed_date >= CURRENT_DATE
      AND (e.proposed_date > CURRENT_DATE OR e.proposed_end_time > LOCALTIME)
      AND e.status NOT IN ('draft', 'cancelled', 'completed', 'rejected')
      AND review.outcome IN ('fully_fulfillable', 'partially_fulfillable')
      AND NOT EXISTS (
        SELECT 1 FROM event_equipment_reservations reservation
        WHERE reservation.event_id=e.id
          AND reservation.request_version=e.equipment_requirements_version
          AND reservation.status='reserved'
      )
    ORDER BY e.proposed_date, e.proposed_start_time, e.id
  `);
  return result.rows;
}

/**
 * Lists upcoming reservations with their item quantities and audit details.
 */
async function listActiveEquipmentReservations(staffId) {
  const result = await pool.query(`
    SELECT reservation.id, reservation.event_id, e.name AS event_name,
      reservation.event_date::text AS event_date, reservation.start_time,
      reservation.end_time, reservation.venue_name, reservation.venue_location,
      reservation.reserved_at, staff.full_name AS reserved_by_name,
      COALESCE(jsonb_agg(jsonb_build_object(
        'assetCode', inventory.asset_code, 'name', inventory.name,
        'specification', inventory.specification, 'quantity', reserved_item.quantity
      ) ORDER BY inventory.asset_code) FILTER (WHERE inventory.id IS NOT NULL), '[]'::jsonb) AS items
    FROM event_equipment_reservations reservation
    JOIN events e ON e.id=reservation.event_id
    JOIN users staff ON staff.id=reservation.reserved_by
    LEFT JOIN event_equipment_reservation_items reserved_item ON reserved_item.reservation_id=reservation.id
    LEFT JOIN equipments inventory ON inventory.id=reserved_item.inventory_id
    WHERE reservation.reserved_by=$1 AND reservation.status='reserved' AND (
      reservation.event_date > CURRENT_DATE
      OR (reservation.event_date=CURRENT_DATE AND reservation.end_time > LOCALTIME)
    )
    GROUP BY reservation.id, e.name, staff.full_name
    ORDER BY reservation.event_date, reservation.start_time, reservation.id
  `, [staffId]);
  return result.rows;
}

/**
 * Releases an active reservation only after its event is cancelled or rescheduled, recording actor/time atomically.
 * The conditional update makes repeated or ineligible requests harmless and preserves the first release audit.
 * @param {number} reservationId active reservation to release.
 * @param {number} staffId authenticated Technical Support staff member.
 * @returns {Promise<object|null>} released reservation and audit details, or null if it is no longer active.
 */
async function releaseEquipmentReservation(reservationId, staffId) {
  const client = await databasePool.connect();
  try {
    await client.query('BEGIN');
    const reservation = (await client.query(`
      WITH released AS (
        UPDATE event_equipment_reservations AS allocation
        SET status='cancelled', released_by=$2, released_at=now()
        FROM events event_record
        WHERE allocation.id=$1 AND allocation.status='reserved'
          -- Release permission follows the same current responsibility scope as the event-status view.
          AND ${responsibilityScope('event_record', '$2')}
          AND event_record.id=allocation.event_id
          AND (
            event_record.status='cancelled'
            OR (event_record.proposed_date IS NOT NULL AND (
              event_record.proposed_date IS DISTINCT FROM allocation.event_date
              OR event_record.proposed_start_time IS DISTINCT FROM allocation.start_time
              OR event_record.proposed_end_time IS DISTINCT FROM allocation.end_time
            ))
          )
        RETURNING allocation.id, allocation.event_id, allocation.request_version,
          allocation.event_date::text AS event_date, allocation.start_time,
          allocation.end_time, allocation.venue_name, allocation.venue_location,
          allocation.status, allocation.reserved_by, allocation.reserved_at,
          allocation.released_by, allocation.released_at
      )
      SELECT released.*, e.name AS event_name, releaser.full_name AS released_by_name
      FROM released
      JOIN events e ON e.id=released.event_id
      JOIN users releaser ON releaser.id=released.released_by
    `, [reservationId, staffId])).rows[0];
    if (!reservation) {
      await client.query('ROLLBACK');
      return null;
    }
    await client.query('COMMIT');
    return reservation;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Finds matching operational assets for itemized requests and optional staff-entered equipment.
 * @param {number} eventId event with a current equipment review.
 * @param {Array<{item:string,quantity:number}>} additionalItems equipment extracted from other request text.
 * @returns {Promise<object|null>} requested names, quantities and matching available assets.
 */
async function getEquipmentReservationAvailability(eventId, additionalItems = []) {
  const event = (await pool.query(`
    SELECT e.id, e.name, e.proposed_date::text AS proposed_date,
      e.proposed_start_time::text AS proposed_start_time,
      e.proposed_end_time::text AS proposed_end_time, e.equipment_items,
      e.equipment_requirements_version AS request_version,
      review.outcome AS review_outcome, review.reason AS review_reason,
      venue.name AS venue_name, venue.location AS venue_location,
      EXISTS (
        SELECT 1 FROM event_equipment_reservations reservation
        WHERE reservation.event_id=e.id
          AND reservation.request_version=e.equipment_requirements_version
          AND reservation.status='reserved'
      ) AS already_reserved
    FROM events e
    JOIN event_equipment_reviews review
      ON review.event_id=e.id AND review.request_version=e.equipment_requirements_version
    LEFT JOIN LATERAL (
      SELECT v.name, v.location
      FROM venue_bookings vb JOIN venues v ON v.id=vb.venue_id
      WHERE vb.event_id=e.id AND vb.status IN ('approved', 'pending')
      ORDER BY CASE WHEN vb.status='approved' THEN 0 ELSE 1 END, vb.start_datetime DESC, vb.id DESC
      LIMIT 1
    ) venue ON true
    WHERE e.id=$1 AND e.is_draft=false AND e.proposed_date >= CURRENT_DATE
      AND (e.proposed_date > CURRENT_DATE OR e.proposed_end_time > LOCALTIME)
      AND e.status NOT IN ('draft', 'cancelled', 'completed', 'rejected')
      AND review.outcome IN ('fully_fulfillable', 'partially_fulfillable')
  `, [eventId])).rows[0];
  if (!event) return null;
  if (event.already_reserved) return { event, alreadyReserved: true, items: [] };

  const requestedItems = Array.isArray(event.equipment_items) ? event.equipment_items : [];
  const requestsByAlias = new Map();
  for (const entry of [...requestedItems, ...additionalItems]) {
    const key = String(entry.item).trim().toLowerCase();
    const existing = requestsByAlias.get(key);
    requestsByAlias.set(key, {
      item: existing?.item || entry.item,
      quantity: (existing?.quantity || 0) + entry.quantity,
    });
  }
  const aliasRequests = [...requestsByAlias.values()];
  const aliasNames = aliasRequests.map(entry => String(entry.item).trim());
  const resolvedAliases = aliasNames.length ? (await pool.query(`
    SELECT requested.item AS requested_item,
      COALESCE(match.name, requested.item) AS canonical_item
    FROM unnest($1::text[]) AS requested(item)
    LEFT JOIN LATERAL (
      SELECT stock.name
      FROM equipments stock
      WHERE lower(trim(stock.name))=lower(trim(requested.item))
        OR lower(trim(stock.asset_code))=lower(trim(requested.item))
      ORDER BY CASE WHEN lower(trim(stock.name))=lower(trim(requested.item)) THEN 0 ELSE 1 END,
        stock.asset_code
      LIMIT 1
    ) match ON true
  `, [aliasNames])).rows : [];
  const canonicalByAlias = new Map(resolvedAliases.map(row => [
    String(row.requested_item).trim().toLowerCase(),
    row.canonical_item,
  ]));
  const requestsByType = new Map();
  for (const entry of aliasRequests) {
    const canonicalItem = canonicalByAlias.get(String(entry.item).trim().toLowerCase()) || entry.item;
    const key = String(canonicalItem).trim().toLowerCase();
    const existing = requestsByType.get(key);
    // A type name and an asset code can describe the same requested units; don't count that alias twice.
    requestsByType.set(key, {
      item: existing?.item || canonicalItem,
      quantity: Math.max(existing?.quantity || 0, entry.quantity),
      requestAliases: [...new Set([...(existing?.requestAliases || []), entry.item])],
    });
  }
  const distinctRequestedItems = [...requestsByType.values()];
  const names = [...requestsByType.keys()];
  const inventory = names.length ? (await pool.query(`
    SELECT stock.id, stock.asset_code, stock.name, stock.specification, stock.status,
      stock.availability_status, stock.quantity,
      CASE WHEN availability.available_date IS NULL THEN 0
        ELSE GREATEST(stock.quantity - COALESCE(booked.quantity, 0), 0)
      END::integer AS available_quantity,
      availability.available_date::text AS available_date,
      availability.start_time::text AS available_start_time,
      availability.end_time::text AS available_end_time
    FROM equipments stock
    LEFT JOIN LATERAL (
LEFT JOIN LATERAL (
  SELECT schedule.id, schedule.available_date, schedule.start_time, schedule.end_time
  FROM technical_equipment_availability schedule
  WHERE schedule.inventory_id=stock.id
    AND schedule.available_date=$2::date
    AND schedule.start_time <= $3::time
    AND schedule.end_time >= $4::time
  ORDER BY schedule.start_time, schedule.end_time
  LIMIT 1
) availability ON true
    LEFT JOIN LATERAL (
      SELECT sum(reserved_item.quantity)::integer AS quantity
      FROM event_equipment_reservations reservation
      JOIN event_equipment_reservation_items reserved_item ON reserved_item.reservation_id=reservation.id
      WHERE reserved_item.inventory_id=stock.id AND reservation.status='reserved'
        AND reservation.event_date=$2::date
        AND reservation.start_time < $4::time AND reservation.end_time > $3::time
    ) booked ON true
    WHERE stock.status='operational' AND stock.availability_status='Available'
      AND lower(trim(stock.name))=ANY($1::text[])
      AND (availability.id IS NOT NULL OR NOT EXISTS (
        SELECT 1 FROM technical_equipment_availability schedule
        WHERE schedule.inventory_id=stock.id AND schedule.available_date=$2::date
      ))
      AND stock.quantity > COALESCE(booked.quantity, 0)
    ORDER BY lower(stock.name), stock.asset_code
  `, [names, event.proposed_date, event.proposed_start_time, event.proposed_end_time])).rows : [];
  const byName = new Map();
  for (const item of inventory) {
    const key = item.name.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) || []), item]);
  }
  return {
    event,
    alreadyReserved: false,
    items: distinctRequestedItems.map(requested => {
      const matches = (byName.get(String(requested.item).trim().toLowerCase()) || [])
        .filter(asset => Number(asset.available_quantity) > 0);
      return {
        item: requested.item,
        requestedQuantity: requested.quantity,
        requestAliases: requested.requestAliases,
        availableQuantity: matches.reduce((sum, asset) => sum + asset.available_quantity, 0),
        availableAssets: matches,
      };
    }),
  };
}

/**
 * Confirms selected assets atomically, locking assets in a stable order to prevent overbooking.
 * @param {number} eventId event with a current full/partial fulfillment review.
 * @param {Array<{inventoryId:number,quantity:number}>} stock lines and unit quantities to reserve.
 * @param {number} staffId authenticated Technical Support staff member.
 * @param {Array<{item:string,quantity:number}>} additionalItems manually identified equipment.
 * @returns {Promise<object>} reservation or a business-rule conflict.
 */
async function createEquipmentReservation(eventId, selections, staffId, additionalItems = []) {
  const client = await databasePool.connect();
  try {
    await client.query('BEGIN');
    const event = (await client.query(`
      SELECT e.id, e.name, e.proposed_date::text AS proposed_date,
        e.proposed_start_time::text AS proposed_start_time,
        e.proposed_end_time::text AS proposed_end_time, e.equipment_items,
        e.equipment_requirements_version AS request_version,
        review.outcome AS review_outcome,
        venue.name AS venue_name, venue.location AS venue_location
      FROM events e
      JOIN event_equipment_reviews review
        ON review.event_id=e.id AND review.request_version=e.equipment_requirements_version
      LEFT JOIN LATERAL (
        SELECT v.name, v.location
        FROM venue_bookings vb JOIN venues v ON v.id=vb.venue_id
        WHERE vb.event_id=e.id AND vb.status IN ('approved', 'pending')
        ORDER BY CASE WHEN vb.status='approved' THEN 0 ELSE 1 END, vb.start_datetime DESC, vb.id DESC
        LIMIT 1
      ) venue ON true
      WHERE e.id=$1 AND e.is_draft=false AND e.proposed_date >= CURRENT_DATE
        AND (e.proposed_date > CURRENT_DATE OR e.proposed_end_time > LOCALTIME)
        AND e.status NOT IN ('draft', 'cancelled', 'completed', 'rejected')
        AND review.outcome IN ('fully_fulfillable', 'partially_fulfillable')
      FOR UPDATE OF e
    `, [eventId])).rows[0];
    if (!event) {
      await client.query('ROLLBACK');
      return { conflict: 'This event does not have a current equipment review or is no longer upcoming.' };
    }
    const requestItems = Array.isArray(event.equipment_items) ? event.equipment_items : [];
    const requestQuantitiesByAlias = new Map();
    const allowedQuantitiesByAlias = new Map();
    for (const item of requestItems) {
      const name = item.item.trim().toLowerCase();
      requestQuantitiesByAlias.set(name, (requestQuantitiesByAlias.get(name) || 0) + item.quantity);
      allowedQuantitiesByAlias.set(name, (allowedQuantitiesByAlias.get(name) || 0) + item.quantity);
    }
    for (const item of additionalItems) {
      const name = item.item.trim().toLowerCase();
      allowedQuantitiesByAlias.set(name, (allowedQuantitiesByAlias.get(name) || 0) + item.quantity);
    }
    const requestAliases = [...new Set([
      ...requestQuantitiesByAlias.keys(),
      ...allowedQuantitiesByAlias.keys(),
    ])];
    const resolutionRows = requestAliases.length ? (await client.query(`
      SELECT requested.item AS requested_item,
        COALESCE(match.name, requested.item) AS canonical_item
      FROM unnest($1::text[]) AS requested(item)
      LEFT JOIN LATERAL (
        SELECT stock.name
        FROM equipments stock
        WHERE lower(trim(stock.name))=requested.item
          OR lower(trim(stock.asset_code))=requested.item
        ORDER BY CASE WHEN lower(trim(stock.name))=requested.item THEN 0 ELSE 1 END,
          stock.asset_code
        LIMIT 1
      ) match ON true
    `, [requestAliases])).rows : [];
    const canonicalByAlias = new Map(resolutionRows.map(row => [
      String(row.requested_item).trim().toLowerCase(),
      String(row.canonical_item).trim().toLowerCase(),
    ]));
    function mergeTypeQuantities(quantitiesByAlias) {
      const quantitiesByType = new Map();
      for (const [alias, quantity] of quantitiesByAlias) {
        const type = canonicalByAlias.get(alias) || alias;
        // Name/code aliases represent the same requested units, while repeated identical labels were already summed.
        quantitiesByType.set(type, Math.max(quantitiesByType.get(type) || 0, quantity));
      }
      return quantitiesByType;
    }
    const requiredByName = mergeTypeQuantities(requestQuantitiesByAlias);
    const requestedByName = mergeTypeQuantities(allowedQuantitiesByAlias);
    const ids = selections.map(selection => selection.inventoryId).sort((a, b) => a - b);
    const inventory = ids.length ? (await client.query(`
      SELECT id, name, asset_code, specification, quantity
      FROM equipments
      WHERE id=ANY($1::integer[]) AND status='operational' AND availability_status='Available'
      ORDER BY id
      FOR UPDATE
    `, [ids])).rows : [];
    if (inventory.length !== ids.length) {
      await client.query('ROLLBACK');
      return { conflict: 'Refresh availability; one or more selected assets are no longer operational.' };
    }

    const inventoryById = new Map(inventory.map(item => [item.id, item]));
    const selectedById = new Map(selections.map(selection => [selection.inventoryId, selection]));
    const selectedCounts = new Map();
    for (const selection of selections) {
      const item = inventoryById.get(selection.inventoryId);
      const itemName = item?.name.trim().toLowerCase();
      const requestedQuantity = itemName && requestedByName.get(itemName);
      const selectedQuantity = (selectedCounts.get(itemName) || 0) + selection.quantity;
      if (!requestedQuantity || selectedQuantity > requestedQuantity) {
        await client.query('ROLLBACK');
        return { conflict: 'Selected equipment must match the reviewed request and cannot exceed its quantity.' };
      }
      selectedCounts.set(itemName, selectedQuantity);
      if (selection.quantity > item.quantity) {
        await client.query('ROLLBACK');
        return { conflict: 'Selected quantity exceeds the total stock for an equipment item.' };
      }
    }
    if (event.review_outcome === 'fully_fulfillable' &&
        [...requiredByName].some(([name, quantity]) => (selectedCounts.get(name) || 0) < quantity)) {
      await client.query('ROLLBACK');
      return { conflict: 'A fully fulfillable request must reserve every requested item and quantity.' };
    }

    if (selections.length < 1) {
      await client.query('ROLLBACK');
      return { conflict: 'Select at least one equipment item to reserve.' };
    }
    // Check after acquiring ordered asset locks so concurrent requests cannot both reserve an asset.
    const availabilitySelections = selections.map(({ inventoryId, quantity }) => ({
      inventory_id: inventoryId,
      quantity,
    }));
    const stillAvailable = (await client.query(`
      SELECT stock.id,
        GREATEST(stock.quantity - COALESCE(booked.quantity, 0), 0)::integer AS available_quantity
      FROM equipments stock
      LEFT JOIN LATERAL (
        SELECT schedule.id
        FROM technical_equipment_availability schedule
        WHERE schedule.inventory_id=stock.id AND schedule.available_date=$2::date
          AND schedule.start_time <= $3::time AND schedule.end_time >= $4::time
        ORDER BY schedule.start_time, schedule.end_time
        LIMIT 1
      ) availability ON true
      LEFT JOIN LATERAL (
        SELECT sum(reserved_item.quantity)::integer AS quantity
        FROM event_equipment_reservations reservation
        JOIN event_equipment_reservation_items reserved_item ON reserved_item.reservation_id=reservation.id
        WHERE reserved_item.inventory_id=stock.id AND reservation.status='reserved'
          AND reservation.event_date=$2::date
          AND reservation.start_time < $4::time AND reservation.end_time > $3::time
      ) booked ON true
      WHERE stock.id=ANY($1::integer[]) AND stock.status='operational'
        AND stock.availability_status='Available'
        AND (availability.id IS NOT NULL OR NOT EXISTS (
          SELECT 1 FROM technical_equipment_availability schedule
          WHERE schedule.inventory_id=stock.id AND schedule.available_date=$2::date
        ))
        AND stock.quantity - COALESCE(booked.quantity, 0) >=
          (SELECT selection.quantity FROM jsonb_to_recordset($5::jsonb) AS selection(inventory_id integer, quantity integer)
           WHERE selection.inventory_id=stock.id)
    `, [ids, event.proposed_date, event.proposed_start_time, event.proposed_end_time,
      JSON.stringify(availabilitySelections)])).rows;
    if (stillAvailable.length !== ids.length) {
      await client.query('ROLLBACK');
      return { conflict: 'One or more selected quantities are no longer available for this time. Refresh availability.' };
    }

    const reservation = (await client.query(`
      INSERT INTO event_equipment_reservations
        (event_id, request_version, event_date, start_time, end_time, venue_name, venue_location, reserved_by)
      VALUES ($1, $2, $3::date, $4::time, $5::time, $6, $7, $8)
      ON CONFLICT (event_id, request_version) WHERE status='reserved' DO NOTHING
      RETURNING id, event_id, request_version, event_date::text AS event_date,
        start_time, end_time, venue_name, venue_location, reserved_by, reserved_at
    `, [event.id, event.request_version, event.proposed_date, event.proposed_start_time,
      event.proposed_end_time, event.venue_name, event.venue_location, staffId])).rows[0];
    if (!reservation) {
      await client.query('ROLLBACK');
      return { conflict: 'Equipment has already been reserved for this request.' };
    }

    await client.query(`
      INSERT INTO event_equipment_reservation_items (reservation_id, inventory_id, quantity)
      SELECT $1, selection.inventory_id, selection.quantity
      FROM jsonb_to_recordset($2::jsonb) AS selection(inventory_id integer, quantity integer)
    `, [reservation.id, JSON.stringify(availabilitySelections)]);
    // Reservation freezes the reviewed equipment details so later organiser edits become change requests.
    await client.query('UPDATE events SET equipment_confirmed_at=COALESCE(equipment_confirmed_at, now()) WHERE id=$1', [event.id]);
    await client.query('COMMIT');
    return { reservation, items: inventory.map(item => ({
      inventoryId: item.id, assetCode: item.asset_code, name: item.name,
      quantity: selectedById.get(item.id)?.quantity,
    })) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Lists upcoming active equipment requests that have not been reviewed at their current version.
 * Requires an assigned Event Coordinator and an explicit responsibility for the authenticated staffId.
 * @returns {Promise<Array<object>>} event, venue, and organiser-submitted technical requirements.
 */
async function listPendingEquipmentRequests(staffId) {
  const result = await pool.query(`
    SELECT e.id, e.name, e.proposed_date::text AS proposed_date, e.proposed_start_time,
      e.proposed_end_time, e.equipment_items, e.equipment_notes, e.technical_support_required,
      e.technical_support_details, e.video_conferencing_required, e.technical_specifications,
      e.equipment_requirements_version AS request_version,
      venue.name AS venue_name, venue.location AS venue_location
    FROM events e
    LEFT JOIN LATERAL (
      SELECT v.name, v.location
      FROM venue_bookings vb
      JOIN venues v ON v.id=vb.venue_id
      WHERE vb.event_id=e.id AND vb.status IN ('approved', 'pending')
      ORDER BY CASE WHEN vb.status='approved' THEN 0 ELSE 1 END, vb.start_datetime DESC, vb.id DESC
      LIMIT 1
    ) venue ON true
    -- AC6: a role alone does not grant responsibility for this event.
    WHERE ${responsibilityScope()} AND e.is_draft=false AND e.coordinator_id IS NOT NULL AND e.proposed_date >= CURRENT_DATE
      AND (e.proposed_date > CURRENT_DATE OR e.proposed_end_time > LOCALTIME)
      AND e.status NOT IN ('draft', 'cancelled', 'completed', 'rejected')
      AND (
        jsonb_array_length(e.equipment_items) > 0
        OR COALESCE(length(trim(e.equipment_notes)), 0) > 0
        OR e.technical_support_required
        OR e.video_conferencing_required
        OR COALESCE(length(trim(e.technical_specifications)), 0) > 0
      )
      AND NOT EXISTS (
        SELECT 1 FROM event_equipment_reviews r
        WHERE r.event_id=e.id AND r.request_version=e.equipment_requirements_version
      )
    ORDER BY e.proposed_date, e.proposed_start_time, e.id
  `, [staffId]);
  return result.rows;
}

/**
 * Adds a review only when the submitted request version is still current and pending.
 * A fully fulfillable decision confirms equipment so later organiser edits become change requests.
 * @param {number} eventId submitted event identifier.
 * @param {object} data decision, optional reason, and the version shown to the reviewer.
 * @param {number} reviewerId authenticated Technical Support user identifier.
 * @param {{ query: Function }} [db] pool or transaction client (the review and its coordinator notification commit together).
 * @returns {Promise<object|null>} saved audit entry, or null when the request is no longer eligible (including an
 *   event with no assigned Event Coordinator yet).
 */
async function createEquipmentReview(eventId, data, reviewerId, db = pool) {
  const result = await db.query(`
    WITH target AS (
      SELECT e.id, e.equipment_requirements_version
      FROM events e
      -- Check before inserting: a new review must not manufacture responsibility.
      WHERE e.id=$1 AND ${responsibilityScope('e', '$4')} AND e.equipment_requirements_version=$5
        AND e.is_draft=false AND e.coordinator_id IS NOT NULL AND e.proposed_date >= CURRENT_DATE
        AND (e.proposed_date > CURRENT_DATE OR e.proposed_end_time > LOCALTIME)
        AND e.status NOT IN ('draft', 'cancelled', 'completed', 'rejected')
        AND (
          jsonb_array_length(e.equipment_items) > 0
          OR COALESCE(length(trim(e.equipment_notes)), 0) > 0
          OR e.technical_support_required
          OR e.video_conferencing_required
          OR COALESCE(length(trim(e.technical_specifications)), 0) > 0
        )
        AND NOT EXISTS (
          SELECT 1 FROM event_equipment_reviews existing
          WHERE existing.event_id=e.id AND existing.request_version=e.equipment_requirements_version
        )
      FOR UPDATE
    ), saved_review AS (
      INSERT INTO event_equipment_reviews (event_id, request_version, outcome, reason, reviewed_by, affected_items)
      SELECT id, equipment_requirements_version, $2, $3, $4, $6::jsonb FROM target
      ON CONFLICT (event_id, request_version) DO NOTHING
      RETURNING id, event_id, request_version, outcome, reason, reviewed_by, reviewed_at, affected_items
    ), confirmed AS (
      UPDATE events e SET equipment_confirmed_at=now()
      FROM saved_review r
      WHERE e.id=r.event_id AND r.outcome='fully_fulfillable'
      RETURNING e.id
    )
    SELECT r.id, r.event_id, r.request_version, r.outcome, r.reason, r.reviewed_by, r.reviewed_at, r.affected_items
    FROM saved_review r
    LEFT JOIN confirmed c ON c.id=r.event_id
  `, [eventId, data.outcome, data.reason, reviewerId, data.requestVersion, JSON.stringify(data.affectedItems || [])]);
  return result.rows[0] || null;
}

/** Lists equipment stock and scheduled windows with booked, available and blocked quantities. */
/** Returns inventory with scheduled windows and reserved windows on otherwise unscheduled dates. */
async function listEquipmentInventory() {
  // The UI distinguishes scheduled coverage from reservation-only windows when applying unscheduled-date availability.
  const result = await pool.query(`
    SELECT stock.id, stock.asset_code, stock.name, stock.specification, stock.status,
      stock.availability_status, stock.quantity,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', history.id,
          'status', history.status,
          'note', history.note,
          'changed_at', history.changed_at,
          'changed_by_name', staff.full_name
        ) ORDER BY history.changed_at, history.id)
        FROM equipment_status_history history
        LEFT JOIN users staff ON staff.id=history.changed_by
        WHERE history.inventory_id=stock.id
      ), '[]'::jsonb) AS status_history,
      COALESCE(jsonb_agg(jsonb_build_object(
        'date', availability.available_date::text,
        'startTime', availability.start_time::text,
        'endTime', availability.end_time::text,
        'isScheduled', availability.is_scheduled,
        'status', CASE
          WHEN stock.availability_status <> 'Available' OR stock.status <> 'operational' THEN 'Unavailable'
          WHEN COALESCE(reserved.quantity, 0) >= stock.quantity THEN 'Reserved'
          ELSE 'Available'
        END,
        'availableQuantity', CASE
          WHEN stock.availability_status <> 'Available' OR stock.status <> 'operational' THEN 0
          ELSE GREATEST(stock.quantity - COALESCE(reserved.quantity, 0), 0)
        END,
        'reservedQuantity', COALESCE(reserved.quantity, 0),
        'blockReason', CASE
          WHEN stock.availability_status <> 'Available' OR stock.status <> 'operational' THEN (
            SELECT history.note
            FROM equipment_status_history history
            WHERE history.inventory_id=stock.id AND history.status='Unavailable'
            ORDER BY history.changed_at DESC, history.id DESC
            LIMIT 1
          )
          ELSE NULL
        END,
        'eventName', reserved.event_names
      ) ORDER BY availability.available_date, availability.start_time)
        FILTER (WHERE availability.id IS NOT NULL), '[]'::jsonb) AS availabilities
    FROM equipments stock
    LEFT JOIN LATERAL (
      SELECT schedule.id, schedule.available_date,
        schedule_segments.start_time, schedule_segments.end_time, TRUE AS is_scheduled
      FROM technical_equipment_availability schedule
      -- Split scheduled windows at booking edges so only occupied sub-periods appear reserved.
      CROSS JOIN LATERAL (
        SELECT availability_boundaries.point_time AS start_time,
          LEAD(availability_boundaries.point_time) OVER (
            ORDER BY availability_boundaries.point_time
          ) AS end_time
        FROM (
          SELECT schedule.start_time AS point_time
          UNION
          SELECT schedule.end_time
          UNION
          SELECT GREATEST(reservation.start_time, schedule.start_time)
          FROM event_equipment_reservations reservation
          JOIN event_equipment_reservation_items reserved_item
            ON reserved_item.reservation_id=reservation.id
          WHERE reserved_item.inventory_id=stock.id AND reservation.status='reserved'
            AND reservation.event_date=schedule.available_date
            AND reservation.start_time < schedule.end_time
            AND reservation.end_time > schedule.start_time
          UNION
          SELECT LEAST(reservation.end_time, schedule.end_time)
          FROM event_equipment_reservations reservation
          JOIN event_equipment_reservation_items reserved_item
            ON reserved_item.reservation_id=reservation.id
          WHERE reserved_item.inventory_id=stock.id AND reservation.status='reserved'
            AND reservation.event_date=schedule.available_date
            AND reservation.start_time < schedule.end_time
            AND reservation.end_time > schedule.start_time
        ) availability_boundaries
      ) schedule_segments
      WHERE schedule_segments.end_time IS NOT NULL
        AND schedule.inventory_id=stock.id
      UNION ALL
      SELECT -row_number() OVER (
        ORDER BY reservation_slot.available_date, reservation_slot.start_time, reservation_slot.end_time
      ) AS id,
        reservation_slot.available_date, reservation_slot.start_time, reservation_slot.end_time, FALSE AS is_scheduled
      FROM (
        SELECT reservation_segments.available_date, reservation_segments.start_time,
          reservation_segments.end_time
        FROM (
          SELECT reservation_boundaries.available_date, reservation_boundaries.point_time AS start_time,
            LEAD(reservation_boundaries.point_time) OVER (
              PARTITION BY reservation_boundaries.available_date
              ORDER BY reservation_boundaries.point_time
            ) AS end_time
          FROM (
            SELECT DISTINCT reservation.event_date AS available_date, reservation.start_time AS point_time
            FROM event_equipment_reservations reservation
            JOIN event_equipment_reservation_items reserved_item
              ON reserved_item.reservation_id=reservation.id
            WHERE reserved_item.inventory_id=stock.id AND reservation.status='reserved'
            UNION
            SELECT DISTINCT reservation.event_date AS available_date, reservation.end_time AS point_time
            FROM event_equipment_reservations reservation
            JOIN event_equipment_reservation_items reserved_item
              ON reserved_item.reservation_id=reservation.id
            WHERE reserved_item.inventory_id=stock.id AND reservation.status='reserved'
          ) reservation_boundaries
        ) reservation_segments
        -- Unscheduled dates default to available; expose only reservation-covered time segments here.
        WHERE reservation_segments.end_time IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM event_equipment_reservations reservation
            JOIN event_equipment_reservation_items reserved_item
              ON reserved_item.reservation_id=reservation.id
            WHERE reserved_item.inventory_id=stock.id AND reservation.status='reserved'
              AND reservation.event_date=reservation_segments.available_date
              AND reservation.start_time < reservation_segments.end_time
              AND reservation.end_time > reservation_segments.start_time
          )
      ) reservation_slot
      WHERE NOT EXISTS (
        SELECT 1
        FROM technical_equipment_availability scheduled_date
        WHERE scheduled_date.inventory_id=stock.id
          AND scheduled_date.available_date=reservation_slot.available_date
      )
    ) availability ON TRUE
    LEFT JOIN LATERAL (
      SELECT sum(reserved_item.quantity)::integer AS quantity,
        string_agg(DISTINCT event.name, ', ' ORDER BY event.name) AS event_names
      FROM event_equipment_reservations reservation
      JOIN event_equipment_reservation_items reserved_item ON reserved_item.reservation_id=reservation.id
      JOIN events event ON event.id=reservation.event_id
      WHERE reserved_item.inventory_id=stock.id AND reservation.status='reserved'
        AND reservation.event_date=availability.available_date
        AND reservation.start_time <= availability.start_time
        AND reservation.end_time >= availability.end_time
    ) reserved ON availability.id IS NOT NULL
    GROUP BY stock.id
    ORDER BY stock.asset_code
  `);
  return result.rows;
}

/**
 * Atomically changes one Unavailable asset to Available and appends its staff resolution note.
 * Returns null if the asset is missing or another request has already changed its availability.
 */
async function markEquipmentAvailable(inventoryId, resolutionNote, staffId) {
  const client = await databasePool.connect();
  try {
    await client.query('BEGIN');
    const updated = (await client.query(`
      UPDATE equipments
      SET availability_status='Available', status='operational', updated_at=now()
      WHERE id=$1 AND availability_status='Unavailable'
      RETURNING id, asset_code, name, specification, status, availability_status, quantity
    `, [inventoryId])).rows[0];
    if (!updated) {
      await client.query('ROLLBACK');
      return null;
    }

    // Persisting the note inside this transaction prevents an Available status without its audit explanation.
    await client.query(`
      INSERT INTO equipment_status_history (inventory_id, status, note, changed_by)
      VALUES ($1, 'Available', $2, $3)
    `, [inventoryId, resolutionNote, staffId]);
    const statusHistory = await client.query(`
      SELECT history.id, history.status, history.note, history.changed_at,
        staff.full_name AS changed_by_name
      FROM equipment_status_history history
      LEFT JOIN users staff ON staff.id=history.changed_by
      WHERE history.inventory_id=$1
      ORDER BY history.changed_at, history.id
    `, [inventoryId]);
    await client.query('COMMIT');
    return { ...updated, status_history: statusHistory.rows };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Lists reviewed requests with equipment that still needs reservation, including the event's full technical requirements.
 * Requires an assigned Event Coordinator and an explicit responsibility for the authenticated staffId.
 */
async function listEquipmentReservationCandidates(staffId) {
  const result = await pool.query(`
    SELECT e.id, e.name, e.proposed_date::text AS proposed_date,
      e.proposed_start_time, e.proposed_end_time, e.equipment_items, e.equipment_notes,
      e.technical_support_required, e.technical_support_details,
      e.video_conferencing_required, e.technical_specifications,
      e.equipment_requirements_version AS request_version,
      review.outcome AS review_outcome, review.reason AS review_reason,
      venue.name AS venue_name, venue.location AS venue_location
    FROM events e
    JOIN event_equipment_reviews review
      ON review.event_id=e.id AND review.request_version=e.equipment_requirements_version
    LEFT JOIN LATERAL (
      SELECT v.name, v.location
      FROM venue_bookings vb JOIN venues v ON v.id=vb.venue_id
      WHERE vb.event_id=e.id AND vb.status IN ('approved', 'pending')
      ORDER BY CASE WHEN vb.status='approved' THEN 0 ELSE 1 END, vb.start_datetime DESC, vb.id DESC
      LIMIT 1
    ) venue ON true
    -- AC6: a role alone does not grant responsibility for this event.
    WHERE ${responsibilityScope()} AND e.is_draft=false AND e.coordinator_id IS NOT NULL AND e.proposed_date >= CURRENT_DATE
      AND (e.proposed_date > CURRENT_DATE OR e.proposed_end_time > LOCALTIME)
      AND e.status NOT IN ('draft', 'cancelled', 'completed', 'rejected')
      AND review.outcome IN ('fully_fulfillable', 'partially_fulfillable')
      AND NOT EXISTS (
        SELECT 1 FROM event_equipment_reservations reservation
        WHERE reservation.event_id=e.id
          AND reservation.request_version=e.equipment_requirements_version
          AND reservation.status='reserved'
      )
    ORDER BY e.proposed_date, e.proposed_start_time, e.id
  `, [staffId]);
  return result.rows;
}

/**
 * Lists actionable allocations and retained releases only within the authenticated staffId responsibility scope.
 * Old event slots remain actionable after cancellation or a changed schedule, even when that original date passed.
 */
async function listActiveEquipmentReservations(staffId) {
  const result = await pool.query(`
    SELECT reservation.id, reservation.event_id, e.name AS event_name,
      e.status AS event_status,
      (e.proposed_date IS NOT NULL AND (
        e.proposed_date IS DISTINCT FROM reservation.event_date
        OR e.proposed_start_time IS DISTINCT FROM reservation.start_time
        OR e.proposed_end_time IS DISTINCT FROM reservation.end_time
      )) AS event_schedule_changed,
      reservation.event_date::text AS event_date, reservation.start_time,
      reservation.end_time, reservation.venue_name, reservation.venue_location,
      reservation.status, reservation.reserved_at, staff.full_name AS reserved_by_name,
      reservation.released_by, releaser.full_name AS released_by_name, reservation.released_at,
      COALESCE(jsonb_agg(jsonb_build_object(
        'assetCode', inventory.asset_code, 'name', inventory.name,
        'specification', inventory.specification, 'quantity', reserved_item.quantity
      ) ORDER BY inventory.asset_code) FILTER (WHERE inventory.id IS NOT NULL), '[]'::jsonb) AS items
    FROM event_equipment_reservations reservation
    JOIN events e ON e.id=reservation.event_id
    JOIN users staff ON staff.id=reservation.reserved_by
    LEFT JOIN users releaser ON releaser.id=reservation.released_by
    LEFT JOIN event_equipment_reservation_items reserved_item ON reserved_item.reservation_id=reservation.id
    LEFT JOIN equipments inventory ON inventory.id=reserved_item.inventory_id
    -- A cancellation or changed event slot still holds stock until staff explicitly release it.
    WHERE ${responsibilityScope()} AND ((reservation.status='reserved' AND (
        reservation.event_date > CURRENT_DATE
        OR (reservation.event_date=CURRENT_DATE AND reservation.end_time > LOCALTIME)
        OR e.status='cancelled'
        OR (e.proposed_date IS NOT NULL AND (
          e.proposed_date IS DISTINCT FROM reservation.event_date
          OR e.proposed_start_time IS DISTINCT FROM reservation.start_time
          OR e.proposed_end_time IS DISTINCT FROM reservation.end_time
        ))
      )) OR reservation.status='cancelled')
    GROUP BY reservation.id, e.name, e.status, e.proposed_date,
      e.proposed_start_time, e.proposed_end_time, staff.full_name, releaser.full_name
    ORDER BY CASE WHEN reservation.status='reserved' THEN 0 ELSE 1 END,
      reservation.event_date, reservation.start_time, reservation.id
  `, [staffId]);
  return result.rows;
}

/**
 * Finds matching operational assets for itemized requests and optional staff-entered equipment.
 * @param {number} eventId event with a current equipment review and an assigned Event Coordinator.
 * @param {Array<{item:string,quantity:number}>} additionalItems equipment extracted from other request text.
 * @param {number} staffId authenticated staff member whose responsibility authorizes this read.
 * @returns {Promise<object|null>} requested names, quantities and matching available assets.
 */
async function getEquipmentReservationAvailability(eventId, additionalItems = [], staffId) {
  const event = (await pool.query(`
    SELECT e.id, e.name, e.proposed_date::text AS proposed_date,
      e.proposed_start_time::text AS proposed_start_time,
      e.proposed_end_time::text AS proposed_end_time, e.equipment_items,
      e.equipment_requirements_version AS request_version,
      review.outcome AS review_outcome, review.reason AS review_reason,
      venue.name AS venue_name, venue.location AS venue_location,
      EXISTS (
        SELECT 1 FROM event_equipment_reservations reservation
        WHERE reservation.event_id=e.id
          AND reservation.request_version=e.equipment_requirements_version
          AND reservation.status='reserved'
      ) AS already_reserved
    FROM events e
    JOIN event_equipment_reviews review
      ON review.event_id=e.id AND review.request_version=e.equipment_requirements_version
    LEFT JOIN LATERAL (
      SELECT v.name, v.location
      FROM venue_bookings vb JOIN venues v ON v.id=vb.venue_id
      WHERE vb.event_id=e.id AND vb.status IN ('approved', 'pending')
      ORDER BY CASE WHEN vb.status='approved' THEN 0 ELSE 1 END, vb.start_datetime DESC, vb.id DESC
      LIMIT 1
    ) venue ON true
    WHERE e.id=$1 AND ${responsibilityScope('e', '$2')} AND e.is_draft=false AND e.coordinator_id IS NOT NULL AND e.proposed_date >= CURRENT_DATE
      AND (e.proposed_date > CURRENT_DATE OR e.proposed_end_time > LOCALTIME)
      AND e.status NOT IN ('draft', 'cancelled', 'completed', 'rejected')
      AND review.outcome IN ('fully_fulfillable', 'partially_fulfillable')
  `, [eventId, staffId])).rows[0];
  if (!event) return null;
  if (event.already_reserved) return { event, alreadyReserved: true, items: [] };

  const requestedItems = Array.isArray(event.equipment_items) ? event.equipment_items : [];
  const requestsByAlias = new Map();
  for (const entry of [...requestedItems, ...additionalItems]) {
    const key = String(entry.item).trim().toLowerCase();
    const existing = requestsByAlias.get(key);
    requestsByAlias.set(key, {
      item: existing?.item || entry.item,
      quantity: (existing?.quantity || 0) + entry.quantity,
    });
  }
  const aliasRequests = [...requestsByAlias.values()];
  const aliasNames = aliasRequests.map(entry => String(entry.item).trim());
  const resolvedAliases = aliasNames.length ? (await pool.query(`
    SELECT requested.item AS requested_item,
      COALESCE(match.name, requested.item) AS canonical_item
    FROM unnest($1::text[]) AS requested(item)
    LEFT JOIN LATERAL (
      SELECT stock.name
      FROM equipments stock
      WHERE lower(trim(stock.name))=lower(trim(requested.item))
        OR lower(trim(stock.asset_code))=lower(trim(requested.item))
      ORDER BY CASE WHEN lower(trim(stock.name))=lower(trim(requested.item)) THEN 0 ELSE 1 END,
        stock.asset_code
      LIMIT 1
    ) match ON true
  `, [aliasNames])).rows : [];
  const canonicalByAlias = new Map(resolvedAliases.map(row => [
    String(row.requested_item).trim().toLowerCase(),
    row.canonical_item,
  ]));
  const requestsByType = new Map();
  for (const entry of aliasRequests) {
    const canonicalItem = canonicalByAlias.get(String(entry.item).trim().toLowerCase()) || entry.item;
    const key = String(canonicalItem).trim().toLowerCase();
    const existing = requestsByType.get(key);
    // A type name and an asset code can describe the same requested units; don't count that alias twice.
    requestsByType.set(key, {
      item: existing?.item || canonicalItem,
      quantity: Math.max(existing?.quantity || 0, entry.quantity),
      requestAliases: [...new Set([...(existing?.requestAliases || []), entry.item])],
    });
  }
  const distinctRequestedItems = [...requestsByType.values()];
  const names = [...requestsByType.keys()];
  const inventory = names.length ? (await pool.query(`
    SELECT stock.id, stock.asset_code, stock.name, stock.specification, stock.status, stock.quantity,
      CASE WHEN availability.available_date IS NULL AND EXISTS (
        SELECT 1 FROM technical_equipment_availability schedule
        WHERE schedule.inventory_id=stock.id AND schedule.available_date=$2::date
      ) THEN 0
        ELSE GREATEST(stock.quantity - COALESCE(booked.quantity, 0), 0)
      END::integer AS available_quantity,
      availability.available_date::text AS available_date,
      availability.start_time::text AS available_start_time,
      availability.end_time::text AS available_end_time
    FROM equipments stock
LEFT JOIN LATERAL (
  SELECT schedule.id, schedule.available_date, schedule.start_time, schedule.end_time
  FROM technical_equipment_availability schedule
  WHERE schedule.inventory_id=stock.id
    AND schedule.available_date=$2::date
    AND schedule.start_time <= $3::time
    AND schedule.end_time >= $4::time
  ORDER BY schedule.start_time, schedule.end_time
  LIMIT 1
) availability ON true
    LEFT JOIN LATERAL (
  -- Unscheduled dates can still be reserved; calculate conflicts only from peak simultaneous usage.
  SELECT MAX(concurrent.quantity)::integer AS quantity
  FROM (
    SELECT reservation_points.point_time,
      SUM(active_item.quantity)::integer AS quantity
    FROM (
      SELECT $3::time AS point_time
      UNION
      SELECT GREATEST(reservation.start_time, $3::time) AS point_time
      FROM event_equipment_reservations reservation
      JOIN event_equipment_reservation_items reserved_item
        ON reserved_item.reservation_id=reservation.id
      WHERE reserved_item.inventory_id=stock.id AND reservation.status='reserved'
        AND reservation.event_date=$2::date
        AND reservation.start_time < $4::time AND reservation.end_time > $3::time
    ) reservation_points
    JOIN event_equipment_reservations active_reservation
      ON active_reservation.event_date=$2::date
      AND active_reservation.status='reserved'
      AND active_reservation.start_time <= reservation_points.point_time
      AND active_reservation.end_time > reservation_points.point_time
    JOIN event_equipment_reservation_items active_item
      ON active_item.reservation_id=active_reservation.id
      AND active_item.inventory_id=stock.id
    GROUP BY reservation_points.point_time
  ) concurrent
) booked ON true
    WHERE stock.status='operational' AND stock.availability_status='Available'
      AND lower(trim(stock.name))=ANY($1::text[])
      AND (availability.id IS NOT NULL OR NOT EXISTS (
        SELECT 1 FROM technical_equipment_availability schedule
        WHERE schedule.inventory_id=stock.id AND schedule.available_date=$2::date
      ))
      AND stock.quantity > COALESCE(booked.quantity, 0)
    ORDER BY lower(stock.name), stock.asset_code
  `, [names, event.proposed_date, event.proposed_start_time, event.proposed_end_time])).rows : [];
  const byName = new Map();
  for (const item of inventory) {
    const key = item.name.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) || []), item]);
  }
  return {
    event,
    alreadyReserved: false,
    items: distinctRequestedItems.map(requested => {
      const matches = (byName.get(String(requested.item).trim().toLowerCase()) || [])
        .filter(asset => Number(asset.available_quantity) > 0);
      return {
        item: requested.item,
        requestedQuantity: requested.quantity,
        requestAliases: requested.requestAliases,
        availableQuantity: matches.reduce((sum, asset) => sum + asset.available_quantity, 0),
        availableAssets: matches,
      };
    }),
  };
}

/**
 * Confirms selected assets atomically, locking assets in a stable order to prevent overbooking.
 * @param {number} eventId event with a current full/partial fulfillment review and an assigned Event Coordinator.
 * @param {Array<{inventoryId:number,quantity:number}>} stock lines and unit quantities to reserve.
 * @param {number} staffId authenticated Technical Support staff member.
 * @param {Array<{item:string,quantity:number}>} additionalItems manually identified equipment.
 * @returns {Promise<object>} reservation or a business-rule conflict.
 */
async function createEquipmentReservation(eventId, selections, staffId, additionalItems = []) {
  const client = await databasePool.connect();
  try {
    await client.query('BEGIN');
    const event = (await client.query(`
      SELECT e.id, e.name, e.proposed_date::text AS proposed_date,
        e.proposed_start_time::text AS proposed_start_time,
        e.proposed_end_time::text AS proposed_end_time, e.equipment_items,
        e.equipment_requirements_version AS request_version, e.coordinator_id,
        review.outcome AS review_outcome,
        venue.name AS venue_name, venue.location AS venue_location
      FROM events e
      JOIN event_equipment_reviews review
        ON review.event_id=e.id AND review.request_version=e.equipment_requirements_version
      LEFT JOIN LATERAL (
        SELECT v.name, v.location
        FROM venue_bookings vb JOIN venues v ON v.id=vb.venue_id
        WHERE vb.event_id=e.id AND vb.status IN ('approved', 'pending')
        ORDER BY CASE WHEN vb.status='approved' THEN 0 ELSE 1 END, vb.start_datetime DESC, vb.id DESC
        LIMIT 1
      ) venue ON true
      -- Authorize inside the transaction before exposing or reserving event equipment.
      WHERE e.id=$1 AND ${responsibilityScope('e', '$2')} AND e.is_draft=false AND e.coordinator_id IS NOT NULL AND e.proposed_date >= CURRENT_DATE
        AND (e.proposed_date > CURRENT_DATE OR e.proposed_end_time > LOCALTIME)
        AND e.status NOT IN ('draft', 'cancelled', 'completed', 'rejected')
        AND review.outcome IN ('fully_fulfillable', 'partially_fulfillable')
      FOR UPDATE OF e
    `, [eventId, staffId])).rows[0];
    if (!event) {
      await client.query('ROLLBACK');
      return { conflict: 'This event does not have a current equipment review or is no longer upcoming.' };
    }
    const requestItems = Array.isArray(event.equipment_items) ? event.equipment_items : [];
    const requestQuantitiesByAlias = new Map();
    const allowedQuantitiesByAlias = new Map();
    for (const item of requestItems) {
      const name = item.item.trim().toLowerCase();
      requestQuantitiesByAlias.set(name, (requestQuantitiesByAlias.get(name) || 0) + item.quantity);
      allowedQuantitiesByAlias.set(name, (allowedQuantitiesByAlias.get(name) || 0) + item.quantity);
    }
    for (const item of additionalItems) {
      const name = item.item.trim().toLowerCase();
      allowedQuantitiesByAlias.set(name, (allowedQuantitiesByAlias.get(name) || 0) + item.quantity);
    }
    const requestAliases = [...new Set([
      ...requestQuantitiesByAlias.keys(),
      ...allowedQuantitiesByAlias.keys(),
    ])];
    const resolutionRows = requestAliases.length ? (await client.query(`
      SELECT requested.item AS requested_item,
        COALESCE(match.name, requested.item) AS canonical_item
      FROM unnest($1::text[]) AS requested(item)
      LEFT JOIN LATERAL (
        SELECT stock.name
        FROM equipments stock
        WHERE lower(trim(stock.name))=requested.item
          OR lower(trim(stock.asset_code))=requested.item
        ORDER BY CASE WHEN lower(trim(stock.name))=requested.item THEN 0 ELSE 1 END,
          stock.asset_code
        LIMIT 1
      ) match ON true
    `, [requestAliases])).rows : [];
    const canonicalByAlias = new Map(resolutionRows.map(row => [
      String(row.requested_item).trim().toLowerCase(),
      String(row.canonical_item).trim().toLowerCase(),
    ]));
    function mergeTypeQuantities(quantitiesByAlias) {
      const quantitiesByType = new Map();
      for (const [alias, quantity] of quantitiesByAlias) {
        const type = canonicalByAlias.get(alias) || alias;
        // Name/code aliases represent the same requested units, while repeated identical labels were already summed.
        quantitiesByType.set(type, Math.max(quantitiesByType.get(type) || 0, quantity));
      }
      return quantitiesByType;
    }
    const requiredByName = mergeTypeQuantities(requestQuantitiesByAlias);
    const requestedByName = mergeTypeQuantities(allowedQuantitiesByAlias);
    const ids = selections.map(selection => selection.inventoryId).sort((a, b) => a - b);
    const inventory = ids.length ? (await client.query(`
      SELECT id, name, asset_code, specification, quantity
      FROM equipments
      WHERE id=ANY($1::integer[]) AND status='operational' AND availability_status='Available'
      ORDER BY id
      FOR UPDATE
    `, [ids])).rows : [];
    if (inventory.length !== ids.length) {
      await client.query('ROLLBACK');
      return { conflict: 'Refresh availability; one or more selected assets are no longer operational.' };
    }

    const inventoryById = new Map(inventory.map(item => [item.id, item]));
    const selectedById = new Map(selections.map(selection => [selection.inventoryId, selection]));
    const selectedCounts = new Map();
    for (const selection of selections) {
      const item = inventoryById.get(selection.inventoryId);
      const itemName = item?.name.trim().toLowerCase();
      const requestedQuantity = itemName && requestedByName.get(itemName);
      const selectedQuantity = (selectedCounts.get(itemName) || 0) + selection.quantity;
      if (!requestedQuantity || selectedQuantity > requestedQuantity) {
        await client.query('ROLLBACK');
        return { conflict: 'Selected equipment must match the reviewed request and cannot exceed its quantity.' };
      }
      selectedCounts.set(itemName, selectedQuantity);
      if (selection.quantity > item.quantity) {
        await client.query('ROLLBACK');
        return { conflict: 'Selected quantity exceeds the total stock for an equipment item.' };
      }
    }
    if (event.review_outcome === 'fully_fulfillable' &&
        [...requiredByName].some(([name, quantity]) => (selectedCounts.get(name) || 0) < quantity)) {
      await client.query('ROLLBACK');
      return { conflict: 'A fully fulfillable request must reserve every requested item and quantity.' };
    }

    if (selections.length < 1) {
      await client.query('ROLLBACK');
      return { conflict: 'Select at least one equipment item to reserve.' };
    }
    // Check after acquiring ordered asset locks so concurrent requests cannot both reserve an asset.
    const availabilitySelections = selections.map(({ inventoryId, quantity }) => ({
      inventory_id: inventoryId,
      quantity,
    }));
    const stillAvailable = (await client.query(`
      SELECT stock.id,
        GREATEST(stock.quantity - COALESCE(booked.quantity, 0), 0)::integer AS available_quantity
      FROM equipments stock
      -- Reapply the preview rule after locking stock so unscheduled dates remain reservable.
      LEFT JOIN LATERAL (
        SELECT schedule.id
        FROM technical_equipment_availability schedule
        WHERE schedule.inventory_id=stock.id AND schedule.available_date=$2::date
          AND schedule.start_time <= $3::time AND schedule.end_time >= $4::time
        ORDER BY schedule.start_time, schedule.end_time
        LIMIT 1
      ) availability ON true
      LEFT JOIN LATERAL (
        -- Match the preview's peak-concurrency rule during the final locked reservation check.
        SELECT MAX(concurrent.quantity)::integer AS quantity
        FROM (
          SELECT reservation_points.point_time,
            SUM(active_item.quantity)::integer AS quantity
          FROM (
            SELECT $3::time AS point_time
            UNION
            SELECT GREATEST(reservation.start_time, $3::time) AS point_time
            FROM event_equipment_reservations reservation
            JOIN event_equipment_reservation_items reserved_item
              ON reserved_item.reservation_id=reservation.id
            WHERE reserved_item.inventory_id=stock.id AND reservation.status='reserved'
              AND reservation.event_date=$2::date
              AND reservation.start_time < $4::time AND reservation.end_time > $3::time
          ) reservation_points
          JOIN event_equipment_reservations active_reservation
            ON active_reservation.event_date=$2::date
            AND active_reservation.status='reserved'
            AND active_reservation.start_time <= reservation_points.point_time
            AND active_reservation.end_time > reservation_points.point_time
          JOIN event_equipment_reservation_items active_item
            ON active_item.reservation_id=active_reservation.id
            AND active_item.inventory_id=stock.id
          GROUP BY reservation_points.point_time
        ) concurrent
      ) booked ON true
      WHERE stock.id=ANY($1::integer[]) AND stock.status='operational'
        AND stock.availability_status='Available'
        AND (availability.id IS NOT NULL OR NOT EXISTS (
          SELECT 1 FROM technical_equipment_availability schedule
          WHERE schedule.inventory_id=stock.id AND schedule.available_date=$2::date
        ))
        AND stock.quantity - COALESCE(booked.quantity, 0) >=
          (SELECT selection.quantity FROM jsonb_to_recordset($5::jsonb) AS selection(inventory_id integer, quantity integer)
           WHERE selection.inventory_id=stock.id)
    `, [ids, event.proposed_date, event.proposed_start_time, event.proposed_end_time,
      JSON.stringify(availabilitySelections)])).rows;
    if (stillAvailable.length !== ids.length) {
      await client.query('ROLLBACK');
      return { conflict: 'One or more selected quantities are no longer available for this time. Refresh availability.' };
    }

    const reservation = (await client.query(`
      INSERT INTO event_equipment_reservations
        (event_id, request_version, event_date, start_time, end_time, venue_name, venue_location, reserved_by)
      VALUES ($1, $2, $3::date, $4::time, $5::time, $6, $7, $8)
      ON CONFLICT (event_id, request_version) WHERE status='reserved' DO NOTHING
      RETURNING id, event_id, request_version, event_date::text AS event_date,
        start_time, end_time, venue_name, venue_location, reserved_by, reserved_at
    `, [event.id, event.request_version, event.proposed_date, event.proposed_start_time,
      event.proposed_end_time, event.venue_name, event.venue_location, staffId])).rows[0];
    if (!reservation) {
      await client.query('ROLLBACK');
      return { conflict: 'Equipment has already been reserved for this request.' };
    }

    await client.query(`
      INSERT INTO event_equipment_reservation_items (reservation_id, inventory_id, quantity)
      SELECT $1, selection.inventory_id, selection.quantity
      FROM jsonb_to_recordset($2::jsonb) AS selection(inventory_id integer, quantity integer)
    `, [reservation.id, JSON.stringify(availabilitySelections)]);
    // Reservation freezes the reviewed equipment details so later organiser edits become change requests.
    await client.query('UPDATE events SET equipment_confirmed_at=COALESCE(equipment_confirmed_at, now()) WHERE id=$1', [event.id]);
    // SCRUM-85 AC4: confirmation and its coordinator notice share this reservation transaction.
    await require('../services/coordinatorNotifications').notifyEquipmentReserved(client, event, reservation);
    await client.query('COMMIT');
    return { reservation, items: inventory.map(item => ({
      inventoryId: item.id, assetCode: item.asset_code, name: item.name,
      quantity: selectedById.get(item.id)?.quantity,
    })) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Lists pending amendment requests for the event's current coordinator, including work inherited at handover.
async function listPendingChangeRequests(coordinatorId) {
  const result = await pool.query(`
    SELECT r.id, r.event_id, e.name AS event_name, r.organiser_id,
      organiser.full_name AS organiser_name, r.requested_changes, r.explanation, r.status, r.submitted_at,
      to_jsonb(e) AS event_record
    FROM event_change_requests r
    JOIN events e ON e.id=r.event_id
    JOIN users organiser ON organiser.id=r.organiser_id
    -- Keep historical request recipients intact while transferring the actionable inbox with responsibility.
    WHERE e.coordinator_id=$1 AND r.status='pending'
    ORDER BY r.submitted_at DESC, r.id DESC`, [coordinatorId]);
  return result.rows;
}

// Columns returned for a clarification, including where it took place and its resolution (offline clarifications story).
const CLARIFICATION_COLUMNS = `id, event_id, coordinator_id, organiser_id, information_needed, message, status, organiser_response,
  created_at, responded_at, source, outcome, coordinator_comments, resolved_at, resolved_by, resolution_outcome, resolution_comments`;

/**
 * Records a clarification that took place offline (AC1) for an event assigned to the coordinator: the question, the
 * organiser's answer and/or the agreed outcome, and comments. It is stored answered, or already resolved (AC2).
 * @returns {Promise<object|null>} the record, or null when the event is not assigned to the coordinator.
 */
async function recordOfflineClarification(eventId, coordinatorId, { informationNeeded, message, response, outcome, comments, resolve }) {
  const result = await pool.query(`
    INSERT INTO event_clarification_requests (event_id, coordinator_id, organiser_id, information_needed, message, source, status,
      organiser_response, responded_at, outcome, coordinator_comments, resolved_at, resolved_by)
    SELECT e.id, e.coordinator_id, e.organiser_id, $3::jsonb, $4, 'offline', CASE WHEN $8 THEN 'resolved' ELSE 'responded' END,
      $5::text, CASE WHEN $5::text IS NULL THEN NULL ELSE now() END, $6, $7,
      CASE WHEN $8 THEN now() END, CASE WHEN $8 THEN e.coordinator_id END
    FROM events e WHERE e.id=$1 AND e.coordinator_id=$2
    RETURNING ${CLARIFICATION_COLUMNS}, (SELECT u.full_name FROM users u WHERE u.id = resolved_by) AS resolved_by_name`,
  [eventId, coordinatorId, JSON.stringify(informationNeeded), message, response, outcome, comments, resolve]);
  return result.rows[0] || null;
}

/** One clarification of an event assigned to the coordinator, or null. */
async function findCoordinatorClarification(eventId, clarificationId, coordinatorId) {
  const result = await pool.query(`
    SELECT ${CLARIFICATION_COLUMNS.split(',').map((column) => `cr.${column.trim()}`).join(', ')}
    FROM event_clarification_requests cr JOIN events e ON e.id = cr.event_id
    WHERE cr.event_id=$1 AND cr.id=$2 AND e.coordinator_id=$3`, [eventId, clarificationId, coordinatorId]);
  return result.rows[0] || null;
}

/**
 * Marks a clarification resolved (AC2) with its resolution outcome and comments, stored apart from everything recorded
 * earlier: the question, any answer, the earlier outcome and comments and their times stay as they were, so the history is
 * complete. Only an open (pending or answered) one can be resolved.
 * @returns {Promise<object|null>} the resolved record, or null when it was resolved meanwhile.
 */
async function resolveClarification(eventId, clarificationId, coordinatorId, { outcome, comments }) {
  const result = await pool.query(`
    UPDATE event_clarification_requests cr SET status='resolved', resolved_at=now(), resolved_by=$3,
      resolution_outcome=$4, resolution_comments=$5
    FROM events e
    WHERE e.id=cr.event_id AND cr.event_id=$1 AND cr.id=$2 AND e.coordinator_id=$3 AND cr.status IN ('pending', 'responded')
    RETURNING ${CLARIFICATION_COLUMNS.split(',').map((column) => `cr.${column.trim()}`).join(', ')},
      (SELECT u.full_name FROM users u WHERE u.id = cr.resolved_by) AS resolved_by_name`,
  [eventId, clarificationId, coordinatorId, outcome, comments]);
  return result.rows[0] || null;
}

// Saves a coordinator's clarification request only for an event assigned to them.
async function createClarificationRequest(id, coordinatorId, informationNeeded, message) {
  const result = await pool.query(`
    WITH request AS (
      INSERT INTO event_clarification_requests (event_id, coordinator_id, organiser_id, information_needed, message)
      SELECT e.id, e.coordinator_id, e.organiser_id, $3::jsonb, $4
      FROM events e WHERE e.id=$1 AND e.coordinator_id=$2
      RETURNING id, event_id, coordinator_id, organiser_id, information_needed, message, status, organiser_response, created_at, responded_at
    ), notified AS (
      INSERT INTO notifications (user_id,event_id,type,title,message,details)
      SELECT request.organiser_id,request.event_id,'event_clarification_requested',
        left('Clarification needed: ' || e.name,255),
        'The Event Coordinator needs clarification for ' || e.name || E'.\\n' || request.message,
        jsonb_build_object('clarificationId',request.id,'informationNeeded',request.information_needed)
      FROM request JOIN events e ON e.id=request.event_id
    )
    SELECT * FROM request`, [id, coordinatorId, JSON.stringify(informationNeeded), message]);
  return result.rows[0] || null;
}

/**
 * Reply AC1–AC4: saves an owned pending reply and notifies the current coordinator in one atomic statement.
 * Locking the event serializes handovers; the request's historical coordinator never decides the recipient.
 * Returns the saved clarification and email-delivery records, or null if no owned pending question matches.
 */
async function respondToClarification(eventId, clarificationId, organiserId, response) {
  const result = await pool.query(`
    WITH target AS (
      SELECT id,name,coordinator_id FROM events WHERE id=$1 AND organiser_id=$3 FOR UPDATE
    ), replied AS (
      UPDATE event_clarification_requests AS question
      SET status='responded', organiser_response=$4, responded_at=now()
      FROM target WHERE question.event_id=target.id AND question.id=$2
        AND question.organiser_id=$3 AND question.status='pending'
      RETURNING question.*
    ), notified AS (
      INSERT INTO notifications (user_id,event_id,type,title,message,details)
      SELECT target.coordinator_id,replied.event_id,'clarification_replied',
        left('Clarification reply received: ' || target.name,255),
        'The Event Organiser replied to a clarification for ' || target.name || E'.\\n' || replied.organiser_response,
        jsonb_build_object('clarificationId',replied.id,'informationNeeded',replied.information_needed)
      FROM replied JOIN target ON target.id=replied.event_id WHERE target.coordinator_id IS NOT NULL
      RETURNING user_id,title,message
    )
    SELECT replied.*,COALESCE((SELECT jsonb_agg(jsonb_build_object('email',recipient.email,'title',notified.title,'message',notified.message))
      FROM notified JOIN users recipient ON recipient.id=notified.user_id),'[]'::jsonb) AS delivery_records
    FROM replied`, [eventId, clarificationId, organiserId, response]);
  if (!result.rows[0]) return null;
  // Delivery metadata stays server-side; SMTP runs only after this atomic database statement succeeds.
  const { delivery_records: stored = [], ...clarificationRequest } = result.rows[0];
  return { clarificationRequest, stored };
}

module.exports = {
  create,
  updateEditable,
  updateEquipment,
  createAmendmentRequest,
  listAmendmentRequests,
  AMENDMENT_CLOSED_STATUSES,
  applyChanges,
  loadArrangements,
  userIdsWithRole,
  listPendingChangeRequests,
  listPendingEquipmentRequests,
  createEquipmentReview,
  listEquipmentInventory,
  markEquipmentAvailable,
  listEquipmentReservationCandidates,
  listActiveEquipmentReservations,
  releaseEquipmentReservation,
  getEquipmentReservationAvailability,
  createEquipmentReservation,
  createClarificationRequest,
  recordOfflineClarification,
  findCoordinatorClarification,
  resolveClarification,
  respondToClarification,
  findAccessibleById,
  listForOrganiser,
  listForCoordinator
};
