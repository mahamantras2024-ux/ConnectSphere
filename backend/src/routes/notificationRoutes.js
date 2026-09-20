const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', notificationController.listNotifications);
router.patch('/:id/read', notificationController.markAsRead);

module.exports = router;
