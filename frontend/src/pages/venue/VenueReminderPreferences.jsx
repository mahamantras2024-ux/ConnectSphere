// File: Lets Venue Staff explicitly opt in or out of the agreed daily pending-request reminder.
import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

/** Persists the reminder choice immediately so a refresh or another device cannot silently change it. */
export default function VenueReminderPreferences() {
  const { token } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api.get('/venues/notification-preferences', token)
      // Older sessions can briefly return an incomplete preference payload during rollout; disabled remains the safe default.
      .then(data => { if (active) setEnabled(data.preference?.dailyPendingReminders ?? false); })
      .catch(requestError => { if (active) setError(requestError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  async function changePreference(event) {
    const nextEnabled = event.target.checked;
    setSaving(true); setError(''); setMessage('');
    try {
      const data = await api.put('/venues/notification-preferences', { dailyPendingReminders: nextEnabled }, token);
      setEnabled(data.preference.dailyPendingReminders);
      setMessage(`Daily pending-request reminders ${data.preference.dailyPendingReminders ? 'enabled' : 'disabled'}.`);
    } catch (requestError) {
      // Keep the last persisted value when saving fails, rather than presenting an opt-in that was never stored.
      event.target.checked = enabled;
      setError(requestError.message);
    } finally { setSaving(false); }
  }

  return <section className="venue-reminder-preferences" aria-labelledby="venue-reminder-title">
    <h2 id="venue-reminder-title">Pending request reminders</h2>
    {loading ? <p role="status">Loading reminder preference…</p>
      : <label><input type="checkbox" checked={enabled} disabled={saving} onChange={changePreference} /> Receive daily reminders for pending venue requests</label>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="error-message">{error}</p>}
  </section>;
}
