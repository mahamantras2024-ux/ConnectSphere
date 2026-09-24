const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const userModel = require('../models/userModel');
const emailService = require('../services/emailService');
const asyncHandler = require('../utils/asyncHandler');

const externalRoles = ['event_organiser', 'attendee'];
const validEmail = (value) => typeof value === 'string' && value.trim().length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
const validPassword = (value) => typeof value === 'string' && value.trim().length >= 8 && Buffer.byteLength(value, 'utf8') <= 72;
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const resetMessage = 'If an external account matches that email, a password-reset link will be sent.';

const register = asyncHandler(async (req, res) => {
  const { email, password, fullName, role, organisationName } = req.body || {};
  if (!externalRoles.includes(role)) return res.status(403).json({ message: 'Only Event Organisers and Attendees can self-register.' });
  if (!validEmail(email) || !validPassword(password) || typeof fullName !== 'string' ||
      !fullName.trim() || fullName.trim().length > 255 ||
      (organisationName != null && (typeof organisationName !== 'string' || organisationName.length > 255))) {
    return res.status(400).json({ message: 'Enter a valid email, name, and a password of at least 8 characters (at most 72 UTF-8 bytes).' });
  }
  try {
    const user = await userModel.createUser({
      email: email.trim().toLowerCase(), full_name: fullName.trim(), role,
      password_hash: await bcrypt.hash(password, 10),
      organisation_name: role === 'event_organiser' ? organisationName?.trim() || null : null,
    });
    return res.status(201).json({ user, message: 'Account created. You can now sign in.' });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ message: 'An account with that email already exists. Please sign in or reset your password.' });
    throw error;
  }
});

const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body || {};
  if (!validEmail(email)) return res.status(400).json({ message: 'Enter a valid email address.' });
  // Configuration failures are independent of whether the account exists.
  try { emailService.emailConfig(); emailService.resetUrl('validation'); }
  catch { return res.status(503).json({ message: 'Password-reset email is not configured. Please contact support.' }); }
  const user = await userModel.getUserByEmail(email.trim().toLowerCase());
  if (user && externalRoles.includes(user.role)) {
    const token = crypto.randomBytes(32).toString('hex');
    const hash = hashToken(token);
    if (await userModel.setPasswordReset(user.id, hash)) {
      try { await emailService.sendPasswordReset(user.email, token); }
      catch (error) {
        await userModel.clearPasswordReset(user.id, hash);
        // Do not log reset links, tokens, addresses or SMTP credentials.
        console.error('Password-reset delivery failed; check email configuration.', error.code || 'MAIL_ERROR');
      }
    }
  }
  return res.json({ message: resetMessage });
});

const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body || {};
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
    return res.status(400).json({ message: 'This reset link is invalid or expired. Request a new link.' });
  }
  if (!validPassword(password)) return res.status(400).json({ message: 'Use at least 8 characters and at most 72 UTF-8 bytes for your password.' });
  const user = await userModel.resetExternalPassword(hashToken(token), await bcrypt.hash(password, 10));
  if (!user) return res.status(400).json({ message: 'This reset link is invalid or expired. Request a new link.' });
  return res.json({ message: 'Password updated. Please sign in again.' });
});

module.exports = { register, forgotPassword, resetPassword };
