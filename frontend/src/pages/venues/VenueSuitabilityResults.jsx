// File: Groups filtered catalogue cards by the assigned event's recorded requirements without duplicating venues.
import { useEffect, useState } from 'react';
import { api } from '../../api/client';

/** Shows each recorded check with a distinct pass, mismatch or unchecked marker. */
function RequirementChecks({ checks }) {
  return <ul className="venue-check-list">{checks.map(check => <li key={check.message} data-result={String(check.met)}>
    <span aria-hidden="true">{check.met === true ? '✓' : check.met === false ? '✗' : '–'}</span><span>{check.message}</span>
  </li>)}</ul>;
}

/** Keeps matches compact; mismatched cards show their reasons directly once the other-venues section opens. */
export function VenueRequirementSummary({ assessment }) {
  return <div className={`venue-fit-summary ${assessment.suitable ? 'venue-fit-good' : 'venue-fit-poor'}`}>
    <span className="venue-fit-badge">{assessment.suitable ? 'Meets recorded requirements' : 'Requirements not met'}</span>
    {assessment.suitable ? <details className="venue-check-details"><summary>Requirements checked</summary>
      <RequirementChecks checks={assessment.checks} /></details>
      : <RequirementChecks checks={assessment.checks.filter(check => check.met !== true)} />}
  </div>;
}

/** Preserves the search endpoint's ordering within each group, including nearest-first map/MRT searches. */
function VenueGroup({ title, venues, assessments, renderVenue }) {
  return <section className="venue-fit-group" aria-label={title}>
    <h2>{title}</h2>
    <ul className="venue-grid venue-fit-grid" aria-label={title}>{venues.map(venue =>
      <li key={venue.id}>{renderVenue(venue, assessments.get(venue.id))}</li>)}</ul>
  </section>;
}

/** Loads only the coordinator-authorized comparison; search results remain usable during loading or comparison failure. */
export default function VenueSuitabilityResults({ eventId, token, venues, renderVenue, refreshKey }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setView(null); setError('');
    api.get(`/events/${eventId}/venue-suitability`, token).then(data => {
      // Never classify cards using a partial/unrecognised API response or a previous event's late response.
      if (!Array.isArray(data?.venues) || !Array.isArray(data.requirements?.accessibility)) throw new Error('Venue suitability is unavailable right now.');
      if (active) setView(data);
    }).catch(failure => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [eventId, token, refreshKey, retry]);

  if (!view) return <>
    <section className="venue-fit-notice" aria-label="Venue suitability">
      {error ? <><p>{error}</p><button className="button-secondary" onClick={() => setRetry(value => value + 1)}>Retry comparison</button></>
        : <p role="status">Loading venue suitability…</p>}
      <p>Browse the catalogue while suitability is unavailable. No match is assumed.</p>
    </section>
    <div className="venue-grid">{venues.map(venue => renderVenue(venue))}</div>
  </>;

  const assessments = new Map(view.venues.map(venue => [venue.id, venue]));
  const suitable = venues.filter(venue => assessments.get(venue.id)?.suitable === true);
  const unsuitable = venues.filter(venue => assessments.get(venue.id)?.suitable === false);
  // A live catalogue update may arrive before its comparison; keep that venue visible without inventing a verdict.
  const unassessed = venues.filter(venue => !assessments.has(venue.id));
  return <div className="venue-fit-results">
    <section className="venue-requirements-card" aria-labelledby="venue-suitability-heading">
      <div className="venue-fit-heading"><div><p className="eyebrow">Compared with your event</p><h2 id="venue-suitability-heading">Venue suitability</h2></div></div>
      <ul className="venue-requirement-facts" aria-label="Organiser's venue requirements">
        <li><span>Expected attendance</span><strong>{view.requirements.expectedAttendance ?? 'Not recorded'}</strong></li>
        <li><span>Room layout</span><strong>{view.requirements.layout || 'No preference'}</strong></li>
        <li><span>Accessibility needs</span><strong>{view.requirements.accessibility.length ? view.requirements.accessibility.join(', ') : 'None'}</strong></li>
      </ul>
      <p>Suitability does not confirm schedule availability. Use the date/time filters or view the venue schedule.</p>
      <p>These groups contain the current search results. Clear filters to compare the full catalogue. Facilities are checked using the facilities filter.</p>
    </section>
    {suitable.length ? <VenueGroup title={`Suitable venues (${suitable.length})`} venues={suitable} assessments={assessments} renderVenue={renderVenue} />
      : <p className="venue-fit-empty">No venue matches all recorded event requirements in these results.</p>}
    {unsuitable.length > 0 && <details className="venue-other-results">
      <summary>Other venues ({unsuitable.length}) — requirements not met</summary>
      <div className="venue-other-body"><VenueGroup title={`Other venues (${unsuitable.length})`} venues={unsuitable} assessments={assessments} renderVenue={renderVenue} /></div>
    </details>}
    {unassessed.length > 0 && <VenueGroup title={`Not yet assessed (${unassessed.length})`} venues={unassessed} assessments={assessments} renderVenue={renderVenue} />}
  </div>;
}
