import { useEffect, useId, useRef, useState } from 'react';

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const clockPattern = /^(0[1-9]|1[0-2]):([0-5]\d) (AM|PM)$/i;

/** Converts a valid 12-hour display label to the API's HH:mm format; invalid drafts return null. */
export function parseClockTime(value) {
  const match = clockPattern.exec(value);
  if (!match) return null;
  // 12 AM is midnight (00); 12 PM is noon (12), rather than adding twelve to an already-12 hour.
  const hour = Number(match[1]) % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0);
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

/** Presents saved 24-hour event times as padded hh:mm AM/PM, retaining blank optional fields. */
export function formatClockTime(value) {
  if (!timePattern.test(value)) return value;
  const [hour, minute] = value.split(':');
  return `${String(Number(hour) % 12 || 12).padStart(2, '0')}:${minute} ${Number(hour) >= 12 ? 'PM' : 'AM'}`;
}

/** Shared booking/filter input: edits 12-hour labels and optionally requires a value; hours advance to minutes. */
export default function ClockTimeField({ label, value, onChange, required = false }) {
  const id = useId();
  const root = useRef(null), input = useRef(null), dial = useRef(null);
  const [part, setPart] = useState(null);
  // Opening an empty clock previews 12 AM without manufacturing a committed time.
  const match = clockPattern.exec(value);
  const [hour, minute, period] = match ? [Number(match[1]), Number(match[2]), match[3].toUpperCase()] : [12, 0, 'AM'];
  const current = part === 'hour' ? hour : minute;
  const minimum = part === 'hour' ? 1 : 0;
  const maximum = part === 'hour' ? 12 : 59;
  const numbers = part === 'hour' ? Array.from({ length: 12 }, (_, index) => index + 1) : Array.from({ length: 12 }, (_, index) => index * 5);
  const angle = part === 'hour' ? hour % 12 * 30 : minute * 6;
  const radius = 106;

  /** Restores keyboard focus to the time field after completion or dismissal. */
  function closeClock() { setPart(null); input.current.focus(); }
  /** Writes one complete display label, preserving explicit AM/PM selection during dial edits. */
  function writeTime(nextHour, nextMinute, nextPeriod) {
    onChange(`${String(nextHour).padStart(2, '0')}:${String(nextMinute).padStart(2, '0')} ${nextPeriod}`);
  }
  /** Changes only the active segment; each caller converts the completed label when submitting. */
  function writeNumber(number) {
    const values = part === 'hour' ? [number, minute] : [hour, number];
    writeTime(values[0], values[1], period);
  }
  /** An hour selection advances the workflow; a minute selection completes it. */
  function chooseNumber(number) {
    writeNumber(number);
    if (part === 'hour') setPart('minute'); else closeClock();
  }
  useEffect(() => {
    if (!part) return undefined;
    dial.current.focus();
    // Only this popup closes on an outside click; the surrounding filter dialog remains open.
    function outside(event) { if (!root.current.contains(event.target)) setPart(null); }
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [part]);
  /** Arrow keys provide precision while clamping hours to 1–12 and minutes to 0–59. */
  function clockKey(event) {
    // Number buttons retain their native Enter/Space behavior when reached using Tab.
    if (event.target !== event.currentTarget) return;
    const steps = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };
    if (event.key === 'Enter') { event.preventDefault(); chooseNumber(current); }
    else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault(); writeNumber(event.key === 'Home' ? minimum : maximum);
    } else if (event.key in steps) {
      event.preventDefault(); writeNumber(Math.min(maximum, Math.max(minimum, current + steps[event.key])));
    }
  }
  /** Reads any minute tick from its angle, including minutes between the five-minute labels. */
  function chooseMinuteAtPoint(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const degrees = Math.atan2(event.clientX - bounds.left - bounds.width / 2, bounds.top + bounds.height / 2 - event.clientY) * 180 / Math.PI;
    chooseNumber((Math.round(degrees / 6) + 60) % 60);
  }
  return <div className="clock-time-field" ref={root} onKeyDown={event => {
    // Escape dismisses the clock first instead of bubbling to the filter dialog's Escape handler.
    if (event.key === 'Escape' && part) { event.stopPropagation(); event.preventDefault(); closeClock(); }
  }}>
    <label htmlFor={id}>{label}</label>
    <div className="clock-time-input">
      <input id={id} ref={input} required={required} type="text" placeholder="hh:mm" value={value} maxLength={8}
        aria-expanded={Boolean(part)} aria-controls={part ? `${id}-clock` : undefined}
        onChange={event => {
          // Keep incomplete drafts editable; normalize a completed label to padded uppercase AM/PM.
          const next = event.target.value, parsed = parseClockTime(next);
          onChange(parsed === null ? next : formatClockTime(parsed));
        }}
        onClick={event => setPart(event.currentTarget.selectionStart >= 3 ? 'minute' : 'hour')}
        onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setPart(event.currentTarget.selectionStart >= 3 ? 'minute' : 'hour'); } }} />
      {/* Fixed-size outline artwork matches the native calendar icon while preserving the larger button hit area. */}
      <button type="button" className="clock-time-open" aria-label={`Choose ${label}`} onClick={() => setPart('hour')}>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
    {part && <div className="clock-time-popup" id={`${id}-clock`}>
      <div className="clock-time-parts">
        <button type="button" aria-label={`${label} hours`} aria-pressed={part === 'hour'} onClick={() => setPart('hour')}>{String(hour).padStart(2, '0')}<small>Hours</small></button>
        <span aria-hidden="true">:</span>
        <button type="button" aria-label={`${label} minutes`} aria-pressed={part === 'minute'} onClick={() => setPart('minute')}>{String(minute).padStart(2, '0')}<small>Minutes</small></button>
        <div className="clock-time-period" role="group" aria-label={`${label} period`}>
          {['AM', 'PM'].map(option => <button key={option} type="button" aria-label={`${label} ${option}`} aria-pressed={period === option}
            onClick={() => writeTime(hour, minute, option)}>{option}</button>)}
        </div>
      </div>
      <p className="clock-time-help">Use arrow keys for precision, then Enter to choose.</p>
      <div ref={dial} tabIndex={0} role="group" aria-label={`${label} ${part} clock`} className="clock-time-dial" onKeyDown={clockKey}
        onClick={part === 'minute' ? chooseMinuteAtPoint : undefined}>
        <span className="clock-time-hand" aria-hidden="true" style={{ height: `${radius / 260 * 100}%`, transform: `rotate(${angle}deg)` }} />
        {numbers.map(number => {
          // Every hour uses the same ring; AM/PM determines its meaning without a second set of numbers.
          const radians = (part === 'hour' ? number % 12 * 30 : number * 6) * Math.PI / 180;
          return <button key={number} type="button" aria-label={`Select ${part} ${String(number).padStart(2, '0')}`} aria-pressed={current === number}
            style={{ left: `${50 + Math.sin(radians) * radius / 260 * 100}%`, top: `${50 - Math.cos(radians) * radius / 260 * 100}%` }}
            onClick={event => { event.stopPropagation(); chooseNumber(number); }}>{part === 'hour' ? number : String(number).padStart(2, '0')}</button>;
        })}
      </div>
      <div className="clock-time-actions">
        <button type="button" onClick={() => { onChange(''); closeClock(); }} aria-label={`Clear ${label}`}>Clear</button>
        <button type="button" onClick={closeClock} aria-label={`Close ${label} clock`}>Done</button>
      </div>
    </div>}
  </div>;
}
