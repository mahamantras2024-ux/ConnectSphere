import {useState} from 'react';
import Modal from '../../components/Modal';
import useRegistrationResource from '../registrations/useRegistrationResource';
import './LeadRegistrations.css';
const labels={registered:'Registered',waitlisted:'Waitlisted',withdrawn:'Withdrawn'};

/** Loads read-only participation details only while the Lead opens an authorised event's drawer. */
function RegistrationDrawer({eventId,token,onClose}){
  const {data,loading,error}=useRegistrationResource(`/events/${eventId}/lead-registrations`,token);
  return <Modal drawer title="Registration information" onClose={onClose}><div className="registration-detail lead-registration-view">
    {loading && <p role="status">Loading registrations…</p>}
    {error && <p role="alert" className="error-message">{error}</p>}
    {data && <>
      <p className="eyebrow">Participation overview</p><h2>{data.event.name}</h2>
      <dl className="lead-registration-metrics"><div><dt>Confirmed headcount</dt><dd>{data.headcount}</dd></div>
        <div><dt>Waitlist</dt><dd>{data.waitlist_count}</dd></div><div><dt>Withdrawals</dt><dd>{data.withdrawal_count}</dd></div></dl>
      {data.venue_capacity===null?<p>No confirmed venue capacity is available.</p>:<p><strong>Venue capacity:</strong> {data.venue_capacity} · <strong>Remaining spots:</strong> {data.remaining_spots}</p>}
      <h3>Attendees and registration statuses</h3>
      {data.attendees.length===0?<p>No registrations yet.</p>:<div className="lead-registration-table"><table>
        <thead><tr><th scope="col">Attendee</th><th scope="col">Status</th></tr></thead>
        <tbody>{data.attendees.map(row=><tr key={row.id}><td>{row.attendee_name}</td><td><span className="status-badge">{labels[row.status]}</span></td></tr>)}</tbody>
      </table></div>}
      <h3>Waitlist queue</h3>
      {data.waitlist.length===0?<p>No attendees on the waitlist.</p>:<ol aria-label="Waitlist queue">{data.waitlist.map(row=><li key={row.id}>{row.attendee_name}</li>)}</ol>}
    </>}
  </div></Modal>;
}

/** A single drawer action keeps private attendee information out of the Lead's assignment cards until requested. */
export default function LeadRegistrations({eventId,token}){
  const [open,setOpen]=useState(false);
  return <><button className="button-secondary" onClick={()=>setOpen(true)}>Registration information</button>
    {open && <RegistrationDrawer eventId={eventId} token={token} onClose={()=>setOpen(false)}/>}</>;
}
