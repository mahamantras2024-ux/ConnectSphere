// Reconsideration endpoints share the event detail's owner/assignment access check; only the assigned coordinator may write.
const asyncHandler = require('../utils/asyncHandler');
const db = require('../config/db');
const eventModel = require('../models/eventModel');
const reconsideration = require('../services/eventReconsideration');

/** PostgreSQL event and history identifiers are positive 32-bit integers. */
const validId = value => /^[1-9]\d*$/.test(String(value)) && Number(value) <= 2147483647;

/** Returns prior outcomes and current eligibility; historical data never grants access to another event. */
const getHistory = asyncHandler(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ message: 'Choose a valid event.' });
  const event = await eventModel.findAccessibleById(req.params.id, req.user);
  if (!event) return res.status(404).json({ message: 'Event not found.' });
  const history = await reconsideration.historyFor(db, event.id);
  const rejection = history.filter(entry => entry.kind === 'review' && entry.outcome === 'rejected').at(-1);
  const blocked = reconsideration.blocker(event, history, await reconsideration.pendingWork(db, event.id));
  return res.json({ history, rejectionId: rejection?.id || null, blocked });
});

/** Validates the displayed rejection version before the service rechecks it under the event lock. */
const reopen = asyncHandler(async (req, res) => {
  if (!validId(req.params.id) || !Number.isInteger(req.body?.rejectionId) || !validId(req.body.rejectionId)) {
    return res.status(400).json({ message: 'Choose a valid event and recorded rejection.' });
  }
  try {
    const event = await reconsideration.reconsiderEvent(Number(req.params.id), req.user.id, req.body.rejectionId);
    return res.json({ event, message: 'Request reopened for review. Previous outcomes and corrections remain in its history.' });
  } catch (error) {
    if (!error.status) throw error;
    return res.status(error.status).json({ message: error.message, code: error.code });
  }
});

module.exports = { getHistory, reopen };
