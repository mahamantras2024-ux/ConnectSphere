// File: Loads and displays events owned by the organiser or assigned to the coordinator.
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';
import OrganiserRequestList from './OrganiserRequestList';
import PageIntro from '../../components/PageIntro';
import NotificationsPanel from '../../components/NotificationsPanel';
import ChangeRequestInbox from './ChangeRequestInbox';
// Renders real role-scoped summaries with loading, failure, and empty states.
export default function EventList({ dashboard = false }) {
  const { token, user } = useAuth();
  const location = useLocation();
  const organiser = user.role === 'event_organiser';
  const [events, setEvents] = useState([]), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  useEffect(() => {
    // Loads scoped events. A token change always comes with a route change (logout or role switch) that unmounts
    // this list, and React 18 ignores updates after unmount, so no stale-response guard is needed.
    setLoading(true); setError('');
    api.get('/events', token).then(data => setEvents(data.events || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);
  const title = dashboard ? `${organiser ? 'Event Organiser' : 'Event Coordinator'} Dashboard` : organiser ? 'My Events' : 'Events';
  return <div className="page"><PageIntro title={title} eyebrow={organiser ? 'Event planning' : 'Assigned to you'} description={organiser ? 'Your requests, their progress, and every detail in one place.' : 'Review the submitted information for events assigned to you.'} action={organiser && <Link className="button-link" to="/organizer/events/new">Request an event <span aria-hidden="true">↗</span></Link>} />
    {dashboard && <NotificationsPanel />}
    {!organiser && dashboard && <ChangeRequestInbox />}
    <div className="section-heading"><h2>{organiser ? 'Your event requests' : 'Assigned events'}</h2><span className="badge">{events.length} events</span></div>
    {loading ? <p role="status" className="loading-state">Loading events...</p> : error ? <p role="alert" className="error-message">{error}</p> : events.length === 0 && !organiser ? <section className="empty-state"><span className="empty-symbol" aria-hidden="true">◇</span><h2>No assigned events yet.</h2><p>Events assigned by your Coordinator Lead will appear here.</p></section> : organiser ? <OrganiserRequestList events={events} onChange={setEvents} token={token}/> : <div className="record-grid">{events.map(event => {
      // Coordinator cards retain the operational lifecycle; organiser grouping is handled above.
      const displayStatus = event.status;
      return <article className="record-card" key={event.id}><div className="record-top"><span className="record-number">EVENT / {String(event.id).padStart(3, '0')}</span><span className={`status-badge status-${displayStatus}`}>{displayStatus?.replace(/_/g, ' ') || 'Draft'}</span>{event.clarification_outstanding && <span className="status-badge status-clarification_outstanding">Clarification outstanding</span>}</div><h3>{event.name || 'Untitled Event'}</h3><p>{event.purpose || 'No purpose provided'}</p><Link className="button-link button-secondary record-action" state={{ backgroundLocation: location }} to={`/events/${event.id}`}>View details <span aria-hidden="true">↗</span></Link></article>; })}</div>}
  </div>;
}
