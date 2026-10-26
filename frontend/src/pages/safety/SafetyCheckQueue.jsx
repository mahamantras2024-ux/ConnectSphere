// File: Lets the Safety Officer review events whose arrangements are confirmed and record an Operational Safety Check.
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import useNotificationOpened from '../../notifications/useNotificationOpened';
import { SAFETY_EVENT_ANCHOR } from '../../notifications/notificationTarget';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';
import SafetyEventFacts, { LATEST_LABELS, STAGE_LABELS } from './SafetyEventFacts';

const OUTCOMES = [['approved', 'Approve'], ['rejected', 'Reject'], ['changes_requested', 'Request changes']];

/** Technical Support only reviews events that asked for something technical, so only those can reopen that stage. */
function needsTechnical(event) {
  return Boolean(event.equipment_items?.length || event.technical_support_required || event.video_conferencing_required || event.equipment_notes?.trim());
}

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
 * Safety Officer queue (Week 7 change 6, Operational Feasibility Check). Each event shows the facts the check
 * considers (SafetyEventFacts, AC1) and a form to approve, reject or request changes (AC2). Notes are required unless
 * approving, and a change request must name the planning stages it reopens (AC3). The server enforces the same rules,
 * and lists an event only once its arrangements are confirmed and no requested change is still open (AC4).
 * Opening a "ready for safety check" notification focuses the named event and states its current review requirement
 * (Safety Officer review notification AC3).
 */
export default function SafetyCheckQueue() {
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
    // AC3: a change request names the planning stages the event returns to; other outcomes send none.
    const requestingChanges = outcome === 'changes_requested';
    if (requestingChanges && !stages.length) { setError('Choose which planning stages need changes.'); return; }
    setSaving(event.id); setError(''); setStatus('');
    try {
      // Stages are sent in a fixed order so the stored list does not depend on click order.
      const body = requestingChanges ? { outcome, notes, changeAreas: Object.keys(STAGE_LABELS).filter((area) => stages.includes(area)) } : { outcome, notes };
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

  return (
    <section className="card safety-queue" aria-labelledby="safety-queue-title">
      <div className="section-heading"><h2 id="safety-queue-title">Operational safety checks</h2>
        {events && <span className="badge">{events.length} ready</span>}</div>
      {status && <p role="status">{status}</p>}
      {error && <p role="alert" className="error-message">{error}</p>}
      {targetMissing && (
        <p role="status" aria-label="Review notification event unavailable" className="text-slate-600">
          The event from your review notification is no longer awaiting a safety check. It may already have been checked, or its arrangements changed.
        </p>
      )}
      {loadError ? <p role="alert" className="error-message">{loadError}</p>
        : !events ? <p role="status" className="loading-state">Loading safety checks...</p>
          : events.length === 0 ? <p className="text-slate-600">No events are waiting for a safety check. Events appear here once their venue and technical arrangements are confirmed.</p>
            : <ul className="safety-list">{events.map((event) => {
              const form = forms[event.id] || {};
              const targeted = event.id === targetId;
              return (
                <li key={event.id} id={SAFETY_EVENT_ANCHOR(event.id)} ref={targeted ? targetRef : null}
                  className={targeted ? 'change-request-card highlighted-safety-event' : 'change-request-card'}>
                  <div><strong>{event.name}</strong>
                    <span className={`status-badge ${event.latest_safety_check ? `status-${event.latest_safety_check.outcome}` : 'status-under_review'}`}>
                      {event.latest_safety_check ? `Last check: ${LATEST_LABELS[event.latest_safety_check.outcome]}` : 'Not yet checked'}</span></div>
                  {targeted && (
                    <p className="safety-review-requirement" role="note" aria-label={`Current review requirement for ${event.name}`}>
                      <strong>Current review requirement:</strong> {reviewRequirement(event)}
                    </p>
                  )}
                  <SafetyEventFacts event={event} />
                  <form className="grid gap-2" onSubmit={(submitEvent) => record(submitEvent, event)}>
                    <fieldset className="flex flex-wrap gap-4" disabled={saving === event.id}>
                      <legend className="mb-1 font-medium">Outcome for {event.name}</legend>
                      {OUTCOMES.map(([value, label]) => (
                        <label key={value} className="flex items-center gap-2">
                          <input className="!w-4" type="radio" name={`safety-outcome-${event.id}`} value={value} checked={form.outcome === value}
                            onChange={() => setForm(event.id, 'outcome', value)} />{label}
                        </label>
                      ))}
                    </fieldset>
                    {form.outcome === 'changes_requested' && (
                      <fieldset className="flex flex-wrap gap-4" disabled={saving === event.id}>
                        <legend className="mb-1 font-medium">Planning stages to reopen for {event.name}</legend>
                        {Object.entries(STAGE_LABELS).map(([area, label]) => (
                          <label key={area} className="flex items-center gap-2">
                            <input className="!w-4" type="checkbox" checked={(form.stages || []).includes(area)}
                              disabled={area === 'technical' && !needsTechnical(event)}
                              onChange={(changeEvent) => toggleStage(event.id, area, changeEvent.target.checked)} />{label}
                          </label>
                        ))}
                      </fieldset>
                    )}
                    <label className="grid gap-1" htmlFor={`safety-notes-${event.id}`}>Notes (required unless approving)
                      <textarea id={`safety-notes-${event.id}`} rows={3} maxLength={4000} value={form.notes || ''} disabled={saving === event.id}
                        onChange={(changeEvent) => setForm(event.id, 'notes', changeEvent.target.value)} />
                    </label>
                    <button type="submit" className="justify-self-start" disabled={saving !== null}>{saving === event.id ? 'Recording…' : 'Record safety check'}</button>
                  </form>
                </li>
              );
            })}</ul>}
    </section>
  );
}
