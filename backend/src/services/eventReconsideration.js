// Reconsider AC1–AC4: responsibility-scoped history and an atomic return to review after recorded corrections.
const { pool } = require('../config/db');
const notifications = require('./notificationService');

/** Expected workflow failures are safe to return to the caller. */
function failure(status, message, code) { return Object.assign(new Error(message), { status, code }); }

/** Loads immutable review/correction snapshots in recorded order, with the recorded reviewer name. */
async function historyFor(db, eventId) {
  return (await db.query(`SELECT h.*, u.full_name AS actor_name FROM event_review_history h
    LEFT JOIN users u ON u.id=h.actor_id WHERE h.event_id=$1 ORDER BY h.id`, [eventId])).rows;
}

/** Reopening never approves: require a new applied correction after the most recent rejection and no pending work. */
function blocker(event, history, pending) {
  if (event.status === 'cancelled') return { code: 'CANCELLED_FINAL', message: 'Cancelled events cannot be reconsidered. Submit a new event request.' };
  if (event.is_draft || event.status !== 'rejected') return { code: 'NOT_REJECTED', message: 'Only rejected event requests can be reconsidered.' };
  const rejectionIndex = history.findLastIndex(entry => entry.kind === 'review' && entry.outcome === 'rejected');
  // History identities follow the event lock; transaction-start timestamps can precede a decision made after waiting.
  if (rejectionIndex < 0 || !history.slice(rejectionIndex + 1).some(entry => entry.kind === 'correction'
      && Array.isArray(entry.details.changes) && entry.details.changes.length > 0)) {
    return { code: 'CORRECTION_REQUIRED', message: 'Apply a recorded amendment correcting the rejected request before reconsideration.' };
  }
  if (pending) return { code: 'REVIEW_WORK_PENDING', message: 'Resolve outstanding clarifications and amendment requests before reconsideration.' };
  return null;
}

/** Reads pending work after the event row lock, so the decision uses the current committed review inputs. */
async function pendingWork(db, eventId) {
  return (await db.query(`SELECT EXISTS(SELECT 1 FROM event_clarification_requests WHERE event_id=$1 AND status='pending')
    OR EXISTS(SELECT 1 FROM event_change_requests WHERE event_id=$1 AND status='pending') AS pending`, [eventId])).rows[0].pending;
}

/** Rechecks assignment, rejection version and corrections under one event lock; notification failure rolls everything back. */
async function reconsiderEvent(eventId, coordinatorId, rejectionId) {
  const client = await pool.connect();
  let event, stored;
  try {
    await client.query('BEGIN');
    const current = (await client.query('SELECT * FROM events WHERE id=$1 AND coordinator_id=$2 FOR UPDATE', [eventId, coordinatorId])).rows[0];
    if (!current) throw failure(404, 'Assigned event not found.');
    const history = await historyFor(client, eventId);
    const blocked = blocker(current, history, await pendingWork(client, eventId));
    if (blocked) throw failure(409, blocked.message, blocked.code);
    const rejection = history.filter(entry => entry.kind === 'review' && entry.outcome === 'rejected').at(-1);
    if (rejection.id !== rejectionId) throw failure(409, 'The review has changed. Refresh the event before reconsidering it.', 'STALE_REVIEW');
    // Only current-decision fields are cleared; the database trigger appends the reopening alongside the earlier rejection.
    event = (await client.query(`UPDATE events SET status='under_review',decided_at=NULL,decided_by=NULL,
      decision_reason=NULL,updated_at=now() WHERE id=$1 RETURNING *`, [eventId])).rows[0];
    stored = await notifications.insertNotifications(client, [{ userId: event.organiser_id, eventId, changeRequestId: null,
      type: 'event_details_changed', title: (`Event reconsidered: ${event.name}`).slice(0,255),
      message: `${event.name} has been reopened for review after recorded corrections. The Event Coordinator will review it again; it has not been approved or confirmed.`,
      details: { kind: 'event_reconsidered', rejectionId } }]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
  await notifications.emailNotifications(stored);
  return event;
}

module.exports = { historyFor, blocker, pendingWork, reconsiderEvent };
