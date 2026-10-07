// File: Shows the signed-in user's in-app notifications with an unread count and lets them mark each one read.
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

/** Displays a stored timestamp in Singapore time, matching how event times are entered. */
function formatTime(value) {
  return new Date(value).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Dashboard panel for notifications such as new change requests (coordinators), decisions (organisers) and
 * changed event details (Venue Staff, Technical Support). Messages are rendered as plain text.
 */
export default function NotificationsPanel() {
  const { token } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [marking, setMarking] = useState(null);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    // Loads once per session token; the panel unmounts on logout or role switch, so no stale-response guard is needed.
    api.get('/notifications', token).then((data) => {
      // Tolerates a response without the list (e.g. an older API) by showing no notifications instead of crashing the dashboard.
      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
    }).catch(() => {
      // A plain message (not an alert) keeps a notification outage from masking the dashboard's own errors.
      setLoadFailed(true);
    });
  }, [token]);

  // Marks one notification read; the button is disabled while its request is in flight so the count drops once.
  async function markRead(notification) {
    setMarking(notification.id); setActionError('');
    try {
      const data = await api.post(`/notifications/${notification.id}/read`, {}, token);
      setNotifications((current) => current.map((item) => (item.id === notification.id ? { ...item, read_at: data.notification.read_at } : item)));
      setUnreadCount((count) => count - 1);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setMarking(null);
    }
  }

  return (
    <section className="notifications-panel" aria-labelledby="notifications-title">
      <div className="section-heading"><h2 id="notifications-title">Notifications</h2><span className="badge">{unreadCount} unread</span></div>
      {loadFailed ? <p className="error-message">Notifications could not be loaded right now.</p>
        : notifications.length === 0 ? <p className="text-slate-600">No notifications yet.</p>
          : <ul className="notification-list">{notifications.map((notification) => (
            <li key={notification.id} className={notification.read_at ? 'notification-item' : 'notification-item notification-unread'}>
              <div className="notification-header">
                <strong>{notification.title}</strong>
                {!notification.read_at && <span className="status-badge status-under_review">New</span>}
              </div>
              <p className="whitespace-pre-wrap">{notification.message}</p>
              <p className="text-sm text-slate-500"><time dateTime={notification.created_at}>{formatTime(notification.created_at)}</time></p>
              {!notification.read_at && (
                <button type="button" className="button-secondary" disabled={marking === notification.id}
                  aria-label={`Mark ${notification.title} as read`} onClick={() => markRead(notification)}>Mark as read</button>
              )}
            </li>
          ))}</ul>}
      {actionError && <p role="alert" className="error-message">{actionError}</p>}
    </section>
  );
}
