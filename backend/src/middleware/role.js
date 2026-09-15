// Restricts a route to a set of roles. Use after requireAuth.
// Example: router.post('/venues', requireAuth, requireRole('venue_staff'), controller.create)
//
// TODO: this only checks role, not "relationship to an event" (e.g. an Event Organiser
// should only see their own events). Add resource-ownership checks per-controller as
// those user stories are written — see the security NFR in the customer briefing.
function requireRole(...allowedRoles) {
  return function (req, res, next) {
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
