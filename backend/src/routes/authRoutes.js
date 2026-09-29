const express = require('express');
const { login, me } = require('../controllers/authController');
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

router.post('/login', login);
router.get('/me', requireAuth, me);

module.exports = router;
