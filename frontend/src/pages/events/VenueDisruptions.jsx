import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {api} from '../../api/client';
/** SCRUM-106 AC2/AC4/AC5: resolves only affected venue bookings, retaining the event and all unaffected arrangements. */
export default function VenueDisruptions({eventId,token,onResolved,refreshKey=0}) {
 const [issues,setIssues]=useState([]),[bookings,setBookings]=useState([]),[choices,setChoices]=useState({});
 const [error,setError]=useState(''),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false);
 useEffect(()=>{
  let active=true;setLoading(true);setError('');
  Promise.all([api.get(`/events/${eventId}/venue-disruptions`,token),api.get(`/events/${eventId}/venue-bookings`,token)])
   .then(([data,arrangements])=>{if(active){setIssues(data.issues || []);setBookings(arrangements.bookings || []);}})
   .catch(failure=>{if(active)setError(failure.message);}).finally(()=>{if(active)setLoading(false);});
  return ()=>{active=false;};
 },[eventId,token,refreshKey]);
 /** Server rechecks current assignment and replacement eligibility; the UI never assumes a selected booking remains valid. */
 async function resolve(issue,replacementBookingId) {
  setSaving(true);setError('');
  try {await api.post(`/events/${eventId}/venue-disruptions/${issue.id}/resolve`,{replacementBookingId},token);
   setIssues(current=>current.filter(item=>item.booking_id!==issue.booking_id));onResolved();}
  catch(failure){setError(failure.message);}finally{setSaving(false);}
 }
 return <section className="ed-card" aria-label="Venue disruptions"><h2>Venue disruptions</h2>
 <p>Changed venue arrangements require a fresh safety review followed by coordinator confirmation. Other bookings are kept.</p>
 {loading&&<p role="status">Loading venue disruptions…</p>}{error&&<p role="alert">{error}</p>}
 {issues.map(issue=><div key={issue.id}><h3>{issue.venue_name}</h3><p>{issue.reason}</p>
 {issue.start_datetime&&<p>{new Date(issue.start_datetime).toLocaleString('en-SG')} – {new Date(issue.end_datetime).toLocaleString('en-SG')}</p>}
 <label>Replacement for {issue.venue_name}<select value={choices[issue.id]||''} disabled={saving} onChange={e=>setChoices({...choices,[issue.id]:e.target.value})}>
 <option value="">Choose an approved replacement</option>{bookings.filter(b=>b.status==='approved'&&b.id!==issue.booking_id&&!issues.some(item=>item.booking_id===b.id)).map(b=><option key={b.id} value={b.id}>{b.venue_name} (booking {b.id})</option>)}</select></label>
 <button disabled={saving||!choices[issue.id]} onClick={()=>resolve(issue,Number(choices[issue.id]))}>Use replacement for {issue.venue_name}</button>
 <button disabled={saving} onClick={()=>resolve(issue,null)}>Cancel affected booking at {issue.venue_name}</button>
 <Link to={`/coordinator/venues?eventId=${eventId}`}>Find a replacement venue</Link></div>)}
 </section>;
}
