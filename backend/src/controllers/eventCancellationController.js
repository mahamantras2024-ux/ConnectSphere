// File: Validates cancellation requests and delegates scoped event changes to the cancellation service.
const asyncHandler = require('../utils/asyncHandler');
const { cancelEvent } = require('../services/eventCancellationService');

/** Handles POST /api/events/:id/cancel for the event organiser or assigned coordinator. */
const postCancellation = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!/^[1-9]\d*$/.test(id) || Number(id) > 2147483647) {
    return res.status(400).json({ message: 'Choose a valid event.' });
  }
  try {
    const result = await cancelEvent(Number(id), req.user);
    return res.json({ ...result, message: 'Event cancelled. Active attendees have been notified.' });
  } catch (error) {
    if (!error.status) throw error;
    return res.status(error.status).json({ message: error.message, ...(error.code ? { code: error.code } : {}) });
  }
});

module.exports = { postCancellation };
