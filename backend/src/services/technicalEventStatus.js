// File: Reads current preparation facts only for staff with a recorded responsibility for the event.

/**
 * Fixed SQL aliases/parameter positions are supplied only by server code. All three relationships
 * are explicit responsibilities; a technical-support role alone never grants access to an event.
 */
function responsibilityScope(eventAlias = 'e', staffParameter = '$1') {
  return `(EXISTS (SELECT 1 FROM event_technical_support_assignments a
      WHERE a.event_id=${eventAlias}.id AND a.staff_id=${staffParameter})
    OR EXISTS (SELECT 1 FROM event_equipment_reviews responsibility_review
      WHERE responsibility_review.event_id=${eventAlias}.id AND responsibility_review.reviewed_by=${staffParameter})
    OR EXISTS (SELECT 1 FROM event_equipment_reservations responsibility_reservation
      WHERE responsibility_reservation.event_id=${eventAlias}.id AND responsibility_reservation.reserved_by=${staffParameter}))`;
}

/**
 * Lists or reads an involved staff member's current event facts, including terminal stages.
 * Select preparation fields explicitly: organiser contacts, private clarification messages and
 * unrelated event records are never part of this resource. Pending amendments are not applied facts.
 */
async function listRelevantEvents(db, staffId, eventId) {
  const result = await db.query(`
    SELECT e.id, e.name, e.purpose, e.status, e.proposed_date::text AS proposed_date,
      e.proposed_start_time, e.proposed_end_time, e.expected_attendance, e.updated_at,
      COALESCE(v.name, 'Venue not assigned') AS venue_name, v.location AS venue_location,
      e.equipment_items, e.equipment_notes, e.technical_support_details,
      e.technical_specifications, e.video_conferencing_required,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', allocation.id, 'status', allocation.status)
        ORDER BY allocation.id) FROM event_equipment_reservations allocation
        WHERE allocation.event_id=e.id AND allocation.status='reserved'), '[]'::jsonb) AS reservations
    FROM events e
    LEFT JOIN LATERAL (
      SELECT v.name, v.location FROM venue_bookings vb JOIN venues v ON v.id=vb.venue_id
      WHERE vb.event_id=e.id AND vb.status='approved' ORDER BY vb.id DESC LIMIT 1
    ) v ON true
    WHERE ${responsibilityScope()} AND e.is_draft=false AND e.status NOT IN ('draft', 'rejected')
      ${eventId === undefined ? '' : 'AND e.id=$2'}
    ORDER BY e.proposed_date NULLS LAST, e.proposed_start_time NULLS LAST, e.id`,
  eventId === undefined ? [staffId] : [staffId, eventId]);
  return result.rows;
}

module.exports = { responsibilityScope, listRelevantEvents };
