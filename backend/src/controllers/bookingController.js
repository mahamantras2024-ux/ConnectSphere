const asyncHandler = require('../utils/asyncHandler');
const bookingModel = require('../models/bookingModel');

// ---- Venue bookings ----

// POST /api/bookings/venue  (Event Coordinator) — "Venue Booking Request"
const requestVenueBooking = asyncHandler(async (req, res) => {
  const { eventId, venueId, startDatetime, endDatetime } = req.body;
  if (!eventId || !venueId || !startDatetime || !endDatetime) {
    return res.status(400).json({ error: 'eventId, venueId, startDatetime and endDatetime are required.' });
  }
  const booking = await bookingModel.createVenueBooking({
    eventId, venueId, requestedBy: req.user.id, startDatetime, endDatetime,
  });
  res.status(201).json({ booking });
});

// GET /api/bookings/venue/pending  (Venue Staff queue)
const listPendingVenueBookings = asyncHandler(async (req, res) => {
  const bookings = await bookingModel.listPendingVenueBookings();
  res.json({ bookings });
});

// GET /api/bookings/venue/event/:eventId
const listVenueBookingsForEvent = asyncHandler(async (req, res) => {
  const bookings = await bookingModel.listVenueBookingsForEvent(req.params.eventId);
  res.json({ bookings });
});

// POST /api/bookings/venue/:id/decision  { status: 'approved'|'rejected', notes }
// "Venue Booking Approval" + "Booking Conflict Detection"
// TODO: wire in bookingModel.hasConflict() before allowing an 'approved' decision,
// and decide what happens to the event's status when a booking is approved/rejected.
const decideVenueBooking = asyncHandler(async (req, res) => {
  const { status, notes } = req.body;
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: "status must be 'approved' or 'rejected'." });
  }
  const booking = await bookingModel.decideVenueBooking(req.params.id, status, req.user.id, notes);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  res.json({ booking });
});

// ---- Equipment reservations ----

// POST /api/bookings/equipment  (Event Coordinator) — "Equipment Request Management"
const requestEquipmentReservation = asyncHandler(async (req, res) => {
  const { eventId, equipmentId, quantity, startDatetime, endDatetime } = req.body;
  if (!eventId || !equipmentId || !startDatetime || !endDatetime) {
    return res.status(400).json({ error: 'eventId, equipmentId, startDatetime and endDatetime are required.' });
  }
  const reservation = await bookingModel.createEquipmentReservation({
    eventId, equipmentId, quantity: quantity || 1, startDatetime, endDatetime, reservedBy: req.user.id,
  });
  res.status(201).json({ reservation });
});

// GET /api/bookings/equipment/event/:eventId
const listEquipmentReservationsForEvent = asyncHandler(async (req, res) => {
  const reservations = await bookingModel.listEquipmentReservationsForEvent(req.params.eventId);
  res.json({ reservations });
});

// POST /api/bookings/equipment/:id/decision  { status: 'confirmed'|'unavailable', notes }
// "Equipment Reservation" decision by Technical Support Staff.
const decideEquipmentReservation = asyncHandler(async (req, res) => {
  const { status, notes } = req.body;
  if (!['confirmed', 'unavailable'].includes(status)) {
    return res.status(400).json({ error: "status must be 'confirmed' or 'unavailable'." });
  }
  const reservation = await bookingModel.decideEquipmentReservation(req.params.id, status, req.user.id, notes);
  if (!reservation) return res.status(404).json({ error: 'Reservation not found.' });
  res.json({ reservation });
});

module.exports = {
  requestVenueBooking,
  listPendingVenueBookings,
  listVenueBookingsForEvent,
  decideVenueBooking,
  requestEquipmentReservation,
  listEquipmentReservationsForEvent,
  decideEquipmentReservation,
};
