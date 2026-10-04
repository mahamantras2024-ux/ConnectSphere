// File: Presents booking identifiers, event names, Singapore times and reasons for venue-change warnings.
// Formats an available booking time safely without inventing missing scheduling information.
function bookingTime(value) {
 const date=value==null?null:new Date(value);
 return date && Number.isFinite(date.getTime()) ? date.toLocaleString('en-SG',{timeZone:'Asia/Singapore',dateStyle:'medium',timeStyle:'short'}) : 'Time not specified';
}
// Renders actionable booking details without client personal information.
export default function BookingImpactList({bookings=[]}) {
 return <ul className="booking-impact-list">{bookings.map(booking=><li key={booking.booking_id}>
  <strong>{booking.event_name || `Event ${booking.event_id}`}</strong><span>Booking #{booking.booking_id} · {booking.status==='approved'?'Confirmed':booking.status}</span>
  <time>{bookingTime(booking.start_datetime)} – {bookingTime(booking.end_datetime)} (SGT)</time>
  {booking.reasons?.map(reason=><p key={reason}>{reason}</p>)}
 </li>)}</ul>;
}
