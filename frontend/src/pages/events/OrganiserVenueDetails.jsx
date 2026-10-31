import { useEffect, useState } from 'react';
import { api } from '../../api/client';

const dateOptions = { timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', year: 'numeric' };
const timeOptions = { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };

/** Shows each of the owner's confirmed and pending arrangements with its booked period in Singapore time. */
export default function OrganiserVenueDetails({ eventId, token }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    // Clear earlier event data and ignore late responses after navigation or session changes.
    let active = true;
    setResult(null);
    setError('');
    api.get(`/events/${eventId}/organiser-venue-bookings`, token)
      .then(data => {
        // A malformed response is a load failure, never evidence that no venue was selected.
        if (!Array.isArray(data.bookings)) throw new Error('Venue arrangements are unavailable.');
        // AC1 requires every active arrangement, even when multiple venues have been confirmed.
        // Preserve the API's schedule order while excluding historical rejections and cancellations.
        const arrangements = data.bookings.filter(booking => ['approved','pending','tentative'].includes(booking.status));
        if (active) setResult(arrangements);
      })
      .catch(failure => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [eventId, token]);

  return <section className="ed-card ed-span" aria-labelledby="organiser-venues-heading">
    <h2 className="ed-card-title" id="organiser-venues-heading">Venue arrangements</h2>
    {error ? <p role="alert">{error}</p> : result === null ? <p role="status">Loading venue arrangements…</p>
      : result.length === 0 ? <p>No Venue Selected</p>
        : <ol aria-label="Venue arrangements" className="ed-clar-list">{result.map(booking => {
          // Show both dates for overnight/multi-day arrangements rather than implying one calendar day.
          const start = new Date(booking.start_datetime);
          const end = new Date(booking.end_datetime);
          const startDate = start.toLocaleDateString('en-SG', dateOptions);
          const endDate = end.toLocaleDateString('en-SG', dateOptions);
          return <li key={booking.id} className="ed-clar-item">
            <h3>{booking.venue_name}</h3>
            <dl className="ed-fields">
              <div className="ed-field"><dt>Address</dt><dd>{booking.address}</dd></div>
              <div className="ed-field"><dt>Capacity</dt><dd>{booking.capacity}</dd></div>
              <div className="ed-field"><dt>Date</dt><dd>{startDate === endDate ? startDate : `${startDate} – ${endDate}`}</dd></div>
              <div className="ed-field"><dt>Time</dt><dd>{start.toLocaleTimeString('en-SG', timeOptions)} – {end.toLocaleTimeString('en-SG', timeOptions)} (SGT)</dd></div>
              <div className="ed-field"><dt>Booking status</dt><dd>{booking.status === 'approved' ? 'Confirmed' : 'Pending Confirmation'}</dd></div>
            </dl>
          </li>;
        })}</ol>}
  </section>;
}
