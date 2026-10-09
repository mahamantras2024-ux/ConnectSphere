// File: Loads and formats persisted event details, handling missing values and request failures.

import { useEffect, useState } from 'react';

import { Link, useLocation, useParams } from 'react-router-dom';

import { api } from '../../api/client';

import ActionConfirmation from '../../components/ActionConfirmation';

import EventAttachments from '../../components/EventAttachments';

import { useAuth } from '../../context/AuthContext';

import EquipmentRequirementsSection from './EquipmentRequirementsSection';

import EventDecisionSection from './EventDecisionSection';



// Scoped styles (everything is prefixed "ed-" so nothing clashes with existing global classes).

const STYLES = `

.ed-root {

  --ed-ink: #1c2530; --ed-muted: #5b6776; --ed-line: #d9dee5; --ed-surface: #ffffff; --ed-wash: #f4f6f8;

  --ed-accent: #198754; --ed-accent-ink: #ffffff;

  --ed-ok-ink: #155724; --ed-ok-bg: #d4edda; --ed-ok-line: #28a745;

  --ed-warn-ink: #856404; --ed-warn-bg: #fff3cd; --ed-warn-line: #ffc107;

  --ed-bad: #dc3545; --ed-bad-ink: #721c24; --ed-bad-bg: #f8d7da;

  --ed-info-ink: #0c5460; --ed-info-bg: #d1ecf1; --ed-info-line: #17a2b8;

  --ed-link: #1d4ed8;

  --ed-radius: 10px;

  display: block; width: 100%; max-width: 1100px; margin: 0 auto; padding: 24px 16px 48px; color: var(--ed-ink);

}

.ed-root.event-detail { display: block; width: 100%; max-width: 1100px; margin-inline: auto; }

@media (prefers-color-scheme: dark) {

  .ed-root {

    --ed-ink: #e7ebf0; --ed-muted: #9aa6b4; --ed-line: #324050; --ed-surface: #1a222c; --ed-wash: #212b37;

    --ed-link: #7ab0ff;

    --ed-accent: #4cc26b; --ed-accent-ink: #0b1f12;

    --ed-ok-ink: #8fe0a6; --ed-ok-bg: #173a27; --ed-ok-line: #4cc26b;

    --ed-warn-ink: #f0c070; --ed-warn-bg: #3d2f12; --ed-warn-line: #c9962b;

    --ed-bad: #ff6b78; --ed-bad-ink: #f5a3aa; --ed-bad-bg: #402022;

    --ed-info-ink: #8fd3e0; --ed-info-bg: #12333a; --ed-info-line: #3aa7bb;

  }

}

.ed-root *, .ed-root *::before, .ed-root *::after { box-sizing: border-box; }

.ed-back { display: inline-flex; margin-bottom: 16px; }



/* Header */

.ed-header { margin-bottom: 28px; }

.ed-eyebrow { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 8px; }

.ed-chip { font-size: .72rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--ed-muted); }

.ed-id { font-size: .85rem; color: var(--ed-muted); }

.ed-title-row { display: flex; align-items: center; gap: 12px; }

.ed-title { margin: 0; font-size: clamp(1.6rem, 4vw, 2.25rem); line-height: 1.15; font-weight: 800; letter-spacing: -.01em; }



/* Badges + notices */

.ed-badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: .8rem; font-weight: 600; white-space: nowrap; background: var(--ed-wash); color: var(--ed-muted); border: 1px solid var(--ed-line); }

.ed-badge--ok { background: var(--ed-ok-bg); color: var(--ed-ok-ink); border-color: transparent; }

.ed-badge--warn { background: var(--ed-warn-bg); color: var(--ed-warn-ink); border-color: transparent; }

.ed-badge--bad { background: var(--ed-bad-bg); color: var(--ed-bad-ink); border-color: transparent; }

.ed-notice { margin: 0 0 16px; padding: 10px 14px; border-radius: 8px; border: 1px solid; border-left-width: 4px; font-size: .925rem; }

.ed-notice--ok { background: var(--ed-ok-bg); color: var(--ed-ok-ink); border-color: var(--ed-ok-line); }

.ed-notice--warn { background: var(--ed-warn-bg); color: var(--ed-warn-ink); border-color: var(--ed-warn-line); font-weight: 600; }

.ed-notice--info { background: var(--ed-info-bg); color: var(--ed-info-ink); border-color: var(--ed-info-line); }

.ed-notice--bad { background: var(--ed-bad-bg); color: var(--ed-bad-ink); border-color: var(--ed-bad); }

.ed-state-card { padding: 20px 24px; border-radius: var(--ed-radius); border: 1px solid var(--ed-line); background: var(--ed-surface); color: var(--ed-muted); }



/* Cards + fields */

.ed-card { background: #ffffff !important; border: 1px solid var(--ed-line); border-radius: var(--ed-radius); padding: 24px 28px; margin-bottom: 28px; }

.ed-grid { display: grid; gap: 28px; grid-template-columns: minmax(0, 1fr); align-items: start; }

.ed-grid > .ed-card { margin-bottom: 0; }

.ed-span { grid-column: 1 / -1; }

.ed-card-title { margin: 0 0 20px; font-size: 1.1rem; font-weight: 700; }

.ed-card-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 20px; }

.ed-card-head .ed-card-title { margin: 0; }

.ed-fields { margin: 0; display: grid; gap: 0; }

.ed-fields--tiles {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0;
}

.ed-field { padding: 16px 0; border-bottom: 1px solid var(--ed-line); }
.ed-field:first-child { padding-top: 0; }
.ed-field:last-child { padding-bottom: 0; border-bottom: 0; }

.ed-fields--tiles .ed-field,
.ed-fields--tiles .ed-field:first-child,
.ed-fields--tiles .ed-field:last-child {
  padding: 16px 0;
  border: 0;
  border-bottom: 1px solid var(--ed-line);
  border-radius: 0;
  background: transparent;
}
.ed-fields--tiles .ed-field:first-child { padding-top: 0; }
.ed-fields--tiles .ed-field:last-child { border-bottom: 0; padding-bottom: 0; }

.ed-field dt {
  margin: 0 0 8px;
  font-size: .95rem;
  font-weight: 500;
  letter-spacing: normal;
  text-transform: none;
  color: var(--ed-ink);
}
.ed-field dd { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }

.ed-value-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; width: 100%; }

.ed-value-row > span:first-child { flex: 1; min-width: 0; }

.ed-value-row .ed-icon-btn { margin-top: -5px; }

.ed-title-group { display: flex; align-items: center; gap: 10px; }



/* Buttons + inputs */

.ed-btn { font: inherit; font-weight: 600; cursor: pointer; border-radius: 6px; padding: 8px 14px; border: 1px solid var(--ed-accent); background: var(--ed-accent); color: var(--ed-accent-ink); }

.ed-btn--quiet { background: transparent; color: var(--ed-ink); border-color: var(--ed-line); }

.ed-btn:hover:not(:disabled) { filter: brightness(1.08); }

.ed-btn:disabled { opacity: .5; cursor: not-allowed; }

.ed-icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; padding: 0; flex: none; cursor: pointer; border-radius: 6px; border: 1px solid var(--ed-line); background: transparent; color: var(--ed-link); }

.ed-icon-btn:hover { background: var(--ed-wash); }

.ed-btn:focus-visible, .ed-icon-btn:focus-visible, .ed-input:focus-visible { outline: 3px solid var(--ed-accent); outline-offset: 2px; }

.ed-root .ed-input { display: block; width: 100%; font: inherit; color: var(--ed-ink); background: var(--ed-surface); border: 1px solid var(--ed-line); border-radius: 6px; padding: 10px 12px; min-width: 0; }

.ed-root textarea.ed-input { resize: vertical; min-height: 84px; }

.ed-root input[type="checkbox"] { width: 18px; height: 18px; flex: none; accent-color: var(--ed-accent); margin: 0; }

.ed-editor { display: grid; gap: 14px; margin-top: 10px; max-width: 520px; }

.ed-editor-actions { display: flex; flex-wrap: wrap; gap: 10px; padding-top: 4px; }

.ed-check { display: flex; align-items: center; gap: 10px; font-weight: 600; }



/* Clarifications */

.ed-clar-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 20px; }

.ed-clar-item { display: grid; gap: 10px; padding: 16px; border: 1px solid var(--ed-line); border-radius: 8px; background: var(--ed-surface); }

.ed-clar-item p { margin: 0; white-space: pre-wrap; }

.ed-clar-response { padding: 14px 16px; border-radius: 8px; background: var(--ed-surface); border: 1px solid var(--ed-line); }

.ed-clar-response p { margin-top: 4px; }

.ed-label { display: grid; gap: 8px; font-weight: 600; }

.ed-clar-form { display: grid; gap: 20px; margin-top: 24px; padding-top: 24px; border-top: 1px solid var(--ed-line); }

.ed-clar-form h3 { margin: 0; font-size: 1rem; }

.ed-check-grid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); border: 0; padding: 0; margin: 0; min-width: 0; }

.ed-check-grid legend { margin-bottom: 12px; font-weight: 600; padding: 0; }

.ed-check-tile { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border: 1px solid var(--ed-line); border-radius: 6px; cursor: pointer; font-weight: 400; }

.ed-check-tile:has(input:checked) { border-color: var(--ed-accent); box-shadow: 0 0 0 1px var(--ed-accent); }

.ed-justify-start { justify-self: start; }

.ed-muted { color: var(--ed-muted); margin: 0; }

.ed-contact a { color: var(--ed-accent); }

.ed-attach > :not(button) { padding: 0; margin: 0; border: 0; box-shadow: none; background: transparent; }

.ed-attach .ed-attach-save { margin-top: 16px; }

@media (prefers-reduced-motion: no-preference) { .ed-btn, .ed-icon-btn { transition: filter .15s, background .15s; } }

`;



