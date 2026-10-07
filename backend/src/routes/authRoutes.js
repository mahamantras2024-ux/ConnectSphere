// File: Registers shared login/session and rate-limited registration and staff/external password-reset endpoints.
const express = require('express');
const { login, me, switchRole } = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');
const externalAuth = require('../controllers/externalAuthController');
const { rateLimit } = require('express-rate-limit');

const router = express.Router();

const registrationLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20,
  message: { message: 'Too many attempts. Please try again in 15 minutes.' } });
const resetLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10,
  message: { message: 'Too many reset attempts. Please try again in 15 minutes.' } });
router.post('/register', registrationLimit, externalAuth.register);
router.post('/forgot-password', resetLimit, externalAuth.forgotPassword);
router.post('/reset-password', resetLimit, externalAuth.resetPassword);

// Separate IP counters keep external recovery attempts from consuming the staff quota.
const internalResetLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10,
  message: { message: 'Too many reset attempts. Please try again in 15 minutes.' } });
router.post('/internal/forgot-password', internalResetLimit, externalAuth.forgotPassword);
router.post('/internal/reset-password', internalResetLimit, externalAuth.resetPassword);

router.post('/login', login);
router.get('/me', requireAuth, me);
router.post('/switch-role', requireAuth, switchRole);

module.exports = router;
