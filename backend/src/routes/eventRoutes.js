const express = require('express');
const router = express.Router();
const eventController = require('../controllers/eventController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', eventController.listEvents);
router.get('/:id', eventController.getEvent);

module.exports = router;
