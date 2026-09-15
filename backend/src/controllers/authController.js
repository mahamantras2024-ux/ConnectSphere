const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const asyncHandler = require('../utils/asyncHandler');
const userModel = require('../models/userModel');

const VALID_ROLES = ['event_organiser', 'event_coordinator', 'venue_staff', 'technical_support', 'attendee'];

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
  );
}

// POST /api/auth/register
// NOTE: in the real system, staff roles (coordinator/venue_staff/technical_support)
// are probably provisioned by an admin, not self-registered. This endpoint allows
// any role for now so the frontend/dev workflow isn't blocked — tighten this once
// that user story is decided.
const register = asyncHandler(async (req, res) => {
  const { email, password, fullName, role, organisationName, phone } = req.body;

  if (!email || !password || !fullName || !role) {
    return res.status(400).json({ error: 'email, password, fullName and role are required.' });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
  }

  const existing = await userModel.findByEmail(email);
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await userModel.create({ email, passwordHash, fullName, role, organisationName, phone });
  const token = signToken(user);

  res.status(201).json({ user, token });
});

// POST /api/auth/login
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required.' });
  }

  const user = await userModel.findByEmail(email);
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const token = signToken(user);
  const { password_hash, ...publicUser } = user;
  res.json({ user: publicUser, token });
});

// GET /api/auth/me
const me = asyncHandler(async (req, res) => {
  const user = await userModel.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json({ user });
});

module.exports = { register, login, me };
