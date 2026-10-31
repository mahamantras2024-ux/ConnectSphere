import {useState} from 'react';
import {api} from '../../api/client';
/** SCRUM-106 AC1/AC2: staff record genuine closures independently of routine schedule editing. All times are Singapore local. */
export default function VenueClosureForm({venueId,token}) {
 const [start,setStart]=useState(''),[end,setEnd]=useState(''),[reason,setReason]=useState('');
 const [result,setResult]=useState(null),[error,setError]=useState(''),[saving,setSaving]=useState(false);
 /** Sends explicit timezone-qualified instants; failed saves never display a success confirmation. */
 async function save(event) {
  event.preventDefault();setSaving(true);setError('');setResult(null);
  try {setResult(await api.post(`/venues/${venueId}/closures`,{startDatetime:new Date(`${start}:00+08:00`).toISOString(),endDatetime:new Date(`${end}:00+08:00`).toISOString(),reason},token));}
  catch(failure){setError(failure.message);} finally{setSaving(false);}
 }
 return <section className="ed-card" aria-label="Record venue closure"><h2>Record venue closure</h2>
 <p>Record emergency unavailability, including periods with existing bookings. Events are not automatically cancelled.</p>
 <form onSubmit={save}><label>Closure starts<input type="datetime-local" required value={start} onChange={e=>setStart(e.target.value)}/></label>
 <label>Closure ends<input type="datetime-local" required value={end} onChange={e=>setEnd(e.target.value)}/></label>
 <label>Closure reason<textarea required maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
 <button disabled={saving} type="submit">Record venue closure</button></form>
 {error&&<p role="alert">{error}</p>}{result&&<div role="status"><p>Closure recorded.</p><p>Affected bookings: {result.affectedBookings.length}</p><ul>{result.affectedBookings.map(b=><li key={b.id}>{b.event_name}</li>)}</ul></div>}
 </section>;
}
