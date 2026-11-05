import { useId } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import TechnicalSupportAssignment from './TechnicalSupportAssignment';
const STAGES = [['draft', 'Draft'], ['submitted', 'Submitted'], ['progress', 'In progress'], ['completed', 'Completed'], ['rejected', 'Rejected']];

/** Coordinator work starts at review, not assignment; cancelled and legacy records remain reachable under Submitted. */
function eventStage(event) {
  if (event.is_draft === true || event.status === 'draft') return 'draft';
  if (event.status === 'completed') return 'completed';
  if (event.status === 'rejected') return 'rejected';
  return ['under_review', 'approved', 'planning', 'confirmed'].includes(event.status) ? 'progress' : 'submitted';
}

/** Filters assigned cards with bookmarkable tabs; stable siblings retain assignment drafts and pending saves across stage moves. */
export default function CoordinatorEventCards({ events, token, staff: supportStaff, supportStaffError, onSaved, returnTo, grouped = false, renderEvent, gridClassName = 'record-grid grouped-event-grid' }) {
  const [params, setParams] = useSearchParams();
  const tabPrefix = useId();
  /** A card stays mounted under the same parent even while its stage is hidden or changes in a live snapshot. */
  function renderCard(event, hidden = false) {
    // Leads share the same filters and stable card identity while supplying their own assignment controls.
    if (renderEvent) return renderEvent(event, hidden);
    const displayStatus = event.status;
    // Equipment reviews can need a team without on-site support; drafts and closed events cannot acquire new assignments.
    const canAssignSupport = !event.is_draft && !['draft', 'cancelled', 'completed', 'rejected'].includes(event.status)
      && (event.technical_support_required || event.equipment_review_required);
    return <article className="record-card" key={event.id} id={`assigned-event-${event.id}`} hidden={hidden}>
      <div className="record-top">
        <span className="record-number">EVENT / {String(event.id).padStart(3, '0')}</span>
        <span className={`status-badge status-${displayStatus}`}>{displayStatus?.replace(/_/g, ' ') || 'Draft'}</span>
        {event.clarification_outstanding && <span className="status-badge status-clarification_outstanding">Clarification outstanding</span>}
      </div>
      <h3>{event.name || 'Untitled Event'}</h3>
      <p>{event.purpose || 'No purpose provided'}</p>
      <Link className="button-link button-secondary record-action view-details-action" state={{ returnTo }} to={`/events/${event.id}`}>
        View details <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M7 17 17 7M7 7h10v10" /></svg>
      </Link>
      {grouped && canAssignSupport && !supportStaffError && <TechnicalSupportAssignment
        event={event} token={token} staff={supportStaff} onSaved={members => onSaved(event.id, members)} />}
      {grouped && canAssignSupport && supportStaffError && <p role="alert" className="error-message">{supportStaffError}</p>}
    </article>;
  }
  if (!grouped) return <div className="record-grid">{events.map(event => renderCard(event))}</div>;
  const groups = STAGES.map(([id, label]) => ({ id, label, count: events.filter(event => eventStage(event) === id).length }));
  const requestedStage = params.get('stage');
  // Explicit selections survive empty refreshes; an unfiltered visit starts at the first populated stage.
  const activeStage = groups.some(group => group.id === requestedStage) ? requestedStage : groups.find(group => group.count)?.id || 'draft';
  const activeGroup = groups.find(group => group.id === activeStage);

  /** Preserve unrelated query parameters and normal Back/Forward navigation between selected stages. */
  function selectStage(id) {
    setParams(current => { const next = new URLSearchParams(current); next.set('stage', id); return next; });
  }

  /** Match the organiser tabs' wrapping arrow keys, Home/End and single keyboard entry point. */
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

  return <>
    <div className="organiser-stage-tabs coordinator-stage-tabs" role="tablist" aria-label="Event stages">
      {groups.map(({id, label, count}) => <button key={id} id={`${tabPrefix}-${id}-tab`} type="button" role="tab" data-stage={id}
        aria-selected={id === activeStage} aria-controls={`${tabPrefix}-panel`} tabIndex={id === activeStage ? 0 : -1}
        onClick={() => selectStage(id)} onKeyDown={navigateTabs}>{label} <span className="badge">{count}</span></button>)}
    </div>
    <section role="tabpanel" id={`${tabPrefix}-panel`} aria-labelledby={`${tabPrefix}-${activeStage}-tab`}>
      {activeGroup.count === 0 && <p>No {activeGroup.label.toLowerCase()} events.</p>}
      {/* One stable card list prevents a status change from reparenting and resetting an in-flight assignment. */}
      <div className={gridClassName}>{events.map(event => renderCard(event, eventStage(event) !== activeStage))}</div>
    </section>
  </>;
}
