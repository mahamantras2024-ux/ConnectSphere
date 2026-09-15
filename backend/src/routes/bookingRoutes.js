const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');

router.use(requireAuth);

// Venue bookings
router.post('/venue', requireRole('event_coordinator'), bookingController.requestVenueBooking);
router.get('/venue/pending', requireRole('venue_staff'), bookingController.listPendingVenueBookings);
router.get('/venue/event/:eventId', bookingController.listVenueBookingsForEvent);
router.post('/venue/:id/decision', requireRole('venue_staff'), bookingController.decideVenueBooking);

// Equipment reservations
router.post('/equipment', requireRole('event_coordinator'), bookingController.requestEquipmentReservation);
router.get('/equipment/event/:eventId', bookingController.listEquipmentReservationsForEvent);
router.post('/equipment/:id/decision', requireRole('technical_support'), bookingController.decideEquipmentReservation);

module.exports = router;
