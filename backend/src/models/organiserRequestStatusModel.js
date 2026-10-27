// SCRUM-93: organisation sharing applies to status reads only, never to editing or private event details.
const db = require('../config/db');

// Fixed SQL shared by the list and status detail; blank organisation labels never confer access.
const ORGANISATION_STATUS_SCOPE = `EXISTS (
  SELECT 1 FROM users request_owner JOIN users viewer ON viewer.id=$1
  WHERE request_owner.id=e.organiser_id
    AND NULLIF(lower(btrim(viewer.organisation_name)), '') IS NOT NULL
    AND viewer.organisation_name ~ '[^[:space:]]'
    AND lower(btrim(request_owner.organisation_name))=lower(btrim(viewer.organisation_name))
)`;

/** Loads the minimum status/action/decision facts for an owner or same-organisation organiser, else null. */
async function findRequestStatus(organiserId, eventId) {
  const result = await db.query(`
    SELECT e.id, e.name, e.status, e.organiser_id, e.updated_at, e.decision_reason, e.decided_at,
      (e.organiser_id=$1) AS can_manage,
      -- Only the submitter receives questions/responses; colleagues need the action flag, not the correspondence.
      CASE WHEN e.organiser_id=$1 THEN COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', cr.id, 'information_needed', cr.information_needed, 'message', cr.message,
        'status', cr.status, 'organiser_response', cr.organiser_response, 'created_at', cr.created_at, 'responded_at', cr.responded_at
      ) ORDER BY cr.created_at DESC, cr.id DESC) FROM event_clarification_requests cr WHERE cr.event_id=e.id), '[]'::jsonb)
      ELSE '[]'::jsonb END AS clarification_requests,
      EXISTS (SELECT 1 FROM event_clarification_requests cr WHERE cr.event_id=e.id AND cr.status='pending') AS clarification_outstanding
    FROM events e
    WHERE (e.organiser_id=$1 OR ${ORGANISATION_STATUS_SCOPE}) AND e.id=$2
  `, [organiserId, eventId]);
  return result.rows[0] || null;
}
module.exports = { ORGANISATION_STATUS_SCOPE, findRequestStatus };
