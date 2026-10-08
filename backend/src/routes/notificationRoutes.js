// File: Serves each signed-in user's own in-app notifications and lets them mark one as read.
const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const notificationService = require('../services/notificationService');

const router = express.Router();
router.use(requireAuth);

// GET /api/notifications returns the caller's 50 newest notifications and unread count; scoping is by session, never by query input.
router.get('/', asyncHandler(async (req, res) => {
  res.json(await notificationService.listForUser(db, req.user.id));
}));

// POST /api/notifications/:id/read marks one of the caller's notifications read; another user's id is reported as not found.
router.post('/:id/read', asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!/^[1-9]\d*$/.test(id) || Number(id) > 2147483647) return res.status(400).json({ message: 'Choose a valid notification.' });
  const notification = await notificationService.markRead(db, req.user.id, Number(id));
  if (!notification) return res.status(404).json({ message: 'Notification not found.' });
  return res.json({ notification });
}));

module.exports = router;
