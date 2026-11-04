// File: One notification preview that opens the page the update happened on (parent notification system AC2-AC4).
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationsContext';
import { exactTime, previewText, relativeTime } from '../notifications/notificationPreview';
import { notificationTarget } from '../notifications/notificationTarget';
import { OPENED_KEY } from '../notifications/useNotificationOpened';

/**
 * A preview: the title, a one-line summary (AC2) and when the update happened, relative with the exact time (AC3).
 * Pressing it opens the related page straight away and marks it read in the background (AC4), so a slow, stalled or
 * failed mark-read never delays or blocks the page.
 * @param {{ notification: object, onOpen: () => void }} props notification data and the dropdown close callback.
 */
export default function NotificationItem({ notification, onOpen }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { markRead } = useNotifications();
  const unread = !notification.read_at;
  const summary = previewText(notification.message);
  const ago = relativeTime(notification.created_at);

  function open() {
    onOpen();
    // Marking read runs in the background: a slow, stalled or failed request must never keep the organiser off the page
    // the notification is about (AC4). The shared list updates when the request completes.
    if (unread) markRead(notification).catch(() => {});
    // The timestamp lets the target page re-read its data even when it is the page already open.
    navigate(notificationTarget(notification, user.role), { state: { [OPENED_KEY]: Date.now() } });
  }

  return (
    <li className={unread ? 'notification-item notification-unread' : 'notification-item'}>
      <button type="button" className="notification-open" onClick={open} aria-label={`${notification.title}${unread ? ' (new)' : ''}`}>
        <span className="notification-header">
          <strong>{notification.title}</strong>
          {unread && <span className="status-badge status-under_review">New</span>}
        </span>
        <span className="notification-summary">{summary}</span>
        <span className="notification-time">
          {ago && <><span>{ago}</span>{' · '}</>}<time dateTime={notification.created_at}>{exactTime(notification.created_at)}</time>
        </span>
      </button>
    </li>
  );
}
