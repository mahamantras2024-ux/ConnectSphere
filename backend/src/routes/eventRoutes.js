// File: Registers authenticated, role-restricted event creation/list/detail endpoints.
const express = require('express');
const router = express.Router();
const eventController = require('../controllers/eventController');
const eventReadController = require('../controllers/eventReadController');
const attendeeEventController = require('../controllers/attendeeEventController');
const coordinatorRegistrationController = require('../controllers/coordinatorRegistrationController');
const eventRegistrationController = require('../controllers/eventRegistrationController');
const eventCancellationController = require('../controllers/eventCancellationController');
const technicalSupportController = require('../controllers/technicalSupportController');
const equipmentReservationUnavailability = require('../controllers/equipmentReservationUnavailabilityController');
const technicalSupportAssignmentController = require('../controllers/technicalSupportAssignmentController');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
const venueBookingDecisions = require('../controllers/venueBookingDecisionController');
const asyncHandler = require('../utils/asyncHandler');
const organiserVenues = require('../controllers/organiserVenueController');

router.use(requireAuth);
router.get('/:id/organiser-venue-bookings', requireRole('event_organiser'), asyncHandler(organiserVenues.listArrangements));
router.get('/technical-support-staff', requireRole('event_coordinator'), technicalSupportAssignmentController.listStaff);
router.get('/on-site-support', requireRole('technical_support'), technicalSupportAssignmentController.listAssigned);
router.put('/:id/technical-support-assignment', requireRole('event_coordinator'), technicalSupportAssignmentController.assign);
const lead = require('../controllers/coordinatorLeadController');
router.get('/assignments', requireRole('event_coordinator_lead'), lead.workspace);
router.put('/:id/assignment', requireRole('event_coordinator_lead'), lead.assign);

const drafts=require('../controllers/eventDraftController');
router.delete('/:id/draft',requireRole('event_organiser'),drafts.remove);
router.post('/:id/submit',requireRole('event_organiser'),drafts.submit);

router.post('/', requireRole('event_organiser'), eventController.createEvent);
router.put('/:id/non-critical', requireRole('event_organiser'), eventController.updateEventInformation);
router.put('/:id/equipment', requireRole('event_organiser'), eventController.updateEquipmentRequirements);
router.get('/change-requests', requireRole('event_coordinator'), eventController.listChangeRequests);
router.post('/change-requests/:id/decision', requireRole('event_coordinator'), eventController.decideChangeRequest);
router.get('/:id/venue-bookings', requireRole('event_coordinator'), venueBookingDecisions.listEventVenueBookings);
router.get('/published', requireRole('attendee'), asyncHandler(attendeeEventController.listPublished));
router.get('/published/:id', requireRole('attendee'), asyncHandler(attendeeEventController.getPublished));
router.get('/:id/coordinator-registrations', requireRole('event_coordinator'), asyncHandler(coordinatorRegistrationController.getRegistrations));
router.get('/:id/registrations', requireRole('event_organiser'), asyncHandler(eventRegistrationController.getEventRegistrations));
router.post('/:id/cancel', requireRole('event_organiser', 'event_coordinator'), eventCancellationController.postCancellation);
router.post('/:id/clarifications', requireRole('event_coordinator'), eventController.createClarificationRequest);
router.post('/:id/clarifications/:clarificationId/respond', requireRole('event_organiser'), eventController.respondToClarification);

router.get('/equipment-requests', requireRole('technical_support'), technicalSupportController.listEquipmentRequests);
router.post('/:id/equipment-reviews', requireRole('technical_support'), technicalSupportController.reviewEquipmentRequest);
router.get('/equipment-inventory', requireRole('technical_support'), technicalSupportController.listEquipmentInventory);
router.put('/equipment-inventory/:id/repair', requireRole('technical_support'), technicalSupportController.repairEquipment);
router.put(
  '/equipment-inventory/:id/unavailable',
  requireRole('technical_support'),
  equipmentReservationUnavailability.markUnavailable,
);
router.get(
  '/equipment-reservation-issues',
  requireRole('technical_support'),
  equipmentReservationUnavailability.listOpenIssues,
);
router.put(
  '/equipment-reservation-issues/:issueId/suggestion',
  requireRole('technical_support'),
  equipmentReservationUnavailability.suggestAlternative,
);
router.get('/equipment-reservations', requireRole('technical_support'), technicalSupportController.listEquipmentReservations);
router.delete('/equipment-reservations/:id', requireRole('technical_support'), technicalSupportController.releaseEquipmentReservation);
router.get('/:id/equipment-availability', requireRole('technical_support'), technicalSupportController.checkEquipmentAvailability);
router.post('/:id/equipment-availability', requireRole('technical_support'), technicalSupportController.checkEquipmentAvailability);
router.post('/:id/equipment-reservations', requireRole('technical_support'), technicalSupportController.reserveEquipment);

router.get(
  '/',
  requireRole('event_coordinator', 'event_organiser'),
  eventReadController.listEvents
);

router.get(
  '/:id',
  requireRole('event_coordinator', 'event_organiser', 'event_coordinator_lead'),
  eventReadController.getEvent
);

module.exports = router;
