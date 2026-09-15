const { query } = require('../config/db');

// NOTE: this model intentionally keeps to simple CRUD + a couple of lookups.
// Business rules (e.g. what fields may change post-confirmation, suitability
// checks, etc.) belong in the controller/service layer once those user
// stories are defined — keeping them out of the model keeps this easy to edit.

async function create(data) {
  const {
    organiserId, name, purpose, description, eventType,
    proposedDate, proposedStartTime, proposedEndTime, expectedAttendance,
    roomLayoutPreference, accessibilityRequirements, registrationRequired,
    registrationCapacity, isDraft,
  } = data;

  const { rows } = await query(
    `INSERT INTO events (
        organiser_id, name, purpose, description, event_type,
        proposed_date, proposed_start_time, proposed_end_time, expected_attendance,
        room_layout_preference, accessibility_requirements, registration_required,
        registration_capacity, is_draft, status
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [
      organiserId, name, purpose, description, eventType,
      proposedDate, proposedStartTime, proposedEndTime, expectedAttendance,
      roomLayoutPreference, JSON.stringify(accessibilityRequirements || []),
      !!registrationRequired, registrationCapacity || null,
      isDraft !== false, isDraft !== false ? 'draft' : 'submitted',
    ]
  );
  return rows[0];
}

async function findById(id) {
  const { rows } = await query('SELECT * FROM events WHERE id = $1', [id]);
  return rows[0];
}

async function listForOrganiser(organiserId) {
  const { rows } = await query(
    'SELECT * FROM events WHERE organiser_id = $1 ORDER BY created_at DESC',
    [organiserId]
  );
  return rows;
}

async function listForCoordinator(coordinatorId) {
  const { rows } = await query(
    'SELECT * FROM events WHERE coordinator_id = $1 ORDER BY created_at DESC',
    [coordinatorId]
  );
  return rows;
}

async function listAll({ status } = {}) {
  if (status) {
    const { rows } = await query(
      'SELECT * FROM events WHERE status = $1 ORDER BY created_at DESC',
      [status]
    );
    return rows;
  }
  const { rows } = await query('SELECT * FROM events ORDER BY created_at DESC');
  return rows;
}

async function updateStatus(id, newStatus, changedBy, notes) {
  const current = await findById(id);
  if (!current) return null;

  const { rows } = await query(
    `UPDATE events SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [newStatus, id]
  );

  await query(
    `INSERT INTO event_status_history (event_id, old_status, new_status, changed_by, notes)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, current.status, newStatus, changedBy || null, notes || null]
  );

  return rows[0];
}

async function assignCoordinator(id, coordinatorId) {
  const { rows } = await query(
    `UPDATE events SET coordinator_id = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [coordinatorId, id]
  );
  return rows[0];
}

async function update(id, fields) {
  // Generic partial-update helper. Caller is responsible for deciding which
  // fields are allowed to change given the event's current status (TODO).
  const keys = Object.keys(fields);
  if (keys.length === 0) return findById(id);

  const setClauses = keys.map((key, i) => `${key} = $${i + 2}`);
  const values = keys.map((key) => fields[key]);

  const { rows } = await query(
    `UPDATE events SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, ...values]
  );
  return rows[0];
}

module.exports = {
  create,
  findById,
  listForOrganiser,
  listForCoordinator,
  listAll,
  updateStatus,
  assignCoordinator,
  update,
};
