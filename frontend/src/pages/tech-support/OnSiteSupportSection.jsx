import React, { useEffect, useState } from 'react';
import { api } from '../../api/client';

const dateFormatter = new Intl.DateTimeFormat('en-SG', { dateStyle: 'long', timeZone: 'UTC' });

/** Displays the event facts a Technical Support Staff member needs for on-site preparation. */
export default function OnSiteSupportSection({ token }) {
  const [events, setEvents] = useState([]);
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  useEffect(() => {
    api.get('/events/on-site-support', token).then(result => {
      setEvents(result.events || []); setState('ready');
    }).catch(err => { setError(err.message); setState('error'); });
  }, [token]);
  return <section className="onsite-support-section" aria-labelledby="on-site-support-title">
    <div className="onsite-support-heading">
      <div>
        <h2 id="on-site-support-title">Assigned events</h2>
        <p className="onsite-support-description">Events where you are assigned to provide technical support.</p>
      </div>
      <span className="badge">{events.length} {events.length === 1 ? 'event' : 'events'}</span>
    </div>
    {state === 'loading' && <p role="status">Loading support assignments...</p>}
    {state === 'error' && <p role="alert" className="error-message">{error}</p>}
    {state === 'ready' && events.length === 0 && <section className="empty-state"><span className="empty-symbol" aria-hidden="true">◇</span><h2>No assigned events yet.</h2><p>Events assigned for on-site technical support will appear here.</p></section>}
    {state === 'ready' && events.length > 0 && <div className="onsite-event-grid">{events.map(event => (
      <article className="onsite-event-card" key={event.id} aria-labelledby={`on-site-event-${event.id}`}>
        <div className="onsite-event-top">
          <span className="record-number">EVENT / {String(event.id).padStart(3, '0')}</span>
          <span className={`status-badge status-${event.status}`}>{event.status?.replace(/_/g, ' ') || 'Assigned'}</span>
        </div>
        <div className="onsite-event-title">
          <h3 id={`on-site-event-${event.id}`}>{event.name || 'Untitled Event'}</h3>
          <p>{event.purpose || 'No purpose provided'}</p>
        </div>
        <dl className="onsite-event-facts">
          <div><dt>Date</dt><dd>{event.proposed_date ? dateFormatter.format(new Date(`${event.proposed_date}T00:00:00Z`)) : 'Not specified'}</dd></div>
          <div><dt>Time</dt><dd>{event.proposed_start_time?.slice(0, 5) || 'Not specified'} – {event.proposed_end_time?.slice(0, 5) || 'Not specified'}</dd></div>
          <div><dt>Venue</dt><dd>{event.venue_name}{event.venue_location ? ` · ${event.venue_location}` : ''}</dd></div>
        </dl>
        <section className="onsite-event-equipment" aria-label="Equipment involved">
          <h4>Equipment involved</h4>
          {event.equipment_items?.length > 0
            ? <ul>{event.equipment_items.map((item, index) => <li key={`${item.item}-${index}`}><span>{item.item}</span><span>Qty. {item.quantity}</span></li>)}</ul>
            : <p>{event.equipment_notes || 'No equipment details provided.'}</p>}
          {event.technical_support_details && <p className="onsite-event-notes"><strong>Support notes</strong>{event.technical_support_details}</p>}
        </section>
      </article>
    ))}</div>}
  </section>;
}
