import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';

/** Refreshes attendee status resources every five seconds; preserves last-known data and rejects obsolete reads. */
export default function useRegistrationResource(path, token) {
  const [data, storeData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const revision = useRef(0);

  /** A committed write invalidates any older read so a delayed poll cannot restore a withdrawn/waitlisted state. */
  const updateData = useCallback(value => {
    revision.current += 1;
    storeData(value);
    setError('');
  }, []);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    storeData(null); setLoading(true); setError('');
    /** Serializes reads, retaining the previous snapshot during failures instead of claiming an empty account. */
    async function refresh() {
      if (inFlight) return;
      inFlight = true;
      const startedAtRevision = revision.current;
      try {
        const result = await api.get(path, token);
        if (active && startedAtRevision === revision.current) { storeData(result); setError(''); }
      } catch (failure) {
        if (active && startedAtRevision === revision.current) {
          // Lost access must remove private records; a transient outage can retain the last confirmed snapshot.
          if ([401, 403, 404].includes(failure.status)) storeData(null);
          setError(failure.message);
        }
      } finally {
        inFlight = false;
        if (active) setLoading(false);
      }
    }
    /** Background tabs may throttle timers, so visibility and window focus request fresh data immediately. */
    function resume() { if (document.visibilityState === 'visible') refresh(); }
    refresh();
    const timer = window.setInterval(refresh, 5000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', resume);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [path, token]);

  return { data, loading, error, updateData };
}
