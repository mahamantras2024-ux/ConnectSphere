// File: Lets a page re-read its data when a notification is opened onto it (parent notification system AC4).
import { useLocation } from 'react-router-dom';

/** Navigation state key set by NotificationItem when a notification is pressed. */
export const OPENED_KEY = 'notificationOpenedAt';

/**
 * When a notification was last opened onto the current page (ms), or undefined. Pressing a notification for the page
 * the user is already on keeps the same component mounted, so pages add this to their load effect's dependencies to
 * show the update the notification announced instead of the list loaded earlier.
 * @returns {number|undefined}
 */
export default function useNotificationOpened() {
  return useLocation().state?.[OPENED_KEY];
}
