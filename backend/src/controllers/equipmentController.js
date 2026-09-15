const asyncHandler = require('../utils/asyncHandler');
const equipmentModel = require('../models/equipmentModel');

// POST /api/equipment  (Technical Support maintain equipment records)
const createEquipment = asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required.' });
  const item = await equipmentModel.create(req.body);
  res.status(201).json({ equipment: item });
});

// GET /api/equipment
const listEquipment = asyncHandler(async (req, res) => {
  const equipment = await equipmentModel.listAll();
  res.json({ equipment });
});

// GET /api/equipment/:id/availability?start=&end=&quantity=  — "Equipment Availability Checking"
const checkAvailability = asyncHandler(async (req, res) => {
  const item = await equipmentModel.findById(req.params.id);
  if (!item) return res.status(404).json({ error: 'Equipment not found.' });

  const { start, end, quantity } = req.query;
  if (!start || !end) {
    return res.status(400).json({ error: 'start and end query params (ISO datetimes) are required.' });
  }

  const reserved = await equipmentModel.getReservedQuantity(req.params.id, start, end);
  const available = item.total_quantity - reserved;
  const requested = Number(quantity || 1);

  res.json({
    equipment: item,
    reservedQuantity: reserved,
    availableQuantity: available,
    sufficient: available >= requested,
  });
});

module.exports = { createEquipment, listEquipment, checkAvailability };
