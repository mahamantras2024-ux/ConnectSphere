import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageIntro from '../../components/PageIntro';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

/** Loads the current owner-scoped registration summary and renders the venue-capacity waiting list. */
export default function EventRegistrationDetails() {
  const { id } = useParams();
  const { token } = useAuth();
  const [event, setEvent] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    // Re-fetch whenever the page opens so the organiser sees current registrations and venue capacity.
    setLoading(true);
    setError('');
    setEvent(null);
    setSummary(null);
    api.get(`/events/${id}/registrations`, token)
      .then(data => {
        setEvent(data.event || null);
        setSummary(data.summary || null);
      })
      .catch(loadError => setError(loadError.message))
      .finally(() => setLoading(false));
  }, [id, token]);

  const backLink = <Link className="button-link button-secondary" to={`/organizer/events/${id}`}>Back to event details</Link>;

  if (loading) return <main className="page">{backLink}<p role="status" className="loading-state">Loading registration details…</p></main>;
  if (error) return <main className="page">{backLink}<p role="alert" className="error-message">{error}</p></main>;
  if (!event || !summary) return <main className="page">{backLink}<p>No registration details are available.</p></main>;

  return (
    <main className="page">
      {backLink}
      <PageIntro
        eyebrow="Event planning"
        title={`${event.name || `Event ${event.id}`} registrations`}
        description="Review current attendee interest and venue-capacity overflow for your event."
      />
      <section className="record-card" aria-label="Registration summary">
        <h2>Registration summary</h2>
        <p>Current headcount: <strong>{summary.headcount}</strong></p>
        <p>Waitlist count: <strong>{summary.waitlist_count}</strong></p>
        <p>Confirmed venue capacity: <strong>{event.venue_capacity ?? 'Not available'}</strong></p>
        <h3>Registration status</h3>
        <dl className="detail-facts">
          <div><dt>Registered</dt><dd>{summary.status_breakdown.registered}</dd></div>
          <div><dt>Withdrawn</dt><dd>{summary.status_breakdown.withdrawn}</dd></div>
        </dl>
      </section>
      <section className="record-card" aria-label="Waiting list">
        <h2>Waiting list</h2>
        {summary.waitlist.length === 0
          ? <p>No attendees are currently on the waiting list.</p>
          : <div className="record-grid">{summary.waitlist.map(attendee => (
            <article className="record-card" key={attendee.registration_id}>
              <strong>{attendee.attendee_name || 'Attendee'}</strong>
              <span>{attendee.reason}</span>
              <small>Registration status: {attendee.status}</small>
              <time dateTime={attendee.registered_at}>{new Date(attendee.registered_at).toLocaleString()}</time>
            </article>
          ))}</div>}
        {event.venue_capacity == null && <p className="detail-note">No confirmed venue capacity is recorded. The list includes registrations already marked as waitlisted.</p>}
      </section>
    </main>
  );
}
