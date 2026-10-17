// File: Locks, updates, and reads recipients for cancellation of a published event.

/** Loads an event under the caller's owner or assigned-coordinator scope and holds the row lock through cancellation. */
async function loadCancellationContext(db, eventId, { organiserId, coordinatorId }) {
  const scopeColumn = organiserId !== undefined ? 'organiser_id' : 'coordinator_id';
  const scopeId = organiserId !== undefined ? organiserId : coordinatorId;
  const result = await db.query(`
    SELECT e.id, e.name, e.status, e.is_draft, e.registration_required, e.organiser_id, e.coordinator_id
    FROM events e WHERE e.id=$1 AND e.${scopeColumn}=$2 FOR UPDATE OF e`, [eventId, scopeId]);
  return result.rows[0] || null;
}

/** Changes only a published event's public status, leaving internal decision details untouched. */
async function recordCancellation(db, eventId) {
  const result = await db.query(`UPDATE events SET status='cancelled', updated_at=now()
    WHERE id=$1 AND status IN ('approved', 'confirmed') AND is_draft=false AND registration_required=true
    RETURNING id, name, status`, [eventId]);
  return result.rows[0] || null;
}

/** Returns active registered and waitlisted attendees; withdrawn registrations do not receive cancellation alerts. */
async function listActiveAttendees(db, eventId) {
  const result = await db.query(`SELECT DISTINCT attendee_id FROM registrations
    WHERE event_id=$1 AND status IN ('registered', 'waitlisted') ORDER BY attendee_id`, [eventId]);
  return result.rows;
}

module.exports = { loadCancellationContext, recordCancellation, listActiveAttendees };
