// SCRUM-93: the read-only status surface shared by an owner's detail page and organisation colleagues.
import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import useLiveResource from '../../hooks/useLiveResource';
import { requestStatusLabel } from './requestStatusLabel';

/** Polls only status/action/decision facts, retaining a confirmed snapshot during transient failures. */
export default function EventRequestStatus({ eventId, onSnapshot }) {
  const { id } = useParams();
  const { token } = useAuth();
  const requestId = eventId || id;
  const { data, loading, error } = useLiveResource(`/events/${requestId}/request-status`, token, { retryAfterMs: 3000 });
  const event = data?.event;
  useEffect(() => {
    // Owner detail updates only lifecycle facts; its separate unsaved edit form is never reset by a poll.
    if (event && onSnapshot) onSnapshot(event);
  }, [event, onSnapshot]);
  return <section className="ed-card" aria-label="Request status">
    <h2>Request status</h2>
    {loading && !event && <p>Loading request status...</p>}
    {error && <p>{error} Status updates are temporarily unavailable.</p>}
    {event && <>
      {!eventId && <h3>{event.name}</h3>}
      <p>Current status: <strong>{requestStatusLabel(event.status)}</strong></p>
      {event.clarification_outstanding && <p>Action required: clarification outstanding.
        {event.can_manage ? ' Please respond to the Coordinator’s clarification request.' : ' The submitting organiser must respond.'}
      </p>}
      {(event.decided_at || ['approved', 'rejected'].includes(event.status)) && <p>
        Initial request outcome: {event.status === 'rejected' ? 'Rejected' : 'Approved'}.
        {event.status === 'rejected' && ` Rejection reason: ${event.decision_reason || 'No reason was provided.'}`}
      </p>}
      {!eventId && event.can_manage && <Link to={`/organizer/events/${event.id}`}>View details and respond</Link>}
    </>}
    {!eventId && <Link to="/organizer/events">Back to event requests</Link>}
  </section>;
}
