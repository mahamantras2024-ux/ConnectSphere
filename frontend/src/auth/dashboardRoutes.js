// File: Maps database roles and retained display-label aliases to their dashboard URLs.
// Auth is logic about who can see what, separate from the UI itself.

// dashboardRoutes maps a role to its dashboard path
const dashboardRoutes = {
  technical_support: '/tech-support/dashboard',
  event_coordinator: '/coordinator/dashboard',
  venue_staff: '/venue/dashboard',
  event_organiser: '/organizer/dashboard',
  attendee: '/attendee/dashboard',
  event_coordinator_lead: '/coordinator-lead/dashboard',
  safety_officer: '/safety/dashboard',
  'Technical Support': '/tech-support/dashboard',
  'Event Coordinator': '/coordinator/dashboard',
  'Venue Staff': '/venue/dashboard',
  'Event Organiser': '/organizer/dashboard',
  Attendee: '/attendee/dashboard',
};
export const roleLabels = { event_organiser: 'Event Organiser', attendee: 'Attendee', venue_staff: 'Venue Staff',
  event_coordinator: 'Event Coordinator', technical_support: 'Technical Support', event_coordinator_lead: 'Coordinator Lead', safety_officer: 'Safety Officer' };

// Returns the dashboard mapped to an own role key or the generic fallback URL.
export function getDashboardRoute(role) {
  return Object.hasOwn(dashboardRoutes, role) ? dashboardRoutes[role] : '/dashboard';
}
