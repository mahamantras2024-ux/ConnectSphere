const { query } = require('../config/db');

// ---- Venue bookings ----

async function createVenueBooking(data) {
  const { eventId, venueId, requestedBy, startDatetime, endDatetime } = data;
  const { rows } = await query(
    `INSERT INTO venue_bookings (event_id, venue_id, requested_by, start_datetime, end_datetime)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [eventId, venueId, requestedBy, startDatetime, endDatetime]
  );
  return rows[0];
}

async function decideVenueBooking(id, status, decidedBy, notes) {
  const { rows } = await query(
    `UPDATE venue_bookings
     SET status = $1, decision_by = $2, decision_notes = $3, updated_at = now()
     WHERE id = $4 RETURNING *`,
    [status, decidedBy, notes || null, id]
  );
  return rows[0];
}

async function listVenueBookingsForEvent(eventId) {
  const { rows } = await query('SELECT * FROM venue_bookings WHERE event_id = $1', [eventId]);
  return rows;
}

async function listPendingVenueBookings() {
  const { rows } = await query(
    `SELECT * FROM venue_bookings WHERE status = 'pending' ORDER BY created_at ASC`
  );
  return rows;
}

// TODO: "Booking Conflict Detection" — placeholder overlap check for a single
// venue. Doesn't yet account for the venue's turnaround_minutes buffer.
async function hasConflict(venueId, startDatetime, endDatetime, excludeBookingId) {
  const { rows } = await query(
    `SELECT id FROM venue_bookings
     WHERE venue_id = $1 AND status = 'approved'
       AND start_datetime < $3 AND end_datetime > $2
       AND ($4::int IS NULL OR id != $4)`,
    [venueId, startDatetime, endDatetime, excludeBookingId || null]
  );
  return rows.length > 0;
}

// "Update Venue Record" + "Delete Venue Record" ACs: both need to know which
// upcoming *confirmed* bookings would be affected by a venue change, along
// with enough event info (attendance, layout preference) to judge impact.
async function listUpcomingApprovedBookingsForVenue(venueId) {
  const { rows } = await query(
    `SELECT vb.id AS booking_id, vb.start_datetime, vb.end_datetime,
            e.id AS event_id, e.name AS event_name,
            e.expected_attendance, e.room_layout_preference
     FROM venue_bookings vb
     JOIN events e ON e.id = vb.event_id
     WHERE vb.venue_id = $1 AND vb.status = 'approved' AND vb.start_datetime >= now()
     ORDER BY vb.start_datetime ASC`,
    [venueId]
  );
  return rows;
}

// ---- Equipment reservations ----

async function createEquipmentReservation(data) {
  const { eventId, equipmentId, quantity, startDatetime, endDatetime, reservedBy } = data;
  const { rows } = await query(
    `INSERT INTO equipment_reservations (event_id, equipment_id, quantity, start_datetime, end_datetime, reserved_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [eventId, equipmentId, quantity, startDatetime, endDatetime, reservedBy]
  );
  return rows[0];
}

async function decideEquipmentReservation(id, status, decidedBy, notes) {
  const { rows } = await query(
    `UPDATE equipment_reservations
     SET status = $1, decision_by = $2, decision_notes = $3, updated_at = now()
     WHERE id = $4 RETURNING *`,
    [status, decidedBy, notes || null, id]
  );
  return rows[0];
}

async function listEquipmentReservationsForEvent(eventId) {
  const { rows } = await query('SELECT * FROM equipment_reservations WHERE event_id = $1', [eventId]);
  return rows;
}

module.exports = {
  createVenueBooking,
  decideVenueBooking,
  listVenueBookingsForEvent,
  listPendingVenueBookings,
  listUpcomingApprovedBookingsForVenue,
  hasConflict,
  createEquipmentReservation,
  decideEquipmentReservation,
  listEquipmentReservationsForEvent,
};
