// File: One shared, regularly refreshed list of the signed-in user's notifications (parent notification system).
import { createContext, useCallback, useContext, useMemo } from 'react';
import { api } from '../api/client';
import { useAuth } from './AuthContext';
import useLiveResource from '../hooks/useLiveResource';

// null outside any provider, so a component used on its own can tell it needs its own list (NotificationsBoundary).
const NotificationsContext = createContext(null);
// No notifications means nothing can be pressed, so the empty list needs no markRead.
const EMPTY = { notifications: [], unreadCount: 0, loading: false, error: '', hasData: false };

/**
 * Reads the user's notifications every five seconds and on window focus (useLiveResource), so a change made elsewhere
 * reaches any open page within the ten-second AC1 limit. The bell and the dashboard panels share this one request.
 */
function LiveNotifications({ token, enabled, children }) {
  const { data, loading, error, updateData } = useLiveResource(enabled ? '/notifications' : null, token);

  // Marks one notification read. The local update invalidates older reads, so a delayed refresh cannot bring back
  // its unread state, and the unread count only drops if it was still unread.
  const markRead = useCallback(async (notification) => {
    const result = await api.post(`/notifications/${notification.id}/read`, {}, token);
    updateData((current) => {
      if (!current) return current;
      const wasUnread = current.notifications.some((item) => item.id === notification.id && !item.read_at);
      return { ...current,
        notifications: current.notifications.map((item) => (item.id === notification.id ? { ...item, read_at: result.notification.read_at } : item)),
        unreadCount: current.unreadCount - (wasUnread ? 1 : 0) };
    });
  }, [token, updateData]);

  const value = useMemo(() => ({ notifications: data?.notifications || [], unreadCount: data?.unreadCount || 0,
    loading, error, hasData: Boolean(data), markRead }), [data, loading, error, markRead]);
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

/**
 * Provides notifications for the signed-in user; signed-out pages get an empty list and make no request. The same
 * component is always rendered, so signing in never remounts (and resets) the pages inside it.
 */
export function NotificationsProvider({ children }) {
  const { token, user } = useAuth();
  return <LiveNotifications token={token} enabled={Boolean(token && user)}>{children}</LiveNotifications>;
}

/** The shared notification list, unread count and markRead action (an empty list outside any provider). */
export function useNotifications() {
  return useContext(NotificationsContext) || EMPTY;
}

/** Uses the app's shared list when present; otherwise (e.g. a panel rendered on its own) provides one for its children. */
export function NotificationsBoundary({ children }) {
  const shared = useContext(NotificationsContext);
  return shared ? children : <NotificationsProvider>{children}</NotificationsProvider>;
}
