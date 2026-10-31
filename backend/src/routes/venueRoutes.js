// File: Registers public venue catalogue/detail queries and authenticated Venue Staff creation directly against PostgreSQL.
const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
const {mergeAttachments}=require('../services/eventAttachments');
const { validateVenue } = require('../services/venueValidation');
const { updateVenue, deactivateVenue } = require('../controllers/venueManagementController');
const { catalogueStream } = require('../services/venueCatalogueStream');
const { validateCoordinates, nearestMrt, geocode } = require('../services/venueLocation');
const { rateLimit } = require('express-rate-limit');
const asyncHandler = require('../utils/asyncHandler');
const { venueSchedule, saveVenueSchedule } = require('../controllers/venueScheduleController');
const { createRequest, decideRequest, listPendingRequests, changeExpiry, confirmHold, changeSession, recheckRequest } = require('../controllers/venueRequestController');
const venueEventStatus = require('../controllers/venueEventStatusController');
router.get('/requests/pending', requireAuth, requireRole('venue_staff'), asyncHandler(listPendingRequests));
router.get('/relevant-events', requireAuth, requireRole('venue_staff'), asyncHandler(venueEventStatus.listRelevantEvents));
router.get('/notification-preferences', requireAuth, requireRole('venue_staff'), asyncHandler(venueEventStatus.getReminderPreference));
router.put('/notification-preferences', requireAuth, requireRole('venue_staff'), asyncHandler(venueEventStatus.saveReminderPreference));
const { searchVenues } = require('../services/venueSearch');
// Coordinator-only search returns catalogue records, never other events' private booking metadata.
router.get('/search', requireAuth, requireRole('event_coordinator'), asyncHandler(async (req, res) => {
  res.json(await searchVenues(req.query, pool));
}));
router.get('/:id/schedule', requireAuth, requireRole('venue_staff', 'event_coordinator'), asyncHandler(venueSchedule));
router.put('/:id/schedule', requireAuth, requireRole('venue_staff'), asyncHandler(saveVenueSchedule));
router.post('/:id/requests', requireAuth, requireRole('event_coordinator'), asyncHandler(createRequest));
router.put('/:id/requests/:requestId/session', requireAuth, requireRole('event_coordinator'), asyncHandler(changeSession));
router.put('/:id/requests/:requestId/decision', requireAuth, requireRole('venue_staff'), asyncHandler(decideRequest));
// A confirmed booking flagged after an applied amendment is re-confirmed or rejected by Venue Staff.
router.put('/:id/requests/:requestId/recheck', requireAuth, requireRole('venue_staff'), asyncHandler(recheckRequest));
router.put('/:id/requests/:requestId/expiry', requireAuth, requireRole('venue_staff'), asyncHandler(changeExpiry));
router.put('/:id/requests/:requestId/confirm', requireAuth, requireRole('event_coordinator'), asyncHandler(confirmHold));
// Bounds staff address lookups and nearest-station requests while protecting the public provider.
const locationLimit = rateLimit({ windowMs:60_000, limit:30, standardHeaders:'draft-8', legacyHeaders:false, message:{message:'Too many map requests. Please try again shortly.'} });
router.get('/stream', catalogueStream);
router.get('/locations/search', requireAuth, requireRole('venue_staff', 'event_coordinator'), locationLimit, async (req,res) => {
 // Searches Singapore addresses only after an explicit staff request.
 if(typeof req.query.q!=='string' || req.query.q.trim().length<3 || req.query.q.length>255)return res.status(400).json({message:'Enter an address or place name of 3–255 characters.'});
 try {res.json(await geocode('api',{q:req.query.q.trim(),bbox:'103.58,1.15,104.1,1.49',countrycode:'SG'}));}
 catch {res.status(503).json({message:'Address search is temporarily unavailable. You can still click the map to select a location.'});}
});
router.get('/locations/resolve', requireAuth, requireRole('venue_staff', 'event_coordinator'), locationLimit, async(req,res) => {
 // Resolves a map click and calculates its nearest MRT even if address lookup is temporarily offline.
 const latitude=Number(req.query.lat),longitude=Number(req.query.lng);
 try {if(req.query.lat==null || req.query.lng==null)throw new Error('Choose a location on the map.');validateCoordinates(latitude,longitude);}
 catch(error){return res.status(400).json({message:error.message});}
 let locations=[];try {locations=await geocode('reverse',{lat:latitude,lon:longitude});}catch{}
 res.json({latitude,longitude,location:locations[0]?.location || `Map location (${latitude.toFixed(5)}, ${longitude.toFixed(5)}), Singapore`,postalCode:locations[0]?.postalCode || null,...{mrt:nearestMrt(latitude,longitude)}});
});
router.put('/:id', requireAuth, requireRole('venue_staff'), asyncHandler(updateVenue));
router.delete('/:id', requireAuth, requireRole('venue_staff'), asyncHandler(deactivateVenue));

// Catalogue creation is an internal Venue Staff operation.
router.post('/', requireAuth, requireRole('venue_staff'), async (req, res) => {
  // Validates and inserts a venue using the authenticated Venue Staff identity.

  try {
    let data;
    try { data = validateVenue(req.body); validateCoordinates(data.latitude,data.longitude); }
    catch (error) { return res.status(400).json({ message: error.message }); }
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
      setupMinutes, turnaroundMinutes,
    } = data;

    const insertQuery = `
      INSERT INTO venues (
        name, location, capacity, supported_layouts,
        accessibility_features, facilities, operating_hours,
        availability_status, pricing, mrt, image, setup_minutes, turnaround_minutes, latitude, longitude, mrt_distance_m,
        emergency_access, known_restrictions, emergency_documents
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
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
      availabilityStatus,
      pricing || null,
      data.latitude == null ? null : nearestMrt(data.latitude,data.longitude).name,
      image || null,
      setupMinutes, turnaroundMinutes, data.latitude ?? null, data.longitude ?? null,
      data.latitude == null ? null : nearestMrt(data.latitude,data.longitude).distanceM,
      data.emergencyAccess, data.knownRestrictions, JSON.stringify(mergeAttachments({},data.emergencyDocuments || {})),
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
  // Returns the public venue catalogue ordered by newest ID.

  try {
    const result = await pool.query('SELECT * FROM venues WHERE is_active = true ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching venues', error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  // Returns the public venue profile by ID or a missing-record response.

  try {
    const result = await pool.query('SELECT * FROM venues WHERE id = $1 AND is_active = true', [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Venue not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching venue details', error: error.message });
  }
});

module.exports = router;
