const pool = require('../config/db');

async function listAll() {
  const result = await pool.query(`
    SELECT id, name, purpose, status, organiser_id, coordinator_id, created_at, updated_at
    FROM events
    ORDER BY created_at DESC
  `);

  return result.rows;
}

async function listForOrganiser(organiserId) {
  const result = await pool.query(`
    SELECT id, name, purpose, status, organiser_id, coordinator_id, created_at, updated_at
    FROM events
    WHERE organiser_id = $1
    ORDER BY created_at DESC
  `, [organiserId]);

  return result.rows;
}

async function listForCoordinator(coordinatorId) {
  const result = await pool.query(`
    SELECT id, name, purpose, status, organiser_id, coordinator_id, created_at, updated_at
    FROM events
    WHERE coordinator_id = $1
    ORDER BY created_at DESC
  `, [coordinatorId]);

  return result.rows;
}

async function findById(id) {
  const result = await pool.query(`
    SELECT *
    FROM events
    WHERE id = $1
  `, [id]);

  return result.rows[0] || null;
}

async function findAccessibleById(id, user) {
  const ownerColumn = user.role === 'event_organiser' ? 'organiser_id'
    : user.role === 'event_coordinator' ? 'coordinator_id' : null;
  if (!ownerColumn) return null;
  // The column is selected from the fixed allowlist above, never request input.
  const result = await pool.query(`
    SELECT e.id, e.organiser_id, e.coordinator_id, e.name, e.purpose,
      e.description, e.event_type, e.proposed_date::text AS proposed_date,
      e.proposed_start_time, e.proposed_end_time, e.expected_attendance,
      e.programme_details, e.room_layout_preference, e.accessibility_requirements,
      e.equipment_notes, e.registration_required, e.registration_capacity,
      e.special_arrangements, e.is_draft, e.status, e.created_at, e.updated_at,
      organiser.full_name AS organiser_name, coordinator.full_name AS coordinator_name
    FROM events e
    JOIN users organiser ON organiser.id = e.organiser_id
    LEFT JOIN users coordinator ON coordinator.id = e.coordinator_id
    WHERE e.id = $1 AND e.${ownerColumn} = $2`, [id, user.id]);
  return result.rows[0] || null;
}

async function create(data) {
  const result = await pool.query(`
    INSERT INTO events (organiser_id, name, purpose, description, event_type,
      proposed_date, proposed_start_time, proposed_end_time, expected_attendance,
      programme_details, room_layout_preference, accessibility_requirements,
      equipment_notes, registration_required, registration_capacity,
      special_arrangements, is_draft, status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18)
    RETURNING *`, [data.organiserId, data.name, data.purpose, data.description,
      data.eventType, data.proposedDate, data.proposedStartTime, data.proposedEndTime,
      data.expectedAttendance, data.programmeDetails, data.roomLayoutPreference,
      JSON.stringify(data.accessibilityRequirements), data.equipmentNotes,
      data.registrationRequired, data.registrationCapacity, data.specialArrangements,
      data.isDraft, data.isDraft ? 'draft' : 'submitted']);
  return result.rows[0];
}

module.exports = {
  create,
  findAccessibleById,
  listAll,
  listForOrganiser,
  listForCoordinator,
  findById
};
