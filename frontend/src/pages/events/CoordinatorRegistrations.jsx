import { useState } from 'react';
import Modal from '../../components/Modal';
import useRegistrationResource from '../registrations/useRegistrationResource';

/** Loads private attendance planning details; calculated overflow remains distinct from stored registration statuses. */
function RegistrationDrawer({ eventId, token, onClose }) {
  const { data, loading, error } = useRegistrationResource(`/events/${eventId}/coordinator-registrations`, token);
  return <Modal drawer title="Registration details" onClose={onClose}><div className="registration-detail">
    {loading && <p role="status">Loading registrations...</p>}
    {error && <p role="alert">{error}</p>}
    {data && <>
      <h3>{data.event.name}</h3>
      <p aria-label="Registration summary">{data.headcount} registered · {data.waitlist_count} on waitlist · {data.withdrawal_count} withdrawn</p>
      <section className="detail-facts" aria-label="Registered attendees"><h3>Registered attendees</h3>
        {data.registered.length === 0 && <p>No registered attendees.</p>}
        <ol start={1} className="list-decimal pl-6">{data.registered.map(attendee => <li key={attendee.id}>{attendee.attendee_name}</li>)}</ol>
      </section>
      <section className="detail-facts" aria-label="Waitlist"><h3>Waitlist</h3>
        {data.waitlist.length === 0 && <p>No attendees on the waitlist.</p>}
        <ol start={1} className="list-decimal pl-6">{data.waitlist.map(attendee => <li key={attendee.id}>
          {attendee.attendee_name} — Joined (SGT) <time dateTime={attendee.registered_at}>{new Date(attendee.registered_at).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })}</time>
        </li>)}</ol>
      </section>
      <section className="detail-facts" aria-label="Exceeding capacity"><h3>Exceeding capacity</h3>
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
  </div></Modal>;
}

/** Keeps the event page compact; closing unmounts private data and restores trigger focus. */
export default function CoordinatorRegistrations({ eventId, token }) {
  const [open, setOpen] = useState(false);
  return <>
    <button className="button-secondary" onClick={() => setOpen(true)}>Registration details</button>
    {open && <RegistrationDrawer eventId={eventId} token={token} onClose={() => setOpen(false)} />}
  </>;
}
