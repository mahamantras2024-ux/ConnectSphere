// File: Loads and formats persisted event details, handling missing values and request failures.
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';

const clarificationFieldLabels = {
  name: 'Event name', purpose: 'Purpose', description: 'Description', event_type: 'Event type',
  proposed_date: 'Date', proposed_start_time: 'Start time', proposed_end_time: 'End time',
  expected_attendance: 'Expected attendance', programme_details: 'Programme',
  room_layout_preference: 'Layout requirements', accessibility_requirements: 'Accessibility needs',
  equipment_notes: 'Equipment requests', registration_required: 'Registration required',
  registration_capacity: 'Registration capacity', special_arrangements: 'Special arrangements',
};

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

  const fieldValue = (value) => {
    // Formats primitive or non-empty string-list event values with a missing-value fallback.

    if (Array.isArray(value)) return value.filter((item) => // Keeps only non-empty text entries for display or validation.

      // Keeps entries that meet the required field or access condition.
      typeof item === 'string' && item.trim()).join(', ') || 'Not specified';
    if (value == null || (typeof value === 'string' && !value.trim())) return 'Not specified';
    return typeof value === 'string' || typeof value === 'number' ? value : 'Not specified';
  };
  const formatDate = (value) => {
    // Validates a stored calendar date and displays it as day/month/year.

    if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return 'Not specified';
    const date = value.slice(0, 10);
    if (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) return 'Not specified';
    return date.split('-').reverse().join('/');
  };

  const formatStatus = (value) => {
    // Capitalizes the stored status or returns a missing-value fallback.

    if (!value) return 'Not specified';
    return value.charAt(0).toUpperCase() + value.slice(1);
  };

  const formatText = (value) => {
    // Converts underscore-separated text into capitalized display words.

    if (!value) return 'Not specified';
    return value
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => // Capitalizes the matched word initial for display text.

      // Handles this operation using the surrounding screen or request state.
      char.toUpperCase());
  };

  async function saveNonCritical() {
    // A second submit (e.g. pressing Enter twice) while saving must not send a duplicate update.
    if (saving) return;
    setSaving(true);
    setSaveMessage('');
    setError('');
    try {
      const apiField = activeEditField === 'accessibilityText' ? 'accessibilityRequirements' : activeEditField;
      let value = editValues[activeEditField];
      if (activeEditField === 'accessibilityText') value = value.split('\n').map((item) => item.trim()).filter(Boolean);
      if (['expectedAttendance', 'registrationCapacity'].includes(activeEditField)) value = value === '' ? null : Number(value);
      const payload = { [apiField]: value };
      const data = await api.put(`/events/${id}/non-critical`, payload, token);
      if (!data.changeRequest) {
        const saved = { ...event, ...data.event };
        setEvent(saved);
        setEditValues(toEditValues(saved));
      } else {
        // A change request leaves the confirmed value in effect, so the editor returns to it.
        resetEditValue(activeEditField);
      }
      // Both API outcomes (saved or change request submitted) always include a confirmation message.
      setSaveMessage(data.message);
      setActiveEditField('');
    } catch (err) {
      // The API client always supplies a readable message for failed requests.
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function sendClarificationRequest(submitEvent) {
    submitEvent.preventDefault();
    // The send button is disabled until fields and a question are entered; this guard stops a duplicate submit while saving.
    if (clarificationSaving) return;
    setClarificationSaving(true); setError(''); setSaveMessage('');
    try {
      const data = await api.post(`/events/${id}/clarifications`, { informationNeeded: clarificationFields, message: clarificationMessage }, token);
      setEvent((current) => ({ ...current, clarification_outstanding: true,
        clarification_requests: [data.clarificationRequest, ...current.clarification_requests] }));
      setClarificationFields([]); setClarificationMessage(''); setSaveMessage(data.message);
    } catch (err) { setError(err.message); }
    finally { setClarificationSaving(false); }
  }

  async function respondToClarification(submitEvent, request) {
    submitEvent.preventDefault();
    // The send button is disabled until a response is typed; this guard stops a duplicate submit while saving.
    if (clarificationSaving) return;
    const response = clarificationResponses[request.id];
    setClarificationSaving(true); setError(''); setSaveMessage('');
    try {
      const data = await api.post(`/events/${id}/clarifications/${request.id}/respond`, { response }, token);
      setEvent((current) => ({ ...current, clarification_outstanding: data.clarificationOutstanding,
        clarification_requests: current.clarification_requests.map((item) => item.id === request.id ? data.clarificationRequest : item) }));
      setClarificationResponses((current) => ({ ...current, [request.id]: '' })); setSaveMessage(data.message);
    } catch (err) { setError(err.message); }
    finally { setClarificationSaving(false); }
  }

  const criticalFields = new Set(['name', 'purpose', 'eventType', 'proposedDate', 'proposedStartTime', 'proposedEndTime',
    'expectedAttendance', 'roomLayoutPreference', 'registrationRequired', 'registrationCapacity']);
  const editingAllowed = () => user.role === 'event_organiser';

  // Restores one editor to the event's stored value (used on Cancel and after a change request).
  function resetEditValue(field) {
    setEditValues((current) => ({ ...current, [field]: toEditValues(event)[field] }));
  }

  function renderEditableField(field, label, value, critical = false, displayValue = value) {
    const canEdit = editingAllowed(field);
    const requestMode = Boolean(event.venue_confirmed && criticalFields.has(field));
    if (!canEdit) return fieldValue(displayValue);
    if (activeEditField !== field) {
      return <span className="inline-flex items-start gap-2">
        <span>{fieldValue(displayValue)}</span>
        <button type="button" className={requestMode ? 'text-amber-800 hover:text-amber-950' : 'text-blue-700 hover:text-blue-900'}
          aria-label={requestMode ? `Request change to ${label}` : `Edit ${label}`}
          title={requestMode ? `Request change to ${label}` : `Edit ${label}`}
          onClick={() => { setSaveMessage(''); setActiveEditField(field); }}>{requestMode ? '✉' : '✎'}</button>
      </span>;
    }
    const controlType = field === 'proposedDate' ? 'date' : ['proposedStartTime', 'proposedEndTime'].includes(field) ? 'time'
      : ['expectedAttendance', 'registrationCapacity'].includes(field) ? 'number' : 'text';
    const multiline = ['description', 'programmeDetails', 'accessibilityText', 'equipmentNotes', 'specialArrangements'].includes(field);
    return <form className="mt-2 grid gap-2" onSubmit={(submitEvent) => { submitEvent.preventDefault(); saveNonCritical(); }}>
      {field === 'registrationRequired' ? <label className="flex items-center gap-2"><input type="checkbox" aria-label={`Edit ${label}`} checked={Boolean(editValues[field])} disabled={saving}
        onChange={(changeEvent) => setEditValues((current) => ({ ...current, [field]: changeEvent.target.checked }))} /> Required</label>
        : multiline ? <textarea aria-label={`Edit ${label}`} value={editValues[field]} disabled={saving}
          onChange={(changeEvent) => setEditValues((current) => ({ ...current, [field]: changeEvent.target.value }))} rows={3} />
          : <input aria-label={`Edit ${label}`} type={controlType} min={controlType === 'number' ? 0 : undefined} value={editValues[field]} disabled={saving}
            onChange={(changeEvent) => setEditValues((current) => ({ ...current, [field]: changeEvent.target.value }))} />}
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="button-primary">{saving ? 'Saving…'
          : event.venue_confirmed && criticalFields.has(field) ? 'Submit change request' : 'Save changes'}</button>
        <button type="button" disabled={saving} className="button-secondary" onClick={() => {
          resetEditValue(field);
          setActiveEditField('');
        }}>Cancel</button>
      </div>
    </form>;
  }

  const backLink = !location.state?.backgroundLocation && <Link className="button-link button-secondary detail-back" to={user.role === 'event_organiser' ? '/organizer/events' : '/events'}>Back to {user.role === 'event_organiser' ? 'My Events' : 'Events'}</Link>;

  if (loading) {
    return (
      <div className="detail-state">{backLink}
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-4 shadow-sm">
          <p className="text-base font-medium text-slate-600">Loading event details...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="detail-state">{backLink}
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-700 shadow-sm">
          {error}
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="detail-state">{backLink}
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-600 shadow-sm">
          No event details available.
        </div>
      </div>
    );
  }

  return (
    <div className="event-detail mx-auto max-w-6xl px-4 py-8">
      {backLink}
      {location.state?.message && <p role="status">{location.state.message}</p>}
      {saveMessage && <p role="status">{saveMessage}</p>}
      {event.clarification_outstanding && <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 font-semibold text-amber-900" role="status">Clarification outstanding — planning is waiting for the Event Organiser.</p>}
      {user.role === 'event_organiser' && <p className="mb-4 text-sm text-slate-600">
        {event.venue_confirmed
          ? 'A venue is confirmed. Use ✎ to edit non-critical information or ✉ to submit a critical change request. The confirmed details stay in effect until review.'
          : 'No venue is confirmed. Use ✎ to edit any event field.'}
      </p>}
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-3">
          <span className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">
            Event Detail
          </span>
          <span className="text-sm text-slate-500">ID #{fieldValue(event.id)}</span>
          <span>{formatStatus(event.status)}</span>
        </div>

        <h1 className="text-4xl font-black tracking-tight text-slate-900">
          {fieldValue(event.name)}
        </h1>
        {user.role === 'event_organiser' && activeEditField !== 'name' && (
          <button type="button" className={event.venue_confirmed ? 'text-amber-800 hover:text-amber-950' : 'text-blue-700 hover:text-blue-900'}
            aria-label={event.venue_confirmed ? 'Request change to Event name' : 'Edit Event name'}
            title={event.venue_confirmed ? 'Request change to Event name' : 'Edit Event name'}
            onClick={() => { setSaveMessage(''); setActiveEditField('name'); }}>{event.venue_confirmed ? '✉' : '✎'}</button>
        )}
        {activeEditField === 'name' && <div>{renderEditableField('name', 'Event name', event.name, true)}</div>}

      </div>

      <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" aria-labelledby="clarifications-heading">
        <div className="section-heading"><h2 id="clarifications-heading">Clarification requests</h2>
          <span className={`status-badge ${event.clarification_outstanding ? 'status-under_review' : 'status-confirmed'}`}>{event.clarification_outstanding ? 'Outstanding' : 'No outstanding clarification'}</span></div>
        {(event.clarification_requests || []).length === 0 ? <p className="text-slate-600">No clarification requests have been sent for this event.</p>
          : <ol className="grid gap-4">{event.clarification_requests.map((request) => <li key={request.id} className="change-request-card">
            <div><strong>Information needed:</strong> {request.information_needed.map((field) => clarificationFieldLabels[field]).join(', ')}</div>
            <p className="whitespace-pre-wrap">{request.message}</p>
            <p className="text-sm text-slate-600">{request.status === 'pending' ? 'Awaiting organiser response' : 'Organiser responded'}</p>
            {request.organiser_response && <div className="rounded-lg bg-slate-50 p-3"><strong>Organiser response or amendment</strong><p className="mt-1 whitespace-pre-wrap">{request.organiser_response}</p></div>}
            {user.role === 'event_organiser' && request.status === 'pending' && <form className="grid gap-3" onSubmit={(submitEvent) => respondToClarification(submitEvent, request)}>
              <label className="grid gap-1 font-medium" htmlFor={`clarification-response-${request.id}`}>Your response or amendment<textarea id={`clarification-response-${request.id}`} aria-label={`Response or amendment to clarification ${request.id}`} rows={3} value={clarificationResponses[request.id] || ''} disabled={clarificationSaving} onChange={(changeEvent) => setClarificationResponses((current) => ({ ...current, [request.id]: changeEvent.target.value }))} /></label>
              <button className="button-primary justify-self-start" type="submit" disabled={clarificationSaving || !(clarificationResponses[request.id] || '').trim()}>{clarificationSaving ? 'Sending…' : 'Send response'}</button>
            </form>}
          </li>)}</ol>}
        {user.role === 'event_coordinator' && <form className="mt-5 grid gap-3 border-t border-slate-200 pt-5" onSubmit={sendClarificationRequest}>
          <h3 className="font-semibold">Request clarification from the organiser</h3>
          <fieldset className="grid gap-2 sm:grid-cols-2"><legend className="mb-2 font-medium">Select information that needs clarification</legend>
            {Object.entries(clarificationFieldLabels).map(([field, label]) => <label key={field} className="flex items-center gap-2"><input className="!w-4" type="checkbox" checked={clarificationFields.includes(field)} disabled={clarificationSaving} onChange={(changeEvent) => setClarificationFields((current) => changeEvent.target.checked ? [...current, field] : current.filter((item) => item !== field))} />{label}</label>)}
          </fieldset>
          <label className="grid gap-1 font-medium" htmlFor="clarification-message">What needs clarification?<textarea id="clarification-message" rows={3} maxLength={4000} value={clarificationMessage} disabled={clarificationSaving} onChange={(changeEvent) => setClarificationMessage(changeEvent.target.value)} /></label>
          <button className="button-primary justify-self-start" type="submit" disabled={clarificationSaving || !clarificationFields.length || !clarificationMessage.trim()}>{clarificationSaving ? 'Sending…' : 'Send clarification request'}</button>
        </form>}
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-5 text-xl font-bold text-slate-900">Event Overview</h2>
          <dl className="space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Purpose
              </dt>
              <dd className="mt-1 text-base font-medium text-slate-900">
                {renderEditableField('purpose', 'Purpose', event.purpose, true)}
              </dd>
            </div>

            <div className="border-b border-slate-100 pb-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Description
              </dt>
              <dd className="mt-1 text-base font-medium text-slate-900">
                {renderEditableField('description', 'Description', event.description)}
              </dd>
            </div>

            <div className="border-b border-slate-100 pb-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Event Type
              </dt>
              <dd className="mt-1 text-base font-medium text-slate-900">
                {renderEditableField('eventType', 'Event type', event.event_type, true, formatText(event.event_type))}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-5 text-xl font-bold text-slate-900">Logistics & Schedule</h2>
          <dl className="space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Date
              </dt>
              <dd className="mt-1 text-base font-medium text-slate-900">
                {renderEditableField('proposedDate', 'Date', event.proposed_date, true, formatDate(event.proposed_date))}
              </dd>
            </div>

            <div className="border-b border-slate-100 pb-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Start Time
              </dt>
              <dd className="mt-1 text-base font-medium text-slate-900">
                {renderEditableField('proposedStartTime', 'Start time', event.proposed_start_time, true)}
              </dd>
            </div>

            <div className="border-b border-slate-100 pb-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                End Time
              </dt>
              <dd className="mt-1 text-base font-medium text-slate-900">
                {renderEditableField('proposedEndTime', 'End time', event.proposed_end_time, true)}
              </dd>
            </div>

            <div className="border-b border-slate-100 pb-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Expected Attendance
              </dt>
              <dd className="mt-1 text-base font-medium text-slate-900">
                {renderEditableField('expectedAttendance', 'Expected attendance', event.expected_attendance, true)}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:col-span-2">
          <h2 className="mb-5 text-xl font-bold text-slate-900">Requirements</h2>
          <dl className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Programme
              </dt>
              <dd className="mt-2 whitespace-pre-wrap text-base font-medium text-slate-900">
                {renderEditableField('programmeDetails', 'Programme', event.programme_details)}
              </dd>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Layout Requirements
              </dt>
              <dd className="mt-2 whitespace-pre-wrap text-base font-medium text-slate-900">
                {renderEditableField('roomLayoutPreference', 'Layout requirements', event.room_layout_preference, true)}
              </dd>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Accessibility Needs
              </dt>
              <dd className="mt-2 whitespace-pre-wrap text-base font-medium text-slate-900">
                {renderEditableField('accessibilityText', 'Accessibility needs', event.accessibility_requirements)}
              </dd>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Equipment Requests
              </dt>
              <dd className="mt-2 whitespace-pre-wrap text-base font-medium text-slate-900">
                {renderEditableField('equipmentNotes', 'Equipment requests', event.equipment_notes)}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:col-span-2">
          <h2 className="mb-5 text-xl font-bold text-slate-900">Special Arrangements</h2>
          <p className="whitespace-pre-wrap">{renderEditableField('specialArrangements', 'Special arrangements', event.special_arrangements)}</p>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:col-span-2">
          <h2 className="mb-5 text-xl font-bold text-slate-900">Registration & Coordination</h2>
          <dl className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Registration Required
              </dt>
              <dd className="mt-2 whitespace-pre-wrap text-base font-medium text-slate-900">
                {renderEditableField('registrationRequired', 'Registration required', event.registration_required, true,
                  event.registration_required == null ? 'Not specified' : event.registration_required ? 'Yes' : 'No')}
              </dd>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Registration Capacity
              </dt>
              <dd className="mt-2 whitespace-pre-wrap text-base font-medium text-slate-900">
                {renderEditableField('registrationCapacity', 'Registration capacity', event.registration_capacity, true)}
              </dd>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Organiser
              </dt>
              <dd className="mt-2 whitespace-pre-wrap text-base font-medium text-slate-900">
                {fieldValue(event.organiser_name)}
              </dd>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Coordinator
              </dt>
              <dd className="mt-2 whitespace-pre-wrap text-base font-medium text-slate-900">
                {fieldValue(event.coordinator_name)}
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}
