// File: Stores per-user in-app notifications and sends their email copies without letting email failures undo the stored decision.
const emailService = require('./emailService');

/**
 * Inserts one notification row per recipient in a single statement and returns each row with the recipient's email.
 * Every caller notifies at least one person (a decision always notifies the organiser), so `notes` is never empty.
 * @param {{ query: Function }} db pool or transaction client, so callers can keep the insert inside their transaction.
 * @param {{ userId: number, eventId: number, changeRequestId: number|null, type: string, title: string, message: string, details: object }[]} notes
 * @returns {Promise<object[]>} stored rows including `email` for delivery.
 */
async function insertNotifications(db, notes) {
  const result = await db.query(`
    WITH inserted AS (
      INSERT INTO notifications (user_id, event_id, change_request_id, type, title, message, details)
      SELECT user_id, event_id, change_request_id, type, title, message, details::jsonb
      FROM unnest($1::int[], $2::int[], $3::int[], $4::text[], $5::text[], $6::text[], $7::text[])
        AS note(user_id, event_id, change_request_id, type, title, message, details)
      RETURNING id, user_id, title, message)
    SELECT inserted.*, users.email FROM inserted JOIN users ON users.id = inserted.user_id`,
  [notes.map((note) => note.userId), notes.map((note) => note.eventId), notes.map((note) => note.changeRequestId),
    notes.map((note) => note.type), notes.map((note) => note.title), notes.map((note) => note.message),
    notes.map((note) => JSON.stringify(note.details))]);
  return result.rows;
}

/**
 * Emails stored notifications after the surrounding transaction commits. Delivery is best-effort: a missing
 * Gmail configuration or SMTP failure is logged (without addresses or content) and never throws.
 * @returns {Promise<number>} number of emails sent successfully.
 */
async function emailNotifications(rows) {
  const results = await Promise.allSettled(rows.map((row) => emailService.sendNotificationEmail(row.email, row.title, row.message)));
  const failed = results.filter((result) => result.status === 'rejected').length;
  if (failed) console.error(`Notification email delivery failed for ${failed} of ${rows.length} recipients.`);
  return rows.length - failed;
}

/** Lists the signed-in user's 50 most recent notifications and their total unread count. */
async function listForUser(db, userId) {
  const [notifications, unread] = await Promise.all([
    db.query(`SELECT id, event_id, change_request_id, type, title, message, details, created_at, read_at
      FROM notifications WHERE user_id=$1 ORDER BY created_at DESC, id DESC LIMIT 50`, [userId]),
    db.query('SELECT count(*)::int AS unread FROM notifications WHERE user_id=$1 AND read_at IS NULL', [userId]),
  ]);
  return { notifications: notifications.rows, unreadCount: unread.rows[0].unread };
}

/** Marks one of the user's own notifications read; another user's notification matches nothing. */
async function markRead(db, userId, notificationId) {
  const result = await db.query(`UPDATE notifications SET read_at=COALESCE(read_at, now())
    WHERE id=$1 AND user_id=$2 RETURNING id, read_at`, [notificationId, userId]);
  return result.rows[0] || null;
}

module.exports = { insertNotifications, emailNotifications, listForUser, markRead };
