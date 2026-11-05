// File: Lets the Safety Officer review events whose arrangements are confirmed and record an Operational Safety Check.
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import useNotificationOpened from '../../notifications/useNotificationOpened';
import { SAFETY_EVENT_ANCHOR } from '../../notifications/notificationTarget';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';
import SafetyEventFacts, { LATEST_LABELS, STAGE_LABELS } from './SafetyEventFacts';
import SafetyCheckForm from './SafetyCheckForm';

/** The event id a "ready for safety check" notification pointed at, from the dashboard URL hash, or null. */
function targetedEventId(hash) {
  const match = /^#safety-event-(\d+)$/.exec(hash || '');
  return match ? Number(match[1]) : null;
}

/**
 * The current reason the event needs the Safety Officer now (AC3). A re-queued event always carries its previous
 * changes_requested check, so a prior check means a reassessment; otherwise it is the first operational safety check.
 */
function reviewRequirement(event) {
  return event.latest_safety_check?.outcome === 'changes_requested'
    ? 'Reassessment after requested changes'
    : 'Initial operational safety check';
}

/**
 * Safety Officer queue (Week 7 change 6, Operational Feasibility Check). The dashboard shows compact summaries;
 * eventId selects one authorized ready event for the full SafetyEventFacts (AC1) and review form (AC2).
 * Notes are required unless approving, and a change request must name the planning stages it reopens (AC3).
 * The server enforces the same rules,
 * and lists an event only once its arrangements are confirmed and no requested change is still open (AC4).
 * Opening a "ready for safety check" notification focuses the named event and states its current review requirement
 * (Safety Officer review notification AC3).
 */
