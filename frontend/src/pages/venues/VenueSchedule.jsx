import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { buildSchedule, scheduleTime } from './schedule';

/** Shows recorded availability for venue {id, name}; token authenticates staff and initialDate optionally selects a Singapore day. */
export default function VenueSchedule({ venue, token, initialDate = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10) }) {
  const [date, setDate] = useState(initialDate);
  const [result, setResult] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const key = `${venue.id}/${date}/${token}/${refresh}`;
  useEffect(() => {
    // Invalidate old responses so yesterday's free periods cannot appear under a new date or venue.
    let active = true;
    if (date) api.get(`/venues/${venue.id}/schedule?date=${date}`, token).then(records => {
      if (active) setResult({ key, records });
    }).catch(error => {
      if (active) setResult({ key, error: error.message });
    });
    return () => { active = false; };
  }, [key, venue.id, date, token]);
  const current = result?.key === key ? result : null;
  return <section aria-label="Venue schedule">
    <h3>{venue.name} schedule</h3>
    <label>Schedule date <input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
    <button type="button" onClick={() => setRefresh(value => value + 1)}>Refresh schedule</button>
    <p>Times are in Singapore (UTC+08:00). Available means no recorded conflict; opening hours and other booking rules still apply. Confirmed bookings reserve exclusive use of this venue.</p>
    {!date ? <p>Choose a date to view the schedule.</p> : !current ? <p role="status">Loading schedule…</p> : current.error ? <p role="alert">Schedule unavailable: {current.error}</p> :
      <ul aria-label="Daily availability">{buildSchedule(date, current.records).map(segment =>
        <li key={segment.start} style={{ borderLeft: `4px solid ${segment.blocked ? '#b45309' : '#15803d'}`, padding: '8px 12px', margin: '8px 0' }}>
          <strong>{scheduleTime(segment.start, date)}–{scheduleTime(segment.end, date)} · {segment.blocked ? 'Unavailable' : 'Available'}</strong>
          {segment.entries.map(entry => <span key={`${entry.kind}-${entry.id}`}> · {entry.kind === 'unavailability' ? 'Other unavailable' : ['approved', 'confirmed'].includes(entry.status) ? 'Confirmed booking' : `Booking (${entry.status})`}: {entry.label}</span>)}
        </li>)}</ul>}
  </section>;
}
