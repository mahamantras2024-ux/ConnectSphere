// File: Seeds isolated Venue Staff event-status scenarios for demonstrations in non-production databases.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');

const DEMO_PREFIX = 'ConnectSphere Demo - ';
const DEMO_EMAIL = process.env.VENUE_STATUS_DEMO_EMAIL || 'venue-demo@example.com';
const DEMO_PASSWORD = process.env.VENUE_STATUS_DEMO_PASSWORD;

/** Creates repeatable demo records while leaving all non-demo users, venues, events, and bookings untouched. */
async function seedVenueEventStatusDemo() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Venue event-status demo data cannot be seeded in production.');
  }
  if (!DEMO_PASSWORD || DEMO_PASSWORD.length < 8) {
    throw new Error('Set VENUE_STATUS_DEMO_PASSWORD to a password of at least 8 characters.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const userResult = await client.query(`
      INSERT INTO users (email, full_name, password_hash, role, roles, organisation_name)
      VALUES ($1, $2, $3, 'venue_staff', ARRAY['venue_staff'], 'ConnectSphere Demonstration')
      ON CONFLICT (email) DO UPDATE SET full_name=EXCLUDED.full_name, password_hash=$3,
        role='venue_staff', roles=ARRAY['venue_staff'], organisation_name=EXCLUDED.organisation_name
      RETURNING id
    `, [DEMO_EMAIL, 'Venue Status Demonstrator', passwordHash]);
    const staffUserId = userResult.rows[0].id;

    const venueIds = {};
    for (const [key, name, location, capacity] of [
      ['main', `${DEMO_PREFIX}Main Hall`, '1 Demo Avenue, Singapore', 200],
      ['secondary', `${DEMO_PREFIX}Studio`, '2 Demo Avenue, Singapore', 80],
    ]) {
      const existing = await client.query('SELECT id FROM venues WHERE name=$1', [name]);
      const result = existing.rows[0] ? existing : await client.query(`
        INSERT INTO venues (name, location, capacity, pricing, operating_hours, is_active)
        VALUES ($1, $2, $3, '$250/hr', '08:00 - 22:00', true)
        RETURNING id
      `, [name, location, capacity]);
      venueIds[key] = result.rows[0].id;
    }

    await client.query('DELETE FROM venue_staff_assignments WHERE staff_user_id=$1', [staffUserId]);
    await client.query(`
      INSERT INTO venue_staff_assignments (venue_id, staff_user_id)
      VALUES ($1, $3), ($2, $3)
    `, [venueIds.main, venueIds.secondary, staffUserId]);

    const organiserResult = await client.query(`
      INSERT INTO users (email, full_name, password_hash, role, roles, organisation_name)
      VALUES ($1, 'Venue Status Demo Organiser', $2, 'event_organiser', ARRAY['event_organiser'], 'ConnectSphere Demonstration')
      ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash
      RETURNING id
    `, ['venue-status-organiser@example.com', passwordHash]);
    const organiserId = organiserResult.rows[0].id;

    const scenarios = [
      ['Planning', 'planning', 'approved', venueIds.main, '2031-10-20T02:00:00Z', 40, 'Seminar'],
      ['Confirmed', 'confirmed', 'approved', venueIds.main, '2031-10-21T02:00:00Z', 60, 'Theatre'],
      ['Completed', 'completed', 'approved', venueIds.secondary, '2031-10-22T02:00:00Z', 30, 'Boardroom'],
      ['Cancelled', 'cancelled', 'cancelled', venueIds.secondary, '2031-10-23T02:00:00Z', 25, 'Seminar'],
      ['Pending request', 'planning', 'pending', venueIds.main, '2031-10-24T02:00:00Z', 75, 'Classroom'],
    ];
    const eventIds = {};
    for (const [key, status, bookingStatus, venueId, start, attendance, layout] of scenarios) {
      const eventName = `${DEMO_PREFIX}${key} Event`;
      const existing = await client.query('SELECT id FROM events WHERE name=$1 AND organiser_id=$2', [eventName, organiserId]);
      const eventResult = existing.rows[0] ? existing : await client.query(`
        INSERT INTO events (
          organiser_id, name, purpose, event_type, expected_attendance, room_layout_preference,
          accessibility_requirements, registration_required, is_draft, status
        ) VALUES ($1, $2, 'Demonstration scenario', 'workshop', $3, $4, '["Ramp access"]'::jsonb, true, false, $5)
        RETURNING id
      `, [organiserId, eventName, attendance, layout, status]);
      const eventId = eventResult.rows[0].id;
      eventIds[key] = eventId;
      await client.query(`
        UPDATE events SET expected_attendance=$2, room_layout_preference=$3, status=$4, is_draft=false, updated_at=now()
        WHERE id=$1
      `, [eventId, attendance, layout, status]);
      await client.query('DELETE FROM venue_bookings WHERE event_id=$1', [eventId]);
      await client.query(`
        INSERT INTO venue_bookings (
          event_id, venue_id, requested_by, start_datetime, end_datetime, status,
          decision_by, decision_notes, requirements, cancel_other_pending
        ) VALUES ($1, $2, $3, $4, $4::timestamptz + interval '1 hour', $5, $3, 'Demo scenario',
          $6::jsonb, false)
      `, [eventId, venueId, organiserId, start, bookingStatus,
        JSON.stringify({ capacity: attendance, layout, accessibility: ['Ramp access'], requiredFacilities: [] })]);
    }

    await client.query('DELETE FROM notifications WHERE user_id=$1 AND details->>$$kind$$ LIKE $$venue_demo%$$', [staffUserId]);
    await client.query(`
      INSERT INTO notifications (user_id, event_id, type, title, message, details)
      VALUES
        ($1, $2, 'venue_event_status_changed', 'Venue event status: ConnectSphere Demo - Confirmed Event',
          'ConnectSphere Demo - Confirmed Event is now confirmed. Review the latest venue arrangement information before preparing the venue.',
          '{"kind":"venue_demo_confirmed"}'::jsonb),
        ($1, $3, 'venue_event_status_changed', 'Venue event status: ConnectSphere Demo - Cancelled Event',
          'ConnectSphere Demo - Cancelled Event has been cancelled and will no longer proceed. Handle its venue reservation according to the cancellation rules.',
          '{"kind":"venue_demo_cancelled"}'::jsonb)
    `, [staffUserId, eventIds.Confirmed, eventIds.Cancelled]);
    await client.query(`
      INSERT INTO venue_notification_preferences (user_id, daily_pending_reminders, last_pending_reminder_at)
      VALUES ($1, false, NULL)
      ON CONFLICT (user_id) DO UPDATE SET daily_pending_reminders=false, last_pending_reminder_at=NULL
    `, [staffUserId]);
    await client.query('COMMIT');
    return { email: DEMO_EMAIL, eventCount: scenarios.length, venueCount: Object.keys(venueIds).length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  seedVenueEventStatusDemo()
    .then(result => console.log(`Venue event-status demo data is ready for ${result.email}: ${result.eventCount} events across ${result.venueCount} venues.`))
    .catch(error => {
      console.error(`Unable to seed Venue event-status demo data: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { seedVenueEventStatusDemo };
