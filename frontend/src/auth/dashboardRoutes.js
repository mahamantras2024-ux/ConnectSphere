const dashboardRoutes = {
  technical_support: '/tech-support/dashboard',
  event_coordinator: '/coordinator/dashboard',
  venue_staff: '/venue/dashboard',
  event_organiser: '/organizer/dashboard',
  attendee: '/attendee/dashboard',
  'Technical Support': '/tech-support/dashboard',
  'Event Coordinator': '/coordinator/dashboard',
  'Venue Staff': '/venue/dashboard',
  'Event Organiser': '/organizer/dashboard',
  Attendee: '/attendee/dashboard',
};

export function getDashboardRoute(role) {
  return Object.hasOwn(dashboardRoutes, role) ? dashboardRoutes[role] : '/dashboard';
}
