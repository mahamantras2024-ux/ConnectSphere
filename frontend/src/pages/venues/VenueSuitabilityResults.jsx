// File: Groups filtered catalogue cards by the assigned event's recorded requirements without duplicating venues.
import { useEffect, useState } from 'react';
import { api } from '../../api/client';

/** Shows recorded outcomes with clear markers and removes catalogue-list jargon from the displayed explanation. */
function RequirementChecks({ checks }) {
  return <ul className="venue-check-list">{checks.map(check => <li key={check.message} data-result={String(check.met)}>
    <span className="venue-check-marker" aria-hidden={check.met == null}>{check.met === true
      ? <svg role="img" aria-label="Requirement met" viewBox="0 0 20 20" fill="none">
        <path d="M4 10l4 4 8-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg> : check.met === false
      ? <svg role="img" aria-label="Requirement not met" viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="1.75" />
        <text x="10" y="14.5" textAnchor="middle" fill="currentColor" fontSize="14" fontWeight="700">!</text>
      </svg> : '–'}</span>
    {/* Catalogue inventory is technical detail; keep the requested requirement and its original verdict intact. */}
    <span>{check.message.replace(/\s+\(venue lists:.*\)(?=\.$)/i, '')}</span>
  </li>)}</ul>;
}

/** Starts each card compact and retains its disclosure choice through refreshes; mismatch lists omit passing checks. */
export function VenueRequirementSummary({ assessment }) {
  const [expanded, setExpanded] = useState(false);
  return <details className={`venue-fit-summary ${assessment.suitable ? 'venue-fit-good' : 'venue-fit-poor'}`} open={expanded}>
    {/* Control only this card's disclosure so a background comparison can update checks without resetting the choice. */}
    <summary className="venue-fit-badge" onClick={event => { event.preventDefault(); setExpanded(current => !current); }}>
      {assessment.suitable ? 'Meets recorded requirements' : 'Requirements not met'}
    </summary>
    <RequirementChecks checks={assessment.suitable ? assessment.checks : assessment.checks.filter(check => check.met !== true)} />
  </details>;
}

/** Preserves the search endpoint's ordering within each group, including nearest-first map/MRT searches. */
function VenueGroup({ title, venues, assessments, renderVenue }) {
  return <section className="venue-fit-group" aria-label={title}>
    <h2>{title}</h2>
    <ul className="venue-grid venue-fit-grid" aria-label={title}>{venues.map(venue =>
      <li key={venue.id}>{renderVenue(venue, assessments.get(venue.id))}</li>)}</ul>
  </section>;
}

/** Retains same-context comparisons during refresh; event/session changes and failures never reuse old verdicts. */
export default function VenueSuitabilityResults({ eventId, token, venues, renderVenue, refreshKey }) {
  const [snapshot, setSnapshot] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  // Scope retained data immediately, before effects run, so a new event/session never displays the old assessment.
  const view = snapshot && snapshot.eventId === eventId && snapshot.token === token ? snapshot.data : null;
  useEffect(() => {
    // A new event or authenticated session starts with its own closed disclosure.
    setExpanded(false);
  }, [eventId, token]);
  useEffect(() => {
    let active = true;
    // Keep the current groups mounted during an ordinary poll; rebuilding them used to close native disclosures.
    setRefreshing(true); setError('');
    api.get(`/events/${eventId}/venue-suitability`, token).then(data => {
      // Never classify cards using a partial/unrecognised API response or a previous event's late response.
      if (!Array.isArray(data?.venues) || !Array.isArray(data.requirements?.accessibility)) throw new Error('Venue suitability is unavailable right now.');
      if (active) setSnapshot({ eventId, token, data });
    }).catch(failure => {
      // Failed comparisons return to unassessed browsing instead of claiming the last snapshot is still current.
      if (active) { setSnapshot(null); setError(failure.message); }
    }).finally(() => { if (active) setRefreshing(false); });
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
      {/* Reuse the existing caption slot so a background read does not insert a new grid row. */}
      <div className="venue-fit-heading"><div><p className="eyebrow" role={refreshing ? 'status' : undefined}>{refreshing ? 'Refreshing venue suitability…' : 'Compared with your event'}</p><h2 id="venue-suitability-heading">Venue suitability</h2></div></div>
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
    {unsuitable.length > 0 && <details className="venue-other-results" open={expanded}>
      <summary onClick={event => { event.preventDefault(); setExpanded(current => !current); }}>Other venues ({unsuitable.length}) — requirements not met</summary>
      <div className="venue-other-body"><VenueGroup title={`Other venues (${unsuitable.length})`} venues={unsuitable} assessments={assessments} renderVenue={renderVenue} /></div>
    </details>}
    {unassessed.length > 0 && <VenueGroup title={`Not yet assessed (${unassessed.length})`} venues={unassessed} assessments={assessments} renderVenue={renderVenue} />}
  </div>;
}
