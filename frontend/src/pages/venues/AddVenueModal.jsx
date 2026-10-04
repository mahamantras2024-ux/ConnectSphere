// File: Creates and edits mapped venue records, with automatic MRT information and explicit booking-impact confirmation.
import { useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';
import Modal from '../../components/Modal';
import LocationPicker from './LocationPicker';
import BookingImpactList from './BookingImpactList';
import {hourlyRateValue} from './hourlyRate';
const fields = [
  ['name', 'Venue name', 'Venue Name *'],
  ['capacity', 'Capacity', 'Capacity (e.g. 100) *', 'number'],
  ['supportedLayouts', 'Supported room layouts', 'Supported Room Layouts (e.g. Banquet, Classroom, Theatre) *'],
  ['facilities', 'Facilities & amenities', 'Facilities & Amenities (comma-separated) *'],
  ['accessibilityFeatures', 'Accessibility features', 'Accessibility Features (e.g. Wheelchair Access, Ramps, Elevator) *'],
];
// Validates the complete venue form and saves only after any server-calculated booking warning is acknowledged.
export default function AddVenueModal({ onClose, onAdd, venue }) {
  const { token } = useAuth();
  const [data, setData] = useState({ name: venue?.name||'', location: venue?.location||'', capacity: String(venue?.capacity??''), supportedLayouts: (venue?.supported_layouts||[]).join(', '), facilities: (venue?.facilities||[]).join(', '), accessibilityFeatures: (venue?.accessibility_features||[]).join(', '), price: hourlyRateValue(venue?.pricing), availabilityStatus:venue?.availability_status||'Available', openTime: venue?.operating_hours?.split(' - ')[0]||'08:00', closeTime: venue?.operating_hours?.split(' - ')[1]||'22:00', setupMinutes: String(venue?.setup_minutes??0), turnaroundMinutes: String(venue?.turnaround_minutes??0) });
  const [location,setLocation]=useState({location:venue?.location||'',latitude:venue?.latitude??null,longitude:venue?.longitude??null,mrt:venue?.mrt?{name:venue.mrt,distanceM:venue.mrt_distance_m}:null});
  const [mapBusy,setMapBusy]=useState(false),[warning,setWarning]=useState(null);
  const [image, setImage] = useState(venue?.image||''), [errors, setErrors] = useState({}), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const saving = useRef(false), reader = useRef(null);
  // Updates one form value and removes that field's stale validation message.
  function change(field, value) { setData(current => (
      // Handles this operation using the surrounding screen or request state.
      { ...current, [field]: value })); setWarning(null); setErrors(current => (
      // Handles this operation using the surrounding screen or request state.
      { ...current, [field]: '' })); }
  // Rejects oversized/non-image files and previews an optional uploaded venue photograph.
  function upload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setError('Please upload a valid image file (PNG, JPG, JPEG, WEBP).'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('Images must be 5 MB or smaller.'); return; }
    reader.current?.abort();
    const next = new FileReader(); reader.current = next;
    next.onload = () => {
      // Handles this operation using the surrounding screen or request state.
       setImage(String(next.result)); setWarning(null); setError(''); };
    next.onerror = () =>
      // Handles this operation using the surrounding screen or request state.
      setError('Unable to read this image. Try another file.');
    next.readAsDataURL(file);
  }
  // Validates required fields and numeric/time boundaries before submitting the authorised venue payload.
  async function submit(event, confirmationToken) {
    event.preventDefault(); if (saving.current) return;
    const invalid = {};
    fields.forEach(([key]) => {
      // Handles this operation using the surrounding screen or request state.
       if (!data[key].trim()) invalid[key] = 'This field is required.'; });
    if (data.capacity && (!Number.isInteger(Number(data.capacity)) || Number(data.capacity) < 1 || Number(data.capacity) > 2147483647)) invalid.capacity = 'Enter a positive whole-number capacity.';
    for (const key of ['supportedLayouts', 'facilities', 'accessibilityFeatures']) if (data[key].trim() && !data[key].split(',').some(value =>
      // Handles this operation using the surrounding screen or request state.
      value.trim())) invalid[key] = 'Enter at least one item.';
    for (const key of ['setupMinutes', 'turnaroundMinutes']) if (!data[key].trim() || !Number.isInteger(Number(data[key])) || Number(data[key]) < 0 || Number(data[key]) > 10080) invalid[key] = 'Enter whole minutes between 0 and 10080.';
    if (!data.openTime || !data.closeTime || data.openTime >= data.closeTime) invalid.hours = 'Opening time must be before closing time.';
    if (data.price.trim() && !/^\d+(?:\.\d{1,2})?$/.test(data.price.trim())) invalid.price='Enter a non-negative hourly rate with up to two decimal places.';
    if (Number(data.price)>99999999.99) invalid.price='Hourly rate must be no greater than $99,999,999.99.';
    if (!location.location || (!venue && location.latitude==null)) invalid.location='Select the venue location from a search result or the map.';
    setErrors(invalid); setError(''); if (Object.keys(invalid).length) return;
    saving.current = true; setBusy(true);
    try {
      const payload = { name: data.name.trim(), location: location.location.trim(), latitude:location.latitude,longitude:location.longitude,capacity: Number(data.capacity),
        facilities: data.facilities.split(',').map(value =>
      // Converts each record into its displayed or submitted representation.
      value.trim()).filter(Boolean),
        supportedLayouts: data.supportedLayouts.split(',').map(value =>
      // Converts each record into its displayed or submitted representation.
      value.trim()).filter(Boolean),
        accessibilityFeatures: data.accessibilityFeatures.split(',').map(value =>
      // Converts each record into its displayed or submitted representation.
      value.trim()).filter(Boolean),
        operatingHours: `${data.openTime} - ${data.closeTime}`, setupMinutes: Number(data.setupMinutes), turnaroundMinutes: Number(data.turnaroundMinutes),
        pricing: data.price.trim() || null, image: image || null, availabilityStatus: data.availabilityStatus,
        ...(venue?{revision:venue.revision,confirmationToken}:{}) };
      const result = venue ? await api.put(`/venues/${venue.id}`,payload,token) : await api.post('/venues',payload,token);
      onAdd?.(result.venue || result); onClose();
    } catch (err) { if(err.details?.code==='BOOKING_IMPACT')setWarning(err.details);else {setWarning(null);setError(err.message || 'Unable to save this venue.');} }
    finally { saving.current = false; setBusy(false); }
  }
  return <Modal title={venue?'Edit Venue':'Add New Venue'} onClose={busy?()=>{}:onClose} wide><form className="venue-form" noValidate onSubmit={submit}>
    <p className="muted">{venue?'Keep this venue accurate. Changes are shared with the catalogue when saved.':'Add a space to the catalogue.'} Required fields are marked with an asterisk.</p>
    <div className="form-grid">{fields.map(([key, label, placeholder, type]) =>
      // Converts each record into its displayed or submitted representation.
      <label className="field" key={key} htmlFor={`venue-${key}`}>{label} *<input id={`venue-${key}`} placeholder={placeholder} type={type || 'text'} value={data[key]} maxLength={type ? undefined : 255} onChange={event =>
      // Handles this control action and updates the screen state.
      change(key, event.target.value)} aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `error-${key}` : undefined} />{errors[key] && <span className="error-text" id={`error-${key}`}>{errors[key]}</span>}</label>)}</div>
    <LocationPicker token={token} value={location} onPendingChange={setMapBusy} onChange={next=>{setLocation(next);setWarning(null);setErrors(current=>({...current,location:''}));}}/>
    {errors.location && <p className="error-text">{errors.location}</p>}
    <div className="form-section"><h3>Operating information</h3><label className="field">Availability<select value={data.availabilityStatus} onChange={e=>change('availabilityStatus',e.target.value)}><option>Available</option><option>Maintenance</option><option>Unavailable</option></select></label><div className="form-grid four-col">
      <label className="field">Opening time *<input type="time" value={data.openTime} onChange={event =>
      // Handles this control action and updates the screen state.
      change('openTime', event.target.value)} /></label>
      <label className="field">Closing time *<input type="time" value={data.closeTime} onChange={event =>
      // Handles this control action and updates the screen state.
      change('closeTime', event.target.value)} /></label>
      <label className="field">Setup time (minutes) *<input type="number" min="0" max="10080" value={data.setupMinutes} onChange={event =>
      // Handles this control action and updates the screen state.
      change('setupMinutes', event.target.value)} />{errors.setupMinutes && <span className="error-text">{errors.setupMinutes}</span>}</label>
      <label className="field">Turnaround time (minutes) *<input type="number" min="0" max="10080" value={data.turnaroundMinutes} onChange={event =>
      // Handles this control action and updates the screen state.
      change('turnaroundMinutes', event.target.value)} />{errors.turnaroundMinutes && <span className="error-text">{errors.turnaroundMinutes}</span>}</label>
    </div>{errors.hours && <p className="error-text">{errors.hours}</p>}<p className="field-help">Setup and turnaround record the time needed before and after an event. Booking checks are handled in the booking workflow.</p></div>
    <div className="form-section"><h3>Additional details <span className="muted">Optional</span></h3><div className="form-grid">
      <label className="field">Hourly rate (SGD / hr)<input type="number" min="0" max="99999999.99" step="0.01" placeholder="Hourly rate (e.g. 500)" value={data.price} onChange={event =>
      // Handles this control action and updates the screen state.
      change('price', event.target.value)} />{errors.price && <span className="error-text">{errors.price}</span>}<span className="field-help">Enter the amount per hour. For example, 500 is displayed as $500/hr.</span></label>
      {venue?.pricing && hourlyRateValue(venue.pricing)==='' && <p className="field-help">This record has a descriptive legacy price. Enter its hourly rate to replace it.</p>}
    </div><label className="upload-field">Venue image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} /><span>PNG, JPEG or WEBP · up to 5 MB</span></label>{image && <img className="upload-preview" src={image} alt="Venue preview" />}</div>
    {warning && <section className="booking-warning" role="alert"><h3>These confirmed bookings may be affected</h3><p>Review the changes before saving. Bookings will stay confirmed; coordinate any necessary arrangements with the Event Coordinator.</p><BookingImpactList bookings={warning.affectedBookings}/><button type="button" disabled={busy||mapBusy} onClick={event=>submit(event,warning.confirmationToken)}>Confirm changes & save</button><button type="button" className="button-secondary" onClick={()=>setWarning(null)}>Continue editing</button></section>}
    {error && <p role="alert" className="error-message">{error}</p>}<footer className="form-footer"><button type="button" className="button-secondary" onClick={onClose} disabled={busy}>Cancel</button><button disabled={busy||mapBusy||!!warning}>{busy ? 'Saving venue...' : venue?'Save changes':'Save & Publish Venue'}</button></footer>
  </form></Modal>;
}
