import { useRef, useState } from 'react';
import { isActiveHold } from './schedule';

/** Converts a venue-local time to the fixed day-axis position used by drag and resize. */
function toMinutes(time) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time || '')) return NaN;
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}

/** Keeps all timeline interactions on 15-minute steps while retaining 24:00 as a visual endpoint. */
function timeLabel(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Renders one venue row with day ticks, locked blockers and editable explicit schedule blocks. */
export default function VenueTimeline({ venueName, periods, records, date, operatingHours, now, canEdit, mode, onChange }) {
  const rowRef = useRef(null);
  const drag = useRef(null);
  const [preview, setPreview] = useState(null);
  const dayStart = Date.parse(`${date}T00:00:00+08:00`);
  const ticks = [0, 240, 480, 720, 960, 1200, 1440];
  const hours = /^(\d{2}:\d{2}) - (\d{2}:\d{2})$/.exec(operatingHours || '');
  const opening = hours ? toMinutes(hours[1]) : 0;
  const closing = hours ? toMinutes(hours[2]) : 1440;

  /** Maps the pointer to the local day using the actual row width, with a test-safe width fallback. */
  function pointerMinute(event) {
    const rect = rowRef.current?.getBoundingClientRect();
    const width = rect?.width || 960;
    return Math.max(0, Math.min(1440, Math.round(((event.clientX - (rect?.left || 0)) / width * 1440) / 15) * 15));
  }

  /** Derives a draft without committing it so cancelling a drag leaves saved periods untouched. */
  function nextPreview(event) {
    const current = pointerMinute(event);
    const { type, original, origin, id } = drag.current;
    if (type === 'create') return { id: 'preview', status: mode, label: '',
      start: timeLabel(Math.min(origin, current)),
      end: timeLabel(Math.max(origin + (current === origin ? 15 : 0), current)) };
    const start = toMinutes(original.start), end = toMinutes(original.end);
    if (type === 'move') {
      const change = Math.max(-start, Math.min(1440 - end, current - origin));
      return { ...original, id, start: timeLabel(start + change), end: timeLabel(end + change) };
    }
    if (type === 'left') return { ...original, id, start: timeLabel(Math.min(end - 15, current)) };
    return { ...original, id, end: timeLabel(Math.max(start + 15, current)) };
  }

  /** Starts a new block on empty space or selects the move/resize gesture on an existing block. */
  function begin(event) {
    if (!canEdit || drag.current || (event.button != null && event.button !== 0) || event.target.closest('button')) return;
    const block = event.target.closest('[data-period-id]');
    const minute = pointerMinute(event);
    if (block) {
      const original = periods.find(period => String(period.id) === block.dataset.periodId);
      drag.current = { type: event.target.dataset.edge || 'move', original, id: original.id, origin: minute, pointerId: event.pointerId };
    } else drag.current = { type: 'create', origin: minute, pointerId: event.pointerId };
    rowRef.current?.setPointerCapture?.(event.pointerId);
    setPreview(nextPreview(event));
  }

  /** Shows the proposed block as the pointer crosses the horizontal axis. */
  function move(event) {
    if (drag.current?.pointerId === event.pointerId) setPreview(nextPreview(event));
  }

  /** Commits the local draft; the parent saves all blocks together only on explicit Save. */
  function finish(event) {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const proposed = nextPreview(event);
    if (drag.current.type === 'create') onChange([...periods, { ...proposed, id: `draft-${Date.now()}-${Math.random()}` }]);
    else onChange(periods.map(period => period.id === drag.current.id ? proposed : period));
    drag.current = null;
    setPreview(null);
  }

  /** A cancelled gesture must never publish a partial or accidental time block. */
  function cancel(event) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setPreview(null);
  }

  const shown = preview?.id === 'preview' ? [...periods, preview] :
    periods.map(period => period.id === preview?.id ? preview : period);
  return <div className="venue-timeline-scroll">
    <div className="venue-timeline" role="grid" aria-label="Venue day timeline">
      <div className="venue-timeline-axis" aria-hidden="true">
        {ticks.map(minute => <span key={minute} className="venue-timeline-tick" style={{ left: `${minute / 14.4}%` }}>{timeLabel(minute)}</span>)}
      </div>
      <div className="venue-timeline-heading">{venueName}</div>
      <div ref={rowRef} role="row" aria-label={`${venueName} timeline`} className="venue-timeline-row"
        onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel}>
        {hours && <>
          <span className="venue-timeline-closed" style={{ left: 0, width: `${opening / 14.4}%` }} title="Outside operating hours" />
          <span className="venue-timeline-closed" style={{ left: `${closing / 14.4}%`, width: `${(1440 - closing) / 14.4}%` }} title="Outside operating hours" />
        </>}
        {records.filter(record => record.kind === 'unavailability' ||
          (record.kind === 'booking' && (['approved', 'confirmed'].includes(record.status) || isActiveHold(record, now)))).map(record => {
          // Booking occupancy includes its setup and turnaround; maintenance already stores its full closure.
          const setup = record.kind === 'booking' ? Number(record.setup_minutes || 0) : 0;
          const turnaround = record.kind === 'booking' ? Number(record.turnaround_minutes || 0) : 0;
          const beginAt = Math.max(0, (Date.parse(record.start_datetime) - dayStart) / 60000 - setup);
          const endAt = Math.min(1440, (Date.parse(record.end_datetime) - dayStart) / 60000 + turnaround);
          if (endAt <= beginAt) return null;
          return <span key={`${record.kind}-${record.id}`} className="venue-timeline-locked"
            style={{ left: `${beginAt / 14.4}%`, width: `${(endAt - beginAt) / 14.4}%` }}
            title={record.label}>{record.kind === 'booking' ? 'Booking' : 'Closed'}</span>;
        })}
        {shown.map(period => {
          const start = toMinutes(period.start), end = toMinutes(period.end);
          if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
          const title = period.label || period.status;
          return <div key={period.id} data-period-id={period.id} className={`venue-timeline-block ${period.status}`}
            aria-label={`${title} ${period.start}–${period.end}`} tabIndex={0}
            style={{ left: `${start / 14.4}%`, width: `${(end - start) / 14.4}%` }}>
            {canEdit && <span data-edge="left" className="venue-timeline-handle" aria-hidden="true" />}
            <span className="venue-timeline-block-label">{period.label || period.status}</span>
            {canEdit && <span data-edge="right" className="venue-timeline-handle" aria-hidden="true" />}
            {canEdit && period.id !== 'preview' && <button type="button" aria-label={`Delete ${title} period`}
              onClick={event => { event.stopPropagation(); onChange(periods.filter(item => item.id !== period.id)); }}>×</button>}
          </div>;
        })}
      </div>
    </div>
  </div>;
}
