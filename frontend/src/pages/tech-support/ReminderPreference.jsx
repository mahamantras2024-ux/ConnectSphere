// File: Lets a Technical Support Staff member opt in to periodic reminders about pending technical support and
// equipment requests, and choose a daily or weekly cadence (AC4). The control loads the stored preference, lets the
// member edit it, and saves it; it mirrors OnSiteSupportSection's loading/error pattern and the "don't claim success
// on failure" rule used across the tech-support dashboard.
import { useEffect, useState } from 'react';
import { reminderPreferenceClient } from '../../api/reminderPreferenceClient';

// The cadences a member can choose. A short, fixed list keeps the selector and its tests in step.
const CADENCES = [['daily', 'Daily'], ['weekly', 'Weekly']];
// When no preference is stored yet, reminders start off at a conservative weekly cadence so the control is usable.
const DEFAULT_FREQUENCY = 'weekly';

/**
 * Reminder preference control for the Technical Support dashboard.
 * @param {{ token: string }} props the member's session token, used for the load/save calls.
 */
export default function ReminderPreference({ token }) {
  const [state, setState] = useState('loading'); // loading | ready | error
  const [error, setError] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [frequency, setFrequency] = useState(DEFAULT_FREQUENCY);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    // An active guard stops a late response (after the token changed or the control unmounted) updating stale state.
    let active = true;
    reminderPreferenceClient.get(token).then((pref) => {
      if (!active) return;
      // A missing preference (null) means "none stored yet"; fall back to the disabled/weekly default.
      setEnabled(Boolean(pref?.enabled));
      setFrequency(pref?.frequency === 'daily' ? 'daily' : DEFAULT_FREQUENCY);
      setState('ready');
    }).catch((err) => {
      if (!active) return;
      setError(err.message);
      setState('error');
    });
    return () => { active = false; };
  }, [token]);

  // Persists the current choice. On failure it surfaces the error and keeps the member's edits so they can retry; it
  // never shows "Preference saved" unless the save actually resolved.
  async function save() {
    setSaving(true);
    setSaveError('');
    setSaved(false);
    try {
      await reminderPreferenceClient.save({ enabled, frequency }, token);
      setSaved(true);
    } catch (err) {
      setSaveError(err.message || 'Unable to save reminder preference.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="reminder-preference" aria-labelledby="reminder-preference-title">
      <h2 id="reminder-preference-title">Periodic reminders</h2>
      <p className="onsite-support-description">Get periodic reminders about pending technical support and equipment requests.</p>
      {state === 'loading' && <p role="status">Loading reminder preference…</p>}
      {state === 'error' && <p role="alert" className="error-message">{error}</p>}
      {state === 'ready' && (
        <div className="reminder-preference-controls">
          <label>
            <input
              type="checkbox"
              checked={enabled}
              // Editing clears the last "saved" confirmation so stale success text never sits over a fresh change.
              onChange={(e) => { setSaved(false); setEnabled(e.target.checked); }}
            />
            Periodic reminders
          </label>
          <label>
            Reminder cadence
            <select
              aria-label="Reminder cadence"
              value={frequency}
              onChange={(e) => { setSaved(false); setFrequency(e.target.value); }}
            >
              {CADENCES.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </select>
          </label>
          {saveError && <p role="alert" className="error-message">{saveError}</p>}
          <button type="button" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : saved ? 'Preference saved' : 'Save preference'}
          </button>
        </div>
      )}
    </section>
  );
}
