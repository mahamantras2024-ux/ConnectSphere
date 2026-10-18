const asyncHandler = require('../utils/asyncHandler');
const registrations = require('../services/attendeeRegistration');

/** Validates the event identity before any registration database reads or writes. */
function validEvent(req, res) {
  if (!/^[1-9]\d*$/.test(req.params.eventId) || Number(req.params.eventId) > 2147483647) {
    res.status(400).json({ message: 'Choose a valid event.' });
    return false;
  }
  return true;
}

/** Returns this attendee's existing record and event availability. */
const get = asyncHandler(async (req, res) => {
  if (!validEvent(req, res)) return;
  const result = await registrations.getRegistration(Number(req.params.eventId), req.user.id);
  if (!result) return res.status(404).json({ message: 'Event not found.' });
  return res.json(result);
});

/** Accepts an explicit waitlist opt-in; the attendee identity always comes from the verified session. */
const create = asyncHandler(async (req, res) => {
  if (!validEvent(req, res)) return;
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) ||
      Object.keys(req.body).some(key => key !== 'joinWaitlist') ||
      (req.body.joinWaitlist !== undefined && typeof req.body.joinWaitlist !== 'boolean')) {
    return res.status(400).json({ message: 'Choose Register or Join waitlist.' });
  }
  const { status, ...result } = await registrations.register(Number(req.params.eventId), req.user.id, req.body.joinWaitlist === true);
  return res.status(status).json(result);
});

module.exports = { get, create };
