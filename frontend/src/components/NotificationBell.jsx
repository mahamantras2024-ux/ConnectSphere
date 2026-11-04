// File: The notification bell shown on every page for every signed-in role (parent notification system AC1).
import { useEffect, useRef, useState } from 'react';
import { useNotifications } from '../context/NotificationsContext';
import NotificationItem from './NotificationItem';
import NotificationSettings from './NotificationSettings';

/** Bell with the unread count; opens a list of recent previews. Closes on Escape or a click outside. */
export default function NotificationBell() {
  const { notifications, unreadCount, loading, error, hasData } = useNotifications();
  const [open, setOpen] = useState(false);
  const container = useRef(null);
  const bellButton = useRef(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (event.type === 'keydown' ? event.key === 'Escape' : !container.current.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  /** The gear disappears with its dropdown, so restore focus to the persistent bell when the dialog closes. */
  function openSettings() {
    bellButton.current.focus();
    setOpen(false);
    setSettingsOpen(true);
  }

  return (
    <div className="notification-bell" ref={container}>
      <button ref={bellButton} type="button" className="notification-bell-button" aria-expanded={open} aria-haspopup="true"
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`} onClick={() => setOpen((current) => !current)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unreadCount > 0 && <span className="notification-count" aria-hidden="true">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>
      {open && (
        <div className="notification-dropdown" role="region" aria-label="Recent notifications">
          <div className="notification-dropdown-header">
            <h2>Notifications</h2>
            <button type="button" className="notification-settings-button" aria-label="Notification settings"
              title="Notification settings" onClick={openSettings}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 2 3-1 2 2 3-1 1-3 3-1 2-3-2-2 1-3-3-2-3 1-2-2Z" />
                <circle cx="12" cy="10.5" r="3" />
              </svg>
            </button>
          </div>
          {loading ? <p role="status" className="loading-state">Loading notifications...</p>
            : !hasData && error ? <p className="error-message">Notifications could not be loaded right now.</p>
              : notifications.length === 0 ? <p className="text-slate-600">No notifications yet.</p>
                : <ul className="notification-list">{notifications.map((notification) => (
                  <NotificationItem key={notification.id} notification={notification} onOpen={() => setOpen(false)} />
                ))}</ul>}
          {hasData && error && <p className="error-message">Notifications could not be refreshed. Showing the last loaded information.</p>}
        </div>
      )}
      {settingsOpen && <NotificationSettings onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
