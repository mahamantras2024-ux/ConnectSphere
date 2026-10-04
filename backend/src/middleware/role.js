// File: Provides role checks for authenticated routes; controllers separately enforce record ownership and assignment.
// Restricts a route to a set of roles. Use after requireAuth.
// Example: router.post('/venues', requireAuth, requireRole('venue_staff'), controller.create)
//
// Creates middleware that permits only the supplied roles after authentication.
function requireRole(...allowedRoles) {
  return function (req, res, next) {
    // Checks the authenticated user against the configured allowed roles before calling next.

    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden for this role.' });
    }
    next();
  };
}

module.exports = { requireRole };
