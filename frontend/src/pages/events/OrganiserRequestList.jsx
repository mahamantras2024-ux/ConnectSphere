import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../../api/client';
import ActionConfirmation from '../../components/ActionConfirmation';

/** Groups owned requests into rows and confirms draft deletion/submission before changing stored state. */
export default function OrganiserRequestList({ events, onChange, token }) {
  const location = useLocation();
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  /** Persists the reviewed decision once; disabled controls prevent competing writes during the request. */
  async function perform() {
    setBusy(true);
    setError('');
    try {
      const result = pending.action === 'delete'
        ? await api.delete(`/events/${pending.event.id}/draft`, token)
        : await api.post(`/events/${pending.event.id}/submit`, {}, token);
      onChange(current => pending.action === 'delete'
        ? current.filter(event => event.id !== pending.event.id)
        : current.map(event => event.id === pending.event.id ? { ...event, ...result.event } : event));
      setSuccess(result.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Assignment controls active progress; terminal states stay visible as submitted history.
  const isDraft = event => event.is_draft === true || event.status === 'draft';
  const isInProgress = event => !isDraft(event) && event.coordinator_id != null && !['completed', 'cancelled'].includes(event.status);
  const groups = [
    ['Drafts', events.filter(isDraft)],
    ['Submitted', events.filter(event => !isDraft(event) && !isInProgress(event))],
    ['In progress', events.filter(isInProgress)],
  ];

  /** Opens a fresh decision so previous failures/successes cannot leak into the next action. */
  function review(event, action) {
    setSuccess('');
    setError('');
    setPending({ event, action });
  }

  return <>
    {groups.map(([title, items]) => <section className="request-section" key={title} aria-label={title}>
      <div className="section-heading"><h2>{title}</h2><span className="badge">{items.length} requests</span></div>
      {items.length === 0 ? <p>No {title === 'Drafts' ? 'draft' : title.toLowerCase()} requests.</p> : <ul className="event-request-rows">
        {items.map(event => <li className="event-request-row" key={event.id}>
          <div>
            <h3>{event.name || 'Untitled Event'}</h3><p>{event.purpose || 'No purpose provided'}</p>
            <span className={`status-badge status-${isInProgress(event) ? 'in_progress' : event.status}`}>
              {isInProgress(event) ? 'In progress' : event.status?.replace(/_/g, ' ') || 'Draft'}
            </span>
            {event.clarification_outstanding && <span className="status-badge status-clarification_outstanding">Clarification outstanding</span>}
          </div>
          <div className="request-row-actions">
            <Link className="button-link button-secondary" state={{ backgroundLocation: location }} to={`/organizer/events/${event.id}`}>View details</Link>
            {isDraft(event) && <>
              <button disabled={busy} className="button-secondary" onClick={() => review(event, 'submit')}>Submit draft</button>
              <button disabled={busy} className="button-secondary" onClick={() => review(event, 'delete')}>Delete draft</button>
            </>}
          </div>
        </li>)}
      </ul>}
    </section>)}
    {pending && <ActionConfirmation action={pending.action === 'delete' ? 'delete this draft' : 'submit this draft'}
      busy={busy} error={error} success={success} onConfirm={perform} onClose={() => setPending(null)} />}
  </>;
}
