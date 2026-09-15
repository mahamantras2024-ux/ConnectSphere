const { query } = require('../config/db');

const REQUIRED_FIELDS = ['location', 'capacity', 'facilities', 'accessibility', 'supportedLayouts', 'operatingHours'];

// "Create Venue Records" AC: all required fields must be filled before the
// venue appears in searches/catalogue. We still allow saving an incomplete
// venue (so Venue Staff can start a record and finish it later) -- it's just
// excluded from search/catalogue results until this returns true.
function isComplete({ location, capacity, facilities, accessibility, supportedLayouts, operatingHours }) {
  return Boolean(
    location &&
    capacity &&
    Array.isArray(facilities) && facilities.length > 0 &&
    Array.isArray(accessibility) && accessibility.length > 0 &&
    Array.isArray(supportedLayouts) && supportedLayouts.length > 0 &&
    operatingHours && Object.keys(operatingHours).length > 0
  );
}

async function create(data) {
  const {
    name, location, capacity, facilities, accessibility,
    supportedLayouts, operatingHours, turnaroundMinutes,
  } = data;

  const complete = isComplete(data);

  const { rows } = await query(
    `INSERT INTO venues (name, location, capacity, facilities, accessibility, supported_layouts, operating_hours, turnaround_minutes, is_complete)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      name, location || null, capacity || null,
      JSON.stringify(facilities || []),
      JSON.stringify(accessibility || []),
      JSON.stringify(supportedLayouts || []),
      JSON.stringify(operatingHours || {}),
      turnaroundMinutes || 0,
      complete,
    ]
  );
  return rows[0];
}

async function findById(id) {
  const { rows } = await query('SELECT * FROM venues WHERE id = $1', [id]);
  return rows[0];
}

// "View Venue Record" AC: include current availability status alongside
// the venue's static details.
async function findByIdWithAvailability(id) {
  const venue = await findById(id);
  if (!venue) return null;

  const { rows } = await query(
    `SELECT id FROM venue_bookings
     WHERE venue_id = $1 AND status = 'approved'
       AND start_datetime <= now() AND end_datetime >= now()`,
    [id]
  );

  return { ...venue, currently_booked: rows.length > 0 };
}

// Full catalogue. Venue Staff see every venue (including drafts/inactive) so
// they can manage them; everyone else only sees complete + active venues.
// "Delete Venue Record" AC: deactivated venues are excluded here for
// non-staff callers but their historical records remain in the DB.
async function listAll({ staffView } = {}) {
  if (staffView) {
    const { rows } = await query('SELECT * FROM venues ORDER BY name ASC');
    return rows;
  }
  const { rows } = await query(
    `SELECT * FROM venues WHERE is_complete = true AND status = 'active' ORDER BY name ASC`
  );
  return rows;
}

async function search({ minCapacity } = {}) {
  if (minCapacity) {
    const { rows } = await query(
      `SELECT * FROM venues
       WHERE capacity >= $1 AND is_complete = true AND status = 'active'
       ORDER BY capacity ASC`,
      [minCapacity]
    );
    return rows;
  }
  return listAll({ staffView: false });
}

async function getBookingsForVenue(venueId) {
  const { rows } = await query(
    `SELECT * FROM venue_bookings WHERE venue_id = $1 AND status IN ('pending','approved')
     ORDER BY start_datetime ASC`,
    [venueId]
  );
  return rows;
}

// "Update Venue Record" — partial update. Caller (controller) is responsible
// for deciding whether the change is "risky" enough to warn about first;
// this function just applies whatever fields are given and recomputes
// is_complete from the merged result.
async function update(id, fields) {
  const current = await findById(id);
  if (!current) return null;

  const merged = {
    location: fields.location !== undefined ? fields.location : current.location,
    capacity: fields.capacity !== undefined ? fields.capacity : current.capacity,
    facilities: fields.facilities !== undefined ? fields.facilities : current.facilities,
    accessibility: fields.accessibility !== undefined ? fields.accessibility : current.accessibility,
    supportedLayouts: fields.supportedLayouts !== undefined ? fields.supportedLayouts : current.supported_layouts,
    operatingHours: fields.operatingHours !== undefined ? fields.operatingHours : current.operating_hours,
  };

  const { rows } = await query(
    `UPDATE venues SET
        name = $1, location = $2, capacity = $3, facilities = $4,
        accessibility = $5, supported_layouts = $6, operating_hours = $7,
        turnaround_minutes = $8, is_complete = $9, updated_at = now()
     WHERE id = $10 RETURNING *`,
    [
      fields.name !== undefined ? fields.name : current.name,
      merged.location,
      merged.capacity,
      JSON.stringify(merged.facilities || []),
      JSON.stringify(merged.accessibility || []),
      JSON.stringify(merged.supportedLayouts || []),
      JSON.stringify(merged.operatingHours || {}),
      fields.turnaroundMinutes !== undefined ? fields.turnaroundMinutes : current.turnaround_minutes,
      isComplete(merged),
      id,
    ]
  );
  return rows[0];
}

// "Delete Venue Record" — soft delete only, per the AC that historical
// booking records must remain intact. Controller checks for upcoming
// confirmed bookings before calling this.
async function deactivate(id) {
  const { rows } = await query(
    `UPDATE venues SET status = 'inactive', updated_at = now() WHERE id = $1 RETURNING *`,
    [id]
  );
  return rows[0];
}

async function checkSuitability(id, { attendance }) {
  const venue = await findById(id);
  if (!venue) return null;
  const suitable = !attendance || attendance <= venue.capacity;
  return {
    suitable,
    reasons: suitable ? [] : [`Expected attendance (${attendance}) exceeds venue capacity (${venue.capacity}).`],
  };
}

module.exports = {
  isComplete,
  create,
  findById,
  findByIdWithAvailability,
  listAll,
  search,
  getBookingsForVenue,
  update,
  deactivate,
  checkSuitability,
  REQUIRED_FIELDS,
};
