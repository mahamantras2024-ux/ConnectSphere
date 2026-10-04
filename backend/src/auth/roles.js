// File: Defines provisioned roles and filters account roles for staff/external access.
const externalRoles = ['event_organiser', 'attendee'];
const internalRoles = ['event_coordinator', 'venue_staff', 'technical_support', 'event_coordinator_lead', 'safety_officer'];
const allRoles = [...externalRoles, ...internalRoles];
// Returns valid provisioned roles, retaining the primary role for existing accounts.
function accountRoles(user) {
  return [...new Set([user.role, ...(Array.isArray(user.roles) ? user.roles : [])])].filter(role =>
      // Keeps entries that meet the required field or access condition.
      allRoles.includes(role));
}
// Limits selectable roles to the current login audience.
function audienceRoles(user, audience) {
  const allowed = audience === 'external' ? externalRoles : audience === 'internal' ? internalRoles : allRoles;
  return accountRoles(user).filter(role =>
      // Keeps entries that meet the required field or access condition.
      allowed.includes(role));
}
module.exports = { externalRoles, internalRoles, allRoles, accountRoles, audienceRoles };
