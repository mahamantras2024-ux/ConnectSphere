// File: Shows the complete venue profile in a right-side drawer and offers guarded deactivation to Venue Staff.
import Modal from '../../components/Modal';
import {useRef,useState} from 'react';
import {api} from '../../api/client';
import VenueMap from './VenueMap';
import EmergencyDocuments from './EmergencyDocuments';
import BookingImpactList from './BookingImpactList';
import VenueSchedule from './VenueSchedule';
import VenueClosureForm from './VenueClosureForm';
import {formatHourlyRate} from './hourlyRate';
import { Link } from 'react-router-dom';
// Formats list fields or displays an explicit missing-value label.
function list(value) { return Array.isArray(value) && value.length ? value.join(', ') : typeof value === 'string' && value.trim() ? value : 'Not specified'; }
// Distinguishes an explicitly recorded zero-minute duration from missing legacy timing information.
function minutes(value) { return value == null ? 'Not specified' : `${value} minutes`; }
/** Groups the complete venue record into readable sections; permissions and deferred schedule loading stay explicit. */
export default function VenueDetail({ venue, onClose, onEdit, onRemoved, canManage=false, canViewSchedule=canManage, token, scheduleHref }) {
  // Keep the schedule unmounted until the visitor explicitly asks for it; that also defers its API request.
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
  // Keep every existing fact, grouped by the task it helps a visitor complete.
  const factGroups = [
    { key: 'summary', title: 'At a glance', values: [
      ['Capacity', venue.capacity == null ? null : `${venue.capacity} Guests`],
      ['Hourly rate', formatHourlyRate(venue.pricing ?? venue.price)],
      ['Operating hours', venue.operating_hours || venue.operatingHours],
      ['Current availability', venue.availability_status || venue.availabilityStatus],
    ] },
    { key: 'location', title: 'Location & transport', values: [
      ['Location', venue.location || venue.address], ['Nearest MRT', venue.mrt || venue.mrtInfo],
    ] },
    { key: 'facilities', title: 'Facilities & layout', values: [
      ['Facilities', list(venue.facilities)],
      ['Accessibility', list(venue.accessibility_features || venue.accessibilityFeatures)],
      ['Supported room layouts', list(venue.supported_layouts || venue.supportedLayouts)],
    ] },
    { key: 'safety', title: 'Preparation & safety', values: [
      ['Setup time', minutes(venue.setup_minutes ?? venue.setupMinutes)],
      ['Turnaround time', minutes(venue.turnaround_minutes ?? venue.turnaroundMinutes)],
      ['Emergency access', venue.emergency_access], ['Known restrictions', venue.known_restrictions],
    ] },
  ];
  return <Modal title="Venue Details" onClose={busy?()=>{}:onClose} drawer>
    <div className="venue-profile">
      <div className="profile-banner">
        {venue.image ? <img src={venue.image} alt={venue.name} /> : <span className="profile-pattern" aria-hidden="true">▧</span>}
        <div><h2>{venue.name}</h2></div>
      </div>
      {factGroups.map(({ key, title, values }) => <section className="venue-detail-section" data-group={key} aria-label={title} key={key}>
        <h3>{title}</h3>
        <dl className="detail-grid">{values.map(([label, value]) =>
          <div key={label}><dt>{label}</dt><dd className={label === 'Emergency access' ? 'venue-emergency-access' : undefined}>{value || 'Not specified'}</dd></div>)}
        </dl>
        {key === 'location' && <>
          {venue.latitude!=null && venue.longitude!=null ? <VenueMap latitude={venue.latitude} longitude={venue.longitude}/> : <p className="field-help">This older record has no map pin yet. Venue Staff can select its location when editing.</p>}
          {venue.mrt_distance_m!=null && <p className="field-help">Nearest MRT is approximately {(venue.mrt_distance_m/1000).toFixed(2)} km away in a straight line.</p>}
        </>}
      </section>)}
      <EmergencyDocuments value={venue.emergency_documents}/>
      {canManage && <section className="venue-detail-section" aria-label="Venue management">
        <h3>Venue management</h3>
        <footer className="venue-record-actions">
          <button onClick={()=>onEdit?.(venue)} disabled={busy}>Edit venue</button>
          <button className="button-danger" onClick={()=>setRemoving(true)} disabled={busy}>Deactivate venue</button>
        </footer>
        {removing && <section className="booking-warning"><h3>Remove this venue from the catalogue?</h3>
          <p>Deactivating hides it from searches and preserves historical bookings. Upcoming bookings must be resolved first.</p>
          {error && <p role="alert" className="error-message">{error}</p>}
          <BookingImpactList bookings={blocked}/>
          <div className="venue-record-actions">
            <button className="button-danger" disabled={busy} onClick={deactivate}>{busy?'Checking bookings…':'Confirm deactivation'}</button>
            <button className="button-secondary" disabled={busy} onClick={()=>{setRemoving(false);setError('');setBlocked([]);}}>Keep venue</button>
          </div>
        </section>}
      </section>}
      {/* Group availability controls without mounting the schedule until it is explicitly requested. */}
      {(canViewSchedule || canManage) && <section className="venue-detail-section venue-availability-section" aria-label="Availability & bookings">
        <h3>Availability & bookings</h3>
        {canViewSchedule && (scheduleHref
          ? <Link className="button-link schedule-action" to={scheduleHref}>View schedule</Link>
          : <button className="schedule-action" type="button" onClick={() => setShowSchedule(true)}>View schedule</button>)}
        {canManage && <VenueClosureForm venueId={venue.id} token={token} />}
        {canViewSchedule && showSchedule && <VenueSchedule venue={venue} token={token} canEdit={canManage} />}
      </section>}
    </div>
  </Modal>;
}
