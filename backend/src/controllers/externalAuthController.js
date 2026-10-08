// File: Registers external accounts and manages emailed, single-use password resets.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const userModel = require('../models/userModel');
const emailService = require('../services/emailService');
const asyncHandler = require('../utils/asyncHandler');
const { internalRoles, accountRoles } = require('../auth/roles');

const externalRoles = ['event_organiser', 'attendee'];
const validEmail = (value) => // Checks that the email is bounded text with a basic email-address shape.

      // Runs valid email for this module.
      typeof value === 'string' && value.trim().length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
const validPassword = (value) => // Checks minimum non-padding password length and bcrypt's 72-byte UTF-8 limit.

      // Runs valid password for this module.
      typeof value === 'string' && value.trim().length >= 8 && Buffer.byteLength(value, 'utf8') <= 72;
const hashToken = (token) => // Hashes a raw password-reset token with SHA-256 for database storage.

      // Runs hash token for this module.
      crypto.createHash('sha256').update(token).digest('hex');
const resetMessage = 'If an external account matches that email, a password-reset link will be sent.';

// Creates an external account, accepting no staff roles or extra role grants from public input.
const register = asyncHandler(async (req, res) => {
  const { email, password, confirmation, fullName, role, organisationName } = req.body || {};
  if (!externalRoles.includes(role)) return res.status(400).json({ message: 'Choose Event Organiser or Attendee. Staff accounts are provisioned internally.' });
  if (!validEmail(email) || typeof fullName !== 'string' || !fullName.trim() || fullName.length > 255) return res.status(400).json({ message: 'Enter a valid name and email address.' });
  if (!validPassword(password)) return res.status(400).json({ message: 'Use at least 8 characters and at most 72 UTF-8 bytes for your password.' });
  if (typeof confirmation !== 'string' || confirmation !== password) return res.status(400).json({ message: 'Passwords do not match. Enter matching password confirmation.' });
  if (organisationName != null && (typeof organisationName !== 'string' || organisationName.length > 255)) return res.status(400).json({ message: 'Enter a valid organisation name.' });
  try {
    const user = await userModel.createUser({ email: email.trim().toLowerCase(), full_name: fullName.trim(), password_hash: await bcrypt.hash(password, 10), role, organisation_name: role === 'event_organiser' ? organisationName?.trim() || null : null });
    return res.status(201).json({ user, message: 'Account created. Please sign in.' });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ message: 'An account with that email already exists. Sign in or reset your password.' });
    throw error;
  }
});

const forgotPassword = asyncHandler(async (req, res) => {
  // Stores a short-lived eligible account reset-token hash and attempts email delivery with a generic response.

  // The registered endpoint selects staff eligibility, never client-supplied roles.
  const internal = req.path?.startsWith('/internal/') || false;
  const allowedRoles = internal ? internalRoles : externalRoles;
  const { email } = req.body || {};
  if (!validEmail(email)) return res.status(400).json({ message: 'Enter a valid email address.' });
  // Configuration failures are independent of whether the account exists.
  try { emailService.emailConfig(); emailService.resetUrl('validation', internal); }
  catch { return res.status(503).json({ message: 'Password-reset email is not configured. Please contact support.' }); }
  const user = await userModel.getUserByEmail(email.trim().toLowerCase());
  if (user && accountRoles(user).some(role =>
      // Handles this operation using the surrounding screen or request state.
      allowedRoles.includes(role))) {
    const token = crypto.randomBytes(32).toString('hex');
    const hash = hashToken(token);
    if (await userModel.setPasswordReset(user.id, hash, internal)) {
      try { await emailService.sendPasswordReset(user.email, token, internal); }
      catch (error) {
        await userModel.clearPasswordReset(user.id, hash);
        // Do not log reset links, tokens, addresses or SMTP credentials.
        console.error('Password-reset delivery failed; check email configuration.', error.code || 'MAIL_ERROR');
      }
    }
  } else {
    // Requested recovery feedback: unknown or wrong-audience addresses keep the form open for correction.
    return res.status(404).json({ message: 'Account not found. Try again.' });
  }
  return res.json({ message: internal ? 'If a staff account matches that email, a password-reset link will be sent.' : resetMessage });
});

const resetPassword = asyncHandler(async (req, res) => {
  // Validates and atomically consumes a reset token while hashing the new password and revoking old sessions.

  // Token consumption enforces the same account audience as link requests.
  const internal = req.path?.startsWith('/internal/') || false;
  const { token, password } = req.body || {};
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
    return res.status(400).json({ message: 'This reset link is invalid or expired. Request a new link.' });
  }
  if (!validPassword(password)) return res.status(400).json({ message: 'Use at least 8 characters and at most 72 UTF-8 bytes for your password.' });
  const user = await userModel.resetAccountPassword(hashToken(token), await bcrypt.hash(password, 10), internal);
  if (!user) return res.status(400).json({ message: 'This reset link is invalid or expired. Request a new link.' });
  // The update is committed and the token consumed before notification; SMTP failure must not suggest retrying the reset.
  try { await emailService.sendPasswordChanged(user.email); }
  catch (error) {
    // Log delivery diagnostics without addresses, passwords, tokens or transport error text.
    console.error('Password-change notification failed; check email configuration.', error.code || 'MAIL_ERROR');
  }
  return res.json({ message: 'Password updated. Please sign in again.' });
});

module.exports = { register, forgotPassword, resetPassword };
