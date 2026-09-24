import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';

export default function EventList() {
  const { token, user } = useAuth();
  const organiser = user.role === 'event_organiser';
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function fetchEvents() {
      try {
        setLoading(true);
        setError('');

        const data = await api.get('/events', token);
        if (isMounted) {
          setEvents(data.events || []);
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message || 'Unable to load events.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    fetchEvents();

    return () => {
      isMounted = false;
    };
  }, [token]);

  if (loading) return <p>Loading events...</p>;
  if (error) return <p className="error-text">{error}</p>;

  return (
    <div className="page">
      <div className="page-header">
        <h1>{organiser ? 'My Events' : 'Events'}</h1>
        {organiser && <Link to="/organizer/events/new">Request an event</Link>}
      </div>

      {events.length === 0 ? (
        <p>{organiser ? 'You have not requested any events yet.' : 'No events found.'}</p>
      ) : (
        <div className="list">
          {events.map((event) => (
            <div key={event.id} className="card">
              <h3>{event.name || 'Untitled Event'}</h3>
              <p>Status: {event.status || 'Draft'}</p>
              <p>{event.purpose || 'No purpose provided'}</p>
              <Link to={`${organiser ? '/organizer/events' : '/events'}/${event.id}`}>View details</Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
