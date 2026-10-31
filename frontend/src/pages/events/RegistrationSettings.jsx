import {useEffect,useState} from 'react';
import {api} from '../../api/client';

/** Converts a stored instant to the Singapore wall-clock representation required by a datetime-local input. */
function localValue(value){return value?new Date(Date.parse(value)+8*3600000).toISOString().slice(0,16):'';}
/** Shows accepted cutoffs with an explicit time zone, including the event-start fallback when unset. */
function deadlineLabel(value){return value?`${new Date(value).toLocaleString('en-SG',{timeZone:'Asia/Singapore',dateStyle:'medium',timeStyle:'short'})} (Singapore time)`:'Event start (Singapore time)';}

/** Keeps deadline proposals distinct from accepted settings; only the owning organiser receives this editor. */
export default function RegistrationSettings({event,token,onSaved}){
  const [registration,setRegistration]=useState(localValue(event.registration_deadline));
  const [withdrawal,setWithdrawal]=useState(localValue(event.withdrawal_deadline));
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  useEffect(()=>{
    // Navigation/session changes must not carry another event's unsaved proposal or success message.
    setRegistration(localValue(event.registration_deadline));setWithdrawal(localValue(event.withdrawal_deadline));setError('');setMessage('');
  },[event.id,event.registration_deadline,event.withdrawal_deadline,token]);
  /** Submitted events use the request endpoint's 202 response; accepted deadlines stay visible until approval. */
  async function save(action){
    action.preventDefault();setBusy(true);setError('');setMessage('');
    try{
      const result=await api.put(`/events/${event.id}/registration-settings`,{
        registrationDeadline:registration?new Date(`${registration}:00+08:00`).toISOString():null,
        withdrawalDeadline:withdrawal?new Date(`${withdrawal}:00+08:00`).toISOString():null,
      },token);
      if(result.event)onSaved(result.event);
      setMessage(result.message);
    }catch(failure){setError(failure.message);}finally{setBusy(false);}
  }
  /** Manual availability is independent of proposed deadline edits and always uses accepted server-side values. */
  async function toggle(){
    setBusy(true);setError('');setMessage('');
    try{const result=await api.put(`/events/${event.id}/registration-availability`,{open:!event.registration_open},token);onSaved(result.event);setMessage(result.message);}
    catch(failure){setError(failure.message);}finally{setBusy(false);}
  }
  return <section className="ed-card ed-span" aria-labelledby="registration-settings-heading">
    <h2 id="registration-settings-heading" className="ed-card-title">Registration settings</h2>
    <p>Registration is <strong>{event.registration_open?'open':'closed'}</strong>. New events stay closed until you open registration after final confirmation.</p>
    <dl className="detail-facts"><div><dt>Accepted registration deadline</dt><dd>{deadlineLabel(event.registration_deadline)}</dd></div>
      <div><dt>Accepted withdrawal deadline</dt><dd>{deadlineLabel(event.withdrawal_deadline)}</dd></div></dl>
    <form onSubmit={save} className="form-grid">
      <label className="field">Registration deadline (Singapore time)<input type="datetime-local" value={registration} disabled={busy} onChange={change=>setRegistration(change.target.value)}/></label>
      <label className="field">Withdrawal deadline (Singapore time)<input type="datetime-local" value={withdrawal} disabled={busy} onChange={change=>setWithdrawal(change.target.value)}/></label>
      <p className="ed-muted">Leave a deadline blank to use the event start. Submitted event changes require your assigned Coordinator’s approval.</p>
      <button className="button-primary" disabled={busy}>{event.is_draft?'Save deadlines':'Request deadline change'}</button>
    </form>
    <div className="booking-review-actions"><button type="button" className="button-secondary" disabled={busy || (!event.registration_open && event.status!=='confirmed')} onClick={toggle}>{event.registration_open?'Close registration':'Open registration'}</button></div>
    {event.status!=='confirmed' && <p className="ed-muted">Registration can be opened when the event is Confirmed.</p>}
    {error && <p role="alert" className="error-message">{error}</p>}{message && <p role="status">{message}</p>}
  </section>;
}
