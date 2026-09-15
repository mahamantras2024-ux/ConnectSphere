import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';

// Covers: Venue Availability Calendar.
export default function VenueCalendar() {
  const { id } = useParams();
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/venues/${id}/calendar`, token)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [id, token]);

  if (error) return <p className="error-text">{error}</p>;
  if (!data) return <p>Loading…</p>;

  return (
    <div>
      <h1>{data.venue.name} — availability</h1>
      {data.bookings.length === 0 && <p>No pending/approved bookings.</p>}
      {data.bookings.map((b) => (
        <div className="card" key={b.id}>
          <p><span className="badge">{b.status}</span></p>
          <p>{new Date(b.start_datetime).toLocaleString()} → {new Date(b.end_datetime).toLocaleString()}</p>
        </div>
      ))}
      <div className="todo-note">
        TODO: render this as an actual calendar/timeline component, and factor in
        the venue's turnaround_minutes buffer and any maintenance blocks.
      </div>
    </div>
  );
}
