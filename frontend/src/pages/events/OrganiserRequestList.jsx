import { useId, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import ActionConfirmation from '../../components/ActionConfirmation';
import { requestStatusLabel } from './requestStatusLabel';

const STAGES = [
  ['draft', 'Draft', 'Drafts'], ['submitted', 'Submitted', 'Submitted'], ['progress', 'In progress', 'In progress'],
  ['completed', 'Completed', 'Completed'], ['rejected', 'Rejected', 'Rejected'],
];

/** A persisted draft flag takes precedence over a legacy lifecycle value. */
function isDraft(event) { return event.is_draft === true || event.status === 'draft'; }

/** Terminal outcomes cannot be mistaken for active assignments; cancelled requests retain their submitted history. */
function eventStage(event) {
  if (isDraft(event)) return 'draft';
  if (event.status === 'completed') return 'completed';
  if (event.status === 'rejected') return 'rejected';
  if (event.status !== 'cancelled' && (event.coordinator_id != null || ['planning', 'confirmed'].includes(event.status))) return 'progress';
  return 'submitted';
}

/** Groups authorised events, with bookmarkable dashboard tabs; private details and draft mutations remain submitter-only. */
export default function OrganiserRequestList({ events, onChange, token, tabbed = false }) {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const tabPrefix = useId();
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

  const groups = STAGES.map(([id, label, title]) => ({ id, label, title, items: events.filter(event => eventStage(event) === id) }));
  const requestedStage = params.get('stage');
  // An explicit selection stays selected even when a refresh empties it; otherwise show the first populated group.
  const activeStage = groups.some(group => group.id === requestedStage) ? requestedStage : groups.find(group => group.items.length)?.id || 'draft';

  /** Preserve unrelated query parameters and let browser history restore the selected dashboard stage. */
  function selectStage(id) {
    setParams(current => { const next = new URLSearchParams(current); next.set('stage', id); return next; });
  }

  /** Horizontal tabs wrap with arrows and support Home/End while retaining one keyboard entry point. */
  function navigateTabs(event) {
    const index = groups.findIndex(group => group.id === activeStage);
    let next;
    switch (event.key) {
      case 'ArrowRight': next = (index + 1) % groups.length; break;
      case 'ArrowLeft': next = (index + groups.length - 1) % groups.length; break;
      case 'Home': next = 0; break;
      case 'End': next = groups.length - 1; break;
      default: return;
    }
    event.preventDefault(); selectStage(groups[next].id);
    event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next].focus();
  }

  /** Opens a fresh decision so previous failures/successes cannot leak into the next action. */
  function review(event, action) {
    setSuccess('');
    setError('');
    setPending({ event, action });
  }

  return <>
    {tabbed && <div className="organiser-stage-tabs" role="tablist" aria-label="Event stages">
      {groups.map(({ id, label, items }) => <button key={id} id={`${tabPrefix}-${id}-tab`} type="button" role="tab" data-stage={id}
        aria-selected={id === activeStage} aria-controls={`${tabPrefix}-${id}-panel`} tabIndex={id === activeStage ? 0 : -1}
        onClick={() => selectStage(id)} onKeyDown={navigateTabs}>{label} <span className="badge event-count-badge">{items.length}</span></button>)}
    </div>}
    {groups.map(({ id, label, title, items }) => <section className="request-section" key={id} id={`${tabPrefix}-${id}-panel`}
      role={tabbed ? 'tabpanel' : undefined} aria-label={tabbed ? label : title}
      aria-labelledby={tabbed ? `${tabPrefix}-${id}-tab` : undefined} hidden={tabbed && id !== activeStage}>
      {!tabbed && <div className="section-heading"><h2>{title}</h2><span className="badge event-count-badge">{items.length} requests</span></div>}
      {items.length === 0 ? <p>No {id === 'draft' ? 'draft' : label.toLowerCase()} {tabbed ? 'events' : 'requests'}.</p> : <ul className="event-request-rows">
        {items.map(event => <li className="event-request-row" key={event.id}>
          <div className="event-request-summary">
            <h3>{event.name || 'Untitled Event'}</h3><p>{event.purpose || 'No purpose provided'}</p>
            {event.clarification_outstanding && <><span className="status-badge status-clarification_outstanding">Clarification outstanding</span><p>Action required: respond to clarification.</p></>}
          </div>
          <span className={`status-badge event-request-status status-${event.status}`}>
            {requestStatusLabel(event.status)}
          </span>
          <div className="request-row-actions">
            {event.can_manage !== false && <Link className="button-link button-secondary" state={{ returnTo: location.pathname + location.search }} to={`/organizer/events/${event.id}`}>View details</Link>}
            {isDraft(event) && event.can_manage !== false && <>
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
