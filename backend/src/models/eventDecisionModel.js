// File: Reads the facts the approve/reject and safety-check rules need, and records decisions and safety checks.

// Builds the shared context query: the event, its bookings, outstanding clarifications and latest safety check.
// `scope` adds a fixed, parameterised condition (never request text); `lock` serialises concurrent decisions on the event.
function contextSql(scope, lock) {
  return `
    SELECT e.id, e.name, e.organiser_id, e.coordinator_id, e.status, e.is_draft, e.equipment_items,
      e.technical_support_required, e.video_conferencing_required, e.equipment_notes, e.equipment_confirmed_at,
      e.decision_reason, e.decided_at, decider.full_name AS decided_by_name, e.safety_changes_open, e.safety_recheck_required_at,
      e.proposed_date::text AS proposed_date, e.proposed_end_time::text AS proposed_end_time,
      (SELECT count(*)::int FROM event_clarification_requests cr WHERE cr.event_id = e.id AND cr.status = 'pending') AS pending_clarifications,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('status', vb.status, 'hold_expires_at', vb.hold_expires_at,
          'recheck_required_at', vb.recheck_required_at) ORDER BY vb.id)
        FROM venue_bookings vb WHERE vb.event_id = e.id), '[]'::jsonb) AS bookings,
      (SELECT jsonb_build_object('outcome', s.outcome, 'notes', s.notes, 'checked_at', s.checked_at, 'safety_officer_name', officer.full_name,
          'change_areas', s.change_areas)
        FROM event_safety_checks s JOIN users officer ON officer.id = s.safety_officer_id
        WHERE s.event_id = e.id ORDER BY s.checked_at DESC, s.id DESC LIMIT 1) AS latest_safety_check
    FROM events e
    LEFT JOIN users decider ON decider.id = e.decided_by
    WHERE e.id = $1${scope}${lock ? ' FOR UPDATE OF e' : ''}`;
}

/**
 * Loads one event's decision context, or null when it does not exist (or is not assigned to `coordinatorId`).
 * @param {{ query: Function }} db pool or transaction client.
 * @param {number|string} eventId event id (already validated).
 * @param {{ coordinatorId?: number, lock?: boolean }} options restrict to the assigned coordinator and/or lock the row.
 */
async function loadDecisionContext(db, eventId, { coordinatorId, lock = false } = {}) {
  const scoped = coordinatorId !== undefined;
  const result = await db.query(contextSql(scoped ? ' AND e.coordinator_id = $2' : '', lock), scoped ? [eventId, coordinatorId] : [eventId]);
  return result.rows[0] || null;
}

/** Stores the coordinator's decision on the event itself so the outcome stays with the record (AC4/AC5). */
async function recordDecision(db, eventId, decision, reason, coordinatorId) {
  const result = await db.query(`
    UPDATE events SET status = $2, decision_reason = $3, decided_by = $4, decided_at = now(), updated_at = now()
    WHERE id = $1 RETURNING id, name, status, organiser_id, decision_reason, decided_at`, [eventId, decision, reason, coordinatorId]);
  return result.rows[0];
}

/**
 * Appends a Safety Officer review; the newest row becomes the event's current safety outcome.
 * `changeAreas` names the planning stages a change request reopens (empty for approve/reject).
 */
async function insertSafetyCheck(db, eventId, safetyOfficerId, outcome, notes, changeAreas = []) {
  const result = await db.query(`
    INSERT INTO event_safety_checks (event_id, safety_officer_id, outcome, notes, change_areas) VALUES ($1, $2, $3, $4, $5)
    RETURNING id, event_id, outcome, notes, change_areas, checked_at`, [eventId, safetyOfficerId, outcome, notes, changeAreas]);
  return result.rows[0];
}

/**
 * Sends the event back to the planning stages the Safety Officer named (Operational Feasibility Check AC3).
 * Reopening technical arrangements clears their confirmation and starts a new request version, so Technical Support's
 * existing queue lists the event again and the organiser may edit the equipment before it is re-confirmed.
 */
async function reopenStages(db, eventId, areas) {
  await db.query(`
    UPDATE events SET safety_changes_open = $2,
      equipment_confirmed_at = CASE WHEN 'technical' = ANY($2::text[]) THEN NULL ELSE equipment_confirmed_at END,
      equipment_requirements_version = equipment_requirements_version + CASE WHEN 'technical' = ANY($2::text[]) THEN 1 ELSE 0 END,
      updated_at = now()
    WHERE id = $1`, [eventId, areas]);
}

/** Marks one reopened stage complete and returns the stages still open (AC4: the re-check waits for all of them). */
async function resolveStage(db, eventId, area) {
  const result = await db.query(`
    UPDATE events SET safety_changes_open = array_remove(safety_changes_open, $2), updated_at = now()
    WHERE id = $1 RETURNING safety_changes_open`, [eventId, area]);
  return result.rows[0].safety_changes_open;
}

/**
 * Lists submitted events that have a confirmed venue, with the facts a Safety Officer reviews (Operational Feasibility
 * Check AC1: attendance, each venue's capacity, layouts, emergency access and known restrictions, accessibility,
 * equipment and the timings that shape crowd movement) and the latest check. Callers apply the
 * remaining readiness rules from eventDecisionPolicy so the queue and the API gate never disagree.
 */
async function safetyCandidates(db) {
  const result = await db.query(`
    SELECT e.id, e.name, e.status, e.is_draft, e.proposed_date::text AS proposed_date, e.proposed_start_time, e.proposed_end_time,
      e.expected_attendance, e.room_layout_preference, e.accessibility_requirements, e.equipment_items,
      e.technical_support_required, e.video_conferencing_required, e.equipment_notes, e.equipment_confirmed_at,
      e.technical_specifications, e.safety_changes_open, e.safety_recheck_required_at,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('status', vb.status, 'hold_expires_at', vb.hold_expires_at,
          'recheck_required_at', vb.recheck_required_at) ORDER BY vb.id)
        FROM venue_bookings vb WHERE vb.event_id = e.id), '[]'::jsonb) AS bookings,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('name', v.name, 'capacity', v.capacity, 'supported_layouts', v.supported_layouts,
          'accessibility_features', v.accessibility_features, 'operating_hours', v.operating_hours, 'setup_minutes', v.setup_minutes,
          'turnaround_minutes', v.turnaround_minutes, 'emergency_access', v.emergency_access, 'known_restrictions', v.known_restrictions,
          'emergency_documents', v.emergency_documents) ORDER BY vb.id)
        FROM venue_bookings vb JOIN venues v ON v.id = vb.venue_id WHERE vb.event_id = e.id AND vb.status = 'approved'), '[]'::jsonb) AS venues,
      (SELECT jsonb_build_object('outcome', s.outcome, 'notes', s.notes, 'checked_at', s.checked_at, 'change_areas', s.change_areas)
        FROM event_safety_checks s WHERE s.event_id = e.id ORDER BY s.checked_at DESC, s.id DESC LIMIT 1) AS latest_safety_check
    FROM events e
    WHERE e.is_draft = false AND e.status IN ('submitted', 'under_review', 'approved', 'planning')
      AND EXISTS (SELECT 1 FROM venue_bookings vb WHERE vb.event_id = e.id AND vb.status = 'approved')
    ORDER BY e.proposed_date NULLS LAST, e.id`);
  return result.rows;
}

module.exports = { loadDecisionContext, recordDecision, insertSafetyCheck, reopenStages, resolveStage, safetyCandidates };
