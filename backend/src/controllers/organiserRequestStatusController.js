// SCRUM-93: status-only reads use current database organisation membership, never client-supplied organisation labels.
const asyncHandler = require('../utils/asyncHandler');
const { findRequestStatus } = require('../models/organiserRequestStatusModel');

/** Returns a private status snapshot for an authorised organiser; unrelated and missing requests both return 404. */
const getRequestStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!/^[1-9]\d*$/.test(id) || Number(id) > 2147483647) return res.status(400).json({ message: 'Choose a valid event.' });
  const event = await findRequestStatus(req.user.id, Number(id));
  if (!event) return res.status(404).json({ message: 'Event not found.' });
  res.set('Cache-Control', 'no-store');
  return res.json({ event });
});
module.exports = { getRequestStatus };
