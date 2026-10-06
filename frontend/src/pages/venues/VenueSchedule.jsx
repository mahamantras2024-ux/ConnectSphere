import { useState } from 'react';
import { buildSchedule, isActiveHold, scheduleTime } from './schedule';
import { useVenueAvailability } from './useVenueAvailability';

/** Shows per-slot availability for a selected venue; staff/coordinator credentials load recorded blockers and event buffers. */
export default function VenueSchedule({ venue, token, initialDate = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10) }) {
  const [date, setDate] = useState(initialDate);
  const { current, now, refresh } = useVenueAvailability(venue.id, date, token);
  const options = { now, setupMinutes: venue.setup_minutes, turnaroundMinutes: venue.turnaround_minutes };
  return <section aria-label="Venue schedule">
    <h3>{venue.name} schedule</h3>
    <label>Schedule date <input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
    <button className="schedule-action" type="button" onClick={refresh}>Refresh schedule</button>
    <p>Times are in Singapore (UTC+08:00). Event occupancy includes setup before the event and turnaround afterwards. Available means no recorded conflict; opening hours and other booking rules still apply.</p>
    {!date ? <p>Choose a date to view the schedule.</p> : !current ? <p role="status">Loading schedule…</p> : current.error ? <p role="alert">Schedule unavailable: {current.error}</p> :
      <ul aria-label="Daily availability">{buildSchedule(date, current.records, options).map(segment =>
        <li key={segment.start} style={{ borderLeft: `4px solid ${segment.blocked ? '#b45309' : '#15803d'}`, padding: '8px 12px', margin: '8px 0' }}>
          <strong>{scheduleTime(segment.start, date)}–{scheduleTime(segment.end, date)} · {segment.blocked ? 'Unavailable' : 'Available'}</strong>
          {segment.entries.map(entry => <span key={`${entry.kind}-${entry.id}`}> · {entry.kind === 'unavailability' ? 'Under Maintenance · Other unavailable' : ['approved', 'confirmed'].includes(entry.status) ? 'Booked · Confirmed booking' : isActiveHold(entry, now) ? 'Temporary Hold' : `Booking (${entry.status})`}: {entry.label}</span>)}
        </li>)}</ul>}
  </section>;
}
