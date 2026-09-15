const express = require('express');
const router = express.Router();
const venueController = require('../controllers/venueController');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');

router.use(requireAuth);

router.post('/', requireRole('venue_staff'), venueController.createVenue);
router.get('/', venueController.listVenues);
router.get('/search', venueController.searchVenues);
router.get('/:id', venueController.getVenue);
router.get('/:id/calendar', venueController.getVenueCalendar);
router.get('/:id/suitability', venueController.checkSuitability);
router.patch('/:id', requireRole('venue_staff'), venueController.updateVenue);
router.delete('/:id', requireRole('venue_staff'), venueController.deactivateVenue);

module.exports = router;
