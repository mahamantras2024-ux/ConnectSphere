import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';

// Covers: Event Information Management, Event Status Management (detail view),
// and is the natural place to later surface venue bookings / equipment
// reservations / registrations / change requests for a single event.
export default function EventDetail() {
  const { id } = useParams();
  const { token, user } = useAuth();
  const [event, setEvent] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/events/${id}`, token)
      .then((data) => setEvent(data.event))
      .catch((err) => setError(err.message));
  }, [id, token]);

  if (error) return <p className="error-text">{error}</p>;
  if (!event) return <p>Loading…</p>;

  return (
    <div>
      <div className="card">
        <h1>{event.name} <span className="badge">{event.status}</span></h1>
        <p>{event.description || <em>No description yet.</em>}</p>
        <p><strong>Purpose:</strong> {event.purpose || '—'}</p>
        <p><strong>Proposed date:</strong> {event.proposed_date ? new Date(event.proposed_date).toLocaleDateString() : '—'}</p>
        <p><strong>Expected attendance:</strong> {event.expected_attendance ?? '—'}</p>
        <p><strong>Layout preference:</strong> {event.room_layout_preference || '—'}</p>
        <p><strong>Registration required:</strong> {event.registration_required ? 'Yes' : 'No'}</p>
      </div>

      {user.role === 'event_coordinator' && (
        <div className="card">
          <h3>Coordinator actions</h3>
          <p style={{ fontSize: '0.85rem', color: '#6b7280' }}>
            Wire these buttons up to POST /api/events/:id/status,
            /api/bookings/venue, and /api/bookings/equipment as those workflows
            are built out.
          </p>
        </div>
      )}

      <div className="todo-note">
        TODO: this page should eventually show the event's venue booking status,
        equipment reservations, registration count, change-request history, and
        the event_status_history audit trail. All of those already have backend
        endpoints/models — just not wired into this screen yet.
      </div>
    </div>
  );
}
