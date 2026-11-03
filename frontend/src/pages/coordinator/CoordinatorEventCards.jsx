import { useState } from 'react';
import { Link } from 'react-router-dom';
import TechnicalSupportAssignment from './TechnicalSupportAssignment';
const STAGES = [['submitted', 'Submitted'], ['under_review', 'Under review'], ['approved', 'Approved'], ['planning', 'Planning'], ['confirmed', 'Confirmed'], ['completed', 'Completed'], ['rejected', 'Rejected'], ['cancelled', 'Cancelled'], ['draft', 'Draft'], ['other', 'Other']];
const CLOSED = ['completed', 'rejected', 'cancelled'];

/** Groups assigned cards without reparenting: stable sibling keys retain drafts and pending saves across stage moves. */
export default function CoordinatorEventCards({ events, token, staff: supportStaff, supportStaffError, onSaved, returnTo, grouped = false }) {
  const [expanded, setExpanded] = useState({});
  /** Card identity remains constant even when a different status heading now precedes it. */
  function renderCard(event, hidden = false) {
    const displayStatus = event.status;
    return <article className="record-card" key={event.id} id={`assigned-event-${event.id}`} hidden={hidden}>
      <div className="record-top">
        <span className="record-number">EVENT / {String(event.id).padStart(3, '0')}</span>
        <span className={`status-badge status-${displayStatus}`}>{displayStatus?.replace(/_/g, ' ') || 'Draft'}</span>
        {event.clarification_outstanding && <span className="status-badge status-clarification_outstanding">Clarification outstanding</span>}
      </div>
      <h3>{event.name || 'Untitled Event'}</h3>
      <p>{event.purpose || 'No purpose provided'}</p>
      <Link className="button-link button-secondary record-action" state={{ returnTo }} to={`/events/${event.id}`}>
        View details <span aria-hidden="true">↗</span>
      </Link>
      {grouped && event.technical_support_required && !supportStaffError && <TechnicalSupportAssignment
        event={event} token={token} staff={supportStaff} onSaved={members => onSaved(event.id, members)} />}
      {grouped && event.technical_support_required && supportStaffError && <p role="alert" className="error-message">{supportStaffError}</p>}
    </article>;
  }
  if (!grouped) return <div className="record-grid">{events.map(event => renderCard(event))}</div>;
  // Flatten first so group-derived array paths never become part of a card's React key.
  const children = STAGES.flatMap(([status, label]) => {
    const members = events.filter(event => (STAGES.some(([key]) => key === event.status) ? event.status : 'other') === status);
    if (!members.length) return [];
    const open = expanded[status] ?? !CLOSED.includes(status);
    return [<h3 key={`stage-${status}`} className="event-stage-heading"><button type="button" aria-expanded={open}
      aria-controls={members.map(event => `assigned-event-${event.id}`).join(' ')}
      onClick={() => setExpanded(current => ({ ...current, [status]: !open }))}>{label} ({members.length})</button></h3>,
      ...members.map(event => renderCard(event, !open))];
  });
  return <div className="record-grid grouped-event-grid">{children}</div>;
}
