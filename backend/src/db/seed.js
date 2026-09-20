const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');

async function seed() {
  const client = await pool.connect();

  try {
    const passwordHash = await bcrypt.hash('password123', 10);

    const users = [
      ['organiser@example.com', 'Olivia Organiser', 'event_organiser', 'Acme Pte Ltd'],
      ['coordinator@example.com', 'Chris Coordinator', 'event_coordinator', null],
      ['venue@example.com', 'Vera VenueStaff', 'venue_staff', null],
      ['tech@example.com', 'Tom TechSupport', 'technical_support', null],
      ['attendee@example.com', 'Amy Attendee', 'attendee', null],
    ];

    for (const [email, full_name, role, organisation_name] of users) {
      await client.query(
        `INSERT INTO users (email, password_hash, full_name, role, organisation_name)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO NOTHING`,
        [email, passwordHash, full_name, role, organisation_name]
      );
    }

    const organiser = await client.query(
      `SELECT id FROM users WHERE email = $1`,
      ['organiser@example.com']
    );

    const coordinator = await client.query(
      `SELECT id FROM users WHERE email = $1`,
      ['coordinator@example.com']
    );

    await client.query(
      `INSERT INTO venues (name, location, capacity, facilities, supported_layouts, turnaround_minutes)
       VALUES
        ('Marina Hall A', 'Level 3, Marina Building', 150, $1::jsonb, $2::jsonb, 60),
        ('Orchard Room 2', 'Level 1, Orchard Wing', 40, $3::jsonb, $4::jsonb, 30)
       ON CONFLICT DO NOTHING`,
      [
        JSON.stringify(['projector', 'av_system']),
        JSON.stringify(['theatre', 'classroom']),
        JSON.stringify(['whiteboard']),
        JSON.stringify(['boardroom'])
      ]
    );

    const organiserId = organiser.rows[0]?.id;
    const coordinatorId = coordinator.rows[0]?.id;

    if (!organiserId || !coordinatorId) {
      throw new Error('Seeded organiser/coordinator users were not found.');
    }

    await client.query(
      `INSERT INTO events (
        id,
        organiser_id,
        coordinator_id,
        name,
        purpose,
        description,
        event_type,
        proposed_date,
        proposed_start_time,
        proposed_end_time,
        expected_attendance,
        status
      )
      VALUES (
        1,
        $1,
        $2,
        'Community Launch Event',
        'Launch the new community engagement initiative.',
        'A public launch event for local residents and partners.',
        'launch_event',
        '2026-10-15',
        '09:00',
        '12:00',
        180,
        'submitted'
      )
      ON CONFLICT (id) DO UPDATE SET
        organiser_id = EXCLUDED.organiser_id,
        coordinator_id = EXCLUDED.coordinator_id,
        name = EXCLUDED.name,
        purpose = EXCLUDED.purpose,
        description = EXCLUDED.description,
        event_type = EXCLUDED.event_type,
        proposed_date = EXCLUDED.proposed_date,
        proposed_start_time = EXCLUDED.proposed_start_time,
        proposed_end_time = EXCLUDED.proposed_end_time,
        expected_attendance = EXCLUDED.expected_attendance,
        status = EXCLUDED.status`,
      [organiserId, coordinatorId]
    );

    console.log('✔ Seed data inserted. Sample login: organiser@example.com / password123');
    console.log('✔ Sample event created with id = 1');
  } catch (err) {
    console.error('✘ Seeding failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();