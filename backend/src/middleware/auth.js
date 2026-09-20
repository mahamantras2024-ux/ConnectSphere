const jwt = require('jsonwebtoken');
const db = require('../config/db');

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
const JWT_SECRET = process.env.JWT_SECRET || 'connectsphere-secret';

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized: Missing token.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'connectsphere-secret');

    const result = await db.query(
      'SELECT id, email, role FROM users WHERE id = $1',
      [decoded.sub]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Unauthorized: User not found.' });
    }

    req.user = result.rows[0];
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { sub, role, email }
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
  requireRole
};
