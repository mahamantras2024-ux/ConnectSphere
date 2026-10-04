// File: Verifies JWTs against current database identity and session version for protected requests.
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { accountRoles } = require('../auth/roles');

const JWT_SECRET = process.env.JWT_SECRET;

// Verifies the bearer JWT and reloads current user role/session version before allowing the request.
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';

  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized: Missing token.' });
  }

  const token = authHeader.slice(7).trim();

  if (!token) {
    return res.status(401).json({ message: 'Unauthorized: Missing token.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    const result = await db.query(
      "SELECT id, email, role, auth_version, COALESCE(to_jsonb(users)->'roles', '[]'::jsonb) AS roles FROM users WHERE id = $1",
      [decoded.sub]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Unauthorized: User not found.' });
    }

    if ((decoded.authVersion || 0) !== (result.rows[0].auth_version || 0)) {
      return res.status(401).json({ message: 'Session expired. Please log in again.' });
    }

    const current = result.rows[0];
    const roles = accountRoles(current);
    const activeRole = decoded.activeRole || current.role;
    if (!roles.includes(activeRole)) return res.status(401).json({ message: 'Role access changed. Please log in again.' });
    req.user = { ...current, roles, role: activeRole };
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Unauthorized: Invalid token.' });
  }
}

module.exports = {
  requireAuth,
  JWT_SECRET
};
