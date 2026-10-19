import { useState } from 'react';
import Modal from '../../components/Modal';
import useRegistrationResource from '../registrations/useRegistrationResource';

/** Loads private attendance planning details; calculated overflow remains distinct from stored registration statuses. */
export default function OrganiserRegistrationDrawer({ eventId, token, onClose }) {
  const { data, loading, error } = useRegistrationResource(`/events/${eventId}/registrations`, token);
  const report = data?.details;
  return <Modal drawer title="Registration details" onClose={onClose}><div className="registration-detail">
    {loading && <p role="status">Loading registrations...</p>}
    {error && <p role="alert">{error}</p>}
    {!loading && !error && !report && <p>No registration details are available.</p>}
    {report && <>
      <h3>{report.event.name || `Event ${report.event.id}`}</h3>
      <p aria-label="Registration summary">{report.headcount} registered · {report.waitlist_count} on waitlist · {report.withdrawal_count} withdrawn</p>
      <section className="detail-facts" aria-label="Registered attendees"><h3>Registered attendees</h3>
        {report.registered.length === 0 && <p>No registered attendees.</p>}
        <ol start={1} className="list-decimal pl-6">{report.registered.map(attendee => <li key={attendee.id}>{attendee.attendee_name || 'Attendee'}</li>)}</ol>
      </section>
      <section className="detail-facts" aria-label="Waitlist"><h3>Waitlist</h3>
        {report.waitlist.length === 0 && <p>No attendees on the waitlist.</p>}
        <ol start={1} className="list-decimal pl-6">{report.waitlist.map(attendee => <li key={attendee.id}>
          {attendee.attendee_name || 'Attendee'} — Joined (SGT) <time dateTime={attendee.registered_at}>{new Date(attendee.registered_at).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })}</time>
        </li>)}</ol>
      </section>
      <section className="detail-facts" aria-label="Exceeding capacity"><h3>Exceeding capacity</h3>
        {report.venue_capacity === null
          ? <p>No confirmed venue capacity is available. Overflow cannot be calculated.</p>
          : <>
            <p>Confirmed venue capacity: {report.venue_capacity}</p>
            {report.overflow_count === 0
              ? <p>No registered attendees exceed confirmed venue capacity.</p>
              : <>
                <p>Registered attendees exceeding confirmed venue capacity: {report.overflow_count}</p>
                <p>These attendees are included in the registered total. Their status remains Registered; they are not added to the stored waitlist.</p>
                <ol start={1} className="list-decimal pl-6">{report.overflow.map(attendee => <li key={attendee.id}>{attendee.attendee_name || 'Attendee'}</li>)}</ol>
              </>}
          </>}
      </section>
    </>}
  </div></Modal>;
}

/** Keeps the event page compact; closing unmounts private data and restores trigger focus. */
export function OrganiserRegistrationAction({ eventId, token }) {
  const [open, setOpen] = useState(false);
  return <>
    <button className="button-secondary" onClick={() => setOpen(true)}>Registration details</button>
    {open && <OrganiserRegistrationDrawer eventId={eventId} token={token} onClose={() => setOpen(false)} />}
  </>;
}
