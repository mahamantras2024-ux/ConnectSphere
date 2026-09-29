import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';

// Covers: Event Request Creation + Draft Event Requests.
export default function EventForm() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '', purpose: '', description: '', eventType: '', proposedDate: '',
    proposedStartTime: '', proposedEndTime: '', expectedAttendance: '',
    roomLayoutPreference: '', registrationRequired: false, registrationCapacity: '',
    programmeDetails: '', specialArrangements: '', equipmentNotes: '', accessibilityText: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function submit(isDraft) {
    setError('');
    if (busy) return;
    setBusy(true);
    try {
      const payload = {
        ...form,
        accessibilityRequirements: form.accessibilityText.split('\n').map((item) => item.trim()).filter(Boolean),
        expectedAttendance: form.expectedAttendance ? Number(form.expectedAttendance) : null,
        registrationCapacity: form.registrationCapacity ? Number(form.registrationCapacity) : null,
        isDraft,
      };
      const data = await api.post('/events', payload, token);
      navigate(`/organizer/events/${data.event.id}`, { state: { message: data.message } });
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <h1>New event request</h1>
      <form onSubmit={(e) => { e.preventDefault(); submit(e.nativeEvent.submitter?.value === 'draft'); }}>
        <label>Event name
          <input value={form.name} onChange={(e) => update('name', e.target.value)} required />
        </label>
        <label>Purpose
          <input value={form.purpose} onChange={(e) => update('purpose', e.target.value)} />
        </label>
        <label>Description
          <textarea value={form.description} onChange={(e) => update('description', e.target.value)} rows={3} />
        </label>
        <label>Event type
          <input value={form.eventType} onChange={(e) => update('eventType', e.target.value)} placeholder="conference, seminar, workshop…" />
        </label>
        <label>Proposed date
          <input type="date" value={form.proposedDate} onChange={(e) => update('proposedDate', e.target.value)} />
        </label>
        <label>Start time
          <input type="time" value={form.proposedStartTime} onChange={(e) => update('proposedStartTime', e.target.value)} />
        </label>
        <label>End time
          <input type="time" value={form.proposedEndTime} onChange={(e) => update('proposedEndTime', e.target.value)} />
        </label>
        <label>Expected attendance
          <input type="number" min="0" value={form.expectedAttendance} onChange={(e) => update('expectedAttendance', e.target.value)} />
        </label>
        <label>Room layout preference
          <input value={form.roomLayoutPreference} onChange={(e) => update('roomLayoutPreference', e.target.value)} placeholder="theatre, classroom, banquet…" />
        </label>
        <label>Programme<textarea maxLength={10000} value={form.programmeDetails} onChange={(e) => update('programmeDetails', e.target.value)} rows={4} /></label>
        <label>Accessibility needs (one per line)<textarea maxLength={10000} value={form.accessibilityText} onChange={(e) => update('accessibilityText', e.target.value)} rows={3} /></label>
        <label>Equipment requirements<textarea maxLength={10000} value={form.equipmentNotes} onChange={(e) => update('equipmentNotes', e.target.value)} rows={3} /></label>
        <label>Special arrangements<textarea maxLength={10000} value={form.specialArrangements} onChange={(e) => update('specialArrangements', e.target.value)} rows={3} /></label>
        <label>
          <input type="checkbox" checked={form.registrationRequired} onChange={(e) => update('registrationRequired', e.target.checked)} style={{ width: 'auto', marginRight: '0.5rem' }} />
          Requires attendee registration
        </label>
        {form.registrationRequired && (
          <label>Registration capacity
            <input type="number" min="0" value={form.registrationCapacity} onChange={(e) => update('registrationCapacity', e.target.value)} />
          </label>
        )}

        {error && <p role="alert" className="error-text">{error}</p>}

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="submit" value="draft" disabled={busy}>Save as draft</button>
          <button type="submit" value="submitted" disabled={busy}>{busy ? 'Saving...' : 'Submit'}</button>
        </div>
      </form>


    </div>
  );
}
