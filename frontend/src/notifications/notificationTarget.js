// File: Decides which page a notification opens (parent notification system AC4).
import { getDashboardRoute } from '../auth/dashboardRoutes';

// Where each role reviews a specific event. Staff roles without an event page work from their dashboard queues.
const EVENT_PAGES = {
  event_organiser: (id) => `/organizer/events/${id}`,
  attendee: (id) => `/attendee/events/${id}`,
  event_coordinator: (id) => `/events/${id}`,
  event_coordinator_lead: (id) => `/events/${id}`,
};

// On-site assignment notifications are only ever delivered to Technical Support Staff, so they always open the
// tech-support dashboard regardless of the viewer's role or event id. Equipment-status notifications are NOT in this
// set: they can also reach an Event Coordinator, so they are routed by recipient role below instead of unconditionally.
const TECH_SUPPORT_ASSIGNMENT_TYPES = new Set([
  'tech_support_assignment_created',
  'tech_support_assignment_updated',
  'tech_support_assignment_cancelled',
]);

/** The dashboard anchor the Safety Officer queue uses to focus the event a notification refers to (AC3). */
export const SAFETY_EVENT_ANCHOR = (id) => `safety-event-${id}`;

/**
 * The page where a notification's update happened, for the signed-in role.
 * - A new request to assign opens the Coordinator Lead's assignment queue.
 * - A new amendment (change) request opens the coordinator's dashboard, whose Amendment requests inbox is where it is
 *   approved or rejected (the event page has no decision controls).
 * - A Technical Support assignment notification opens the tech-support dashboard, independent of the event id.
 * - An equipment-status notification opens the tech-support dashboard for a Technical Support recipient; for any other
 *   role (e.g. an Event Coordinator) it uses that role's normal event-page/dashboard route.
 * - A Safety Officer notification opens the safety dashboard, anchored to the specific event when one is named, so the
 *   relevant event and its current review requirement are shown (AC3).
 * - Otherwise the related event's page for that role, or the role's dashboard when it has no event page or no event.
 * @param {{ type: string, event_id: number|null, details?: { kind?: string }|null }} notification stored notification.
 * @param {string} role the signed-in user's active role.
 * @returns {string} an in-app path.
 */
export function notificationTarget(notification, role) {
  // The outgoing coordinator's notice must not open event details after responsibility has transferred.
  if (notification.details?.kind === 'event_reassigned_away') return getDashboardRoute(role);
  // Organisation colleagues have status-only access; this target never opens another organiser’s private detail page.
  if (notification.type === 'event_request_status_changed' && role === 'event_organiser' && notification.event_id != null) return `/organizer/events/${notification.event_id}/status`;
  if (notification.type === 'event_awaiting_assignment') return '/coordinator-lead/dashboard';
  if (notification.type === 'change_request_submitted' && role === 'event_coordinator') return '/coordinator/dashboard';
  // Assignment work is tech-support-only and dashboard-owned, so route by type before any role/event-page branch.
  if (TECH_SUPPORT_ASSIGNMENT_TYPES.has(notification.type)) return '/tech-support/dashboard';
  // An equipment-status notification opens the tech-support dashboard only for a Technical Support recipient; any other
  // role (e.g. an Event Coordinator who also receives it) falls through to its own event-page/dashboard route below.
  if (notification.type === 'equipment_status_changed' && role === 'technical_support') return '/tech-support/dashboard';
  if (role === 'safety_officer') {
    return notification.event_id != null
      ? `/safety/dashboard#${SAFETY_EVENT_ANCHOR(notification.event_id)}`
      : '/safety/dashboard';
  }
  const eventPage = EVENT_PAGES[role];
  return notification.event_id != null && eventPage ? eventPage(notification.event_id) : getDashboardRoute(role);
}
