// File: Keeps internal queues and notifications current without overlapping requests or overwriting newer writes.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

/**
 * Reads a protected resource every five seconds and on focus; transient failures retain the last confirmed snapshot.
 * A null `path` reads nothing (e.g. while signed out), so callers can keep a stable component tree.
 */
export default function useLiveResource(path, token) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const revision = useRef(0);
  // A successful local write is newer evidence than a GET already in flight.
  const updateData = useCallback(value => { revision.current++; setData(value); setError(''); }, []);
  const refresh = useCallback(() => setVersion(value => value + 1), []);
  useEffect(() => {
    let active = true, inFlight = false;
    setData(null); setError('');
    if (!path) { setLoading(false); return undefined; }
    setLoading(true);
    /** Serializes reads and discards responses from a previous identity, route or mutation revision. */
    async function read() {
      if (inFlight) return;
      inFlight = true;
      const started = revision.current;
      try {
        const result = await api.get(path, token);
        if (active && started === revision.current) { setData(result); setError(''); }
      } catch (failure) {
        if (active && started === revision.current) {
          // An authorization failure removes private records; an outage does not pretend the queue is empty.
          if ([401, 403, 404].includes(failure.status)) setData(null);
          setError(failure.message);
        }
      } finally { inFlight = false; if (active) setLoading(false); }
    }
    read();
    const timer = window.setInterval(read, 5000);
    window.addEventListener('focus', read);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', read); };
  }, [path, token, version]);
  return { data, loading, error, updateData, refresh };
}
