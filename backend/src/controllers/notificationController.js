const asyncHandler = require('../utils/asyncHandler');
const notificationModel = require('../models/notificationModel');

// GET /api/notifications?unread=true
const listMine = asyncHandler(async (req, res) => {
  const notifications = await notificationModel.listForUser(req.user.id, {
    unreadOnly: req.query.unread === 'true',
  });
  res.json({ notifications });
});

// POST /api/notifications/:id/read
const markRead = asyncHandler(async (req, res) => {
  const notification = await notificationModel.markRead(req.params.id, req.user.id);
  if (!notification) return res.status(404).json({ error: 'Notification not found.' });
  res.json({ notification });
});

// TODO: "Notification System" — right now nothing in the app actually calls
// notificationModel.create() yet. Once event/booking/registration flows are
// built out, call it at each trigger point listed in the customer briefing
// section 6 (submission, assignment, approval/rejection, changes, etc).
// This endpoint exists so it can be exercised/tested manually in the meantime.
const createForTesting = asyncHandler(async (req, res) => {
  const { userId, type, message, relatedEventId } = req.body;
  if (!userId || !type || !message) {
    return res.status(400).json({ error: 'userId, type and message are required.' });
  }
  const notification = await notificationModel.create({ userId, type, message, relatedEventId });
  res.status(201).json({ notification });
});

module.exports = { listMine, markRead, createForTesting };
