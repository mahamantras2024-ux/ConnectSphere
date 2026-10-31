// File: The assigned Event Coordinator records a clarification that took place offline - by phone, email or in person -
// against the event (Record Offline Clarifications and Apply Agreed Amendments AC1), optionally resolving it at once (AC2).
import { useState } from 'react';
import { api } from '../../api/client';
import { CLARIFICATION_LABELS } from './clarificationLabels';

/**
 * @param {{ eventId: number, token: string, onRecorded: (clarification: object, message: string) => void }} props
 *   `onRecorded` receives the stored record so the history shows it straight away.
 */
export default function OfflineClarificationForm({ eventId, token, onRecorded }) {
  // Opened on request, so the Activity tab is not crowded and its two topic lists never appear together by default.
  const [open, setOpen] = useState(false);
  const [topics, setTopics] = useState([]);
  const [question, setQuestion] = useState('');
  const [response, setResponse] = useState('');
  const [outcome, setOutcome] = useState('');
  const [comments, setComments] = useState('');
  const [resolve, setResolve] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Mirrors the server's rule so the coordinator sees what is missing before sending.
  const missing = !topics.length ? 'Select what the clarification was about.'
    : !question.trim() ? 'Enter the clarification question.'
      : !response.trim() && !(resolve && outcome.trim()) ? 'Enter the organiser\'s response, or mark it resolved and record the outcome.' : '';

  async function record(submitEvent) {
    submitEvent.preventDefault();
    if (missing) { setError(missing); return; }
    setSaving(true); setError('');
    try {
      const data = await api.post(`/events/${eventId}/clarifications/offline`, { informationNeeded: topics, message: question, response,
        outcome, comments, resolve }, token);
      onRecorded(data.clarificationRequest, data.message);
      setTopics([]); setQuestion(''); setResponse(''); setOutcome(''); setComments(''); setResolve(false); setOpen(false);
    } catch (err) {
      setError(err.message || 'Unable to record the clarification.');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return <button type="button" className="button-secondary ed-justify-start" onClick={() => setOpen(true)}>Record an offline clarification</button>;
  }
  return (
    <form className="ed-clar-form" aria-labelledby="offline-clarification-title" onSubmit={record}>
      <h3 id="offline-clarification-title">Record an offline clarification</h3>
      <p className="ed-muted">For a clarification discussed outside ConnectSphere, record the question, the organiser&apos;s answer or the agreed outcome, and any comments.</p>
      <fieldset className="ed-check-grid"><legend>What was the clarification about?</legend>
        {Object.entries(CLARIFICATION_LABELS).map(([field, label]) => (
          <label key={field} className="ed-check-tile">
            <input type="checkbox" aria-label={`Offline clarification about ${label}`} checked={topics.includes(field)} disabled={saving}
              onChange={(changeEvent) => setTopics((current) => (changeEvent.target.checked ? [...current, field] : current.filter((item) => item !== field)))} />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
      <label className="ed-label" htmlFor="offline-question">Clarification question
        <textarea className="ed-input" id="offline-question" rows={2} maxLength={4000} value={question} disabled={saving} onChange={(changeEvent) => setQuestion(changeEvent.target.value)} />
      </label>
      <label className="ed-label" htmlFor="offline-response">Organiser&apos;s response
        <textarea className="ed-input" id="offline-response" rows={2} maxLength={10000} value={response} disabled={saving} onChange={(changeEvent) => setResponse(changeEvent.target.value)} />
      </label>
      <label className="ed-label" htmlFor="offline-outcome">Outcome
        <textarea className="ed-input" id="offline-outcome" rows={2} maxLength={10000} value={outcome} disabled={saving} onChange={(changeEvent) => setOutcome(changeEvent.target.value)} />
      </label>
      <label className="ed-label" htmlFor="offline-comments">Comments
        <textarea className="ed-input" id="offline-comments" rows={2} maxLength={4000} value={comments} disabled={saving} onChange={(changeEvent) => setComments(changeEvent.target.value)} />
      </label>
      <label className="ed-check"><input type="checkbox" checked={resolve} disabled={saving} onChange={(changeEvent) => setResolve(changeEvent.target.checked)} />
        <span>Mark resolved now</span></label>
      {error && <p role="alert" className="ed-notice ed-notice--bad">{error}</p>}
      <div className="ed-editor-actions">
        <button className="button-primary" type="submit" disabled={saving}>{saving ? 'Recording…' : 'Record offline clarification'}</button>
        <button className="button-secondary" type="button" disabled={saving} onClick={() => { setOpen(false); setError(''); }}>Cancel</button>
      </div>
    </form>
  );
}
