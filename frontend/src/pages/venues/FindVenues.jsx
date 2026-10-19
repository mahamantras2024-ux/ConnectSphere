// File: Connects venue discovery with an assigned event and a full-page booking review.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import PageIntro from '../../components/PageIntro';
import VenueList from './VenueList';
import VenueBookingRequest from '../events/VenueBookingRequest';

/** Loads assignment-scoped events; event details seed discovery without making any filter compulsory. */
export default function FindVenues() {
  const { token } = useAuth();
  const [params, setParams] = useSearchParams();
  const eventId = params.get('eventId') || '';
  const venueId = params.get('venueId') || '';
  const [events, setEvents] = useState([]);
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [chooseEvent, setChooseEvent] = useState(false);

  useEffect(() => {
    // Clear the previous context before any route/session change can submit against a stale event.
    let active = true;
    setLoading(true); setEvent(null); setError(''); setSubmitted(false);
    async function loadContext() {
      try {
        const result = await api.get('/events', token);
        const assigned = result.events || [];
        if (!active) return;
        setEvents(assigned);
        if (eventId) {
          if (!assigned.some(record => String(record.id) === eventId)) throw new Error('Choose an event assigned to you.');
          const detail = await api.get(`/events/${eventId}`, token);
          if (active) setEvent(detail.event);
        }
      } catch (failure) { if (active) setError(failure.message); }
      finally { if (active) setLoading(false); }
    }
    loadContext();
    return () => { active = false; };
  }, [eventId, token, retry]);

  /** Keeps the URL bookmarkable and retains the chosen venue while selecting the booking's event. */
  function selectEvent(value) {
    setChooseEvent(false);
    const next = new URLSearchParams(params);
    if (value) next.set('eventId', value); else next.delete('eventId');
    setParams(next);
  }
  /** Selection opens review only after the coordinator chooses an assigned event. */
  function requestVenue(venue) {
    setSubmitted(false);
    setChooseEvent(!event);
    const next = new URLSearchParams(params);
    next.set('venueId', venue.id);
    setParams(next);
  }
  /** Returns to discovery for an additional independent request, keeping the event context. */
  function findAnother() {
    const next = new URLSearchParams(params);
    next.delete('venueId'); setParams(next); setSubmitted(false); setChooseEvent(false);
  }
  return <div className="page venue-discovery-page">
    <PageIntro title="Find venues" eyebrow="Venue arrangements" description="Find a suitable space, review its details and send a booking request." />
    <section className="booking-context" aria-label="Event context">
      <label>Booking for event<select value={eventId} disabled={loading} onChange={change => selectEvent(change.target.value)}>
        <option value="">Browse venues first</option>
        {events.map(record => <option key={record.id} value={record.id}>{record.name}</option>)}
      </select></label>
      {event && !submitted && <Link className="button-link button-secondary" to={`/events/${event.id}?tab=venues`}>View event requests</Link>}
      {loading && <p role="status">Loading assigned events…</p>}
      {error && <div role="alert"><p>{error}</p><button className="button-secondary" onClick={() => setRetry(value => value + 1)}>Retry events</button></div>}
      {chooseEvent && !event && <p role="status">Choose an assigned event to request this venue.</p>}
    </section>
    {!loading && (venueId && event ? <div className="booking-review">
      <div className="workspace-action-card"><div><h2>{submitted ? 'Venue request sent' : 'Review venue request'}</h2><p>{event.name}</p></div>
        {!submitted && <button className="button-secondary" onClick={findAnother}>Back to venues</button>}</div>
      {/* Replace the submitted form with explicit next steps so a saved request cannot be sent again accidentally. */}
      {!submitted && <VenueBookingRequest key={`${event.id}:${venueId}`} event={event} token={token} initialVenueId={venueId} onSubmitted={() => setSubmitted(true)} />}
      {submitted && <div className="booking-next-actions" role="region" aria-label="Request submitted actions">
        <p role="status">Venue request submitted.</p>
        <p>Your request has been saved. Track its status from the event’s Venue requests tab.</p>
        <Link className="button-link" to={`/events/${event.id}?tab=venues`}>View event requests</Link>
        <button className="button-secondary" onClick={findAnother}>Find another venue</button>
      </div>}
    </div> : <VenueList key={eventId} event={event} onRequest={requestVenue} />)}
  </div>;
}
