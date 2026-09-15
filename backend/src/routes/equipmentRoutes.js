const express = require('express');
const router = express.Router();
const equipmentController = require('../controllers/equipmentController');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');

router.use(requireAuth);

router.post('/', requireRole('technical_support'), equipmentController.createEquipment);
router.get('/', equipmentController.listEquipment);
router.get('/:id/availability', equipmentController.checkAvailability);

module.exports = router;
