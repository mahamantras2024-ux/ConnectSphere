// File: Lets a Technical Support Staff member opt in or out of periodic reminders for pending technical support and
// equipment requests, and choose a reminder cadence (AC4). The UI mirrors the Venue Staff reminder control
// (VenueReminderPreferences) so the two dashboards stay consistent: the choice is saved immediately on change, with a
// status confirmation and an error that rolls the cadence back if a save fails.
import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

/** Persists the reminder choice immediately so a refresh or another device cannot silently change it. */
export default function ReminderPreference() {
  const { token } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [frequencyDays, setFrequencyDays] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api.get('/tech-support/reminder-preference', token)
      // An incomplete preference payload falls back to the disabled/daily default, matching the venue control.
      .then(data => { if (active) {
        setEnabled(data.preference?.dailyPendingReminders ?? false);
        setFrequencyDays(data.preference?.reminderFrequencyDays ?? 1);
      }})
      .catch(requestError => { if (active) setError(requestError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  // Saves the choice and, on failure, restores the previous cadence so the UI never shows an unsaved selection.
  async function savePreference(nextEnabled, nextFrequencyDays, previousFrequencyDays = frequencyDays) {
    setSaving(true); setError(''); setMessage('');
    try {
      const data = await api.put('/tech-support/reminder-preference', {
        dailyPendingReminders: nextEnabled, reminderFrequencyDays: nextFrequencyDays,
      }, token);
      setEnabled(data.preference.dailyPendingReminders);
      setFrequencyDays(data.preference.reminderFrequencyDays);
      setMessage(`${frequencyLabel(data.preference.reminderFrequencyDays)} pending-request reminders ${data.preference.dailyPendingReminders ? 'enabled' : 'disabled'}.`);
    } catch (requestError) {
      setFrequencyDays(previousFrequencyDays);
      setError(requestError.message);
    } finally { setSaving(false); }
  }

  function frequencyLabel(days) { return days === 7 ? 'Weekly' : days === 3 ? 'Every 3 days' : 'Daily'; }
  function changePreference(event) { savePreference(event.target.checked, frequencyDays); }
  function changeFrequency(event) {
    const nextFrequencyDays = Number(event.target.value);
    const previousFrequencyDays = frequencyDays;
    setFrequencyDays(nextFrequencyDays);
    // Changing cadence only persists while reminders are on; off means there is nothing to reschedule.
    if (enabled) savePreference(true, nextFrequencyDays, previousFrequencyDays);
  }

  return <section className="venue-reminder-preferences" aria-labelledby="tech-support-reminder-title">
    <h2 id="tech-support-reminder-title">Pending request reminders</h2>
    {loading ? <p role="status">Loading reminder preference…</p>
      : <>
        <label className="venue-reminder-toggle">
          <input className="venue-reminder-checkbox" type="checkbox" checked={enabled} disabled={saving} onChange={changePreference} />
          <span>Receive periodic reminders for pending technical support and equipment requests</span>
        </label>
        <div className="venue-reminder-frequency">
          <label htmlFor="tech-support-reminder-frequency">frequency</label>
          <select id="tech-support-reminder-frequency" value={frequencyDays} disabled={saving} onChange={changeFrequency}>
            <option value="1">Daily</option>
            <option value="3">Every 3 days</option>
            <option value="7">Weekly</option>
          </select>
        </div>
      </>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="error-message">{error}</p>}
  </section>;
}
