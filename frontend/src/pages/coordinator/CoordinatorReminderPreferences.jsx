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
  // Keep only one preference write in flight until its result is known.
  if(saving)return;
  setSaving(true);setError('');setMessage('');
  try{const data=await api.put(ENDPOINT,next,token);setPreference(data.preference);setMessage('Reminder preference saved.');}
  catch(failure){setError(failure.message);}finally{setSaving(false);}
 }
 /** Cadence changes apply only after reminders are enabled; failures retain the persisted choice. */
 function changeFrequency(event){if(!preference.enabled)return;save({...preference,frequencyDays:Number(event.target.value)});}
 return <section className="venue-reminder-preferences" aria-label="Coordinator review reminders"><h2>Pending review reminders</h2>
 <p>Include pending venue, equipment, safety and organiser change-request reviews for events currently assigned to you.</p>
 {loading?<p role="status">Loading reminder preference…</p>:<>
 <label className="venue-reminder-toggle"><input className="venue-reminder-checkbox" type="checkbox" checked={preference.enabled} disabled={saving} onChange={event=>save({...preference,enabled:event.target.checked})}/><span>Receive periodic reminders for all pending reviews</span></label>
 <label className="coordinator-reminder-frequency">Review reminder frequency<select value={preference.frequencyDays} disabled={saving || !preference.enabled} onChange={changeFrequency}>
 <option value="1">Daily</option><option value="3">Every 3 days</option><option value="7">Weekly</option></select></label></>}
 {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
 </section>;
}
