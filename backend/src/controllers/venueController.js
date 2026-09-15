const asyncHandler = require('../utils/asyncHandler');
const venueModel = require('../models/venueModel');
const bookingModel = require('../models/bookingModel');

// POST /api/venues  (Venue Staff) — "Create Venue Records"
// Venues can be saved incomplete (draft), but only appear in search/catalogue
// once venueModel.isComplete() is true — see venueModel.create().
const createVenue = asyncHandler(async (req, res) => {
  const { name, capacity } = req.body;
  if (!name || !capacity) {
    return res.status(400).json({ error: 'name and capacity are required.' });
  }
  const venue = await venueModel.create(req.body);
  res.status(201).json({
    venue,
    complete: venue.is_complete,
    message: venue.is_complete
      ? 'Venue created and visible in the catalogue.'
      : `Venue saved as a draft. Fill in ${venueModel.REQUIRED_FIELDS.join(', ')} before it appears in searches.`,
  });
});

// GET /api/venues — "Venue Catalogue"
// Venue Staff see everything (including drafts/inactive) to manage them;
// everyone else only sees complete + active venues.
const listVenues = asyncHandler(async (req, res) => {
  const staffView = req.user.role === 'venue_staff';
  const venues = await venueModel.listAll({ staffView });
  res.json({ venues });
});

const searchVenues = asyncHandler(async (req, res) => {
  const { minCapacity } = req.query;
  const venues = await venueModel.search({
    minCapacity: minCapacity ? Number(minCapacity) : undefined,
  });
  res.json({ venues });
});

// GET /api/venues/:id — "View Venue Record"
// Includes current availability status (whether an approved booking covers
// this exact moment) alongside the venue's static details.
const getVenue = asyncHandler(async (req, res) => {
  const venue = await venueModel.findByIdWithAvailability(req.params.id);
  if (!venue) return res.status(404).json({ error: 'Venue not found.' });
  res.json({ venue });
});

const getVenueCalendar = asyncHandler(async (req, res) => {
  const venue = await venueModel.findById(req.params.id);
  if (!venue) return res.status(404).json({ error: 'Venue not found.' });
  const bookings = await venueModel.getBookingsForVenue(req.params.id);
  res.json({ venue, bookings });
});

const checkSuitabilityEndpoint = asyncHandler(async (req, res) => {
  const result = await venueModel.checkSuitability(req.params.id, {
    attendance: Number(req.query.attendance || 0),
  });
  if (!result) return res.status(404).json({ error: 'Venue not found.' });
  res.json(result);
});

// Compares proposed new values against each upcoming confirmed booking's
// event to see whether the change would leave that booking unsuitable.
// TODO: events don't yet have a structured "required facilities" field
// (only freeform equipment_notes), so facility-removal impact can't be
// checked precisely yet -- only capacity and layout are checked here.
function assessBookingImpact(bookings, proposed) {
  return bookings
    .map((b) => {
      const reasons = [];
      if (proposed.capacity && b.expected_attendance && b.expected_attendance > proposed.capacity) {
        reasons.push(`Expected attendance (${b.expected_attendance}) would exceed the new capacity (${proposed.capacity}).`);
      }
      if (
        proposed.supportedLayouts &&
        b.room_layout_preference &&
        !proposed.supportedLayouts.includes(b.room_layout_preference)
      ) {
        reasons.push(`Booked layout "${b.room_layout_preference}" would no longer be supported.`);
      }
      return { ...b, reasons };
    })
    .filter((b) => b.reasons.length > 0);
}

// PATCH /api/venues/:id  (Venue Staff) — "Update Venue Record"
// If the change is "risky" (lower capacity, or layouts removed) and it would
// affect an upcoming confirmed booking, we return the warning instead of
// saving -- unless the caller passes { confirm: true }, which proceeds
// anyway. This matches the AC: "I'm warned ... before the change is confirmed."
const updateVenue = asyncHandler(async (req, res) => {
  const existing = await venueModel.findById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Venue not found.' });

  const { confirm, ...fields } = req.body;

  const capacityReduced = fields.capacity !== undefined && fields.capacity < existing.capacity;
  const layoutsRemoved =
    fields.supportedLayouts !== undefined &&
    existing.supported_layouts.some((l) => !fields.supportedLayouts.includes(l));

  if ((capacityReduced || layoutsRemoved) && !confirm) {
    const upcoming = await bookingModel.listUpcomingApprovedBookingsForVenue(req.params.id);
    const affected = assessBookingImpact(upcoming, {
      capacity: fields.capacity,
      supportedLayouts: fields.supportedLayouts,
    });

    if (affected.length > 0) {
      return res.status(409).json({
        warning: true,
        message: 'This change may affect existing confirmed bookings. Resubmit with confirm: true to proceed anyway.',
        affectedBookings: affected,
      });
    }
  }

  const venue = await venueModel.update(req.params.id, fields);
  res.json({ venue });
});

// DELETE /api/venues/:id  (Venue Staff) — "Delete Venue Record"
// Soft-delete (deactivate) only, per the AC that historical booking records
// must remain intact. Blocked if there are upcoming confirmed bookings.
const deactivateVenue = asyncHandler(async (req, res) => {
  const existing = await venueModel.findById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Venue not found.' });

  const upcoming = await bookingModel.listUpcomingApprovedBookingsForVenue(req.params.id);
  if (upcoming.length > 0) {
    return res.status(409).json({
      error: 'Cannot deactivate: this venue has upcoming confirmed bookings.',
      affectedBookings: upcoming,
    });
  }

  const venue = await venueModel.deactivate(req.params.id);
  res.json({ venue });
});

module.exports = {
  createVenue,
  listVenues,
  searchVenues,
  getVenue,
  getVenueCalendar,
  checkSuitability: checkSuitabilityEndpoint,
  updateVenue,
  deactivateVenue,
};
