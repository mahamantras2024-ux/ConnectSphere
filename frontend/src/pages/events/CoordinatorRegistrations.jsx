import { useState } from 'react';
import Modal from '../../components/Modal';
import useRegistrationResource from '../registrations/useRegistrationResource';
import './CoordinatorRegistrations.css';

const statusLabels = { registered: 'Registered', waitlisted: 'Waitlisted', withdrawn: 'Withdrawn' };

/** Loads private attendance planning details; calculated overflow remains distinct from stored registration statuses. */
export function RegistrationDetails({ eventId, token }) {
  const { data, loading, error } = useRegistrationResource(`/events/${eventId}/coordinator-registrations`, token);
  return <div className="registration-detail coordinator-participation">
    {loading && <p role="status">Loading registrations...</p>}
    {error && <p role="alert">{error}</p>}
    {data && <>
      <h3>{data.event.name}</h3>
      <section aria-label="Participation summary">
        <dl className="coordinator-participation-metrics" aria-label="Registration summary">
          <div><dt>Confirmed headcount</dt><dd>{data.headcount}</dd></div>
          <div><dt>Waitlist</dt><dd>{data.waitlist_count}</dd></div>
          <div><dt>Withdrawals</dt><dd>{data.withdrawal_count}</dd></div>
        </dl>
        {data.venue_capacity === null ? <p>No confirmed venue capacity is available.</p> :
          <p className="coordinator-capacity"><span><strong>Venue capacity:</strong> <span aria-label="Venue capacity">{data.venue_capacity}</span></span>
            <span><strong>Remaining spots:</strong> <span aria-label="Remaining spots">{data.remaining_spots}</span></span></p>}
      </section>
      <section aria-label="Attendees and registration statuses"><h3>Attendees and registration statuses</h3>
        {!data.attendees?.length ? <p>No registrations yet.</p> : <div className="coordinator-attendee-table"><table aria-label="Attendees and registration statuses">
          <thead><tr><th scope="col">Attendee</th><th scope="col">Status</th></tr></thead>
          <tbody>{data.attendees.map(attendee => <tr key={attendee.id}><td>{attendee.attendee_name}</td>
            <td><span className="status-badge">{statusLabels[attendee.status]}</span></td></tr>)}</tbody>
        </table></div>}
      </section>
      <section aria-label="Waitlist"><h3>Waitlist queue</h3>
        {data.waitlist.length === 0 && <p>No attendees on the waitlist.</p>}
        <ol start={1} className="list-decimal pl-6">{data.waitlist.map(attendee => <li key={attendee.id}>
          {attendee.attendee_name} — Joined (SGT) <time dateTime={attendee.registered_at}>{new Date(attendee.registered_at).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })}</time>
        </li>)}</ol>
      </section>
      <section aria-label="Exceeding capacity"><h3>Exceeding capacity</h3>
        {data.venue_capacity === null
          ? <p>No confirmed venue capacity is available. Overflow cannot be calculated.</p>
          : <>
            <p>Confirmed venue capacity: {data.venue_capacity}</p>
            {data.overflow_count === 0
              ? <p>No registered attendees exceed confirmed venue capacity.</p>
              : <>
                <p>Registered attendees exceeding confirmed venue capacity: {data.overflow_count}</p>
                <p>These attendees are included in the registered total. Their status remains Registered; they are not added to the stored waitlist.</p>
                <ol start={1} className="list-decimal pl-6">{data.overflow.map(attendee => <li key={attendee.id}>{attendee.attendee_name}</li>)}</ol>
              </>}
          </>}
      </section>
    </>}
  </div>;
}

/** Keeps the event page compact; closing unmounts private data and restores trigger focus. */
export default function CoordinatorRegistrations({ eventId, token, inline = false }) {
  const [open, setOpen] = useState(false);
  // The workspace tab shares the same report without creating a second modal navigation layer.
  if (inline) return <RegistrationDetails eventId={eventId} token={token} />;
  return <>
    <button className="button-secondary" onClick={() => setOpen(true)}>Registration details</button>
    {open && <Modal drawer title="Registration details" onClose={() => setOpen(false)}><RegistrationDetails eventId={eventId} token={token} /></Modal>}
  </>;
}
