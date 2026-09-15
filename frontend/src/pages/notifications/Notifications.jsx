import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';

// Covers: Notification System (inbox view).
export default function Notifications() {
  const { token } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [error, setError] = useState('');

  function load() {
    api.get('/notifications', token).then((data) => setNotifications(data.notifications)).catch((err) => setError(err.message));
  }

  useEffect(load, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  async function markRead(id) {
    await api.post(`/notifications/${id}/read`, {}, token);
    load();
  }

  return (
    <div>
      <h1>Notifications</h1>
      {error && <p className="error-text">{error}</p>}
      {notifications.length === 0 && <p>No notifications yet.</p>}
      {notifications.map((n) => (
        <div className="card" key={n.id} style={{ opacity: n.is_read ? 0.6 : 1 }}>
          <p>{n.message}</p>
          <p style={{ fontSize: '0.8rem', color: '#6b7280' }}>{new Date(n.created_at).toLocaleString()}</p>
          {!n.is_read && <button onClick={() => markRead(n.id)}>Mark as read</button>}
        </div>
      ))}
      <div className="todo-note">
        TODO: nothing in the backend creates real notifications yet — see
        notificationController.js. Call notificationModel.create() at each
        trigger point in customer briefing section 6 as those flows are built.
      </div>
    </div>
  );
}
