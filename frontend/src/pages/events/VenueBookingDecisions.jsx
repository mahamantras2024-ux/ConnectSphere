import { useEffect, useState } from 'react';
import VenueHoldState from './VenueHoldState';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

const STATUS_LABELS = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' };

/** Shows the assigned coordinator the selected event's venue request history and persisted staff decisions. */
export default function VenueBookingDecisions({ eventId, refreshKey = 0 }) {
  const { token } = useAuth();
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    // Fetch again when the event or authenticated session changes so decisions never leak across event views.
    let active = true;
    setLoading(true);
    setError('');
    api.get(`/events/${eventId}/venue-bookings`, token)
      .then(data => { if (active) setBookings(data.bookings || []); })
      .catch(loadError => { if (active) setError(loadError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [eventId, token, refreshKey]);

  return (
    <section className="ed-card" aria-labelledby="venue-bookings-heading">
      <h2 className="ed-card-title" id="venue-bookings-heading">Venue booking decisions</h2>
      {loading ? <p role="status">Loading venue booking decisions…</p>
        : error ? <p role="alert">{error}</p>
          : bookings.length === 0 ? <p className="ed-muted">No venue booking requests for this event.</p>
            : (
              <ol aria-label="Venue booking requests" className="ed-clar-list">
                {bookings.map(booking => {
                  // The database status check defines this complete set, so a missing label is a data-contract error.
                  const status = STATUS_LABELS[booking.status];
                  return (
                    <li key={booking.id} aria-label={`${booking.venue_name} ${status}`} className="ed-clar-item">
                      <h3>{booking.venue_name}</h3>
                      <VenueHoldState booking={booking} />
                      <p><strong>Status:</strong> <span>{status}</span></p>
                      {booking.start_datetime && <p><strong>Period:</strong> {new Date(booking.start_datetime).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })} – {new Date(booking.end_datetime).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })}</p>}
                      {booking.requirements && <dl>
                        <dt>Capacity</dt><dd>{booking.requirements.capacity ?? 'Not specified'}</dd>
                        <dt>Room layout</dt><dd>{booking.requirements.layout || 'Not specified'}</dd>
                        <dt>Accessibility</dt><dd>{booking.requirements.accessibility.join(', ') || 'None specified'}</dd>
                        <dt>Required facilities</dt><dd>{booking.requirements.requiredFacilities.join(', ') || 'None specified'}</dd>
                      </dl>}
                      <p>{booking.cancel_other_pending ? 'Other pending requests will be cancelled if this arrangement changes or is cancelled.' : 'Other requests are kept if this arrangement changes or is cancelled.'}</p>
                      {booking.decision_notes?.trim() && (
                        <p><strong>Venue Staff reason:</strong> {booking.decision_notes}</p>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
    </section>
  );
}