const iconProps = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: 'false' };

const PencilIcon = () => (

  <svg {...iconProps}>

    <path d="M12 20h9" />

    <path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z" />

  </svg>

);



const clarificationFieldLabels = {

  name: 'Event name', purpose: 'Purpose', description: 'Description', event_type: 'Event type',

  proposed_date: 'Date', proposed_start_time: 'Start time', proposed_end_time: 'End time',

  expected_attendance: 'Expected attendance', programme_details: 'Programme',

  room_layout_preference: 'Layout requirements', accessibility_requirements: 'Accessibility needs',

  equipment_notes: 'Equipment requirements', registration_required: 'Registration required',

  registration_capacity: 'Registration capacity', special_arrangements: 'Special arrangements',

};



// Picks a badge tone from the stored status so approvals, rejections and pending states read at a glance.

function statusTone(status) {

  const value = String(status || '').toLowerCase();

  if (/approv|confirm|accept/.test(value)) return 'ed-badge--ok';

  if (/reject|declin|cancel/.test(value)) return 'ed-badge--bad';

  if (/review|pending|submit|draft/.test(value)) return 'ed-badge--warn';

  return '';

}



// One label/value pair inside a <dl>.

const Field = ({ label, children }) => (

  <div className="ed-field"><dt>{label}</dt><dd>{children}</dd></div>

);



