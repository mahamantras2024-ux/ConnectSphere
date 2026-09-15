import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';

// Covers: Attendee Registration (attendee's own view).
export default function MyRegistrations() {
  const { token } = useAuth();
  const [registrations, setRegistrations] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/registrations/mine', token).then((data) => setRegistrations(data.registrations)).catch((err) => setError(err.message));
  }, [token]);

  return (
    <div>
      <h1>My registrations</h1>
      {error && <p className="error-text">{error}</p>}
      {registrations.length === 0 && <p>You haven't registered for any events yet.</p>}
      {registrations.map((r) => (
        <div className="card" key={r.id}>
          <p>Event #{r.event_id} <span className="badge">{r.status}</span></p>
        </div>
      ))}
      <div className="todo-note">
        TODO: join in event name/date instead of just the event id, and add a
        withdraw button wired to POST /api/registrations/:eventId/withdraw.
      </div>
    </div>
  );
}
