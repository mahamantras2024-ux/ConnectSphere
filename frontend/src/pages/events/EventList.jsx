// File: Loads organisation request statuses for organisers and assigned events for coordinators.
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';
import useLiveResource from '../../hooks/useLiveResource';
import OrganiserRequestList from './OrganiserRequestList';
import PageIntro from '../../components/PageIntro';
import NotificationsPanel from '../../components/NotificationsPanel';
import ChangeRequestInbox from './ChangeRequestInbox';
import CoordinatorEventCards from '../coordinator/CoordinatorEventCards';
// Renders real role-scoped summaries with loading, failure, and empty states.
export default function EventList({ dashboard = false }) {
  const { token, user } = useAuth();
  const location = useLocation();
  const organiser = user.role === 'event_organiser';
  // Five-second polling plus a three-second stalled-read retry follows the existing ten-second notification contract.
  const { data, loading, error, updateData } = useLiveResource('/events', token, { retryAfterMs: 3000 });
  const events = data?.events || [];
  /** Local draft/support writes invalidate older polls, so a late response cannot undo a successful action. */
  function setEvents(update) {
    updateData(current => ({ ...current, events: update(current.events) }));
  }
  const [supportStaff, setSupportStaff] = useState([]);
  const [supportStaffError, setSupportStaffError] = useState('');
  useEffect(() => {
    if (organiser || !dashboard) return undefined;
    api.get('/events/technical-support-staff', token).then(data => setSupportStaff(data.staff || []))
      .catch(err => setSupportStaffError(err.message));
    return undefined;
  }, [token, organiser]);
  const title = dashboard ? `${organiser ? 'Event Organiser' : 'Event Coordinator'} Dashboard` : organiser ? 'My Events' : 'Events';
  return <div className="page"><PageIntro title={title} eyebrow={organiser ? 'Event planning' : 'Assigned to you'} description={organiser ? 'Your requests, their progress, and every detail in one place.' : 'Review the submitted information for events assigned to you.'} action={organiser && <Link className="button-link" to="/organizer/events/new">Request an event <span aria-hidden="true">↗</span></Link>} />
    {dashboard && <NotificationsPanel />}
    {!organiser && dashboard && <ChangeRequestInbox />}
    <div className="section-heading"><h2>{organiser ? dashboard ? 'Your events' : 'Your event requests' : 'Assigned events'}</h2><span className="badge">{events.length} events</span></div>
    {loading ? <p role="status" className="loading-state">Loading events...</p> : error ? <p role="alert" className="error-message">{error}</p> : events.length === 0 && !organiser ? <section className="empty-state"><span className="empty-symbol" aria-hidden="true">◇</span><h2>No assigned events yet.</h2><p>Events assigned by your Coordinator Lead will appear here.</p></section> : organiser ? <OrganiserRequestList events={events} onChange={setEvents} token={token} tabbed={dashboard}/> : <CoordinatorEventCards events={events} token={token} staff={supportStaff} supportStaffError={supportStaffError} grouped={dashboard}
      returnTo={location.pathname} onSaved={(id, members) => setEvents(current => current.map(item => item.id === id ? { ...item, technical_support_staff: members } : item))} />}
  </div>;
}