/**

 * Converts a stored event (snake_case API fields) into editor values keyed by edit field.

 * Missing values become empty inputs (or an unticked box) so editors never show "null"; zero stays zero.

 * Used when the event loads, after a save, and to restore a field when an edit is cancelled.

 */

function toEditValues(event) {

  return {

    name: event.name || '',

    purpose: event.purpose || '',

    description: event.description || '',

    eventType: event.event_type || '',

    proposedDate: event.proposed_date?.slice(0, 10) || '',

    proposedStartTime: event.proposed_start_time?.slice(0, 5) || '',

    proposedEndTime: event.proposed_end_time?.slice(0, 5) || '',

    expectedAttendance: event.expected_attendance ?? '',

    programmeDetails: event.programme_details || '',

    roomLayoutPreference: event.room_layout_preference || '',

    equipmentNotes: event.equipment_notes || '',

    accessibilityText: (event.accessibility_requirements || []).join('\n'),

    specialArrangements: event.special_arrangements || '',

    registrationRequired: event.registration_required ?? false,

    registrationCapacity: event.registration_capacity ?? '',

  };

}



// Loads an accessible event and renders persisted fields with safe missing-value formatting.

export default function EventDetail() {

  const { id } = useParams();

  const { token, user } = useAuth();

  const location = useLocation();

  const [event, setEvent] = useState(null);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState('');

  const [editValues, setEditValues] = useState(null);

  const [saveMessage, setSaveMessage] = useState('');

  const [saving, setSaving] = useState(false);

  const [confirmUpdate, setConfirmUpdate] = useState(false);

  const [updateSuccess, setUpdateSuccess] = useState('');

  const [updateError, setUpdateError] = useState('');

  const [readingFiles, setReadingFiles] = useState(0);

  const [fileChanges, setFileChanges] = useState({});

  const [activeEditField, setActiveEditField] = useState('');

  const [clarificationFields, setClarificationFields] = useState([]);

  const [clarificationMessage, setClarificationMessage] = useState('');

  const [clarificationResponses, setClarificationResponses] = useState({});

  const [clarificationSaving, setClarificationSaving] = useState(false);



  useEffect(() => {

    // Loads this screen's API data when its dependencies change and manages effect lifetime.

    let isMounted = true;



    // Loads the selected event and updates details/loading/error only while the effect remains active.

    async function fetchEvent() {

      try {

        setLoading(true);

        setError('');

        setEvent(null);



        const data = await api.get(`/events/${id}`, token);



        if (isMounted) {

          setEvent(data.event);

          if (data.event) setEditValues(toEditValues(data.event));

        }

      } catch (err) {

        if (isMounted) {

          setError(err.message || 'Unable to load event details.');

        }

      } finally {

        if (isMounted) {

          setLoading(false);

        }

      }

    }



    if (id) {

      fetchEvent();

    }



    return () => {

      // Marks this request inactive so late responses cannot update an unmounted or changed screen.

      isMounted = false;

    };

  }, [id, token]);



  // Formats primitive or non-empty string-list event values with a missing-value fallback.

  const fieldValue = (value) => {

    if (Array.isArray(value)) {

      return value.filter((item) => typeof item === 'string' && item.trim()).join(', ') || 'Not specified';

    }

    if (value == null || (typeof value === 'string' && !value.trim())) return 'Not specified';

    return typeof value === 'string' || typeof value === 'number' ? value : 'Not specified';

  };



  // Validates a stored calendar date and displays it as day/month/year.

  const formatDate = (value) => {

    if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return 'Not specified';

    const date = value.slice(0, 10);

    if (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) return 'Not specified';

    return date.split('-').reverse().join('/');

  };



  // Capitalizes the stored status or returns a missing-value fallback.

  const formatStatus = (value) => {

    if (!value) return 'Not specified';

    return value.charAt(0).toUpperCase() + value.slice(1);

  };



  // Converts underscore-separated text into capitalized display words.

  const formatText = (value) => {

    if (!value) return 'Not specified';

    return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());

  };



  /** Persists the confirmed field/file update; failures retain the editor for correction or retry. */

  async function saveNonCritical() {

    setSaving(true);

    setSaveMessage('');

    setError('');

    try {

      const apiField = activeEditField === 'accessibilityText' ? 'accessibilityRequirements' : activeEditField;

      let value = editValues[activeEditField];

      if (activeEditField === 'accessibilityText') value = value.split('\n').map((item) => item.trim()).filter(Boolean);

      if (['expectedAttendance', 'registrationCapacity'].includes(activeEditField)) value = value === '' ? null : Number(value);

      const payload = activeEditField === 'attachments' ? { attachments: fileChanges } : { [apiField]: value };

      const data = await api.put(`/events/${id}/non-critical`, payload, token);

      if (!data.changeRequest) {

        const saved = { ...event, ...data.event };

        setEvent(saved);

        setEditValues(toEditValues(saved));

      } else {

        // A change request leaves the confirmed value in effect, so the editor returns to it.

        resetEditValue(activeEditField);

      }

      setUpdateSuccess(data.message || 'Non-critical event information saved.');

      setFileChanges({});

      setActiveEditField('');

    } catch (err) {

      setUpdateError(err.message || 'Unable to save event information.');

    } finally {

      setSaving(false);

    }

  }



  async function sendClarificationRequest(submitEvent) {

    submitEvent.preventDefault();

    if (clarificationSaving || !clarificationFields.length || !clarificationMessage.trim()) return;

    setClarificationSaving(true); setError(''); setSaveMessage('');

    try {

      const data = await api.post(`/events/${id}/clarifications`, { informationNeeded: clarificationFields, message: clarificationMessage }, token);

      setEvent((current) => ({ ...current, clarification_outstanding: true,

        clarification_requests: [data.clarificationRequest, ...(current.clarification_requests || [])] }));

      setClarificationFields([]); setClarificationMessage(''); setSaveMessage(data.message);

    } catch (err) { setError(err.message || 'Unable to send clarification request.'); }

    finally { setClarificationSaving(false); }

  }



  async function respondToClarification(submitEvent, request) {

    submitEvent.preventDefault();

    const response = clarificationResponses[request.id] || '';

    if (clarificationSaving || !response.trim()) return;

    setClarificationSaving(true); setError(''); setSaveMessage('');

    try {

      const data = await api.post(`/events/${id}/clarifications/${request.id}/respond`, { response }, token);

      setEvent((current) => ({ ...current, clarification_outstanding: data.clarificationOutstanding,

        // A response form exists only for a recorded request; preserve its sibling requests during handover.

        clarification_requests: current.clarification_requests.map((item) => item.id === request.id ? data.clarificationRequest : item) }));

      setClarificationResponses((current) => ({ ...current, [request.id]: '' })); setSaveMessage(data.message);

    } catch (err) { setError(err.message || 'Unable to save clarification response.'); }

    finally { setClarificationSaving(false); }

  }



  const criticalFields = new Set(['name', 'purpose', 'eventType', 'proposedDate', 'proposedStartTime', 'proposedEndTime',

    'expectedAttendance', 'roomLayoutPreference', 'registrationRequired', 'registrationCapacity']);

  const editingAllowed = () => user.role === 'event_organiser';



  // Restores one editor to the event's stored value (used on Cancel and after a change request).

  function resetEditValue(field) {

    setEditValues((current) => ({ ...current, [field]: toEditValues(event)[field] }));

  }



  // Pencil button for one field; its label becomes "Request change to ..." once a venue is confirmed.

  function renderEditButton(field, label, requestMode) {

    const text = requestMode ? `Request change to ${label}` : `Edit ${label}`;

    return (

      <button type="button" className="ed-icon-btn"

        aria-label={text} title={text}

        onClick={() => { setSaveMessage(''); setActiveEditField(field); }}>

        <PencilIcon />

      </button>

    );

  }



  function renderEditableField(field, label, value, critical = false, displayValue = value) {

    const canEdit = editingAllowed(field);

    const requestMode = Boolean(event.venue_confirmed && criticalFields.has(field));

    if (!canEdit) return fieldValue(displayValue);

    if (activeEditField !== field) {

      return (

        <span className="ed-value-row">

          <span>{fieldValue(displayValue)}</span>

          {renderEditButton(field, label, requestMode)}

        </span>

      );

    }

    const controlType = field === 'proposedDate' ? 'date' : ['proposedStartTime', 'proposedEndTime'].includes(field) ? 'time'

      : ['expectedAttendance', 'registrationCapacity'].includes(field) ? 'number' : 'text';

    const multiline = ['description', 'programmeDetails', 'accessibilityText', 'equipmentNotes', 'specialArrangements'].includes(field);

    const setValue = (next) => setEditValues((current) => ({ ...current, [field]: next }));

    return (

      <form className="ed-editor" onSubmit={(submitEvent) => { submitEvent.preventDefault(); setUpdateError(''); setConfirmUpdate(true); }}>

        {field === 'registrationRequired'

          ? (

            <label className="ed-check">

              <span>Registration required?</span>

              <input type="checkbox" aria-label={`Edit ${label}`} checked={Boolean(editValues[field])} disabled={saving}

                onChange={(changeEvent) => setValue(changeEvent.target.checked)} />

            </label>

          )

          : multiline

            ? (

              <textarea className="ed-input" aria-label={`Edit ${label}`} value={editValues[field]} disabled={saving} rows={3}

                onChange={(changeEvent) => setValue(changeEvent.target.value)} />

            )

            : (

              <input className="ed-input" aria-label={`Edit ${label}`} type={controlType} min={controlType === 'number' ? 0 : undefined}

                value={editValues[field]} disabled={saving}

                onChange={(changeEvent) => setValue(changeEvent.target.value)} />

            )}

        <div className="ed-editor-actions">

          <button type="submit" disabled={saving} className="button-primary">{saving ? 'Saving…'

            : event.venue_confirmed && criticalFields.has(field) ? 'Submit change request' : 'Save changes'}</button>

          <button type="button" disabled={saving} className="button-secondary" onClick={() => {

            resetEditValue(field);

            setActiveEditField('');

          }}>Cancel</button>

        </div>

      </form>

    );

  }



  const backLink = !location.state?.backgroundLocation && (

    <Link className="button-link button-secondary detail-back ed-back"

      to={user.role === 'event_organiser' ? '/organizer/events' : user.role === 'event_coordinator_lead' ? '/coordinator-lead/dashboard' : '/events'}>

      ← Back to {user.role === 'event_organiser' ? 'My Events' : 'Events'}

    </Link>

  );



  if (loading) {

    return (

      <div className="detail-state ed-root"><style>{STYLES}</style>{backLink}

        <div className="ed-state-card" role="status"><p className="ed-muted">Loading event details...</p></div>

      </div>

    );

  }



  if (error) {

    return (

      <div className="detail-state ed-root"><style>{STYLES}</style>{backLink}

        <div role="alert" className="ed-notice ed-notice--bad">{error}</div>

      </div>

    );

  }



  if (!event) {

    return (

      <div className="detail-state ed-root"><style>{STYLES}</style>{backLink}

        <div className="ed-state-card">No event details available.</div>

      </div>

    );

  }



  return (

    <div className="event-detail ed-root">

      <style>{STYLES}</style>

      {backLink}

      {location.state?.message && <p className="ed-notice ed-notice--ok" role="status">{location.state.message}</p>}

      {saveMessage && <p className="ed-notice ed-notice--ok" role="status">{saveMessage}</p>}

      {event.clarification_outstanding && <p className="ed-notice ed-notice--warn" role="status">Clarification outstanding — planning is waiting for the Event Organiser.</p>}

      {user.role === 'event_organiser' && <p className="mb-4 text-sm text-slate-600">

        {event.venue_confirmed

          ? 'A venue is confirmed. Use the pencil icon to edit non-critical information or to submit a critical change request. The confirmed details stay in effect until review.'

          : 'No venue is confirmed. Use the pencil icon to edit any event field.'}

      </p>}

      <header className="ed-header">

        <div className="ed-eyebrow">

          <span className="ed-chip">Event Detail</span>

          <span className={`ed-badge ${statusTone(event.status)}`}>{formatStatus(event.status)}</span>

        </div>

        <div className="ed-title-row">

          <h1 className="ed-title">{fieldValue(event.name)}</h1>

          {user.role === 'event_organiser' && activeEditField !== 'name' && renderEditButton('name', 'Event name', Boolean(event.venue_confirmed))}

        </div>

        {activeEditField === 'name' && <div>{renderEditableField('name', 'Event name', event.name, true)}</div>}

      </header>



      {confirmUpdate && <ActionConfirmation action="update this event request" busy={saving} error={updateError} success={updateSuccess} onConfirm={saveNonCritical} onClose={() => { setConfirmUpdate(false); if (updateSuccess) { setSaveMessage(updateSuccess); setUpdateSuccess(''); } }} />}

      <div className="ed-card ed-attach">

        <EventAttachments value={{ ...(event.attachments || {}), ...fileChanges }} onBusy={delta => setReadingFiles(current => current + delta)} onChange={user.role === 'event_organiser' ? (field, file) => { setFileChanges(current => ({ ...current, [field]: file })); setActiveEditField('attachments'); } : undefined} />

        {activeEditField === 'attachments' && <button className="button-primary ed-attach-save" disabled={readingFiles > 0 || saving} onClick={() => { setUpdateError(''); setConfirmUpdate(true); }}>Save attachments</button>}

      </div>

      {['event_coordinator', 'event_coordinator_lead'].includes(user.role) && (

        <section className="ed-card ed-contact" aria-label="Organiser contact">

          <h2 className="ed-card-title">Organiser contact</h2>

          <p className="ed-muted">{event.organiser_name}</p>

          {event.organiser_email ? <a href={`mailto:${event.organiser_email}`}>{event.organiser_email}</a> : <p className="ed-muted">Email not recorded</p>}

        </section>

      )}

      <EventDecisionSection event={event} onDecided={(status) => setEvent((current) => ({ ...current, status }))} />



      <section className="ed-card" aria-labelledby="clarifications-heading">

        <div className="ed-card-head">

          <h2 className="ed-card-title" id="clarifications-heading">Clarification requests</h2>

          <span className={`ed-badge ${event.clarification_outstanding ? 'ed-badge--warn' : 'ed-badge--ok'}`}>{event.clarification_outstanding ? 'Outstanding' : 'No outstanding clarification'}</span>

        </div>

        {(event.clarification_requests || []).length === 0

          ? <p className="ed-muted">No clarification requests have been sent for this event.</p>

          : (

            <ol className="ed-clar-list">

              {event.clarification_requests.map((request) => (

                <li key={request.id} className="ed-clar-item">

                  <div><strong>Information needed:</strong> {request.information_needed.map((field) => clarificationFieldLabels[field]).join(', ')}</div>

                  <p>{request.message}</p>

                  <div><span className={`ed-badge ${request.status === 'pending' ? 'ed-badge--warn' : 'ed-badge--ok'}`}>{request.status === 'pending' ? 'Awaiting organiser response' : 'Organiser responded'}</span></div>

                  {request.organiser_response && (

                    <div className="ed-clar-response"><strong>Organiser response or amendment</strong><p>{request.organiser_response}</p></div>

                  )}

                  {user.role === 'event_organiser' && request.status === 'pending' && (

                    <form className="ed-editor" style={{ maxWidth: 'none' }} onSubmit={(submitEvent) => respondToClarification(submitEvent, request)}>

                      <label className="ed-label" htmlFor={`clarification-response-${request.id}`}>Your response or amendment

                        <textarea className="ed-input" id={`clarification-response-${request.id}`} aria-label={`Response or amendment to clarification ${request.id}`} rows={3} value={clarificationResponses[request.id] || ''} disabled={clarificationSaving} onChange={(changeEvent) => setClarificationResponses((current) => ({ ...current, [request.id]: changeEvent.target.value }))} />

                      </label>

                      <button className="button-primary ed-justify-start" type="submit" disabled={clarificationSaving || !(clarificationResponses[request.id] || '').trim()}>{clarificationSaving ? 'Sending…' : 'Send response'}</button>

                    </form>

                  )}

                </li>

              ))}

            </ol>

          )}

        {user.role === 'event_coordinator' && (

          <form className="ed-clar-form" onSubmit={sendClarificationRequest}>

            <h3>Request clarification from the organiser</h3>

            <fieldset className="ed-check-grid"><legend>Select information that needs clarification</legend>

              {Object.entries(clarificationFieldLabels).map(([field, label]) => (

                <label key={field} className="ed-check-tile">

                  <input type="checkbox" checked={clarificationFields.includes(field)} disabled={clarificationSaving} onChange={(changeEvent) => setClarificationFields((current) => changeEvent.target.checked ? [...current, field] : current.filter((item) => item !== field))} />{label}

                </label>

              ))}

            </fieldset>

            <label className="ed-label" htmlFor="clarification-message">What needs clarification?

              <textarea className="ed-input" id="clarification-message" rows={3} maxLength={4000} value={clarificationMessage} disabled={clarificationSaving} onChange={(changeEvent) => setClarificationMessage(changeEvent.target.value)} />

            </label>

            <button className="button-primary ed-justify-start" type="submit" disabled={clarificationSaving || !clarificationFields.length || !clarificationMessage.trim()}>{clarificationSaving ? 'Sending…' : 'Send clarification request'}</button>

          </form>

        )}

      </section>



      <div className="ed-grid">

        <section className="ed-card ed-span">

          <h2 className="ed-card-title">Event Overview</h2>

          <dl className="ed-fields ed-fields--tiles" style={{ '--ed-cols': 3 }}>

            <Field label="Purpose">{renderEditableField('purpose', 'Purpose', event.purpose, true)}</Field>

            <Field label="Description">{renderEditableField('description', 'Description', event.description)}</Field>

            <Field label="Event Type">{renderEditableField('eventType', 'Event type', event.event_type, true, formatText(event.event_type))}</Field>

          </dl>

        </section>



        <section className="ed-card ed-span">

          <h2 className="ed-card-title">Logistics & Schedule</h2>

          <dl className="ed-fields ed-fields--tiles" style={{ '--ed-cols': 4 }}>

            <Field label="Date">{renderEditableField('proposedDate', 'Date', event.proposed_date, true, formatDate(event.proposed_date))}</Field>

            <Field label="Start Time">{renderEditableField('proposedStartTime', 'Start time', event.proposed_start_time, true)}</Field>

            <Field label="End Time">{renderEditableField('proposedEndTime', 'End time', event.proposed_end_time, true)}</Field>

            <Field label="Expected Attendance">{renderEditableField('expectedAttendance', 'Expected attendance', event.expected_attendance, true)}</Field>

          </dl>

        </section>



        <section className="ed-card ed-span">

          <h2 className="ed-card-title">Requirements</h2>

          <dl className="ed-fields ed-fields--tiles" style={{ '--ed-cols': 3 }}>

            <Field label="Programme">{renderEditableField('programmeDetails', 'Programme', event.programme_details)}</Field>

            <Field label="Layout Requirements">{renderEditableField('roomLayoutPreference', 'Layout requirements', event.room_layout_preference, true)}</Field>

            <Field label="Accessibility Needs">{renderEditableField('accessibilityText', 'Accessibility needs', event.accessibility_requirements)}</Field>

          </dl>

        </section>



        <EquipmentRequirementsSection event={event} canEdit={user.role === 'event_organiser'} token={token}

          onSaved={(fields) => setEvent((current) => ({ ...current, ...fields }))} onMessage={setSaveMessage}>

          {renderEditableField('equipmentNotes', 'Other equipment notes', event.equipment_notes)}

        </EquipmentRequirementsSection>



        <section className="ed-card ed-span">

          <h2 className="ed-card-title">Special Arrangements</h2>

          <div style={{ whiteSpace: 'pre-wrap' }}>{renderEditableField('specialArrangements', 'Special arrangements', event.special_arrangements)}</div>

        </section>



        <section className="ed-card ed-span">

          <h2 className="ed-card-title">Registration & Coordination</h2>

          <dl className="ed-fields ed-fields--tiles" style={{ '--ed-cols': 4 }}>

            <Field label="Registration Required">

              {renderEditableField('registrationRequired', 'Registration required', event.registration_required, true,

                event.registration_required == null ? 'Not specified' : event.registration_required ? 'Yes' : 'No')}

            </Field>

            <Field label="Registration Capacity">{renderEditableField('registrationCapacity', 'Registration capacity', event.registration_capacity, true)}</Field>

            <Field label="Organiser">{fieldValue(event.organiser_name)}</Field>

            <Field label="Coordinator">{fieldValue(event.coordinator_name)}</Field>

          </dl>

        </section>

      </div>

    </div>

  );

}