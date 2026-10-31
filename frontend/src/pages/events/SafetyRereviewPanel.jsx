import {useEffect,useRef,useState} from 'react';
import {api} from '../../api/client';
const OUTCOMES={approved:'Passed',rejected:'Rejected',changes_requested:'Changes requested'};
/** SCRUM-111: current coordinator sees the complete review trail and explicitly submits corrected arrangements. */
export default function SafetyRereviewPanel({eventId,token,refreshKey=0,onSubmitted}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[saving,setSaving]=useState(false),[version,setVersion]=useState(0);
 const identity=`${eventId}:${token}`,currentIdentity=useRef(identity);currentIdentity.current=identity;
 useEffect(()=>{
  let active=true;setData(null);setError('');setSaving(false);
  api.get(`/events/${eventId}/safety-review-history`,token).then(result=>{
   if(active){if(!Array.isArray(result.history))throw new Error('Safety review history is unavailable.');setData(result);}
  }).catch(failure=>{if(active)setError(failure.message||'Unable to load safety review history.');});
  // Late responses from another event/session cannot disclose its reasons or enable its actions here.
  return()=>{active=false;};
 },[eventId,token,refreshKey,version]);
 /** Recheck readiness on the server; a stale screen cannot resubmit another coordinator's event or duplicate a cycle. */
 async function submit(){
  const submittedIdentity=identity;setSaving(true);setError('');
  try{
   await api.post(`/events/${eventId}/safety-resubmissions`,{},token);
   if(currentIdentity.current!==submittedIdentity)return;
   setVersion(value=>value+1);onSubmitted?.();
  }catch(failure){if(currentIdentity.current===submittedIdentity)setError(failure.message||'Unable to submit for safety re-review.');}
  finally{if(currentIdentity.current===submittedIdentity)setSaving(false);}
 }
 return <section aria-label="Safety review and resubmission history">
  <h3>Safety review history</h3>
  {error&&<p role="alert">{error}</p>}
  {!data&&!error&&<p role="status">Loading safety review history…</p>}
  {data&&<>
   {data.history.length===0?<p>No safety reviews recorded yet.</p>:<ol aria-label="Safety review records">{data.history.map(entry=><li key={`${entry.kind}-${entry.id}`}>
    <strong>{entry.kind==='review'?OUTCOMES[entry.outcome]:'Submitted for safety re-review'}</strong>
    <p>{entry.actor} · <time dateTime={entry.recorded_at}>{new Date(entry.recorded_at).toLocaleString('en-SG',{timeZone:'Asia/Singapore'})}</time></p>
    {entry.notes&&<p>Reason: {entry.notes}</p>}
   </li>)}</ol>}
   {data.required&&<>
    <p>The rejected arrangements must be corrected and submitted for another safety review before confirmation.</p>
    <button type="button" disabled={saving||!data.canResubmit} onClick={submit}>{saving?'Submitting…':'Submit for safety re-review'}</button>
    {data.blocked&&<p>{data.blocked}</p>}
   </>}
  </>}
 </section>;
}
