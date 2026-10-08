// File: Stores organiser event requests and reads event lists/details with owner or coordinator scoping.
const pool = require('../config/db');
const { pool: databasePool } = require('../config/db');
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

// Replaces an owned event's equipment requirements before confirmation and advances its reviewable version.
// The confirmation check lives in the UPDATE so a confirmation committed mid-edit cannot be overwritten.
async function updateEquipment(id, organiserId, data) {
  const result = await pool.query(`
    UPDATE events SET equipment_items=$3::jsonb, technical_support_required=$4, technical_support_details=$5,
      video_conferencing_required=$6, technical_specifications=$7,
      equipment_requirements_version=equipment_requirements_version+1, updated_at=now()
    WHERE id=$1 AND organiser_id=$2 AND equipment_confirmed_at IS NULL
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
async function listEquipmentInventory() {
  const result = await pool.query(`
    SELECT stock.id, stock.asset_code, stock.name, stock.specification, stock.status, stock.quantity,
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
    LEFT JOIN technical_equipment_availability availability ON availability.inventory_id=stock.id
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
 * Lists reviewed requests with equipment that still needs to be reserved.
 */
async function listEquipmentReservationCandidates() {
  const result = await pool.query(`
    SELECT e.id, e.name, e.proposed_date::text AS proposed_date,
      e.proposed_start_time, e.proposed_end_time, e.equipment_items,
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
  const combinedRequests = new Map();
  for (const entry of [...requestedItems, ...additionalItems]) {
    const key = String(entry.item).trim().toLowerCase();
    const existing = combinedRequests.get(key);
    combinedRequests.set(key, {
      item: existing?.item || entry.item,
      quantity: (existing?.quantity || 0) + entry.quantity,
    });
  }
  const distinctRequestedItems = [...combinedRequests.values()];
  const names = distinctRequestedItems.map(entry => String(entry.item).trim().toLowerCase());
  const inventory = names.length ? (await pool.query(`
    SELECT stock.id, stock.asset_code, stock.name, stock.specification, stock.status, stock.quantity,
      GREATEST(stock.quantity - COALESCE(booked.quantity, 0), 0)::integer AS available_quantity,
      availability.available_date::text AS available_date,
      availability.start_time::text AS available_start_time,
      availability.end_time::text AS available_end_time
    FROM equipments stock
    JOIN technical_equipment_availability availability ON availability.inventory_id=stock.id
    LEFT JOIN LATERAL (
      SELECT sum(reserved_item.quantity)::integer AS quantity
      FROM event_equipment_reservations reservation
      JOIN event_equipment_reservation_items reserved_item ON reserved_item.reservation_id=reservation.id
      WHERE reserved_item.inventory_id=stock.id AND reservation.status='reserved'
        AND reservation.event_date=$2::date
        AND reservation.start_time < $4::time AND reservation.end_time > $3::time
    ) booked ON true
    WHERE stock.status='operational' AND lower(trim(stock.name))=ANY($1::text[])
      AND availability.available_date=$2::date
      AND availability.start_time <= $3::time AND availability.end_time >= $4::time
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
      const matches = byName.get(String(requested.item).trim().toLowerCase()) || [];
      return {
        item: requested.item,
        requestedQuantity: requested.quantity,
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
    const requestedByName = new Map();
    const requiredByName = new Map();
    for (const item of requestItems) {
      const name = item.item.trim().toLowerCase();
      requestedByName.set(name, (requestedByName.get(name) || 0) + item.quantity);
      requiredByName.set(name, (requiredByName.get(name) || 0) + item.quantity);
    }
    for (const item of additionalItems) {
      const name = item.item.trim().toLowerCase();
      requestedByName.set(name, (requestedByName.get(name) || 0) + item.quantity);
    }
    const ids = selections.map(selection => selection.inventoryId).sort((a, b) => a - b);
    const inventory = ids.length ? (await client.query(`
      SELECT id, name, asset_code, specification, quantity
      FROM equipments
      WHERE id=ANY($1::integer[]) AND status='operational'
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
        requestItems.some(item =>
          (selectedCounts.get(item.item.trim().toLowerCase()) || 0) < requiredByName.get(item.item.trim().toLowerCase()))) {
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
      JOIN technical_equipment_availability availability ON availability.inventory_id=stock.id
      LEFT JOIN LATERAL (
        SELECT sum(reserved_item.quantity)::integer AS quantity
        FROM event_equipment_reservations reservation
        JOIN event_equipment_reservation_items reserved_item ON reserved_item.reservation_id=reservation.id
        WHERE reserved_item.inventory_id=stock.id AND reservation.status='reserved'
          AND reservation.event_date=$2::date
          AND reservation.start_time < $4::time AND reservation.end_time > $3::time
      ) booked ON true
      WHERE stock.id=ANY($1::integer[]) AND stock.status='operational'
        AND availability.available_date=$2::date
        AND availability.start_time <= $3::time AND availability.end_time >= $4::time
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
      ON CONFLICT (event_id, request_version) DO NOTHING
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
async function listEquipmentInventory() {
  const result = await pool.query(`
    SELECT stock.id, stock.asset_code, stock.name, stock.specification, stock.status, stock.quantity,
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
    LEFT JOIN technical_equipment_availability availability ON availability.inventory_id=stock.id
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
 * Lists reviewed requests with equipment that still needs to be reserved.
 */
async function listEquipmentReservationCandidates() {
  const result = await pool.query(`
    SELECT e.id, e.name, e.proposed_date::text AS proposed_date,
      e.proposed_start_time, e.proposed_end_time, e.equipment_items,
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
  const combinedRequests = new Map();
  for (const entry of [...requestedItems, ...additionalItems]) {
    const key = String(entry.item).trim().toLowerCase();
    const existing = combinedRequests.get(key);
    combinedRequests.set(key, {
      item: existing?.item || entry.item,
      quantity: (existing?.quantity || 0) + entry.quantity,
    });
  }
  const distinctRequestedItems = [...combinedRequests.values()];
  const names = distinctRequestedItems.map(entry => String(entry.item).trim().toLowerCase());
  const inventory = names.length ? (await pool.query(`
    SELECT stock.id, stock.asset_code, stock.name, stock.specification, stock.status, stock.quantity,
      GREATEST(stock.quantity - COALESCE(booked.quantity, 0), 0)::integer AS available_quantity,
      availability.available_date::text AS available_date,
      availability.start_time::text AS available_start_time,
      availability.end_time::text AS available_end_time
    FROM equipments stock
    JOIN technical_equipment_availability availability ON availability.inventory_id=stock.id
    LEFT JOIN LATERAL (
      SELECT sum(reserved_item.quantity)::integer AS quantity
      FROM event_equipment_reservations reservation
      JOIN event_equipment_reservation_items reserved_item ON reserved_item.reservation_id=reservation.id
      WHERE reserved_item.inventory_id=stock.id AND reservation.status='reserved'
        AND reservation.event_date=$2::date
        AND reservation.start_time < $4::time AND reservation.end_time > $3::time
    ) booked ON true
    WHERE stock.status='operational' AND lower(trim(stock.name))=ANY($1::text[])
      AND availability.available_date=$2::date
      AND availability.start_time <= $3::time AND availability.end_time >= $4::time
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
      const matches = byName.get(String(requested.item).trim().toLowerCase()) || [];
      return {
        item: requested.item,
        requestedQuantity: requested.quantity,
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
    const requestedByName = new Map();
    const requiredByName = new Map();
    for (const item of requestItems) {
      const name = item.item.trim().toLowerCase();
      requestedByName.set(name, (requestedByName.get(name) || 0) + item.quantity);
      requiredByName.set(name, (requiredByName.get(name) || 0) + item.quantity);
    }
    for (const item of additionalItems) {
      const name = item.item.trim().toLowerCase();
      requestedByName.set(name, (requestedByName.get(name) || 0) + item.quantity);
    }
    const ids = selections.map(selection => selection.inventoryId).sort((a, b) => a - b);
    const inventory = ids.length ? (await client.query(`
      SELECT id, name, asset_code, specification, quantity
      FROM equipments
      WHERE id=ANY($1::integer[]) AND status='operational'
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
        requestItems.some(item =>
          (selectedCounts.get(item.item.trim().toLowerCase()) || 0) < requiredByName.get(item.item.trim().toLowerCase()))) {
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
      JOIN technical_equipment_availability availability ON availability.inventory_id=stock.id
      LEFT JOIN LATERAL (
        SELECT sum(reserved_item.quantity)::integer AS quantity
        FROM event_equipment_reservations reservation
        JOIN event_equipment_reservation_items reserved_item ON reserved_item.reservation_id=reservation.id
        WHERE reserved_item.inventory_id=stock.id AND reservation.status='reserved'
          AND reservation.event_date=$2::date
          AND reservation.start_time < $4::time AND reservation.end_time > $3::time
      ) booked ON true
      WHERE stock.id=ANY($1::integer[]) AND stock.status='operational'
        AND availability.available_date=$2::date
        AND availability.start_time <= $3::time AND availability.end_time >= $4::time
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
      ON CONFLICT (event_id, request_version) DO NOTHING
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
  listPendingEquipmentRequests,
  createEquipmentReview,
  listEquipmentInventory,
  listEquipmentReservationCandidates,
  listActiveEquipmentReservations,
  getEquipmentReservationAvailability,
  createEquipmentReservation,
  createClarificationRequest,
  respondToClarification,
  findAccessibleById,
  listForOrganiser,
  listForCoordinator
};
