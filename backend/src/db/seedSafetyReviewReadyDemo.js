// File: Seeds an isolated event that is one step away from an Operational Safety Check, so the Safety Officer
// "ready for safety check" notification can be demonstrated by approving a single pending venue booking.
// Opt-in, idempotent, and refused in production; all demo rows share the "ConnectSphere Demo -" name prefix.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');

const DEMO_PREFIX = 'ConnectSphere Demo - ';
// Demo logins. Override the shared password with SAFETY_REVIEW_DEMO_PASSWORD; the emails can be overridden too.
const PASSWORD = process.env.SAFETY_REVIEW_DEMO_PASSWORD;
const ACCOUNTS = {
  safetyOfficer: { email: process.env.SAFETY_REVIEW_DEMO_SAFETY_EMAIL || 'safety-review-demo-officer@example.com',
    fullName: 'Safety Review Demo Officer', role: 'safety_officer' },
  coordinator: { email: process.env.SAFETY_REVIEW_DEMO_COORDINATOR_EMAIL || 'safety-review-demo-coordinator@example.com',
    fullName: 'Safety Review Demo Coordinator', role: 'event_coordinator' },
  venueStaff: { email: process.env.SAFETY_REVIEW_DEMO_VENUE_EMAIL || 'safety-review-demo-venue@example.com',
    fullName: 'Safety Review Demo Venue Staff', role: 'venue_staff' },
  organiser: { email: process.env.SAFETY_REVIEW_DEMO_ORGANISER_EMAIL || 'safety-review-demo-organiser@example.com',
    fullName: 'Safety Review Demo Organiser', role: 'event_organiser' },
};

/** Upserts one demo account with a real (hashed) password so it can sign in, keeping its single internal role. */
async function upsertAccount(client, { email, fullName, role }, passwordHash) {
  const result = await client.query(`
    INSERT INTO users (email, full_name, password_hash, role, roles, organisation_name)
    VALUES ($1, $2, $3, $4::text, ARRAY[$4::text], 'ConnectSphere Demonstration')
    ON CONFLICT (email) DO UPDATE SET full_name=EXCLUDED.full_name, password_hash=$3,
      role=EXCLUDED.role, roles=EXCLUDED.roles, organisation_name=EXCLUDED.organisation_name
    RETURNING id`, [email.trim().toLowerCase(), fullName, passwordHash, role]);
  return result.rows[0].id;
}

/**
 * Stages a submitted, coordinator-assigned event with no technical needs and a single still-pending venue booking,
 * so every safety-review requirement is met except a confirmed venue. Approving that booking as the demo Venue
 * Staff flips the event from not-ready to ready and notifies every Safety Officer (type 'safety_check_ready').
 */
