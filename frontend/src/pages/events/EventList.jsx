// File: Loads and displays events owned by the organiser or assigned to the coordinator.
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';
import PageIntro from '../../components/PageIntro';
// Renders real role-scoped summaries with loading, failure, and empty states.
export default function EventList({ dashboard = false }) {
  const { token, user } = useAuth();
  const location = useLocation();
  const organiser = user.role === 'event_organiser';
  const [events, setEvents] = useState([]), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  useEffect(() => {
    // Loads scoped events and ignores stale responses after session changes.
    let active = true; setLoading(true); setError('');
    api.get('/events', token).then(data => {
      // Applies the successfully loaded result.
       if (active) setEvents(data.events || []); }).catch(err => {
      // Reports a failed asynchronous operation.
       if (active) setError(err.message); }).finally(() => {
      // Clears the pending state when the operation finishes.
       if (active) setLoading(false); });
    return () => {
      // Handles this operation using the surrounding screen or request state.
       active = false; };
  }, [token]);
  const title = dashboard ? `${organiser ? 'Event Organiser' : 'Event Coordinator'} Dashboard` : organiser ? 'My Events' : 'Events';
  return <div className="page"><PageIntro title={title} eyebrow={organiser ? 'Event planning' : 'Assigned to you'} description={organiser ? 'Your requests, their progress, and every detail in one place.' : 'Review the submitted information for events assigned to you.'} action={organiser && <Link className="button-link" to="/organizer/events/new">Request an event <span aria-hidden="true">↗</span></Link>} />
    <div className="section-heading"><h2>{organiser ? 'Your event requests' : 'Assigned events'}</h2><span className="badge">{events.length} events</span></div>
    {loading ? <p role="status" className="loading-state">Loading events...</p> : error ? <p role="alert" className="error-message">{error}</p> : events.length === 0 ? <section className="empty-state"><span className="empty-symbol" aria-hidden="true">◇</span><h2>{organiser ? 'A great event starts here.' : 'No assigned events yet.'}</h2><p>{organiser ? 'You have not requested any events yet.' : 'Events assigned by your Coordinator Lead will appear here.'}</p></section> : <div className="record-grid">{events.map(event =>
      // Converts each record into its displayed or submitted representation.
      <article className="record-card" key={event.id}><div className="record-top"><span className="record-number">EVENT / {String(event.id).padStart(3, '0')}</span><span className={`status-badge status-${event.status}`}>{event.status?.replace(/_/g, ' ') || 'Draft'}</span></div><h3>{event.name || 'Untitled Event'}</h3><p>{event.purpose || 'No purpose provided'}</p><Link className="button-link button-secondary record-action" state={{ backgroundLocation: location }} to={`${organiser ? '/organizer/events' : '/events'}/${event.id}`}>View details <span aria-hidden="true">↗</span></Link></article>)}</div>}
  </div>;
}
