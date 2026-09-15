const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', notificationController.listMine);
router.post('/:id/read', notificationController.markRead);
router.post('/test-create', notificationController.createForTesting); // TODO: remove once real triggers exist

module.exports = router;
