// File: Provides the least-privilege Venue Staff event-status view and its venue-arrangement notifications.
const { insertNotifications } = require('./notificationService');

const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_CHECK_MS = 60 * 60 * 1000;
const REMINDER_FREQUENCIES = [1, 3, 7];

/** Restricts the venue dashboard to the four persisted booking-decision statuses. */
function staffStatus(status) {
  return ['pending', 'approved', 'rejected', 'cancelled'].includes(status) ? status : 'pending';
}

/** Reads only preparation details for events linked to a venue assigned to this Venue Staff member. */
async function listRelevantVenueEvents(db, staffUserId) {
  const result = await db.query(`SELECT booking.id AS booking_id, event.id AS event_id, event.name AS event_name,
      booking.status AS booking_status, venue.name AS venue_name, booking.start_datetime, booking.end_datetime,
      COALESCE(booking.requirements->>'capacity', event.expected_attendance::text)::integer AS expected_attendance,
      COALESCE(NULLIF(booking.requirements->>'layout', ''), event.room_layout_preference) AS room_layout,
      COALESCE(booking.requirements->'accessibility', event.accessibility_requirements, '[]'::jsonb) AS accessibility
    FROM venue_staff_assignments assignment
    JOIN venue_bookings booking ON booking.venue_id=assignment.venue_id
    JOIN events event ON event.id=booking.event_id
    JOIN venues venue ON venue.id=booking.venue_id
    WHERE assignment.staff_user_id=$1
    ORDER BY booking.updated_at DESC, booking.id DESC`, [staffUserId]);
  // Build a deliberate allow-list so later event columns cannot leak into the staff preparation workspace.
  return result.rows.map(row => ({ bookingId: row.booking_id, eventId: row.event_id, name: row.event_name,
    status: staffStatus(row.booking_status), venueName: row.venue_name, startDatetime: row.start_datetime,
    endDatetime: row.end_datetime, expectedAttendance: row.expected_attendance, roomLayout: row.room_layout,
    accessibility: row.accessibility || [] }));
}

/** Saves an explicit opt-in and cadence; invalid cadence input is rejected instead of silently changing behavior. */
async function updateVenueReminderPreference(db, staffUserId, dailyPendingReminders, reminderFrequencyDays = 1) {
  if (typeof dailyPendingReminders !== 'boolean' || !REMINDER_FREQUENCIES.includes(Number(reminderFrequencyDays))) {
    throw Object.assign(new Error('Choose whether to receive reminders and a frequency of daily, every 3 days, or weekly.'), { status: 400 });
  }
  const frequencyDays = Number(reminderFrequencyDays);
  const result = await db.query(`INSERT INTO venue_notification_preferences (user_id, daily_pending_reminders, reminder_frequency_days)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id) DO UPDATE SET daily_pending_reminders=EXCLUDED.daily_pending_reminders,
      reminder_frequency_days=EXCLUDED.reminder_frequency_days,
      last_pending_reminder_at=CASE WHEN EXCLUDED.daily_pending_reminders THEN venue_notification_preferences.last_pending_reminder_at ELSE NULL END
    RETURNING daily_pending_reminders, reminder_frequency_days`, [staffUserId, dailyPendingReminders, frequencyDays]);
  return { dailyPendingReminders: result.rows[0].daily_pending_reminders, reminderFrequencyDays: result.rows[0].reminder_frequency_days };
}

/** Retrieves the preference, creating no record when the user has never made a choice. */
async function getVenueReminderPreference(db, staffUserId) {
  const result = await db.query(`SELECT daily_pending_reminders, reminder_frequency_days FROM venue_notification_preferences WHERE user_id=$1`, [staffUserId]);
  return { dailyPendingReminders: result.rows[0]?.daily_pending_reminders || false, reminderFrequencyDays: result.rows[0]?.reminder_frequency_days || 1 };
}

/** A reminder is due on its first enabled run and at or after the selected elapsed-day cadence. */
function isReminderDue(lastSentAt, reminderFrequencyDays = 1, now = Date.now()) {
  return !lastSentAt || now - Date.parse(lastSentAt) >= DAY_MS * reminderFrequencyDays;
}

/** Preserves the original daily helper for callers and tests that use the default cadence. */
function isDailyReminderDue(lastSentAt, now = Date.now()) {
  return isReminderDue(lastSentAt, 1, now);
}

/** Stores a single status-change notice per staff member assigned to one of the event's booked venues. */
async function notifyVenueStaffOfEventStatus(db, event) {
  const recipients = await db.query(`SELECT DISTINCT assignment.staff_user_id
    FROM venue_staff_assignments assignment JOIN venue_bookings booking ON booking.venue_id=assignment.venue_id
    WHERE booking.event_id=$1 ORDER BY assignment.staff_user_id`, [event.id]);
  if (!recipients.rows.length) return [];
  const status = staffStatus(event.status);
  const cancellation = status === 'cancelled';
  const message = cancellation
    ? `${event.name} has been cancelled and will no longer proceed. Handle its venue reservation according to the cancellation rules.`
    : `${event.name} is now ${status}. Review the latest venue arrangement information before preparing the venue.`;
  return insertNotifications(db, recipients.rows.map(({ staff_user_id: userId }) => ({ userId, eventId: event.id,
    changeRequestId: null, type: 'venue_event_status_changed', title: `Venue event status: ${event.name}`,
    message, details: { kind: 'venue_event_status_changed', status } })));
}

/** Sends due daily reminders only to opted-in staff who currently have pending requests for an assigned venue. */
async function sendDailyPendingVenueReminders(db, now = Date.now()) {
  const result = await db.query(`SELECT preference.user_id, preference.last_pending_reminder_at,
    preference.reminder_frequency_days,
      count(DISTINCT booking.id)::int AS pending_count
    FROM venue_notification_preferences preference
    JOIN venue_staff_assignments assignment ON assignment.staff_user_id=preference.user_id
    JOIN venue_bookings booking ON booking.venue_id=assignment.venue_id AND booking.status='pending'
    WHERE preference.daily_pending_reminders=true
    GROUP BY preference.user_id, preference.last_pending_reminder_at, preference.reminder_frequency_days`);
  const due = result.rows.filter(row => isReminderDue(row.last_pending_reminder_at, row.reminder_frequency_days || 1, now));
  if (!due.length) return [];
  const notes = due.map(row => ({ userId: row.user_id, eventId: null, changeRequestId: null,
    type: 'pending_venue_request_reminder', title: 'Pending venue booking requests',
    message: `You have ${row.pending_count} pending venue booking request${row.pending_count === 1 ? '' : 's'} requiring review.`,
    details: { kind: 'pending_venue_request_reminder', pendingCount: row.pending_count } }));
  const stored = await insertNotifications(db, notes);
  await db.query(`UPDATE venue_notification_preferences SET last_pending_reminder_at=to_timestamp($2 / 1000.0)
    WHERE user_id = ANY($1::int[])`, [due.map(row => row.user_id), now]);
  return stored;
}

/** Checks hourly so an enabled user is notified as soon as practical after the 24-hour boundary without duplicate daily notices. */
function startDailyVenueReminderScheduler(db) {
  const run = () => sendDailyPendingVenueReminders(db).catch(error => console.error(`Venue reminder job failed: ${error.message}`));
  run();
  return setInterval(run, REMINDER_CHECK_MS);
}

module.exports = { listRelevantVenueEvents, updateVenueReminderPreference, getVenueReminderPreference, isDailyReminderDue, isReminderDue,
  notifyVenueStaffOfEventStatus, sendDailyPendingVenueReminders, startDailyVenueReminderScheduler };
