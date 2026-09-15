const asyncHandler = require('../utils/asyncHandler');
const registrationModel = require('../models/registrationModel');
const eventModel = require('../models/eventModel');

// POST /api/registrations  { eventId }  (Attendee) — "Attendee Registration"
// TODO: check event.registration_required, capacity vs registrationModel.countRegistered(),
// and waitlist behaviour once that story is refined.
const registerForEvent = asyncHandler(async (req, res) => {
  const { eventId } = req.body;
  if (!eventId) return res.status(400).json({ error: 'eventId is required.' });

  const event = await eventModel.findById(eventId);
  if (!event) return res.status(404).json({ error: 'Event not found.' });
  if (!event.registration_required) {
    return res.status(400).json({ error: 'Registration is not enabled for this event.' });
  }

  const registration = await registrationModel.register(eventId, req.user.id);
  res.status(201).json({ registration });
});

// POST /api/registrations/:eventId/withdraw  (Attendee)
const withdrawRegistration = asyncHandler(async (req, res) => {
  const registration = await registrationModel.withdraw(req.params.eventId, req.user.id);
  if (!registration) return res.status(404).json({ error: 'Registration not found.' });
  res.json({ registration });
});

// GET /api/registrations/event/:eventId  (Coordinator/Organiser view)
const listForEvent = asyncHandler(async (req, res) => {
  const registrations = await registrationModel.listForEvent(req.params.eventId);
  res.json({ registrations });
});

// GET /api/registrations/mine  (Attendee)
const listMine = asyncHandler(async (req, res) => {
  const registrations = await registrationModel.listForAttendee(req.user.id);
  res.json({ registrations });
});

module.exports = { registerForEvent, withdrawRegistration, listForEvent, listMine };
