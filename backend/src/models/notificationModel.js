const { query } = require('../config/db');

// TODO: this is a synchronous "write a row" implementation. Once the team
// decides whether notifications should also go out via email/push, this is
// the seam to add that (e.g. dispatch a job after insert).
async function create({ userId, type, message, relatedEventId }) {
  const { rows } = await query(
    `INSERT INTO notifications (user_id, type, message, related_event_id)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [userId, type, message, relatedEventId || null]
  );
  return rows[0];
}

async function listForUser(userId, { unreadOnly } = {}) {
  if (unreadOnly) {
    const { rows } = await query(
      `SELECT * FROM notifications WHERE user_id = $1 AND is_read = false ORDER BY created_at DESC`,
      [userId]
    );
    return rows;
  }
  const { rows } = await query(
    `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
}

async function markRead(id, userId) {
  const { rows } = await query(
    `UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2 RETURNING *`,
    [id, userId]
  );
  return rows[0];
}

module.exports = { create, listForUser, markRead };
