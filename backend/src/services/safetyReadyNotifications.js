// Safety recovery AC1–AC3: recover missing notices once per officer and current safety-review cycle.

/**
 * Stores only missing readiness notices for explicitly selected Safety Officers. Existing legacy notices count for
 * the current cycle; the partial unique index also prevents concurrent new inserts from creating duplicates.
 * Callers first apply evaluateSafetyReview to the current context; this persists an eligible queue entry.
 * Returns only newly inserted delivery records, so refreshes never resend emails or reset read state.
 */
async function storeSafetyReadyNotifications(db, context, userIds) {
  if (!userIds.length) return [];
  const check = context.latest_safety_check;
  const checkedAt = check?.checked_at || null;
  // A persisted check ID distinguishes review cycles even if two checks share a timestamp.
  const reviewCycle = check?.id != null ? `check:${check.id}` : checkedAt ? new Date(checkedAt).toISOString() : 'initial';
  const reassessment = ['rejected', 'changes_requested'].includes(check?.outcome);
  const title = (reassessment ? `Ready for safety re-review: ${context.name}` : `Ready for safety check: ${context.name}`).slice(0,255);
  const message = reassessment
    ? `${context.name} has completed the requested arrangement revisions and is ready for operational safety re-review.`
    : `${context.name} has confirmed venue and technical arrangements and is ready for its operational safety check.`;
  const details = JSON.stringify({ eventId: context.id, requirement: reassessment ? 'reassessment' : 'initial', reviewCycle });
  const result = await db.query(`WITH inserted AS (
    INSERT INTO notifications (user_id,event_id,change_request_id,type,title,message,details)
    SELECT note.user_id,note.event_id,note.change_request_id,note.type,note.title,note.message,note.details::jsonb
    FROM unnest($1::int[],$2::int[],$3::int[],$4::text[],$5::text[],$6::text[],$7::text[])
      AS note(user_id,event_id,change_request_id,type,title,message,details)
    WHERE EXISTS (SELECT 1 FROM users recipient WHERE recipient.id=note.user_id
      AND (recipient.role='safety_officer' OR COALESCE(to_jsonb(recipient)->'roles','[]'::jsonb) ? 'safety_officer'))
      AND NOT EXISTS (SELECT 1 FROM notifications previous
        WHERE previous.user_id=note.user_id AND previous.event_id=note.event_id AND previous.type='safety_check_ready'
          AND (previous.details->>'reviewCycle'=note.details::jsonb->>'reviewCycle'
            OR (NOT (previous.details ? 'reviewCycle') AND ($8::timestamptz IS NULL OR previous.created_at >= $8::timestamptz))))
    ON CONFLICT DO NOTHING
    RETURNING id,user_id,title,message
  ) SELECT inserted.*,users.email FROM inserted JOIN users ON users.id=inserted.user_id`,
  [userIds,userIds.map(()=>context.id),userIds.map(()=>null),userIds.map(()=>'safety_check_ready'),
    userIds.map(()=>title),userIds.map(()=>message),userIds.map(()=>details),checkedAt]);
  return result.rows;
}

module.exports = { storeSafetyReadyNotifications };
