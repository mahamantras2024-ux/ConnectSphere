// File: Collects organiser event requirements and saves a draft or submitted request through the API.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PageIntro from '../../components/PageIntro';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../api/client';

// Covers: Event Request Creation + Draft Event Requests.
// Renders event requirement inputs and draft/submission actions for an organiser.
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

  // Updates one controlled form field while retaining the other field values.
  function update(field, value) {
    setForm((f) => (// Builds updated form/error state from the previous state without discarding other fields.

      // Handles this operation using the surrounding screen or request state.
      { ...f, [field]: value }));
  }

  // Builds the event payload, saves a draft/submission, and navigates to its saved detail page.
  async function submit(isDraft) {
    setError('');
    if (busy) return;
    setBusy(true);
    try {
      const payload = {
        ...form,
        accessibilityRequirements: form.accessibilityText.split('\n').map((item) => // Trims each text entry before building the submitted field list.

      // Converts each record into its displayed or submitted representation.
      item.trim()).filter(Boolean),
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
      <Link className="button-link button-secondary detail-back" to="/organizer/events">← Back to My Events</Link><PageIntro title="New event request" eyebrow="Start something memorable" description="Share your plans, save a draft, or send a request to your coordinator." />
      <form className="event-form event-request-form" onSubmit={(e) => {
        // Prevents browser form submission and chooses draft or submitted event saving.
         e.preventDefault(); submit(e.nativeEvent.submitter?.value === 'draft'); }}>
        <label>Event name
          <input value={form.name} onChange={(e) => // Copies the selected input value into the name form field.

      // Handles this control action and updates the screen state.
      update('name', e.target.value)} required />
        </label>
        <label>Purpose
          <input value={form.purpose} onChange={(e) => // Copies the selected input value into the purpose form field.

      // Handles this control action and updates the screen state.
      update('purpose', e.target.value)} />
        </label>
        <label>Description
          <textarea value={form.description} onChange={(e) => // Copies the selected input value into the description form field.

      // Handles this control action and updates the screen state.
      update('description', e.target.value)} rows={3} />
        </label>
        <label>Event type
          <input value={form.eventType} onChange={(e) => // Copies the selected input value into the eventType form field.

      // Handles this control action and updates the screen state.
      update('eventType', e.target.value)} placeholder="conference, seminar, workshop…" />
        </label>
        <label>Proposed date
          <input type="date" value={form.proposedDate} onChange={(e) => // Copies the selected input value into the proposedDate form field.

      // Handles this control action and updates the screen state.
      update('proposedDate', e.target.value)} />
        </label>
        <label>Start time
          <input type="time" value={form.proposedStartTime} onChange={(e) => // Copies the selected input value into the proposedStartTime form field.

      // Handles this control action and updates the screen state.
      update('proposedStartTime', e.target.value)} />
        </label>
        <label>End time
          <input type="time" value={form.proposedEndTime} onChange={(e) => // Copies the selected input value into the proposedEndTime form field.

      // Handles this control action and updates the screen state.
      update('proposedEndTime', e.target.value)} />
        </label>
        <label>Expected attendance
          <input type="number" min="0" value={form.expectedAttendance} onChange={(e) => // Copies the selected input value into the expectedAttendance form field.

      // Handles this control action and updates the screen state.
      update('expectedAttendance', e.target.value)} />
        </label>
        <label>Room layout preference
          <input value={form.roomLayoutPreference} onChange={(e) => // Copies the selected input value into the roomLayoutPreference form field.

      // Handles this control action and updates the screen state.
      update('roomLayoutPreference', e.target.value)} placeholder="theatre, classroom, banquet…" />
        </label>
        <label>Programme<textarea maxLength={10000} value={form.programmeDetails} onChange={(e) => // Copies the selected input value into the programmeDetails form field.

      // Handles this control action and updates the screen state.
      update('programmeDetails', e.target.value)} rows={4} /></label>
        <label>Accessibility needs (one per line)<textarea maxLength={10000} value={form.accessibilityText} onChange={(e) => // Copies the selected input value into the accessibilityText form field.

      // Handles this control action and updates the screen state.
      update('accessibilityText', e.target.value)} rows={3} /></label>
        <label>Equipment requirements<textarea maxLength={10000} value={form.equipmentNotes} onChange={(e) => // Copies the selected input value into the equipmentNotes form field.

      // Handles this control action and updates the screen state.
      update('equipmentNotes', e.target.value)} rows={3} /></label>
        <label>Special arrangements<textarea maxLength={10000} value={form.specialArrangements} onChange={(e) => // Copies the selected input value into the specialArrangements form field.

      // Handles this control action and updates the screen state.
      update('specialArrangements', e.target.value)} rows={3} /></label>
        <label>
          <input type="checkbox" checked={form.registrationRequired} onChange={(e) => // Copies the selected input value into the registrationRequired form field.

      // Handles this control action and updates the screen state.
      update('registrationRequired', e.target.checked)} style={{ width: 'auto', marginRight: '0.5rem' }} />
          Requires attendee registration
        </label>
        {form.registrationRequired && (
          <label>Registration capacity
            <input type="number" min="0" value={form.registrationCapacity} onChange={(e) => // Copies the selected input value into the registrationCapacity form field.

      // Handles this control action and updates the screen state.
      update('registrationCapacity', e.target.value)} />
          </label>
        )}

        {error && <p role="alert" className="error-text">{error}</p>}

        <div className="form-actions">
          <button className="button-secondary" type="submit" value="draft" disabled={busy}>Save as draft</button>
          <button type="submit" value="submitted" disabled={busy}>{busy ? 'Saving...' : 'Submit'}</button>
        </div>
      </form>


    </div>
  );
}
