import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { isActiveHold } from './schedule';

/** Loads a venue/day snapshot, ignores obsolete responses and updates the checking clock at hold deadlines. */
export function useVenueAvailability(venueId, date, token) {
  const [result, setResult] = useState(null);
  const [version, setVersion] = useState(0);
  const [now, setNow] = useState(Date.now);
  const key = `${venueId}/${date}/${token}/${version}`;
  // Manual refresh, window focus and expiry all revalidate decisions made by other users.
  function refresh() { setNow(Date.now()); setVersion(value => value + 1); }
  useEffect(() => {
    let active = true;
    if (date) api.get(`/venues/${venueId}/schedule?date=${date}`, token).then(records => {
      if (active) { setNow(Date.now()); setResult({ key, records }); }
    }).catch(error => {
      if (active) setResult({ key, error: error.message });
    });
    return () => { active = false; };
  }, [key, venueId, date, token]);
  useEffect(() => {
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  const current = result?.key === key ? result : null;
  useEffect(() => {
    const deadlines = (current?.records ?? []).filter(record => isActiveHold(record, now)).map(record => Date.parse(record.hold_expires_at));
    if (!deadlines.length) return;
    // Cap long waits at the browser timer limit; recomputing at that point schedules the remainder safely.
    const delay = Math.max(0, Math.min(Math.min(...deadlines) - Date.now(), 2147483647));
    // A stale pending snapshot may have been approved since loading; hide it and refetch before freeing its slot.
    const timer = setTimeout(refresh, delay);
    return () => clearTimeout(timer);
  }, [current, now]);
  return { current, now, refresh };
}
