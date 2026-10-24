// File: Lets Venue Staff explicitly opt in or out and choose a pending-request reminder cadence.
import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

/** Persists the reminder choice immediately so a refresh or another device cannot silently change it. */
export default function VenueReminderPreferences() {
  const { token } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [frequencyDays, setFrequencyDays] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api.get('/venues/notification-preferences', token)
      // Older sessions can briefly return an incomplete preference payload during rollout; disabled remains the safe default.
      .then(data => { if (active) {
        setEnabled(data.preference?.dailyPendingReminders ?? false);
        setFrequencyDays(data.preference?.reminderFrequencyDays ?? 1);
      }})
      .catch(requestError => { if (active) setError(requestError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  async function savePreference(nextEnabled, nextFrequencyDays, previousFrequencyDays = frequencyDays) {
    setSaving(true); setError(''); setMessage('');
    try {
      const data = await api.put('/venues/notification-preferences', {
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
    if (enabled) savePreference(true, nextFrequencyDays, previousFrequencyDays);
  }

  return <section className="venue-reminder-preferences" aria-labelledby="venue-reminder-title">
    <h2 id="venue-reminder-title">Pending request reminders</h2>
    {loading ? <p role="status">Loading reminder preference…</p>
      : <>
        <label><input type="checkbox" checked={enabled} disabled={saving} onChange={changePreference} /> Receive periodic reminders for pending venue requests</label>
        <label htmlFor="venue-reminder-frequency">Frequency</label>
        <select id="venue-reminder-frequency" value={frequencyDays} disabled={saving} onChange={changeFrequency}>
          <option value="1">Daily</option>
          <option value="3">Every 3 days</option>
          <option value="7">Weekly</option>
        </select>
      </>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="error-message">{error}</p>}
  </section>;
}
