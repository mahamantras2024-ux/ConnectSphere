// File: Technical Support periodic reminder preferences and the pending-request reminder job (AC4). Mirrors the Venue
// Staff reminder service (venueEventStatus.js): an opt-in flag with a selectable cadence is persisted per member, and a
// scheduler sends a reminder only to opted-in members who currently have pending work, respecting the chosen cadence.
const { insertNotifications } = require('./notificationService');

const DAY_MS = 24 * 60 * 60 * 1000;
// Supported cadences in days: Daily (1), Every 3 days (3), Weekly (7) — identical to the Venue Staff control.
const REMINDER_FREQUENCIES = [1, 3, 7];
// Re-check hourly so an enabled member is reminded soon after their cadence boundary without duplicate notices.
const REMINDER_CHECK_MS = 60 * 60 * 1000;

/**
 * Persists the member's opt-in and cadence. Disabling clears the last-sent timestamp so a later re-enable reminds on
 * the next run rather than waiting out the previous cadence window.
 * @param {{ query: Function }} db pool or transaction client.
 * @param {number} staffUserId the Technical Support member.
 * @param {boolean} dailyPendingReminders opt-in flag.
 * @param {number} [reminderFrequencyDays] one of 1, 3, 7.
 * @returns {Promise<{ dailyPendingReminders: boolean, reminderFrequencyDays: number }>}
 */
async function updateTechSupportReminderPreference(db, staffUserId, dailyPendingReminders, reminderFrequencyDays = 1) {
  // Reject anything outside the agreed contract before touching the database, matching the venue service's 400 rule.
  if (typeof dailyPendingReminders !== 'boolean' || !REMINDER_FREQUENCIES.includes(Number(reminderFrequencyDays))) {
    throw Object.assign(new Error('Choose whether to receive reminders and a frequency of daily, every 3 days, or weekly.'), { status: 400 });
  }
  const frequencyDays = Number(reminderFrequencyDays);
  const result = await db.query(`INSERT INTO tech_support_notification_preferences (user_id, daily_pending_reminders, reminder_frequency_days)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id) DO UPDATE SET daily_pending_reminders=EXCLUDED.daily_pending_reminders,
      reminder_frequency_days=EXCLUDED.reminder_frequency_days,
      last_pending_reminder_at=CASE WHEN EXCLUDED.daily_pending_reminders THEN tech_support_notification_preferences.last_pending_reminder_at ELSE NULL END
    RETURNING daily_pending_reminders, reminder_frequency_days`, [staffUserId, dailyPendingReminders, frequencyDays]);
  return { dailyPendingReminders: result.rows[0].daily_pending_reminders, reminderFrequencyDays: result.rows[0].reminder_frequency_days };
}

/** Reads the member's preference, creating no row when they have never chosen; defaults to disabled/daily. */
async function getTechSupportReminderPreference(db, staffUserId) {
  const result = await db.query(`SELECT daily_pending_reminders, reminder_frequency_days
    FROM tech_support_notification_preferences WHERE user_id=$1`, [staffUserId]);
  return { dailyPendingReminders: result.rows[0]?.daily_pending_reminders || false, reminderFrequencyDays: result.rows[0]?.reminder_frequency_days || 1 };
}

/** A reminder is due on the first enabled run and at or after the selected elapsed-day cadence (boundary counts as due). */
function isReminderDue(lastSentAt, reminderFrequencyDays = 1, now = Date.now()) {
  return !lastSentAt || now - Date.parse(lastSentAt) >= DAY_MS * reminderFrequencyDays;
}

/**
 * Sends due reminders to opted-in members who currently have pending work: pending equipment requests awaiting review
 * (a shared Technical Support queue) plus open equipment reservation issues on events the member is assigned to on-site.
 * Records the send time so restarts and hourly re-checks never double-send within a cadence window.
 * @param {{ query: Function }} db pool or transaction client.
 * @param {number} [now] current time in ms (injectable for tests).
 * @returns {Promise<object[]>} stored notification rows (empty when none are due).
 */
async function sendPendingTechSupportReminders(db, now = Date.now()) {
  const result = await db.query(`
    WITH pending_requests AS (
      -- Count of equipment requests still awaiting Technical Support review (the shared pending queue). This mirrors
      -- listPendingEquipmentRequests: upcoming, non-terminal events with a technical requirement and no current-version review.
      SELECT count(*)::int AS pending_count
      FROM events e
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
    )
    SELECT preference.user_id, preference.last_pending_reminder_at, preference.reminder_frequency_days,
      (SELECT pending_count FROM pending_requests)
        + count(DISTINCT issue.id)::int AS pending_count
    FROM tech_support_notification_preferences preference
    -- The member's own open reservation issues: issues on events they provide on-site support for.
    LEFT JOIN event_technical_support_assignments assignment ON assignment.staff_id=preference.user_id
    LEFT JOIN event_equipment_reservations reservation ON reservation.event_id=assignment.event_id
    LEFT JOIN equipment_reservation_unavailability issue
      ON issue.reservation_id=reservation.id AND issue.status='open'
    WHERE preference.daily_pending_reminders=true
    GROUP BY preference.user_id, preference.last_pending_reminder_at, preference.reminder_frequency_days`);
  // Respect the cadence in JS so the SQL stays a plain aggregate; only remind members who actually have pending work.
  const due = result.rows.filter(row => row.pending_count > 0 && isReminderDue(row.last_pending_reminder_at, row.reminder_frequency_days || 1, now));
  if (!due.length) return [];
  const notes = due.map(row => ({ userId: row.user_id, eventId: null, changeRequestId: null,
    type: 'pending_tech_support_request_reminder', title: 'Pending technical support and equipment requests',
    message: `You have ${row.pending_count} pending technical support and equipment request${row.pending_count === 1 ? '' : 's'} requiring attention.`,
    details: { kind: 'pending_tech_support_request_reminder', pendingCount: row.pending_count } }));
  const stored = await insertNotifications(db, notes);
  await db.query(`UPDATE tech_support_notification_preferences SET last_pending_reminder_at=to_timestamp($2 / 1000.0)
    WHERE user_id = ANY($1::int[])`, [due.map(row => row.user_id), now]);
  return stored;
}

/** Runs the reminder job immediately and then hourly; errors are logged, never thrown, so the API stays up. */
function startTechSupportReminderScheduler(db) {
  const run = () => sendPendingTechSupportReminders(db).catch(error => console.error(`Tech support reminder job failed: ${error.message}`));
  run();
  return setInterval(run, REMINDER_CHECK_MS);
}

module.exports = { updateTechSupportReminderPreference, getTechSupportReminderPreference, isReminderDue,
  sendPendingTechSupportReminders, startTechSupportReminderScheduler };
