// File: Shows the assigned Event Coordinator which venues match the organiser's venue requirements for an event.
import { useEffect, useState } from 'react';
import { api } from '../../api/client';

const CHECK_MARKS = { true: '✓', false: '✗', null: '–' };

/** One venue: its suitability badge and a line per organiser requirement saying what matched or is missing (AC4/AC5). */
function VenueRow({ venue }) {
  return (
    <li className={`change-request-card ${venue.suitable ? 'venue-match' : 'venue-mismatch'}`}>
      <div>
        <strong>{venue.name}</strong>
        <span className={`status-badge ${venue.suitable ? 'status-approved' : 'status-rejected'}`}>{venue.suitable ? 'Appears suitable' : 'Not suitable'}</span>
      </div>
      <p className="text-sm text-slate-600">{venue.location} · Capacity {venue.capacity}</p>
      <ul aria-label={`Requirements checked for ${venue.name}`} className="text-sm">
        {venue.checks.map((check) => (
          <li key={check.message} className={check.met === false ? 'error-message' : undefined}>{CHECK_MARKS[check.met]} {check.message}</li>
        ))}
      </ul>
    </li>
  );
}

/**
 * Check Venue Suitability. Compares the venue requirements the organiser specified - expected attendance, room layout
 * and accessibility needs - with every active venue's recorded information (AC1). A venue appears suitable only when it
 * holds the attendance (AC2) and lists the requested layout and every accessibility need (AC3); suitable venues are
 * highlighted as matches (AC4) and each unsuitable venue shows the requirement it does not satisfy (AC5).
 * @param {{ eventId: number, token: string }} props the event being coordinated and the session token.
 */
export default function VenueSuitabilitySection({ eventId, token }) {
  const [view, setView] = useState(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    api.get(`/events/${eventId}/venue-suitability`, token)
      .then((data) => {
        // This panel is supplementary: an unexpected response (e.g. an older API) must not break the event page.
        if (!Array.isArray(data?.venues) || !Array.isArray(data.requirements?.accessibility)) throw new Error('Venue suitability is unavailable right now.');
        setView(data); setLoadError('');
      })
      .catch((err) => setLoadError(err.message));
  }, [eventId, token]);

  const suitable = view?.venues.filter((venue) => venue.suitable) || [];
  const unsuitable = view?.venues.filter((venue) => !venue.suitable) || [];
  const requirements = view?.requirements;
  return (
    <section className="ed-card ed-span" aria-labelledby="venue-suitability-heading">
      <h2 id="venue-suitability-heading" className="ed-card-title">Venue suitability</h2>
      {/* Plain text (not an alert) so a suitability outage never masks the event page's own errors. */}
      {loadError ? <p className="error-message">{loadError}</p> : !view ? <p role="status" className="loading-state">Loading venue suitability...</p> : (
        <div className="grid gap-4">
          <dl className="detail-facts" aria-label="Organiser's venue requirements">
            <div><dt>Expected attendance</dt><dd>{requirements.expectedAttendance ?? 'Not recorded'}</dd></div>
            <div><dt>Room layout</dt><dd>{requirements.layout || 'No preference'}</dd></div>
            <div><dt>Accessibility needs</dt><dd>{requirements.accessibility.length ? requirements.accessibility.join(', ') : 'None'}</dd></div>
          </dl>
          {view.venues.length === 0 ? <p className="text-slate-600">No active venues are in the catalogue.</p> : (
            <>
              <div>
                <h3 id="suitable-venues-heading">Suitable venues ({suitable.length})</h3>
                {suitable.length ? <ul aria-labelledby="suitable-venues-heading" className="safety-list">{suitable.map((venue) => <VenueRow key={venue.id} venue={venue} />)}</ul>
                  : <p className="text-slate-600">No venue matches all of the organiser's venue requirements.</p>}
              </div>
              {unsuitable.length > 0 && (
                <div>
                  <h3 id="unsuitable-venues-heading">Not suitable ({unsuitable.length})</h3>
                  <ul aria-labelledby="unsuitable-venues-heading" className="safety-list">{unsuitable.map((venue) => <VenueRow key={venue.id} venue={venue} />)}</ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
