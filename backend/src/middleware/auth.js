const jwt = require('jsonwebtoken');
const db = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'connectsphere-secret';

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
      'SELECT id, email, role, auth_version FROM users WHERE id = $1',
      [decoded.sub]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Unauthorized: User not found.' });
    }

    if ((decoded.authVersion || 0) !== (result.rows[0].auth_version || 0)) {
      return res.status(401).json({ message: 'Session expired. Please log in again.' });
    }

    req.user = result.rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Unauthorized: Invalid token.' });
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Unauthorized.' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        message: 'Forbidden: You do not have permission to access this resource.'
      });
    }

    next();
  };
}

module.exports = {
  requireAuth,
  requireRole,
  JWT_SECRET
};
