// File: Returns only the authenticated attendee's existing registration summaries for Sprint 1.
const asyncHandler = require('../utils/asyncHandler');
const registrationModel = require('../models/registrationModel');

// GET /api/registrations/mine  (Attendee)
const listMine = asyncHandler(async (req, res) => {
  // Returns registrations belonging to the authenticated attendee.

  const registrations = await registrationModel.listForAttendee(req.user.id);
  res.json({ registrations });
});

module.exports = { listMine };
