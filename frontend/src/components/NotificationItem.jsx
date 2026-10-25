// File: One notification preview that opens the page the update happened on (parent notification system AC2-AC4).
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationsContext';
import { exactTime, previewText, relativeTime } from '../notifications/notificationPreview';
import { notificationTarget } from '../notifications/notificationTarget';
import { OPENED_KEY } from '../notifications/useNotificationOpened';

/**
 * A preview: the title, a one-line summary (AC2) and when the update happened, relative with the exact time (AC3).
 * Pressing it marks it read and opens the related page (AC4); a failed mark-read still opens the page.
 * @param {{ notification: object, onOpen?: () => void, details?: boolean, children?: import('react').ReactNode }} props
 *   `onOpen` lets a dropdown close itself; `details` adds the full message under an expandable "Details" when the preview
 *   shortens it (dashboard panels); `children` are extra controls shown beside the preview (e.g. Mark as read).
 */
export default function NotificationItem({ notification, onOpen, details = false, children }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { markRead } = useNotifications();
  const unread = !notification.read_at;
  const summary = previewText(notification.message);
  const ago = relativeTime(notification.created_at);
  // The full message is offered only when the preview leaves something out (extra lines or a shortened sentence).
  const hasMore = details && summary !== notification.message.trim();

  async function open() {
    onOpen?.();
    if (unread) await markRead(notification).catch(() => {});
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
      {hasMore && (
        <details className="notification-details">
          <summary>Details</summary>
          <p className="whitespace-pre-wrap">{notification.message}</p>
        </details>
      )}
      {children}
    </li>
  );
}
