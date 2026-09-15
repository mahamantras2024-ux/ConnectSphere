import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';

// Covers: Event Review and Approval, Event Status Management (listing part).
export default function EventList() {
  const { token, user } = useAuth();
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/events', token)
      .then((data) => setEvents(data.events))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Events</h1>
        {user.role === 'event_organiser' && <Link to="/events/new"><button>New event request</button></Link>}
      </div>

      {loading && <p>Loading…</p>}
      {error && <p className="error-text">{error}</p>}

      {!loading && events.length === 0 && <p>No events yet.</p>}

      {events.map((ev) => (
        <div className="card" key={ev.id}>
          <h3>
            <Link to={`/events/${ev.id}`}>{ev.name}</Link>{' '}
            <span className="badge">{ev.status}</span>
          </h3>
          <p>{ev.purpose}</p>
          <p style={{ fontSize: '0.85rem', color: '#6b7280' }}>
            {ev.proposed_date ? new Date(ev.proposed_date).toLocaleDateString() : 'No date yet'}
            {' · '}Expected attendance: {ev.expected_attendance ?? '—'}
          </p>
        </div>
      ))}

      <div className="todo-note">
        TODO: filtering/sorting, pagination, and role-specific views (e.g. "pending my
        review" for coordinators) — see eventController.listEvents on the backend.
      </div>
    </div>
  );
}
