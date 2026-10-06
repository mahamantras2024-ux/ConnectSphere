// File: Shows the complete venue profile in a right-side drawer and offers guarded deactivation to Venue Staff.
import Modal from '../../components/Modal';
import {useRef,useState} from 'react';
import {api} from '../../api/client';
import VenueMap from './VenueMap';
import BookingImpactList from './BookingImpactList';
import VenueSchedule from './VenueSchedule';
import {formatHourlyRate} from './hourlyRate';
// Formats list fields or displays an explicit missing-value label.
function list(value) { return Array.isArray(value) && value.length ? value.join(', ') : typeof value === 'string' && value.trim() ? value : 'Not specified'; }
// Distinguishes an explicitly recorded zero-minute duration from missing legacy timing information.
function minutes(value) { return value == null ? 'Not specified' : `${value} minutes`; }
// Renders venue details and the embedded map, and lists bookings that prevent deactivation.
export default function VenueDetail({ venue, onClose, onEdit, onRemoved, canManage=false, token }) {
  const [showSchedule, setShowSchedule] = useState(false);
  const [removing,setRemoving]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[blocked,setBlocked]=useState([]);
  const saving=useRef(false);
  // Removes the venue from active catalogues while showing server-verified blocking bookings.
  async function deactivate() {
    if(saving.current)return;saving.current=true;setBusy(true);setError('');setBlocked([]);
    try {await api.delete(`/venues/${venue.id}`,token);onRemoved?.(venue.id);onClose();}
    catch(err){setError(err.message);setBlocked(err.details?.affectedBookings||[]);}
    finally {saving.current=false;setBusy(false);}
  }
  if (!venue) return null;
  const values = [['Location', venue.location || venue.address], ['Capacity', venue.capacity == null ? null : `${venue.capacity} Guests`],
    ['Facilities', list(venue.facilities)], ['Accessibility', list(venue.accessibility_features || venue.accessibilityFeatures)],
    ['Supported room layouts', list(venue.supported_layouts || venue.supportedLayouts)], ['Operating hours', venue.operating_hours || venue.operatingHours],
    ['Current availability', venue.availability_status || venue.availabilityStatus], ['Setup time', minutes(venue.setup_minutes ?? venue.setupMinutes)],
    ['Turnaround time', minutes(venue.turnaround_minutes ?? venue.turnaroundMinutes)], ['Nearest MRT', venue.mrt || venue.mrtInfo], ['Hourly rate', formatHourlyRate(venue.pricing ?? venue.price)]];
  return <Modal title="Venue Details" onClose={busy?()=>{}:onClose} drawer><div className="venue-profile"><div className="profile-banner">{venue.image ? <img src={venue.image} alt={venue.name} /> : <span className="profile-pattern" aria-hidden="true">▧</span>}<div><p className="eyebrow">A space for your next event</p><h2>{venue.name}</h2></div></div>
    <dl className="detail-grid">{values.map(([label, value]) =>
      // Converts each record into its displayed or submitted representation.
      <div key={label}><dt>{label}</dt><dd>{value || 'Not specified'}</dd></div>)}</dl>
    {venue.latitude!=null && venue.longitude!=null ? <VenueMap latitude={venue.latitude} longitude={venue.longitude}/> : <p className="field-help">This older record has no map pin yet. Venue Staff can select its location when editing.</p>}
    {venue.mrt_distance_m!=null && <p className="field-help">Nearest MRT is approximately {(venue.mrt_distance_m/1000).toFixed(2)} km away in a straight line.</p>}
    {canManage && <footer className="venue-record-actions"><button onClick={()=>onEdit?.(venue)} disabled={busy}>Edit venue</button><button className="button-danger" onClick={()=>setRemoving(true)} disabled={busy}>Deactivate venue</button></footer>}
    {removing && <section className="booking-warning"><h3>Remove this venue from the catalogue?</h3><p>Deactivating hides it from searches and preserves historical bookings. Upcoming bookings must be resolved first.</p>{error && <p role="alert" className="error-message">{error}</p>}<BookingImpactList bookings={blocked}/><div className="venue-record-actions"><button className="button-danger" disabled={busy} onClick={deactivate}>{busy?'Checking bookings…':'Confirm deactivation'}</button><button className="button-secondary" disabled={busy} onClick={()=>{setRemoving(false);setError('');setBlocked([]);}}>Keep venue</button></div></section>}
    {canManage && <button type="button" onClick={() => setShowSchedule(true)}>View schedule</button>}
    {canManage && showSchedule && <VenueSchedule venue={venue} token={token} />}
  </div></Modal>;
}
