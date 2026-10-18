import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import AttendeeRegistration from '../registrations/AttendeeRegistration';

const publicStatusLabels = { confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled' };
const publicStatusClasses = { confirmed: 'status-confirmed', completed: 'status-completed', cancelled: 'status-cancelled' };

/** Formats stored 24-hour times without timezone conversion, preserving the event's local schedule. */
function formatEventTime(start, end) {
  const formattedStart = typeof start === 'string' ? start.slice(0, 5) : '';
  const formattedEnd = typeof end === 'string' ? end.slice(0, 5) : '';
  return formattedStart && formattedEnd ? `${formattedStart}–${formattedEnd}` : [formattedStart, formattedEnd].filter(Boolean).join('–') || 'Time not specified';
}

/** Loads fresh attendee-safe details and status for a public event or the attendee's own terminal event. */
export default function AttendeeEventDetails() {
  const { id } = useParams();
  const { token } = useAuth();
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    // Re-fetch each time this route opens, clearing old values so a previous event cannot flash as current.
    setLoading(true);
    setError('');
    setEvent(null);
    api.get(`/events/published/${id}`, token)
      .then(data => setEvent(data.event))
      .catch(loadError => setError(loadError.message))
      .finally(() => setLoading(false));
  }, [id, token]);

  if (loading) return <main className="page"><p role="status" className="loading-state">Loading event details…</p></main>;
  if (error) return <main className="page"><p role="alert" className="error-message">{error}</p><Link to="/attendee/dashboard">Back to events</Link></main>;
  if (!event) return <main className="page"><p>No event details available.</p><Link to="/attendee/dashboard">Back to events</Link></main>;

  const accessibilityNotes = Array.isArray(event.accessibility_requirements)
    ? event.accessibility_requirements.filter(note => typeof note === 'string' && note.trim()) : [];
  const attendeeInformation = typeof event.special_arrangements === 'string' ? event.special_arrangements.trim() : '';

  return (
    <main className="page">
      <Link className="button-link button-secondary" to="/attendee/dashboard">Back to events</Link>
      <article className="record-card">
        <span className={`status-badge ${publicStatusClasses[event.status] || 'status-unknown'}`}>
          {publicStatusLabels[event.status] || 'Status unavailable'}
        </span>
        <h1>{event.name}</h1>
        <dl className="detail-facts">
          <div><dt>Date</dt><dd>{event.proposed_date || 'Date not specified'}</dd></div>
          <div><dt>Time</dt><dd>{formatEventTime(event.proposed_start_time, event.proposed_end_time)}</dd></div>
          <div><dt>Location</dt><dd>{event.venue_name || 'Venue not confirmed'}{event.location ? ` · ${event.location}` : ''}</dd></div>
          <div><dt>Description</dt><dd>{event.description || 'No description provided.'}</dd></div>
          <div><dt>Organiser</dt><dd>{event.organiser_name || 'Organiser not specified'}</dd></div>
        </dl>
      </article>
      <section className="record-card" aria-label="Accessibility and attendee information">
        <h2>Accessibility and attendee information</h2>
        <dl className="detail-facts">
          <div><dt>Accessibility</dt><dd>{accessibilityNotes.length ? <ul>{accessibilityNotes.map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}</ul> : 'No specific accessibility information provided.'}</dd></div>
          <div><dt>Additional information</dt><dd>{attendeeInformation || 'No additional attendee information provided.'}</dd></div>
        </dl>
      </section>
      {/* Registration is an explicit event requirement; attending an open event must not imply signing up. */}
      {event.registration_required === true && <AttendeeRegistration key={id} eventId={id} />}
    </main>
  );
}
