// File: The notification bell shown on every page for every signed-in role (parent notification system AC1).
import { useEffect, useRef, useState } from 'react';
import { useNotifications } from '../context/NotificationsContext';
import NotificationItem from './NotificationItem';

/** Bell with the unread count; opens a list of recent previews. Closes on Escape or a click outside. */
export default function NotificationBell() {
  const { notifications, unreadCount, loading, error, hasData } = useNotifications();
  const [open, setOpen] = useState(false);
  const container = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (event.type === 'keydown' ? event.key === 'Escape' : !container.current.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  return (
    <div className="notification-bell" ref={container}>
      <button type="button" className="notification-bell-button" aria-expanded={open} aria-haspopup="true"
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`} onClick={() => setOpen((current) => !current)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unreadCount > 0 && <span className="notification-count" aria-hidden="true">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>
      {open && (
        <div className="notification-dropdown" role="region" aria-label="Recent notifications">
          {loading ? <p role="status" className="loading-state">Loading notifications...</p>
            : !hasData && error ? <p className="error-message">Notifications could not be loaded right now.</p>
              : notifications.length === 0 ? <p className="text-slate-600">No notifications yet.</p>
                : <ul className="notification-list">{notifications.map((notification) => (
                  <NotificationItem key={notification.id} notification={notification} onOpen={() => setOpen(false)} />
                ))}</ul>}
          {hasData && error && <p className="error-message">Notifications could not be refreshed. Showing the last loaded information.</p>}
        </div>
      )}
    </div>
  );
}
