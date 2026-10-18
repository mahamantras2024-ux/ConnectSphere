const { pool } = require('../config/db');
const { loadEvent, registrationFacts } = require('./attendeeRegistration');
const { capacityFor } = require('./attendeeRegistrationPolicy');
const { withdrawalDeadline, withdrawalBlocker } = require('./attendeeWithdrawalPolicy');
const { insertNotifications } = require('./notificationService');

/** Promotes exactly the first FIFO entry when the withdrawn confirmed place actually leaves available capacity. */
async function promoteNext(client, event, occupied) {
  const capacity = capacityFor(event);
  if (!event.registration_required || capacity === null || occupied >= capacity) return;
  // All registration/withdrawal writers hold the same event lock, so selection cannot race another seat allocation.
  const result = await client.query(`UPDATE registrations SET status='registered'
    WHERE id=(SELECT id FROM registrations WHERE event_id=$1 AND status='waitlisted'
      ORDER BY registered_at, id LIMIT 1 FOR UPDATE) RETURNING id, attendee_id`, [event.id]);
  const promoted = result.rows[0];
  if (!promoted) return;
  // Notification and promotion commit together: a storage outage cannot silently move someone without informing them.
  await insertNotifications(client, [{ userId: promoted.attendee_id, eventId: event.id, changeRequestId: null,
    type: 'waitlist_promoted', title: `Registration confirmed: ${event.name}`,
    message: `A place opened for ${event.name}. You have moved off the waitlist and your registration is now Registered.`,
    details: { registrationId: promoted.id, status: 'registered' } }]);
}

/** Withdraws only the session attendee's record and promotes/notifies one waiting attendee in the same transaction. */
async function withdraw(eventId, attendeeId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const event = await loadEvent(client, eventId, true);
    const facts = event ? await registrationFacts(client, eventId, attendeeId) : null;
    if (!facts?.registration) { await client.query('ROLLBACK'); return { status: 404, message: 'Registration not found.' }; }
    if (facts.registration.status === 'withdrawn') {
      await client.query('COMMIT');
      return { status: 200, registration: facts.registration, message: 'Your registration is already Withdrawn.' };
    }
    const blocker = withdrawalBlocker(event, Date.now());
    if (blocker) { await client.query('ROLLBACK'); return { status: 409, message: blocker, deadline: withdrawalDeadline(event) }; }
    if (!['registered', 'waitlisted'].includes(facts.registration.status)) {
      await client.query('ROLLBACK'); return { status: 409, message: 'This registration cannot be withdrawn.' };
    }
    const result = await client.query(`UPDATE registrations SET status='withdrawn', withdrawn_at=clock_timestamp()
      WHERE event_id=$1 AND attendee_id=$2 RETURNING *`, [eventId, attendeeId]);
    // Leaving a waitlist frees no seat. A confirmed withdrawal may promote after registration closes, until event start.
    if (facts.registration.status === 'registered') {
      const updated = await registrationFacts(client, eventId, attendeeId);
      await promoteNext(client, event, updated.occupied);
    }
    await client.query('COMMIT');
    return { status: 200, registration: result.rows[0], message: 'Your registration is now Withdrawn.' };
  } catch (error) {
    await client.query('ROLLBACK'); throw error;
  } finally { client.release(); }
}

module.exports = { withdraw };
