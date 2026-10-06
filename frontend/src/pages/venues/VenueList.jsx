// File: Keeps active venue catalogues current and opens right-side profiles with staff edit/removal controls.
import { useEffect, useState } from 'react';
import VenueDetail from './VenueDetail';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';
import AddVenueModal from './AddVenueModal';
import {formatHourlyRate} from './hourlyRate';
// Renders responsive catalogue cards with real values and explicit missing-data states.
export default function VenueList() {
  const { token, user } = useAuth();
  const [venues, setVenues] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [selected, setSelected] = useState(null);
  const [editing,setEditing]=useState(null),[version,setVersion]=useState(0),[notice,setNotice]=useState('');
  useEffect(() => {
    // Fetches records and ignores responses after the catalogue unmounts or changes session.
    let active = true;
    api.get('/venues', token).then(data => {
      // Applies the successfully loaded result.
       if (active) {const records=Array.isArray(data)?data:data.venues||[];setVenues(records);setSelected(current=>current?records.find(v=>v.id===current.id)||null:null);setError('');} }).catch(err => {
      // Reports a failed asynchronous operation.
       if (active) setError(err.message); }).finally(() => {
      // Clears the pending state when the operation finishes.
       if (active) setLoading(false); });
    return () => {
      // Handles this operation using the surrounding screen or request state.
       active = false; };
  }, [token,version]);
  useEffect(()=> { // Refreshes open catalogues on committed database changes, browser focus and fallback polling.
    const refresh=()=>setVersion(current=>current+1);
    let stream;
    if(typeof EventSource==='function') {stream=new EventSource(`${import.meta.env.VITE_API_URL||'http://localhost:4000/api'}/venues/stream`);stream.onmessage=refresh;}
    const timer=setInterval(refresh,20000);window.addEventListener('focus',refresh);
    return ()=> {stream?.close();clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[]);
  if (loading) return <p role="status" className="loading-state">Loading venues...</p>;
  if (error) return <p role="alert" className="error-message">{error}</p>;
  return <section className="venue-catalogue">{notice && <p role="status" className="success-message">{notice}</p>}<div className="section-heading"><h2>Venues</h2><span className="badge">{venues.length} spaces</span></div>
    {!venues.length ? <div className="empty-state"><span className="empty-symbol" aria-hidden="true">▧</span><h2>Your next space belongs here.</h2><p>No venues found. Add a venue to start your catalogue.</p></div> : <div className="venue-grid">{venues.map(venue =>
      // Converts each record into its displayed or submitted representation.
      <article className="venue-card" key={venue.id}>
      <div className="venue-image">{venue.image ? <img src={venue.image} alt={venue.name} /> : <div className="venue-placeholder" aria-label="No venue image"><span aria-hidden="true">▧</span><small>No image provided</small></div>}<span className="image-badge">{venue.availability_status || venue.availabilityStatus || 'Not specified'}</span></div>
      <div className="venue-card-body"><span className="record-number">VENUE / {String(venue.id).padStart(3, '0')}</span><h3>{venue.name}</h3><p>{venue.location || 'Location not specified'}</p><div className="venue-facts"><span>{venue.capacity ?? '—'} Guests</span><span>{venue.operating_hours || venue.operatingHours || 'Hours not specified'}</span></div><div className="venue-card-footer"><span>{formatHourlyRate(venue.pricing)}</span><button className="text-button" onClick={() =>
      // Handles this control action and updates the screen state.
      setSelected(venue)}>View details <span aria-hidden="true">↗</span></button></div></div>
    </article>)}</div>}{selected && <VenueDetail venue={selected} onClose={() =>
      // Handles this control action and updates the screen state.
      setSelected(null)} canManage={user?.role==='venue_staff'} canViewSchedule={['venue_staff','event_coordinator'].includes(user?.role)} token={token} onEdit={record=>{setSelected(null);setEditing(record);}} onRemoved={id=>{setVenues(current=>current.filter(v=>v.id!==id));setNotice('Venue deactivated. Historical bookings are preserved.');setVersion(current=>current+1);}} />}
    {editing && <AddVenueModal venue={editing} onClose={()=>setEditing(null)} onAdd={record=>{setSelected(record);setNotice('Venue updated and shared with the catalogue.');setVersion(current=>current+1);}}/>}
  </section>;
}
