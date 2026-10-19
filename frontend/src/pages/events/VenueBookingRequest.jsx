import { useEffect, useState } from 'react';
import { api } from '../../api/client';

/** Lets the assigned coordinator request one venue period and revise the choices after an availability conflict. */
export default function VenueBookingRequest({ event, token, onSubmitted, initialVenueId }) {
  const [venues, setVenues] = useState([]);
  const [venueId, setVenueId] = useState('');
  const [date, setDate] = useState(event.proposed_date || '');
  const [startTime, setStartTime] = useState(String(event.proposed_start_time || '').slice(0, 5));
  const [endTime, setEndTime] = useState(String(event.proposed_end_time || '').slice(0, 5));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [capacity, setCapacity] = useState(event.expected_attendance || '');
  const [layout, setLayout] = useState(event.room_layout_preference || '');
  const [accessibility, setAccessibility] = useState((event.accessibility_requirements || []).join(', '));
  const [facilities, setFacilities] = useState((event.required_facilities || []).join(', '));
  const [cancelOtherPending, setCancelOtherPending] = useState(false);

  useEffect(() => {
    let current = true;
    api.get('/venues', token).then(result => {
      if (current) {
        const records = Array.isArray(result) ? result : result.venues || [];
        setVenues(records);
        // A chosen catalogue venue must never silently fall back to a different space after refresh/deactivation.
        const initial = initialVenueId ? records.find(record => String(record.id) === initialVenueId) : records[0];
        setVenueId(initial ? String(initial.id) : '');
        if (initialVenueId && !initial) setFeedback({ kind: 'error', message: 'This venue is no longer available. Choose another venue.' });
      }
    }).catch(error => {
      if (current) setFeedback({ kind: 'error', message: error.message || 'Unable to load venues.' });
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [token, initialVenueId]);

  /** Submits the current controlled values so a retry uses the coordinator's latest venue and period. */
  async function submit(eventAction) {
    eventAction.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      await api.post(`/venues/${venueId}/requests`, {
        eventId: event.id,
        startDatetime: `${date}T${startTime}:00+08:00`,
        endDatetime: `${date}T${endTime}:00+08:00`,
        capacity: capacity === '' ? null : Number(capacity),
        layout: layout.trim(),
        accessibility: splitRequirements(accessibility),
        requiredFacilities: splitRequirements(facilities),
        cancelOtherPending,
      }, token);
      setFeedback({ kind: 'success', message: 'Venue request submitted.' });
      onSubmitted?.();
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
    {feedback && <p role={feedback.kind === 'success' ? 'status' : 'alert'} className={feedback.kind === 'conflict' ? 'ed-badge ed-badge--warn' : undefined}>{feedback.message}</p>}
    {loading ? <p role="status">Loading venues…</p> : venues.length === 0 ? <p>No active venues are available to request.</p> : <form onSubmit={submit}>
      <label>Venue
        <select required value={venueId} onChange={update(setVenueId)}>
          {!venueId && <option value="">Choose an active venue</option>}
          {venues.map(venue => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
        </select>
      </label>
      <label>Date
        <input required type="date" value={date} onChange={update(setDate)} />
      </label>
      <label>Start time
        <input required type="time" value={startTime} onChange={update(setStartTime)} />
      </label>
      <label>End time
        <input required type="time" value={endTime} onChange={update(setEndTime)} />
      </label>
      <label>Expected attendance / capacity
        <input type="number" min="1" max="2147483647" step="1" value={capacity} onChange={update(setCapacity)} />
      </label>
      <label>Room layout<input value={layout} maxLength={200} onChange={update(setLayout)} /></label>
      <label>Accessibility requirements<input value={accessibility} maxLength={2000} onChange={update(setAccessibility)} /></label>
      <label>Required facilities<input value={facilities} maxLength={2000} onChange={update(setFacilities)} /></label>
      <p className="ed-muted">Separate multiple accessibility requirements or facilities with commas.</p>
      <label><input type="checkbox" checked={cancelOtherPending} onChange={change => setCancelOtherPending(change.target.checked)} />
        Automatically cancel my other pending venue requests for this event if this arrangement changes or is cancelled.
      </label>
      <p className="ed-muted">Approved bookings are kept. Approval alone does not cancel other requests.</p>
      <button type="submit" disabled={busy || !venueId}>{busy ? 'Submitting…' : 'Request venue'}</button>
    </form>}
  </section>;
}

/** Converts comma-separated requirements into distinct non-empty entries before the API snapshots them. */
function splitRequirements(value) {
  return [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))];
}
