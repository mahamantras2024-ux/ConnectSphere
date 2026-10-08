// File: Lets the Safety Officer review events whose arrangements are confirmed and record an Operational Safety Check.
import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';
import { formatEquipmentItems } from '../events/equipmentRequirements';

const OUTCOMES = [['approved', 'Approve'], ['rejected', 'Reject'], ['changes_requested', 'Request changes']];
const LATEST_LABELS = { approved: 'Passed', rejected: 'Failed', changes_requested: 'Changes requested' };

/** Summarises the equipment and technical needs the Safety Officer must consider (placement, crowd movement). */
function equipmentSummary(event) {
  const needs = [];
  if (event.equipment_items?.length) needs.push(formatEquipmentItems(event.equipment_items));
  if (event.technical_support_required) needs.push('On-site technical support');
  if (event.video_conferencing_required) needs.push('Video-conferencing / hybrid');
  if (event.equipment_notes?.trim()) needs.push(event.equipment_notes.trim());
  return needs.length ? needs.join('; ') : 'None requested';
}

/**
 * Safety Officer queue (Week 7 change 6). Each event shows the facts the check considers - attendance, venue and
 * capacity, layout, accessibility, equipment - and a form to approve, reject or request changes. Notes are required
 * unless approving; the server enforces the same rule and the confirmed-arrangements prerequisite.
 */
export default function SafetyCheckQueue() {
  const { token } = useAuth();
  const [events, setEvents] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [forms, setForms] = useState({});
  const [saving, setSaving] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/safety/checks', token).then((data) => { setEvents(data.events); setLoadError(''); })
      .catch((err) => setLoadError(err.message));
  }, [token, reloadKey]);

  // Updates one event's draft outcome or notes without touching the others.
  const setForm = (id, field, value) => setForms((current) => ({ ...current, [id]: { ...current[id], [field]: value } }));

  // Records the check; a missing explanation is caught here first so the officer gets immediate feedback.
  async function record(submitEvent, event) {
    submitEvent.preventDefault();
    const { outcome = '', notes = '' } = forms[event.id] || {};
    if (!outcome) { setError('Choose an outcome for the safety check.'); return; }
    if (outcome !== 'approved' && !notes.trim()) { setError('Explain what is unsafe or what must change.'); return; }
    setSaving(event.id); setError(''); setStatus('');
    try {
      const data = await api.post(`/events/${event.id}/safety-checks`, { outcome, notes }, token);
      setStatus(data.message);
      setForms((current) => ({ ...current, [event.id]: {} }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(null);
      setReloadKey((key) => key + 1);
    }
  }

  return (
    <section className="card safety-queue" aria-labelledby="safety-queue-title">
      <div className="section-heading"><h2 id="safety-queue-title">Operational safety checks</h2>
        {events && <span className="badge">{events.length} ready</span>}</div>
      {status && <p role="status">{status}</p>}
      {error && <p role="alert" className="error-message">{error}</p>}
      {loadError ? <p role="alert" className="error-message">{loadError}</p>
        : !events ? <p role="status" className="loading-state">Loading safety checks...</p>
          : events.length === 0 ? <p className="text-slate-600">No events are waiting for a safety check. Events appear here once their venue and technical arrangements are confirmed.</p>
            : <ul className="safety-list">{events.map((event) => {
              const form = forms[event.id] || {};
              return (
                <li key={event.id} className="change-request-card">
                  <div><strong>{event.name}</strong>
                    <span className={`status-badge ${event.latest_safety_check ? `status-${event.latest_safety_check.outcome}` : 'status-under_review'}`}>
                      {event.latest_safety_check ? `Last check: ${LATEST_LABELS[event.latest_safety_check.outcome]}` : 'Not yet checked'}</span></div>
                  <dl className="detail-facts">
                    <div><dt>Date and time</dt><dd>{event.proposed_date || 'Not specified'}{event.proposed_start_time ? `, ${event.proposed_start_time.slice(0, 5)}–${event.proposed_end_time?.slice(0, 5) || '?'}` : ''}</dd></div>
                    <div><dt>Expected attendance</dt><dd>{event.expected_attendance ?? 'Not specified'}</dd></div>
                    <div><dt>Venue</dt><dd>{event.venues.map((venue) => `${venue.name} (capacity ${venue.capacity})`).join(', ')}</dd></div>
                    <div><dt>Layout</dt><dd>{event.room_layout_preference || 'Not specified'}</dd></div>
                    <div><dt>Accessibility</dt><dd>{event.accessibility_requirements?.length ? event.accessibility_requirements.join(', ') : 'None recorded'}</dd></div>
                    <div><dt>Equipment</dt><dd>{equipmentSummary(event)}</dd></div>
                  </dl>
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
