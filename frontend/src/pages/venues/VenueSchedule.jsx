import { useEffect, useState } from 'react';
import { scheduleTime } from './schedule';
import { useVenueAvailability } from './useVenueAvailability';
import VenueTimeline from './VenueTimeline';
import BookingImpactList from './BookingImpactList';
import { api } from '../../api/client';

/** Shows one venue's local day and lets staff stage explicit periods before an atomic save. */
export default function VenueSchedule({ venue, token, canEdit = false, initialDate = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10) }) {
  const [date, setDate] = useState(initialDate);
  const { current, now, refresh } = useVenueAvailability(venue.id, date, token);
  const [periods, setPeriods] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [affected, setAffected] = useState([]);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const options = { now, setupMinutes: venue.setup_minutes, turnaroundMinutes: venue.turnaround_minutes,
    operatingHours: venue.operating_hours || venue.operatingHours };
  useEffect(() => {
    if (!current?.records || dirty) return;
    // Only staff-authored rows are editable; legacy maintenance and bookings stay locked.
    setPeriods(current.records.filter(record => record.kind === 'schedule').map(record => ({
      id: record.id, status: record.status, label: record.label === record.status ? '' : record.label,
      start: scheduleTime(Date.parse(record.start_datetime), date),
      end: scheduleTime(Date.parse(record.end_datetime), date),
    })));
  }, [current?.records, date, dirty]);

  /** Updates local edits without making them visible to another user until Save succeeds. */
  function changePeriods(next) { setPeriods(next); setDirty(true); setError(''); setAffected([]); setNotice(''); }

  /** Rejects incomplete, overlapping or closed-hour periods before calling the authoritative API. */
  function validate() {
    if (!date) return 'Choose a schedule date.';
    const hours = /^(\d{2}:\d{2}) - (\d{2}:\d{2})$/.exec(options.operatingHours || '');
    if (!hours) return 'Record valid operating hours before editing this schedule.';
    const minute = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : NaN;
    const ordered = [...periods].sort((a, b) => minute(a.start) - minute(b.start));
    for (let index = 0; index < ordered.length; index += 1) {
      const period = ordered[index], start = minute(period.start), end = minute(period.end);
      if (!period.status) return `Period ${index + 1} needs a status.`;
      // Dragging creates complete positive durations; corrupted or legacy rows still need a safe rejection.
      if (!(end > start)) return `Period ${index + 1} must end later than it starts.`;
      // The permitted endpoints are inclusive for a half-open period: opening start and closing end both pass.
      if (start < minute(hours[1]) || end > minute(hours[2])) return `Period ${index + 1} must be within permitted hours ${hours[1]}–${hours[2]}.`;
      if (index && start < minute(ordered[index - 1].end)) return 'Scheduled periods cannot overlap.';
    }
    return '';
  }

  /** Saves the selected day and retains conflict details when a confirmed booking would be closed. */
  async function save() {
    const invalid = validate();
    if (invalid) { setError(invalid); return; }
    setSaving(true); setError(''); setAffected([]);
    try {
      await api.put(`/venues/${venue.id}/schedule`,
        { date, periods: periods.map(({ status, start, end, label }) => ({ status, start, end, label })) }, token);
      setNotice('Venue schedule saved.');
      setDirty(false);
      refresh();
    } catch (failure) {
      setError(failure.message || 'Unable to save the schedule.');
      setAffected(failure.details?.affectedBookings || []);
    } finally { setSaving(false); }
  }

  return <section aria-label="Venue schedule">
    <h3>{venue.name} schedule</h3>
    <label>Schedule date <input type="date" value={date} onChange={event => {
      setDate(event.target.value); setPeriods([]); setDirty(false); setError(''); setAffected([]); setNotice('');
    }} /></label>
    <button className="schedule-action" type="button" onClick={refresh}>Refresh schedule</button>
    <p>Times are in Singapore (UTC+08:00). Operating hours: {options.operatingHours || 'Not recorded'}. Unmarked time inside operating hours is available; bookings and unavailable periods still block it.</p>
    {!date ? <div><p>Choose a date to view the schedule.</p>{canEdit && <>
      {error && <p role="alert" className="error-message">{error}</p>}
      <button type="button" onClick={save}>Save schedule</button>
    </>}</div> : !current ? <p role="status">Loading schedule…</p> : current.error ? <p role="alert">Schedule unavailable: {current.error}</p> :
      <>
      <VenueTimeline venueName={venue.name} date={date} operatingHours={options.operatingHours} records={current.records} periods={periods} now={now}
        canEdit={canEdit} setupMinutes={options.setupMinutes} turnaroundMinutes={options.turnaroundMinutes} onChange={changePeriods} />
      {canEdit && <div className="venue-schedule-actions">
        {error && <p role="alert" className="error-message">{error}</p>}
        {!!affected.length && <section aria-label="Affected bookings"><h4>Confirmed bookings affected</h4><BookingImpactList bookings={affected} /></section>}
        {notice && <p role="status" className="success-message">{notice}</p>}
        <button type="button" disabled={saving || !current || !!current.error} onClick={save}>{saving ? 'Saving schedule…' : 'Save schedule'}</button>
      </div>}
      </>}
  </section>;
}
