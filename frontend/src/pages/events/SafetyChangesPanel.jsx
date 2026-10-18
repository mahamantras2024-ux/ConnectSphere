// File: Shows the planning stages a Safety Officer sent an event back to, and lets the coordinator mark them complete.
import { useState } from 'react';
import { api } from '../../api/client';
import { STAGE_LABELS } from '../safety/SafetyEventFacts';

/**
 * Operational Feasibility Check AC3/AC4. The organiser sees which stages need changes and the Safety Officer's notes.
 * The assigned coordinator also gets "Mark changes complete" for each stage, available only once the server reports
 * that stage's arrangement is in place again (e.g. the venue re-confirmed). When none is left open, the event goes back
 * to the Safety Officer for another check.
 * @param {{ eventId: number, changes: { open: { area: string, blocked?: { message: string } | null }[], notes: string | null },
 *   coordinator: boolean, token: string, onChanged: () => void }} props `onChanged` re-reads the review after a change.
 */
export default function SafetyChangesPanel({ eventId, changes, coordinator, token, onChanged }) {
  const [saving, setSaving] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  // Marks one stage complete; buttons are disabled while saving so one click sends one request.
  async function complete(area) {
    setSaving(area); setError(''); setStatus('');
    try {
      const data = await api.post(`/events/${eventId}/safety-changes/resolve`, { area }, token);
      setStatus(data.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(null);
      // Re-read in both cases: success removes the stage, and a refusal may mean the arrangement changed elsewhere.
      onChanged();
    }
  }

  return (
    <div className="grid gap-2" role="group" aria-labelledby={`safety-changes-${eventId}`}>
      <h3 id={`safety-changes-${eventId}`} className="font-semibold">Safety changes requested</h3>
      <p className="text-sm text-slate-600">The Safety Officer sent this event back for changes. It needs another safety check before it can proceed.</p>
      {changes.notes && <p className="text-sm">Safety Officer notes: {changes.notes}</p>}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert" className="error-message">{error}</p>}
      <ul className="decision-checklist" aria-label="Stages needing changes">
        {changes.open.map(({ area, blocked }) => (
          <li key={area} className="decision-unmet">
            <strong>{STAGE_LABELS[area]}</strong>
            {coordinator && (
              <>
                {blocked && <span>{blocked.message}</span>}
                <button type="button" className="button-secondary" disabled={saving !== null || Boolean(blocked)}
                  onClick={() => complete(area)}>{saving === area ? 'Saving…' : `Mark ${STAGE_LABELS[area].toLowerCase()} complete`}</button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
