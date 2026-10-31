import {useEffect,useState} from 'react';
import {api} from '../../api/client';
const ENDPOINT='/notifications/coordinator-preferences';
/** SCRUM-85 AC9: explicit coordinator opt-in, with the same 1/3/7-day choices as Venue Staff. */
export default function CoordinatorReminderPreferences({token}){
 const [preference,setPreference]=useState({enabled:false,frequencyDays:1});
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 useEffect(()=>{
  let active=true;setLoading(true);setError('');
  api.get(ENDPOINT,token).then(data=>{if(active)setPreference(data.preference||{enabled:false,frequencyDays:1});})
   .catch(failure=>{if(active)setError(failure.message);}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[token]);
 /** Only confirmed server writes change opt-in; failures retain the previous persisted choice. */
 async function save(next){
  setSaving(true);setError('');setMessage('');
  try{const data=await api.put(ENDPOINT,next,token);setPreference(data.preference);setMessage('Reminder preference saved.');}
  catch(failure){setError(failure.message);}finally{setSaving(false);}
 }
 /** A disabled user's cadence stays a draft until they explicitly opt in. */
 function changeFrequency(event){const next={...preference,frequencyDays:Number(event.target.value)};if(preference.enabled)save(next);else setPreference(next);}
 return <section className="ed-card" aria-label="Coordinator review reminders"><h2>Pending review reminders</h2>
 <p>Include pending venue, equipment, safety and organiser change-request reviews for events currently assigned to you.</p>
 {loading?<p role="status">Loading reminder preference…</p>:<>
 <label><input type="checkbox" checked={preference.enabled} disabled={saving} onChange={event=>save({...preference,enabled:event.target.checked})}/>Receive periodic reminders for all pending reviews</label>
 <label>Review reminder frequency<select value={preference.frequencyDays} disabled={saving} onChange={changeFrequency}>
 <option value="1">Daily</option><option value="3">Every 3 days</option><option value="7">Weekly</option></select></label></>}
 {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
 </section>;
}
