// File: Dashboard panel listing the signed-in user's notifications as short, clickable previews.
import { useState } from 'react';
import { NotificationsBoundary, useNotifications } from '../context/NotificationsContext';
import NotificationItem from './NotificationItem';

/**
 * Dashboard view of the shared notification list (the same data as the navbar bell, so only one request is made).
 * Each preview opens the related page (parent notification system AC4); "Mark as read" dismisses one without leaving.
 */
function PanelBody() {
  const { notifications, unreadCount, loading, error, hasData, markRead } = useNotifications();
  const [marking, setMarking] = useState(null);
  const [actionError, setActionError] = useState('');

  // Marks one notification read; the button is disabled while its request is in flight so the count drops once.
  async function dismiss(notification) {
    setMarking(notification.id); setActionError('');
    try { await markRead(notification); } catch (err) { setActionError(err.message); } finally { setMarking(null); }
  }

  return (
    <section className="notifications-panel" aria-labelledby="notifications-title">
      <div className="section-heading"><h2 id="notifications-title">Notifications</h2>{!loading && <span className="badge">{unreadCount} unread</span>}</div>
      {loading ? <p role="status" className="loading-state">Loading notifications...</p>
        : error && !hasData ? <p className="error-message">Notifications could not be loaded right now.</p>
          : notifications.length === 0 ? <p className="text-slate-600">No notifications yet.</p>
            : <ul className="notification-list">{notifications.map((notification) => (
              <NotificationItem key={notification.id} notification={notification} details>
                {!notification.read_at && (
                  <button type="button" className="button-secondary" disabled={marking === notification.id}
                    aria-label={`Mark ${notification.title} as read`} onClick={() => dismiss(notification)}>Mark as read</button>
                )}
              </NotificationItem>
            ))}</ul>}
      {actionError && <p role="alert" className="error-message">{actionError}</p>}
      {error && hasData && <p className="error-message">Notifications could not be refreshed. Showing the last loaded information.</p>}
    </section>
  );
}

/** The panel, using the app's shared notification list (or its own when rendered outside the app shell). */
export default function NotificationsPanel() {
  return <NotificationsBoundary><PanelBody /></NotificationsBoundary>;
}
