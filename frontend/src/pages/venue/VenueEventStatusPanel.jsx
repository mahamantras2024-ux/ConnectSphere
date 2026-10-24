// File: Presents assigned-venue event stages and the preparation information Venue Staff may act upon.
import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

const statusLabels = { planning: 'Planning', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled' };

/** Shows only server-authorized event details and makes cancellation operationally distinct from completed history. */
export default function VenueEventStatusPanel() {
  const { token } = useAuth();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    // The server applies venue assignment scope; the UI never receives unrelated events to filter locally.
    api.get('/venues/relevant-events', token)
      .then(data => { if (active) setEvents(data.events || []); })
      .catch(requestError => { if (active) setError(requestError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  return <section className="venue-event-status" aria-labelledby="venue-event-status-title">
    <div className="section-heading"><div><p className="eyebrow">Venue arrangements</p><h2 id="venue-event-status-title">Event status for your venue bookings</h2></div></div>
    {loading ? <p role="status">Loading relevant event statuses…</p>
      : error ? <p role="alert" className="error-message">{error}</p>
        : events.length === 0 ? <p>No events are currently linked to your assigned venues.</p>
          : <div className="record-grid">{events.map(event => <article className="record-card" key={event.bookingId}>
            <span className="status-badge">{statusLabels[event.status] || 'Status unavailable'}</span>
            <h3>{event.name}</h3><p>{event.venueName}</p>
            {event.status === 'cancelled'
              ? <p className="detail-note">This event will no longer proceed. Handle the associated venue reservation according to the cancellation rules.</p>
              : <dl className="detail-facts"><div><dt>Expected attendance</dt><dd>{event.expectedAttendance ?? 'Not specified'}</dd></div>
                <div><dt>Room layout</dt><dd>{event.roomLayout || 'Not specified'}</dd></div>
                <div><dt>Accessibility</dt><dd>{event.accessibility.join(', ') || 'None recorded'}</dd></div></dl>}
          </article>)}</div>}
  </section>;
}