async function seedSafetyReviewReadyDemo() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Safety-review demo data cannot be seeded in production.');
  }
  if (!PASSWORD || PASSWORD.length < 8) {
    throw new Error('Set SAFETY_REVIEW_DEMO_PASSWORD to a password of at least 8 characters.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const ids = {};
    for (const [key, account] of Object.entries(ACCOUNTS)) ids[key] = await upsertAccount(client, account, passwordHash);

    // An active venue the demo Venue Staff is assigned to, so the staff decision screen lists this booking.
    const venueName = `${DEMO_PREFIX}Safety Review Hall`;
    const existingVenue = await client.query('SELECT id FROM venues WHERE name=$1', [venueName]);
    const venueId = existingVenue.rows[0]
      ? existingVenue.rows[0].id
      : (await client.query(`
          INSERT INTO venues (name, location, capacity, pricing, operating_hours, is_active)
          VALUES ($1, '10 Demo Avenue, Singapore', 150, '$250/hr', '08:00 - 22:00', true)
          RETURNING id`, [venueName])).rows[0].id;
    await client.query(`
      INSERT INTO venue_staff_assignments (venue_id, staff_user_id) VALUES ($1, $2)
      ON CONFLICT (venue_id, staff_user_id) DO NOTHING`, [venueId, ids.venueStaff]);

    // The event: submitted, assigned to the demo coordinator, no equipment/technical needs (so technical arrangements
    // are auto-confirmed), no clarifications and no prior safety check. The only unmet requirement is the venue.
    const eventName = `${DEMO_PREFIX}Ready-for-Safety-Check Event`;
    const existingEvent = await client.query('SELECT id FROM events WHERE name=$1 AND organiser_id=$2', [eventName, ids.organiser]);
    const eventId = existingEvent.rows[0]
      ? existingEvent.rows[0].id
      : (await client.query(`
          INSERT INTO events (organiser_id, coordinator_id, name, purpose, event_type, proposed_date,
            proposed_start_time, proposed_end_time, expected_attendance, room_layout_preference,
            accessibility_requirements, equipment_items, technical_support_required, video_conferencing_required,
            registration_required, is_draft, status)
          VALUES ($1, $2, $3, 'Demonstrate the Safety Officer readiness notification', 'workshop',
            CURRENT_DATE + 30, '09:00', '12:00', 60, 'Theatre', '["Ramp access"]'::jsonb,
            '[]'::jsonb, false, false, false, false, 'submitted')
          RETURNING id`, [ids.organiser, ids.coordinator, eventName])).rows[0].id;
    // Re-assert the one-step-away state even if the event already existed (so re-running restores a clean demo).
    await client.query(`
      UPDATE events SET coordinator_id=$2, status='submitted', is_draft=false,
        equipment_items='[]'::jsonb, technical_support_required=false, technical_support_details=NULL,
        video_conferencing_required=false, technical_specifications=NULL, equipment_notes=NULL,
        equipment_confirmed_at=NULL, safety_changes_open='{}', decision_reason=NULL, decided_by=NULL, decided_at=NULL,
        updated_at=now()
      WHERE id=$1`, [eventId, ids.coordinator]);
    // Clear any prior safety check and bookings so the event is genuinely due its first check with no live venue yet.
    await client.query('DELETE FROM event_safety_checks WHERE event_id=$1', [eventId]);
    await client.query('DELETE FROM venue_bookings WHERE event_id=$1', [eventId]);

    // One pending booking with a far-future hold, so it is a live-but-undecided arrangement: the venue is NOT yet
    // confirmed (VENUE_NOT_CONFIRMED), which is the single step that keeps the event out of the safety queue.
    await client.query(`
      INSERT INTO venue_bookings (event_id, venue_id, requested_by, start_datetime, end_datetime, status,
        hold_expires_at, requirements, cancel_other_pending)
      VALUES ($1, $2, $3, (CURRENT_DATE + 30 + time '09:00') AT TIME ZONE 'Asia/Singapore',
        (CURRENT_DATE + 30 + time '12:00') AT TIME ZONE 'Asia/Singapore', 'pending',
        now() + interval '30 days',
        '{"capacity":60,"layout":"Theatre","accessibility":["Ramp access"],"requiredFacilities":[]}'::jsonb, false)`,
      [eventId, venueId, ids.coordinator]);

    await client.query('COMMIT');
    return { eventId, venueId, accounts: Object.fromEntries(Object.entries(ACCOUNTS).map(([k, a]) => [k, a.email])) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  seedSafetyReviewReadyDemo()
    .then((result) => {
      console.log('Safety-review-ready demo data is ready.');
      console.log(`  Event #${result.eventId} "${DEMO_PREFIX}Ready-for-Safety-Check Event" has one pending venue booking at venue #${result.venueId}.`);
      console.log('  Sign in as the Venue Staff account and approve that booking to notify the Safety Officer:');
      for (const [role, email] of Object.entries(result.accounts)) console.log(`    ${role}: ${email}`);
    })
    .catch((error) => {
      console.error(`Unable to seed safety-review-ready demo data: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { seedSafetyReviewReadyDemo };
