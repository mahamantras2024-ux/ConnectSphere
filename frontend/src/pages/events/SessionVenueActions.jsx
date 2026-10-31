import {useState} from 'react';
import {api} from '../../api/client';
import VenueBookingRequest from './VenueBookingRequest';

/** Keeps single-session revisions inline; a changed request returns to staff review without touching other tracks. */
export default function SessionVenueActions({booking,token,onSaved}){
  const [editing,setEditing]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  /** Cancels only this booking; server assignment and active-state checks remain authoritative. */
  async function cancel(){
    setBusy(true);setError('');
    try{const result=await api.put(`/venues/${booking.venue_id}/requests/${booking.id}/session`,{cancel:true},token);onSaved(result.request);}
    catch(failure){setError(failure.message);}
    finally{setBusy(false);}
  }
  // Convert stored instants to Singapore wall time for the existing request form's explicit +08:00 submission.
  const start=new Date(Date.parse(booking.start_datetime)+8*3600000).toISOString();
  const end=new Date(Date.parse(booking.end_datetime)+8*3600000).toISOString();
  const details=booking.requirements;
  const event={id:booking.event_id,proposed_date:start.slice(0,10),proposed_start_time:start.slice(11,16),proposed_end_time:end.slice(11,16),
    expected_attendance:details.capacity,room_layout_preference:details.layout,accessibility_requirements:details.accessibility,required_facilities:details.requiredFacilities};
  return <section aria-label={`Manage ${details.sessionName}`}>
    {error && <p role="alert">{error}</p>}
    <div className="booking-review-actions"><button className="button-secondary" disabled={busy} onClick={()=>setEditing(!editing)}>{editing?'Keep current request':'Change session request'}</button>
      <button className="button-secondary" disabled={busy} onClick={cancel}>Cancel session request</button></div>
    {editing && <div className="booking-review"><p>Changes require fresh staff approval. To choose another venue, cancel this request and find a replacement for the same session.</p>
      <VenueBookingRequest event={event} token={token} initialVenueId={String(booking.venue_id)} editingBooking={booking} onSubmitted={saved=>{setEditing(false);onSaved(saved);}}/></div>}
  </section>;
}
