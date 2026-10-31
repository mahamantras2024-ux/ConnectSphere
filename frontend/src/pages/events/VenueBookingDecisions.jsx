import { useEffect, useState } from 'react';
import VenueHoldState from './VenueHoldState';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import SessionVenueActions from './SessionVenueActions';

const STATUS_LABELS = { pending: 'Pending', tentative: 'Tentative hold', expired: 'Expired', approved: 'Approved', confirmed:'Approved', rejected: 'Rejected', cancelled: 'Cancelled' };

/** Shows the assigned coordinator the selected event's venue request history and persisted staff decisions. */
export default function VenueBookingDecisions({ eventId, refreshKey = 0 }) {
  const { token } = useAuth();
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [saving, setSaving] = useState(null);
  useEffect(() => {
    // Withdraw expired confirmation actions even when this event page stays open across the deadline.
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  /** The server rechecks assignment, expiry and occupancy; a failed confirmation cannot manufacture a final booking. */
  async function confirm(booking) {
    setSaving(booking.id);
    setError('');
    try {
      const result = await api.put(`/venues/${booking.venue_id}/requests/${booking.id}/confirm`, {}, token);
      setBookings(current => current.map(row => row.id === booking.id ? { ...row, ...result.request } : row));
    } catch (failure) {
      setError(failure.message || 'Unable to confirm the venue arrangement.');
    } finally {
      setSaving(null);
    }
  }

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
      {error && <p role="alert">{error}</p>}
      {loading ? <p role="status">Loading venue booking decisions…</p>
          : bookings.length === 0 ? (!error && <p className="ed-muted">No venue booking requests for this event.</p>)
            : (
              <ol aria-label="Venue booking requests" className="ed-clar-list">
                {bookings.map(booking => {
                  // The database status check defines this complete set, so a missing label is a data-contract error.
                  const expired=booking.status==='expired' || (booking.status==='tentative' && !(Date.parse(booking.hold_expires_at)>now));
                  const status = STATUS_LABELS[expired?'expired':booking.status];
                  return (
                    <li key={booking.id} aria-label={`${booking.venue_name} ${status}`} className="ed-clar-item">
                      <h3>{booking.venue_name}</h3>
                      {booking.requirements?.sessionName && <p className="eyebrow">Session: {booking.requirements.sessionName}</p>}
                      <VenueHoldState booking={booking} />
                      <p><strong>Status:</strong> <span>{status}</span></p>
                      {booking.status==='tentative' && <p>Expires {new Date(booking.hold_expires_at).toLocaleString('en-SG',{timeZone:'Asia/Singapore'})} (SGT)</p>}
                      {expired ? <p>Submit a new venue request for fresh availability checks and staff approval.</p>
                        : booking.status==='tentative' && <button type="button" disabled={saving!==null} onClick={()=>confirm(booking)}>Confirm venue arrangement</button>}
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
                      {booking.requirements?.sessionName && !expired && ['pending','tentative','approved','confirmed'].includes(booking.status) &&
                        <SessionVenueActions booking={booking} token={token} onSaved={saved=>setBookings(current=>current.map(row=>row.id===saved.id?{...row,...saved}:row))}/>}
                    </li>
                  );
                })}
              </ol>
            )}
    </section>
  );
}
