import { useEffect, useState } from 'react';
import { api } from '../../api/client';

/** Lets the assigned coordinator request one venue period and revise the choices after an availability conflict. */
export default function VenueBookingRequest({ event, token }) {
  const [venues, setVenues] = useState([]);
  const [venueId, setVenueId] = useState('');
  const [date, setDate] = useState(event.proposed_date || '');
  const [startTime, setStartTime] = useState(String(event.proposed_start_time || '').slice(0, 5));
  const [endTime, setEndTime] = useState(String(event.proposed_end_time || '').slice(0, 5));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    let current = true;
    api.get('/venues', token).then(result => {
      if (current) {
        const records = Array.isArray(result) ? result : result.venues || [];
        setVenues(records);
        setVenueId(records[0] ? String(records[0].id) : '');
      }
    }).catch(error => {
      if (current) setFeedback({ kind: 'error', message: error.message || 'Unable to load venues.' });
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [token]);

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
      }, token);
      setFeedback({ kind: 'success', message: 'Venue request submitted.' });
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
      <button type="submit" disabled={busy || !venueId}>{busy ? 'Submitting…' : 'Request venue'}</button>
    </form>}
  </section>;
}