export default function SafetyCheckQueue({ eventId = null }) {
  const { token } = useAuth();
  const { hash } = useLocation();
  const notificationOpened = useNotificationOpened();
  const [events, setEvents] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [forms, setForms] = useState({});
  const [saving, setSaving] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const targetId = targetedEventId(hash);
  const targetRef = useRef(null);

  useEffect(() => {
    api.get('/safety/checks', token).then((data) => { setEvents(data.events); setLoadError(''); })
      .catch((err) => setLoadError(err.message));
    // Opening a "ready for safety check" notification here re-reads the queue.
  }, [token, reloadKey, notificationOpened]);

  // Once the targeted event is on screen, bring it into view so the officer sees the event the notification named (AC3).
  useEffect(() => {
    if (targetId != null && events?.some((event) => event.id === targetId) && targetRef.current) {
      targetRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [targetId, events, notificationOpened]);

  // Updates one event's draft outcome, notes or stages without touching the others.
  const setForm = (id, field, value) => setForms((current) => ({ ...current, [id]: { ...current[id], [field]: value } }));
  // Adds or removes one planning stage from an event's change request.
  const toggleStage = (id, area, checked) => setForms((current) => {
    const stages = current[id]?.stages || [];
    return { ...current, [id]: { ...current[id], stages: checked ? [...stages, area] : stages.filter((stage) => stage !== area) } };
  });

  // Records the check; a missing explanation is caught here first so the officer gets immediate feedback.
  async function record(submitEvent, event) {
    submitEvent.preventDefault();
    const { outcome = '', notes = '', stages = [] } = forms[event.id] || {};
    if (!outcome) { setError('Choose an outcome for the safety check.'); return; }
    if (outcome !== 'approved' && !notes.trim()) { setError('Explain what is unsafe or what must change.'); return; }
    // Rejected checks can also reopen named planning stages so revised arrangements can be reassessed.
    const requestingChanges = outcome === 'changes_requested' || (outcome === 'rejected' && stages.length > 0);
    if (outcome === 'changes_requested' && !stages.length) { setError('Choose which planning stages need changes.'); return; }
    setSaving(event.id); setError(''); setStatus('');
    try {
      // Stages are sent in a fixed order so the stored list does not depend on click order.
      // Approval must not submit an explanation hidden after switching away from Reject or Request changes.
      const submittedNotes = outcome === 'approved' ? '' : notes;
      const body = requestingChanges ? { outcome, notes: submittedNotes, changeAreas: Object.keys(STAGE_LABELS).filter((area) => stages.includes(area)) } : { outcome, notes: submittedNotes };
      const data = await api.post(`/events/${event.id}/safety-checks`, body, token);
      setStatus(data.message);
      setForms((current) => ({ ...current, [event.id]: {} }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(null);
      setReloadKey((key) => key + 1);
    }
  }

  // A notification named an event that is no longer ready (already checked, or an arrangement changed): say so (AC3).
  const targetMissing = targetId != null && events && !events.some((event) => event.id === targetId);
  // The full page can expose only records returned by the same authoritative readiness gate as the dashboard.
  const shownEvents = events && (eventId === null ? events : events.filter(event => String(event.id) === String(eventId)));

  return (
    <section className="card safety-queue" aria-labelledby="safety-queue-title">
      <div className="section-heading"><h2 id="safety-queue-title">Operational safety checks</h2>
        {events && <span className="badge event-count-badge">{shownEvents.length} ready</span>}</div>
      {status && <p role="status">{status}</p>}
      {error && <p role="alert" className="error-message">{error}</p>}
      {targetMissing && (
        <p role="status" aria-label="Review notification event unavailable" className="text-slate-600">
          The event from your review notification is no longer awaiting a safety check. It may already have been checked, or its arrangements changed.
        </p>
      )}
      {loadError ? <><p role="alert" className="error-message">{loadError}</p><button className="button-secondary" onClick={() => setReloadKey(key => key + 1)}>Retry safety checks</button></>
        : !events ? <p role="status" className="loading-state">Loading safety checks...</p>
          : shownEvents.length === 0 ? <p className="text-slate-600">{eventId === null ? 'No events are waiting for a safety check. Events appear here once their venue and technical arrangements are confirmed.' : 'This event is no longer awaiting a safety check. It may already have been checked, or its arrangements changed.'}</p>
            : <ul className={eventId === null ? 'safety-list record-grid' : 'safety-list'}>{shownEvents.map((event) => {
              const form = forms[event.id] || {};
              const targeted = event.id === targetId;
              return (
                <li key={event.id} id={SAFETY_EVENT_ANCHOR(event.id)} ref={targeted ? targetRef : null}
                  className={targeted ? 'highlighted-safety-event' : undefined}><article className={eventId === null ? 'record-card' : 'change-request-card'}>
                  <div className="record-top"><span className="record-number">EVENT / {event.id}</span>
                    <span className={`status-badge ${event.latest_safety_check ? `status-${event.latest_safety_check.outcome}` : 'status-under_review'}`}>
                      {event.latest_safety_check ? `Last check: ${LATEST_LABELS[event.latest_safety_check.outcome]}` : 'Not yet checked'}</span></div>
                  <h3><strong>{event.name}</strong></h3>
                  {targeted && (
                    <p className="safety-review-requirement" role="note" aria-label={`Current review requirement for ${event.name}`}>
                      <strong>Current review requirement:</strong> {reviewRequirement(event)}
                    </p>
                  )}
                  {eventId === null ? <>
                    <p>{event.proposed_date || 'Date not specified'}{event.proposed_start_time && ` · ${event.proposed_start_time.slice(0, 5)}–${event.proposed_end_time?.slice(0, 5) || '?'}`}</p>
                    <p>{event.expected_attendance ?? 'Not specified'} expected attendees</p>
                    <p>{event.venues.map(venue => venue.name).join(', ') || 'Venue not recorded'}</p>
                    <Link className="button-link button-secondary record-action" aria-label={`Conduct safety check for ${event.name}`} to={`/safety/events/${event.id}/check`}>Conduct safety check <span aria-hidden="true">↗</span></Link>
                  </> : <><SafetyEventFacts event={event} /><SafetyCheckForm event={event} form={form} saving={saving}
                    onFieldChange={setForm} onStageToggle={toggleStage} onSubmit={record} /></>}
                </article></li>
              );
            })}</ul>}
    </section>
  );
}
