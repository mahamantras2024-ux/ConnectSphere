// File: Decides which page a notification opens (parent notification system AC4).
import { getDashboardRoute } from '../auth/dashboardRoutes';

// Where each role reviews a specific event. Staff roles without an event page work from their dashboard queues.
const EVENT_PAGES = {
  event_organiser: (id) => `/organizer/events/${id}`,
  attendee: (id) => `/attendee/events/${id}`,
  event_coordinator: (id) => `/events/${id}`,
  event_coordinator_lead: (id) => `/events/${id}`,
};

/** The dashboard anchor the Safety Officer queue uses to focus the event a notification refers to (AC3). */
export const SAFETY_EVENT_ANCHOR = (id) => `safety-event-${id}`;

/**
 * The page where a notification's update happened, for the signed-in role.
 * - A new request to assign opens the Coordinator Lead's assignment queue.
 * - A Safety Officer notification opens the safety dashboard, anchored to the specific event when one is named, so the
 *   relevant event and its current review requirement are shown (AC3).
 * - Otherwise the related event's page for that role, or the role's dashboard when it has no event page or no event.
 * @param {{ type: string, event_id: number|null }} notification stored notification.
 * @param {string} role the signed-in user's active role.
 * @returns {string} an in-app path.
 */
export function notificationTarget(notification, role) {
  if (notification.type === 'event_awaiting_assignment') return '/coordinator-lead/dashboard';
  if (role === 'safety_officer') {
    return notification.event_id != null
      ? `/safety/dashboard#${SAFETY_EVENT_ANCHOR(notification.event_id)}`
      : '/safety/dashboard';
  }
  const eventPage = EVENT_PAGES[role];
  return notification.event_id != null && eventPage ? eventPage(notification.event_id) : getDashboardRoute(role);
}
