import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import PageIntro from '../../components/PageIntro';

/** Reviews active requests and changes one coordinator using the assignment seen by the lead. */
export default function CoordinatorLeadDashboard() {
  const { token } = useAuth();
  const location = useLocation();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setData(null); setError('');
    api.get('/events/assignments', token).then(result => { if (active) setData(result); })
      .catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [token, version]);
  /** Sends the reviewed assignment as a precondition so another decision cannot be silently overwritten. */
  async function assign(event, coordinatorId) {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await api.put(`/events/${event.id}/assignment`, {
        coordinatorId: Number(coordinatorId), expectedCoordinatorId: event.coordinator_id,
      }, token);
      const coordinator = data.coordinators.find(item => item.id === Number(coordinatorId));
      setData(current => ({ ...current, events: current.events.map(item => item.id === event.id
        ? { ...item, coordinator_id: result.event.coordinator_id, coordinator_name: coordinator.full_name } : item) }));
      setMessage(result.message);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  /** Shares the same event cards for the unassigned queue and the supervised assignment list. */
  function renderEvents(events, empty) {
    return events.length === 0 ? <section className="empty-state"><p>{empty}</p></section> : <div className="record-grid">{events.map(event =>
      <article className="record-card" key={event.id}>
        <div className="record-top"><span className="record-number">EVENT / {event.id}</span><span className={`status-badge status-${event.status}`}>{event.status}</span></div>
        <h3>{event.name}</h3><p>{event.purpose || 'Purpose not recorded'}</p>
        <dl className="detail-facts"><div><dt>Organiser</dt><dd>{event.organiser_name}</dd></div>
          <div><dt>Proposed date</dt><dd>{event.proposed_date || 'Not specified'}</dd></div>
          <div><dt>Expected attendance</dt><dd>{event.expected_attendance ?? 'Not specified'}</dd></div>
          <div><dt>Coordinator</dt><dd>{event.coordinator_name || 'Unassigned'}</dd></div></dl>
        <Link className="button-link button-secondary" state={{ backgroundLocation: location }} to={`/events/${event.id}`}>View details</Link>
        <form className="grid gap-2 mt-4" onSubmit={submitEvent => {
          submitEvent.preventDefault(); assign(event, new FormData(submitEvent.currentTarget).get('coordinator'));
        }}>
          <label htmlFor={`coordinator-${event.id}`}>Coordinator for {event.name}</label>
          <select id={`coordinator-${event.id}`} name="coordinator" defaultValue="" required disabled={busy}>
            <option value="" disabled>Choose a coordinator</option>
            {data.coordinators.filter(coordinator => coordinator.id !== event.coordinator_id).map(coordinator =>
              <option key={coordinator.id} value={coordinator.id}>{coordinator.full_name} ({coordinator.email})</option>)}
          </select><button className="button-primary" disabled={busy || data.coordinators.every(coordinator => coordinator.id === event.coordinator_id)}>{event.coordinator_id === null ? 'Assign coordinator' : 'Reassign coordinator'}</button>
        </form>
      </article>)}</div>;
  }
  return <div className="page"><PageIntro title="Coordinator Lead Dashboard" eyebrow="Internal workspace" description="Review incoming requests and oversee coordinator assignments." />
    <button className="button-secondary" disabled={busy} onClick={() => setVersion(value => value + 1)}>Refresh assignments</button>
    {error && <p role="alert" className="error-message">{error}</p>}{message && <p role="status">{message}</p>}
    {!data ? !error && <p role="status">Loading event requests…</p> : <>
      {data.coordinators.length === 0 && <p role="status">No Event Coordinators are provisioned. Contact your administrator.</p>}
      <div className="section-heading"><h2>Unassigned requests</h2><span className="badge">{data.events.filter(event => event.coordinator_id === null).length} requests</span></div>
      {renderEvents(data.events.filter(event => event.coordinator_id === null), 'No unassigned requests.')}
      <div className="section-heading"><h2>Assigned active events</h2></div>
      {renderEvents(data.events.filter(event => event.coordinator_id !== null), 'No assigned active events.')}
    </>}
  </div>;
}
