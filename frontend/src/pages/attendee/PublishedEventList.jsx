import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

/** Lists only published, registration-enabled events and links attendees to their current details. */
export default function PublishedEventList() {
  const { token } = useAuth();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    // Request the current catalogue on each dashboard visit so attendees can open the latest published records.
    setLoading(true);
    setError('');
    api.get('/events/published', token)
      .then(data => setEvents(data.events || []))
      .catch(loadError => setError(loadError.message))
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <section className="page" aria-labelledby="published-events-heading">
      <div className="section-heading"><h2 id="published-events-heading">Published events</h2></div>
      {loading ? <p role="status" className="loading-state">Loading published events…</p>
        : error ? <p role="alert" className="error-message">{error}</p>
          : events.length === 0 ? <p className="empty-state">No published events are open for registration.</p>
            : <div className="record-grid">{events.map(event => (
              <article className="record-card" key={event.id}>
                <span className="status-badge status-confirmed">Confirmed</span>
                <h3>{event.name}</h3>
                <p>{event.proposed_date || 'Date not specified'}</p>
                <Link className="button-link button-secondary record-action" to={`/attendee/events/${event.id}`}>View event details</Link>
              </article>
            ))}</div>}
    </section>
  );
}
