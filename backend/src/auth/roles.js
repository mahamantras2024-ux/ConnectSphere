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
/**
 * Returns why a set of roles cannot be provisioned, or null when it is valid.
 * Internal staff accounts are tied to exactly one internal role (staff login story, AC1): an account holding an
 * internal role may hold no other role, internal or external. External accounts keep their existing rule and may
 * combine Event Organiser and Attendee. Repeated entries count once.
 * @param {unknown} roles requested role names.
 * @returns {string|null} a message for the person provisioning the account, or null.
 */
function roleSetError(roles) {
  if (!Array.isArray(roles) || !roles.length || roles.some((role) => !allRoles.includes(role))) {
    return 'Provide a valid set of recognised roles.';
  }
  const unique = [...new Set(roles)];
  if (unique.some((role) => internalRoles.includes(role)) && unique.length !== 1) {
    return 'Internal staff accounts must have exactly one internal role.';
  }
  return null;
}
module.exports = { externalRoles, internalRoles, allRoles, accountRoles, audienceRoles, roleSetError };
