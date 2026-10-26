// Automatic event completion uses persisted status so all dashboards share the same lifecycle.

/**
 * Completes only published approved/confirmed events strictly after their scheduled end.
 * Event schedule fields are Singapore wall times, matching attendee registration. The single
 * conditional UPDATE is safe across concurrent workers; status-change triggers notify once.
 * Missing schedule fields cannot establish that an event is over and are left untouched.
 * The optional current instant allows deterministic boundary tests; normal jobs use the server clock.
 */
async function completePastEvents(db, now = new Date()) {
  const result = await db.query(`UPDATE events SET status='completed', updated_at=now()
    WHERE is_draft=false AND status IN ('approved', 'confirmed')
      AND (proposed_date + proposed_end_time) AT TIME ZONE 'Asia/Singapore' < $1::timestamptz
    RETURNING id`, [now]);
  return result.rows;
}

/** Checks at startup and each minute; a failed check is logged and retried on the next tick. */
function startEventCompletionScheduler(db) {
  const run = () => completePastEvents(db).catch(error => console.error(`Event completion job failed: ${error.message}`));
  run();
  const timer = setInterval(run, 60 * 1000);
  timer.unref();
  return timer;
}

module.exports = { completePastEvents, startEventCompletionScheduler };
