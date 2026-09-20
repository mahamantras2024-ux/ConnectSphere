const express = require('express');
const router = express.Router();
const equipmentController = require('../controllers/equipmentController');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', equipmentController.listEquipment);
router.get('/:id', equipmentController.getEquipmentById);

module.exports = router;
