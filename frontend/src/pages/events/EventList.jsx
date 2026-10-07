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
  const [changeRequests, setChangeRequests] = useState([]), [changeRequestError, setChangeRequestError] = useState('');
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
  useEffect(() => {
    if (organiser || !dashboard) return undefined;
    let active = true;
    api.get('/events/change-requests', token).then(data => {
      if (active) setChangeRequests(data.changeRequests || []);
    }).catch(err => {
      if (active) setChangeRequestError(err.message || 'Unable to load change requests.');
    });
    return () => { active = false; };
  }, [token, organiser, dashboard]);
  const title = dashboard ? `${organiser ? 'Event Organiser' : 'Event Coordinator'} Dashboard` : organiser ? 'My Events' : 'Events';
  return <div className="page"><PageIntro title={title} eyebrow={organiser ? 'Event planning' : 'Assigned to you'} description={organiser ? 'Your requests, their progress, and every detail in one place.' : 'Review the submitted information for events assigned to you.'} action={organiser && <Link className="button-link" to="/organizer/events/new">Request an event <span aria-hidden="true">↗</span></Link>} />
    {!organiser && dashboard && <section className="change-request-inbox" aria-labelledby="change-requests-title">
      <div className="section-heading"><h2 id="change-requests-title">Critical change requests</h2><span className="badge">{changeRequests.length} pending</span></div>
      {changeRequestError ? <p role="alert" className="error-message">{changeRequestError}</p> : changeRequests.length === 0
        ? <p className="text-slate-600">No pending change requests.</p>
        : <ul className="change-request-list">{changeRequests.map(request => <li key={request.id} className="change-request-card">
          <div><strong>{request.event_name}</strong><span> from {request.organiser_name}</span><span className="status-badge status-under_review">Pending review</span></div>
          <ul>{Object.entries(request.requested_changes || {}).map(([field, value]) => <li key={field}>
            <strong>{({ name: 'Event name', purpose: 'Purpose', eventType: 'Event type', proposedDate: 'Date', proposedStartTime: 'Start time', proposedEndTime: 'End time', expectedAttendance: 'Expected attendance', roomLayoutPreference: 'Layout requirements', registrationRequired: 'Registration required', registrationCapacity: 'Registration capacity' })[field] || field}:</strong> {Array.isArray(value) ? value.join(', ') : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value ?? 'Not specified'}
          </li>)}</ul>
          <Link className="button-link button-secondary" state={{ backgroundLocation: location }} to={`/events/${request.event_id}`}>View confirmed event</Link>
        </li>)}</ul>}
    </section>}
    <div className="section-heading"><h2>{organiser ? 'Your event requests' : 'Assigned events'}</h2><span className="badge">{events.length} events</span></div>
    {loading ? <p role="status" className="loading-state">Loading events...</p> : error ? <p role="alert" className="error-message">{error}</p> : events.length === 0 ? <section className="empty-state"><span className="empty-symbol" aria-hidden="true">◇</span><h2>{organiser ? 'A great event starts here.' : 'No assigned events yet.'}</h2><p>{organiser ? 'You have not requested any events yet.' : 'Events assigned by your Coordinator Lead will appear here.'}</p></section> : <div className="record-grid">{events.map(event => {
      // Assignment signals progress to organisers without changing the stored lifecycle or terminal states.
      const displayStatus = organiser && event.coordinator_id != null && !['draft', 'cancelled', 'completed'].includes(event.status)
        ? 'in_progress' : event.status;
      return <article className="record-card" key={event.id}><div className="record-top"><span className="record-number">EVENT / {String(event.id).padStart(3, '0')}</span><span className={`status-badge status-${displayStatus}`}>{displayStatus === 'in_progress' ? 'In progress' : displayStatus?.replace(/_/g, ' ') || 'Draft'}</span>{event.clarification_outstanding && <span className="status-badge status-clarification_outstanding">Clarification outstanding</span>}</div><h3>{event.name || 'Untitled Event'}</h3><p>{event.purpose || 'No purpose provided'}</p><Link className="button-link button-secondary record-action" state={{ backgroundLocation: location }} to={`${organiser ? '/organizer/events' : '/events'}/${event.id}`}>View details <span aria-hidden="true">↗</span></Link></article>; })}</div>}
  </div>;
}
