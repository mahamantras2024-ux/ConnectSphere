// Inserts a handful of sample users/venues/equipment for local development.
// Safe to re-run: uses ON CONFLICT DO NOTHING on unique columns.
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

    await client.query(
      `INSERT INTO venues (name, location, capacity, facilities, supported_layouts, turnaround_minutes)
       VALUES
        ('Marina Hall A', 'Level 3, Marina Building', 150, '["projector","av_system"]', '["theatre","classroom"]', 60),
        ('Orchard Room 2', 'Level 1, Orchard Wing', 40, '["whiteboard"]', '["boardroom"]', 30)
       ON CONFLICT DO NOTHING`
    );

    await client.query(
      `INSERT INTO equipment (name, type, total_quantity)
       VALUES
        ('Wireless Microphone', 'audio', 10),
        ('Projector', 'av', 5),
        ('Laptop', 'computing', 8)
       ON CONFLICT DO NOTHING`
    );

    console.log('✔ Seed data inserted. Sample login: organiser@example.com / password123');
  } catch (err) {
    console.error('✘ Seeding failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
