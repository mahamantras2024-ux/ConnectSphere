const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');

// POST /api/venues (Public route, no auth middleware required)
router.post('/', async (req, res) => {
  try {
    const {
      name,
      location,
      capacity,
      supportedLayouts,
      accessibilityFeatures,
      facilities,
      operatingHours,
      availabilityStatus,
      pricing,
      mrt,
      image,
    } = req.body;

    if (
      !name ||
      !location ||
      !capacity ||
      !supportedLayouts ||
      (Array.isArray(supportedLayouts) && supportedLayouts.length === 0) ||
      !accessibilityFeatures ||
      (Array.isArray(accessibilityFeatures) && accessibilityFeatures.length === 0) ||
      !facilities ||
      (Array.isArray(facilities) && facilities.length === 0) ||
      !operatingHours
    ) {
      return res.status(400).json({
        message: 'Validation Error: All required fields must be non-empty.',
      });
    }

    const insertQuery = `
      INSERT INTO venues (
        name, location, capacity, supported_layouts, 
        accessibility_features, facilities, operating_hours, 
        availability_status, pricing, mrt, image
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *;
    `;

    const values = [
      name,
      location,
      capacity,
      supportedLayouts,
      accessibilityFeatures,
      facilities,
      operatingHours,
      availabilityStatus || 'Available',
      pricing || null,
      mrt || null,
      image || null,
    ];

    const result = await pool.query(insertQuery, values);

    return res.status(201).json({
      message: 'Venue successfully created.',
      venue: result.rows[0],
    });
  } catch (error) {
    return res.status(500).json({ message: 'Error creating venue', error: error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM venues ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching venues', error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM venues WHERE id = $1', [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Venue not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching venue details', error: error.message });
  }
});

module.exports = router;