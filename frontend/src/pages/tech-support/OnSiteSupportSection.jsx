import React, { useState } from 'react';
import useLiveResource from '../../hooks/useLiveResource';

const dateFormatter = new Intl.DateTimeFormat('en-SG', { dateStyle: 'long', timeZone: 'UTC' });

/** Maps persisted workflow values into the four preparation stages without exposing internal planning codes. */
function stageLabel(status) {
  if (!status) return 'Assigned';
  if (['approved', 'confirmed'].includes(status)) return 'Confirmed';
  if (status === 'completed') return 'Completed';
  if (status === 'cancelled') return 'Cancelled';
  return 'Planning';
}

/** Displays the event facts a Technical Support Staff member needs for on-site preparation. */
export default function OnSiteSupportSection({ token, onRelease }) {
  // Poll/focus refreshes and identity changes use the shared stale-response and authorization protections.
  const { data, loading, error, refresh } = useLiveResource('/events/on-site-support', token);
  const events = Array.isArray(data?.events) ? data.events : [];
  const state = loading ? 'loading' : error ? 'error' : 'ready';
  const [releasing, setReleasing] = useState(null);
  const [releaseError, setReleaseError] = useState('');

  /** Uses the existing audited release action and re-reads the card only after the server confirms success. */
  async function release(reservation, event) {
    setReleasing(reservation.id);
    setReleaseError('');
    try {
      await onRelease({ ...reservation, event_name: event.name });
      refresh();
    } catch (failure) {
      setReleaseError(failure.message || 'Unable to release this equipment reservation.');
    } finally {
      setReleasing(null);
    }
  }
  return <section className="onsite-support-section" aria-labelledby="on-site-support-title">
    <div className="onsite-support-heading">
      <div>
        <h2 id="on-site-support-title">Assigned events</h2>
        <p className="onsite-support-description">Events with your assigned support, equipment reviews or equipment reservations.</p>
      </div>
      <button type="button" className="button-secondary" onClick={refresh} disabled={loading}>Refresh event statuses</button>
      <span className="badge">{events.length} {events.length === 1 ? 'event' : 'events'}</span>
    </div>
    {releaseError && <p role="alert" className="error-message">{releaseError}</p>}
    {state === 'loading' && <p role="status">Loading support assignments...</p>}
    {state === 'error' && <p role="alert" className="error-message">{error}</p>}
    {state === 'ready' && events.length === 0 && <section className="empty-state"><span className="empty-symbol" aria-hidden="true">◇</span><h2>No assigned events yet.</h2><p>Events assigned for on-site technical support will appear here.</p></section>}
    {state === 'ready' && events.length > 0 && <div className="onsite-event-grid">{events.map(event => (
      <article className="onsite-event-card" key={event.id} aria-labelledby={`on-site-event-${event.id}`}>
        <div className="onsite-event-top">
          <span className="record-number">EVENT / {String(event.id).padStart(3, '0')}</span>
          <span className={`status-badge status-${stageLabel(event.status).toLowerCase()}`}>{stageLabel(event.status)}</span>
        </div>
        <div className="onsite-event-title">
          <h3 id={`on-site-event-${event.id}`}>{event.name || 'Untitled Event'}</h3>
          <p>{event.purpose || 'No purpose provided'}</p>
        </div>
        {stageLabel(event.status) === 'Confirmed' && <p>Latest confirmed preparation information</p>}
        {event.status === 'completed' && <p>This event is completed. No further event preparations are required.</p>}
        {event.status === 'cancelled' && <p>This event is cancelled. Preparations are no longer required. Release any remaining equipment reservations where applicable.</p>}
        <dl className="onsite-event-facts">
          <div><dt>Date</dt><dd>{event.proposed_date ? dateFormatter.format(new Date(`${event.proposed_date}T00:00:00Z`)) : 'Not specified'}</dd></div>
          <div><dt>Time</dt><dd>{event.proposed_start_time?.slice(0, 5) || 'Not specified'} – {event.proposed_end_time?.slice(0, 5) || 'Not specified'}</dd></div>
          {event.expected_attendance != null && <div><dt>Expected attendance</dt><dd>{event.expected_attendance}</dd></div>}
          <div><dt>Venue</dt><dd>{event.venue_name}{event.venue_location ? ` · ${event.venue_location}` : ''}</dd></div>
        </dl>
        <section className="onsite-event-equipment" aria-label="Equipment involved">
          <h4>Equipment involved</h4>
          {event.equipment_items?.length > 0
            ? <ul>{event.equipment_items.map((item, index) => <li key={`${item.item}-${index}`}><span>{item.item}</span><span>Qty. {item.quantity}</span></li>)}</ul>
            : <p>{event.equipment_notes || 'No equipment details provided.'}</p>}
          {event.equipment_items?.length > 0 && event.equipment_notes && <p className="onsite-event-notes"><strong>Equipment notes</strong>{event.equipment_notes}</p>}
          {event.technical_specifications && <p className="onsite-event-notes"><strong>Technical specifications</strong>{event.technical_specifications}</p>}
          {event.video_conferencing_required && <p>Video conferencing required</p>}
          {event.technical_support_details && <p className="onsite-event-notes"><strong>Support notes</strong>{event.technical_support_details}</p>}
        </section>
        {event.status === 'cancelled' && onRelease && (event.reservations || []).filter(reservation => reservation.status === 'reserved').map(reservation => (
          <button key={reservation.id} type="button" className="button-secondary"
            disabled={releasing !== null} onClick={() => release(reservation, event)}
            aria-label={`Release equipment reservation ${reservation.id}`}>
            {releasing === reservation.id ? 'Releasing equipment…' : `Release equipment reservation ${reservation.id}`}
          </button>
        ))}
      </article>
    ))}</div>}
  </section>;
}
