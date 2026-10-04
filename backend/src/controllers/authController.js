// File: Handles shared password login and current-user responses using bcrypt, JWTs, and PostgreSQL users.
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getUserByEmail } = require('../models/userModel');
const { audienceRoles, accountRoles } = require('../auth/roles');

// Issues a session scoped to one provisioned active role without changing account permissions.
function session(user, role) {
  return { token: jwt.sign({ sub: user.id, id: user.id, email: user.email, role,
    activeRole: role, authVersion: user.auth_version || 0 }, process.env.JWT_SECRET, { expiresIn: '8h' }),
  user: { id: user.id, email: user.email, full_name: user.full_name, role, roles: accountRoles(user) } };
}

// Validates account credentials and returns a role-bearing JWT and public user identity.
async function login(req, res) {
  const { email, password } = req.body || {};

  if (typeof email !== 'string' || !email.trim() ||
      typeof password !== 'string' || !password.trim()) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }
  if (req.body.audience != null && !['external', 'internal'].includes(req.body.audience)) return res.status(400).json({ message: 'Choose a valid login audience.' });

  try {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await getUserByEmail(normalizedEmail);

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const roles = audienceRoles(user, req.body.audience);
    if (!roles.length) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    return res.status(200).json(session(user, roles.includes(user.role) ? user.role : roles[0]));
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Unable to log in at this time.' });
  }
}

// Returns public details for the authenticated user using their stored email.
async function me(req, res) {
  try {
    const user = await getUserByEmail(req.user.email);
    if (!user) {
      return res.status(401).json({ message: 'User no longer exists.' });
    }
    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: req.user.role,
        roles: accountRoles(user),
      },
    });
  } catch (error) {
    console.error('Fetch current user error:', error);
    return res.status(500).json({ message: 'Unable to fetch current user.' });
  }
}

// Switches the session only to a role currently provisioned in the secure database.
async function switchRole(req, res) {
  try {
    const user = await getUserByEmail(req.user.email);
    if (!user || !accountRoles(user).includes(req.body?.role)) return res.status(403).json({ message: 'This role is not assigned to your account.' });
    return res.json(session(user, req.body.role));
  } catch { return res.status(503).json({ message: 'Unable to switch roles. Please try again.' }); }
}
module.exports = { login, me, switchRole };
