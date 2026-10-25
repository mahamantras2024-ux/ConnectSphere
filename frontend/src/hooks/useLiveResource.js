// File: Keeps internal queues and notifications current without overwriting newer writes with older reads.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

/** Most reads kept open at once when stalled reads are being retried, so a hung server cannot pile up requests. */
const MAX_PARALLEL_READS = 3;

/**
 * Reads a protected resource every five seconds and on focus; transient failures retain the last confirmed snapshot.
 * A null `path` reads nothing (e.g. while signed out), so callers can keep a stable component tree.
 * @param {string|null} path API path to read.
 * @param {string} token session token.
 * @param {{ retryAfterMs?: number }} [options] `retryAfterMs` opts in to retrying a read that has not answered in time:
 *   by default a slow read simply delays the next poll, but a caller with a freshness limit (notifications must appear
 *   within ten seconds) starts a new read instead of waiting on a stalled one. Late answers older than what is already
 *   shown are ignored, so a retry never brings back stale data.
 */
export default function useLiveResource(path, token, { retryAfterMs } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const revision = useRef(0);
  // A successful local write is newer evidence than a GET already in flight.
  const updateData = useCallback(value => { revision.current++; setData(value); setError(''); }, []);
  const refresh = useCallback(() => setVersion(value => value + 1), []);
  useEffect(() => {
    // `latestStarted` numbers each read; `latestSettled` is the newest read whose answer has been applied.
    let active = true, pending = 0, latestStarted = 0, latestSettled = 0, retryTimer;
    setData(null); setError('');
    if (!path) { setLoading(false); return undefined; }
    setLoading(true);
    /**
     * Reads once. Normally reads are serialized; a retry (`overtake`) may start while a stalled read is still open.
     * Responses from a previous identity, route or mutation revision, or older than an applied one, are discarded.
     */
    async function read(overtake = false) {
      if (overtake ? pending >= MAX_PARALLEL_READS : pending) return;
      const sequence = ++latestStarted;
      pending++;
      const started = revision.current;
      if (retryAfterMs) {
        window.clearTimeout(retryTimer);
        // If this read has not answered in time, start another rather than waiting on it.
        retryTimer = window.setTimeout(() => { if (active && latestSettled < sequence) read(true); }, retryAfterMs);
      }
      try {
        const result = await api.get(path, token);
        if (active && started === revision.current && sequence > latestSettled) { latestSettled = sequence; setData(result); setError(''); }
      } catch (failure) {
        if (active && started === revision.current && sequence > latestSettled) {
          latestSettled = sequence;
          // An authorization failure removes private records; an outage does not pretend the queue is empty.
          if ([401, 403, 404].includes(failure.status)) setData(null);
          setError(failure.message);
        }
      } finally { pending--; if (active) setLoading(false); }
    }
    // Polls and focus never overtake a read in progress; only the stalled-read retry does.
    const poll = () => read();
    poll();
    const timer = window.setInterval(poll, 5000);
    window.addEventListener('focus', poll);
    return () => { active = false; window.clearInterval(timer); window.clearTimeout(retryTimer); window.removeEventListener('focus', poll); };
  }, [path, token, version, retryAfterMs]);
  return { data, loading, error, updateData, refresh };
}
