const express = require('express');
const router = express.Router();

router.use('/auth', require('./authRoutes'));
router.use('/events', require('./eventRoutes'));
router.use('/venues', require('./venueRoutes'));
router.use('/equipment', require('./equipmentRoutes'));
router.use('/bookings', require('./bookingRoutes'));
router.use('/registrations', require('./registrationRoutes'));
router.use('/notifications', require('./notificationRoutes'));

module.exports = router;
