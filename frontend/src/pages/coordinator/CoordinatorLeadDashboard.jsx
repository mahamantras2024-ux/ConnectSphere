import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import useNotificationOpened from '../../notifications/useNotificationOpened';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import PageIntro from '../../components/PageIntro';
import useLiveResource from '../../hooks/useLiveResource';
import CoordinatorEventCards from './CoordinatorEventCards';
import './CoordinatorLeadDashboard.css';

/** Reviews active requests and changes one coordinator using the assignment seen by the lead. */
export default function CoordinatorLeadDashboard() {
  const { token } = useAuth();
  const location = useLocation();
  const notificationOpened = useNotificationOpened();
  const { data, error: loadError, updateData, refresh } = useLiveResource('/events/assignments', token);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  // Keep drafts and disclosure choices outside cards so regrouping and refreshes preserve user work.
  const [drafts, setDrafts] = useState({});
  const [expanded, setExpanded] = useState({});
  const lastNotification = useRef(notificationOpened);
  useEffect(() => {
    if (lastNotification.current !== notificationOpened) {
      lastNotification.current = notificationOpened;
      refresh();
    }
  }, [notificationOpened, refresh]);
  /** Every section starts open; only an explicit user choice closes it. */
  const isOpen = key => expanded[key] !== false;
  /** Toggle one disclosure without resetting its siblings or children. */
  const toggle = key => setExpanded(current => ({ ...current, [key]: current[key] === false }));
  /** Sends the reviewed assignment as a precondition so another decision cannot be silently overwritten. */
  async function assign(event, coordinatorId) {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await api.put(`/events/${event.id}/assignment`, {
        coordinatorId: Number(coordinatorId), expectedCoordinatorId: event.coordinator_id,
      }, token);
      const coordinator = data.coordinators.find(item => item.id === Number(coordinatorId));
      updateData(current => current && ({ ...current, events: current.events.map(item => item.id === event.id
        ? { ...item, coordinator_id: result.event.coordinator_id, coordinator_name: coordinator.full_name } : item) }));
      setDrafts(current => ({ ...current, [event.id]: '' }));
      setMessage(result.message);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  /** Five shared grid rows align summaries, facts and actions; stable keys and selections preserve drafts across stages. */
  function renderEvent(event, hidden = false) {
    return <article className="record-card lead-card" key={event.id} id={`lead-event-${event.id}`} hidden={hidden}>
        <div className="record-top"><span className="record-number">EVENT / {event.id}</span><span className={`status-badge status-${event.status}`}>{event.status}</span></div>
        <div className="lead-card-summary"><h3>{event.name}</h3>
        {event.status === 'confirmed' && <p>Reassignment transfers coordinator access only. Confirmed event details, venue bookings, technical arrangements and safety approvals stay unchanged.</p>}
        <p>{event.purpose || 'Purpose not recorded'}</p></div>
        <dl className="detail-facts"><div><dt>Organiser</dt><dd>{event.organiser_name}</dd></div>
          <div><dt>Proposed date</dt><dd>{event.proposed_date || 'Not specified'}</dd></div>
          <div><dt>Expected attendance</dt><dd>{event.expected_attendance ?? 'Not specified'}</dd></div>
          <div><dt>Coordinator</dt><dd>{event.coordinator_name || 'Unassigned'}</dd></div></dl>
        <Link className="button-link button-secondary record-action view-details-action" state={{ returnTo: location.pathname + location.search }} to={`/events/${event.id}`}>View details <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M7 17 17 7M7 7h10v10" /></svg></Link>
        <form className="grid gap-2 mt-4" onSubmit={submitEvent => {
          submitEvent.preventDefault(); assign(event, new FormData(submitEvent.currentTarget).get('coordinator'));
        }}>
          <label htmlFor={`coordinator-${event.id}`}>Coordinator for {event.name}</label>
          <select id={`coordinator-${event.id}`} name="coordinator" value={drafts[event.id] || ""} onChange={change => setDrafts(current => ({ ...current, [event.id]: change.target.value }))} required disabled={busy}>
            <option value="" disabled>Choose a coordinator</option>
            {data.coordinators.filter(coordinator => coordinator.id !== event.coordinator_id).map(coordinator =>
              <option key={coordinator.id} value={coordinator.id}>{coordinator.full_name} ({coordinator.email})</option>)}
          </select><button className="button-primary" disabled={busy || data.coordinators.every(coordinator => coordinator.id === event.coordinator_id)}>{event.coordinator_id === null ? 'Assign coordinator' : 'Reassign coordinator'}</button>
        </form>
      </article>;
  }
  /** Parent queues use h2 while the visually nested lifecycle controls use smaller h3 headings. */
  function section(key, label, events, content) {
    return <section className="lead-section" key={key}>
      <h2><button className="lead-parent-toggle" aria-expanded={isOpen(key)} aria-controls={`lead-${key}`} onClick={() => toggle(key)}>
        <span aria-hidden="true">{isOpen(key) ? '▾' : '▸'}</span> {label} ({events.length})
      </button></h2>
      <div id={`lead-${key}`} role="region" aria-label={label} hidden={!isOpen(key)}>{content}</div>
    </section>;
  }
  const unassigned = data?.events.filter(event => event.coordinator_id === null);
  const assigned = data?.events.filter(event => event.coordinator_id !== null);
  return <div className="page"><PageIntro title="Coordinator Lead Dashboard" eyebrow="Internal workspace" description="Review incoming requests and oversee coordinator assignments." />
    <button type="button" className="button-secondary dashboard-refresh-button" disabled={busy} onClick={() => { setError(''); refresh(); }} aria-label="Refresh assignments" title="Refresh assignments" aria-busy={busy}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg></button>
    {(error || loadError) && <p role="alert" className="error-message">{error || loadError}</p>}{message && <p role="status">{message}</p>}
    {!data ? !(error || loadError) && <p role="status">Loading event requests…</p> : <>
      {data.coordinators.length === 0 && <p role="status">No Event Coordinators are provisioned. Contact your administrator.</p>}
      {section('unassigned', 'Unassigned requests', unassigned, unassigned.length
        ? <div className="record-grid lead-event-grid">{unassigned.map(event => renderEvent(event))}</div> : <p>No unassigned requests.</p>)}
      {section('assigned', 'Assigned active events', assigned, assigned.length ? <div className="lead-assigned-stages">
        {/* Share coordinator tab semantics without replacing the lead's cards, permissions or assignment preconditions. */}
        <CoordinatorEventCards events={assigned} grouped renderEvent={renderEvent} gridClassName="record-grid lead-event-grid" />
      </div> : <p>No assigned active events.</p>)}
    </>}
  </div>;
}
