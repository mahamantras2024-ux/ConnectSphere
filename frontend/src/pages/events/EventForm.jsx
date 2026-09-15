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
  });
  const [error, setError] = useState('');

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function submit(isDraft) {
    setError('');
    try {
      const payload = {
        ...form,
        expectedAttendance: form.expectedAttendance ? Number(form.expectedAttendance) : null,
        registrationCapacity: form.registrationCapacity ? Number(form.registrationCapacity) : null,
        isDraft,
      };
      const data = await api.post('/events', payload, token);
      navigate(`/events/${data.event.id}`);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="card">
      <h1>New event request</h1>
      <form onSubmit={(e) => e.preventDefault()}>
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
        <label>
          <input type="checkbox" checked={form.registrationRequired} onChange={(e) => update('registrationRequired', e.target.checked)} style={{ width: 'auto', marginRight: '0.5rem' }} />
          Requires attendee registration
        </label>
        {form.registrationRequired && (
          <label>Registration capacity
            <input type="number" min="0" value={form.registrationCapacity} onChange={(e) => update('registrationCapacity', e.target.value)} />
          </label>
        )}

        {error && <p className="error-text">{error}</p>}

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="button" onClick={() => submit(true)}>Save as draft</button>
          <button type="button" onClick={() => submit(false)}>Submit</button>
        </div>
      </form>

      <div className="todo-note">
        TODO: accessibility requirements and equipment requirements are in the DB
        schema/API but not yet wired into this form — add fields as those stories
        are refined (they'll likely need richer widgets than a text input).
      </div>
    </div>
  );
}
