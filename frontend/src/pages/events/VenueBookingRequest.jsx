import { useEffect, useId, useState } from 'react';
import ClockTimeField, { parseClockTime, formatClockTime } from '../../components/ClockTimeField';
import { api } from '../../api/client';

/** Lets the assigned coordinator request one venue period and revise the choices after an availability conflict. */
export default function VenueBookingRequest({ event, token, onSubmitted, initialVenueId, editingBooking, onVenueChange }) {
  const requirementsNoteId = useId();
  const [venues, setVenues] = useState([]);
  const [venueId, setVenueId] = useState('');
  const [date, setDate] = useState(event.proposed_date || '');
  const [startTime, setStartTime] = useState(formatClockTime(String(event.proposed_start_time || '').slice(0, 5)));
  const [endTime, setEndTime] = useState(formatClockTime(String(event.proposed_end_time || '').slice(0, 5)));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [capacity, setCapacity] = useState(event.expected_attendance || '');
  const [layout, setLayout] = useState(event.room_layout_preference || '');
  const [accessibility, setAccessibility] = useState((event.accessibility_requirements || []).join(', '));
  const [facilities, setFacilities] = useState((event.required_facilities || []).join(', '));
  const [cancelOtherPending, setCancelOtherPending] = useState(false);
  const [sessionName,setSessionName]=useState(editingBooking?.requirements.sessionName || '');
  const [venueRetry, setVenueRetry] = useState(0);
  const sessionRequest = Boolean(sessionName.trim());

  useEffect(() => {
    let current = true;
    setLoading(true); setVenues([]); setVenueId(''); setFeedback(null);
    // Named sessions keep their own requirements; ordinary bookings must satisfy the saved event as well.
    api.get(sessionRequest ? '/venues' : `/events/${event.id}/eligible-venues`, token).then(result => {
      if (current) {
        const records = Array.isArray(result) ? result : result.venues || [];
        setVenues(records);
        // A chosen catalogue venue must never silently fall back to a different space after refresh/deactivation.
        const initial = initialVenueId ? records.find(record => String(record.id) === initialVenueId) : records[0];
        setVenueId(initial ? String(initial.id) : '');
        if (initialVenueId && !initial) setFeedback({ kind: 'error', message: 'This venue is no longer available. Choose another venue.' });
      }
    }).catch(error => {
      if (current) setFeedback({ kind: 'load-error', message: error.message || 'Unable to load venues.' });
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [token, initialVenueId, event.id, sessionRequest, venueRetry]);

  /** Submits the current controlled values so a retry uses the coordinator's latest venue and period. */
  async function submit(eventAction) {
    eventAction.preventDefault();
    // Keyboard drafts must be complete before converting display labels into Singapore API timestamps.
    const start = parseClockTime(startTime), end = parseClockTime(endTime);
    if (start === null || end === null) {
      setFeedback({ kind: 'error', message: 'Enter both times as hh:mm AM or PM.' });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const body = {
        eventId: event.id,
        startDatetime: `${date}T${start}:00+08:00`,
        endDatetime: `${date}T${end}:00+08:00`,
        capacity: capacity === '' ? null : Number(capacity),
        layout: layout.trim(),
        accessibility: splitRequirements(accessibility),
        requiredFacilities: splitRequirements(facilities),
        cancelOtherPending: sessionName.trim()?false:cancelOtherPending,
        ...(sessionName.trim()?{sessionName:sessionName.trim()}:{}),
      };
      const result=editingBooking
        ? await api.put(`/venues/${venueId}/requests/${editingBooking.id}/session`,body,token)
        : await api.post(`/venues/${venueId}/requests`,body,token);
      setFeedback({ kind: 'success', message: 'Venue request submitted.' });
      onSubmitted?.(result.request);
    } catch (error) {
      const selectedVenue = venues.find(venue => String(venue.id) === venueId);
      // Explain the unavailable period and retain every field so the coordinator can correct and resubmit it.
      const message = error.status === 409
        ? `${selectedVenue?.name || 'This venue'} is unavailable for the requested period. Change the venue, date or time, then try again.`
        : error.message || 'Unable to submit the venue request.';
      setFeedback({ kind: error.status === 409 ? 'conflict' : 'error', message });
    } finally {
      setBusy(false);
    }
  }

  /** Clears obsolete feedback when the coordinator revises a request before retrying. */
  function update(setter) {
    return change => {
      setter(change.target.value);
      setFeedback(null);
    };
  }

  return <section className="ed-card" aria-labelledby="venue-booking-request-heading">
    <h2 className="ed-card-title" id="venue-booking-request-heading">Request a venue booking</h2>
    {/* A smaller independent session can still be created when no venue fits the whole event. */}
    <div className="booking-review-session">
      <label>Session / track (optional)<input value={sessionName} onChange={update(setSessionName)} maxLength={120} disabled={Boolean(editingBooking)} placeholder="e.g. Breakout session A"/></label>
      <p className="ed-muted">Name each session to keep its timing, attendance and venue arrangements independent.</p>
    </div>
    {feedback && <p role={feedback.kind === 'success' ? 'status' : 'alert'} className={feedback.kind === 'conflict' ? 'ed-badge ed-badge--warn' : undefined}>{feedback.message}</p>}
    {feedback?.kind === 'load-error' && <button className="button-secondary" onClick={() => setVenueRetry(value => value + 1)}>Retry venues</button>}
    {loading ? <p role="status">Loading venues…</p> : feedback?.kind === 'load-error' ? null : venues.length === 0 ? <p>{sessionRequest ? 'No active venues are available to request.' : 'No active venues meet this event’s requirements.'}</p> : <form onSubmit={submit}>
      <label>Venue
        <select required value={venueId} onChange={change => { update(setVenueId)(change); onVenueChange?.(change.target.value); }} disabled={Boolean(editingBooking)}>
          {!venueId && <option value="">Choose an active venue</option>}
          {venues.map(venue => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
        </select>
      </label>
      <label>Date
        <input required type="date" value={date} onChange={update(setDate)} />
      </label>
      <ClockTimeField label="Start time" required value={startTime} onChange={value => { setStartTime(value); setFeedback(null); }} />
      <ClockTimeField label="End time" required value={endTime} onChange={value => { setEndTime(value); setFeedback(null); }} />
      <label>Expected attendance / capacity
        <input type="number" required={Boolean(sessionName.trim())} min="1" max="2147483647" step="1" value={capacity} onChange={update(setCapacity)} />
      </label>
      <label>Room layout<input value={layout} maxLength={200} onChange={update(setLayout)} /></label>
      {/* These stars reference entry guidance, not mandatory fields; preserve the existing accessible field names. */}
      <label><span>Accessibility requirements<span aria-hidden="true"> *</span></span><input aria-label="Accessibility requirements" aria-describedby={requirementsNoteId} value={accessibility} maxLength={2000} onChange={update(setAccessibility)} /></label>
      <label><span>Required facilities<span aria-hidden="true"> *</span></span><input aria-label="Required facilities" aria-describedby={requirementsNoteId} value={facilities} maxLength={2000} onChange={update(setFacilities)} /></label>
      <p className="ed-muted" id={requirementsNoteId}><span aria-hidden="true">* </span>Separate multiple accessibility requirements or facilities with commas.</p>
      {!sessionName.trim() && <label><input type="checkbox" checked={cancelOtherPending} onChange={change => setCancelOtherPending(change.target.checked)} />
        Automatically cancel my other pending venue requests for this event if this arrangement changes or is cancelled.
      </label>}
      <p className="ed-muted">Approved bookings are kept. Approval alone does not cancel other requests.</p>
      <button type="submit" disabled={busy || !venueId}>{busy ? 'Submitting…' : 'Request venue'}</button>
    </form>}
  </section>;
}

/** Converts comma-separated requirements into distinct non-empty entries before the API snapshots them. */
function splitRequirements(value) {
  return [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))];
}
