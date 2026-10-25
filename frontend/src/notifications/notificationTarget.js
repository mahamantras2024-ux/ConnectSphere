// File: Decides which page a notification opens (parent notification system AC4).
import { getDashboardRoute } from '../auth/dashboardRoutes';

// Where each role reviews a specific event. Staff roles without an event page work from their dashboard queues.
const EVENT_PAGES = {
  event_organiser: (id) => `/organizer/events/${id}`,
  attendee: (id) => `/attendee/events/${id}`,
  event_coordinator: (id) => `/events/${id}`,
  event_coordinator_lead: (id) => `/events/${id}`,
};

/**
 * The page where a notification's update happened, for the signed-in role.
 * - A new request to assign opens the Coordinator Lead's assignment queue.
 * - A new amendment (change) request opens the coordinator's dashboard, whose Amendment requests inbox is where it is
 *   approved or rejected (the event page has no decision controls).
 * - A safety-check notification opens the Safety Officer's queue.
 * - Otherwise the related event's page for that role, or the role's dashboard when it has no event page or no event.
 * @param {{ type: string, event_id: number|null }} notification stored notification.
 * @param {string} role the signed-in user's active role.
 * @returns {string} an in-app path.
 */
export function notificationTarget(notification, role) {
  if (notification.type === 'event_awaiting_assignment') return '/coordinator-lead/dashboard';
  if (notification.type === 'change_request_submitted' && role === 'event_coordinator') return '/coordinator/dashboard';
  if (role === 'safety_officer') return '/safety/dashboard';
  const eventPage = EVENT_PAGES[role];
  return notification.event_id != null && eventPage ? eventPage(notification.event_id) : getDashboardRoute(role);
}
