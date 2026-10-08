// File: Collects organiser event requirements and saves a draft or submitted request through the API.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import EquipmentRequirementsFields from './EquipmentRequirementsFields';
import { emptyEquipment, equipmentError, equipmentPayload } from './equipmentRequirements';
import ActionConfirmation from '../../components/ActionConfirmation';
import EventAttachments from '../../components/EventAttachments';
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
  const [equipment, setEquipment] = useState(emptyEquipment);
  const [attachments, setAttachments] = useState({});
  const [reading, setReading] = useState(0);
  const [pending, setPending] = useState(null);
  const [saved, setSaved] = useState(null);
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
    setBusy(true);
    try {
      const payload = {
        ...form, ...equipmentPayload(equipment), attachments,
        accessibilityRequirements: form.accessibilityText.split('\n').map((item) => // Trims each text entry before building the submitted field list.

      // Converts each record into its displayed or submitted representation.
      item.trim()).filter(Boolean),
        expectedAttendance: form.expectedAttendance ? Number(form.expectedAttendance) : null,
        registrationCapacity: form.registrationCapacity ? Number(form.registrationCapacity) : null,
        isDraft,
      };
      const data = await api.post('/events', payload, token);
      setSaved(data);
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <Link className="button-link button-secondary detail-back" to="/organizer/events">← Back to My Events</Link><PageIntro title="New event request" eyebrow="Start something memorable" description="Share your plans, save a draft, or submit a request to the Coordinator Lead." />
      <form className="event-form event-request-form" onSubmit={(e) => {
        // Submission uses native required-field validation; the separate draft button allows incomplete data.
        e.preventDefault(); const problem = equipmentError(equipment); setError(problem); if (!problem) setPending(false); }}>
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
          <input required type="date" value={form.proposedDate} onChange={(e) => // Copies the selected input value into the proposedDate form field.

      // Handles this control action and updates the screen state.
      update('proposedDate', e.target.value)} />
        </label>
        <label>Start time
          <input required type="time" value={form.proposedStartTime} onChange={(e) => // Copies the selected input value into the proposedStartTime form field.

      // Handles this control action and updates the screen state.
      update('proposedStartTime', e.target.value)} />
        </label>
        <label>End time
          <input required type="time" value={form.proposedEndTime} onChange={(e) => // Copies the selected input value into the proposedEndTime form field.

      // Handles this control action and updates the screen state.
      update('proposedEndTime', e.target.value)} />
        </label>
        <label>Expected attendance
          <input required type="number" min="1" value={form.expectedAttendance} onChange={(e) => // Copies the selected input value into the expectedAttendance form field.

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
        <EquipmentRequirementsFields value={equipment} onChange={setEquipment} disabled={busy}>
          <label>Other equipment notes<textarea maxLength={10000} value={form.equipmentNotes} onChange={(e) => update('equipmentNotes', e.target.value)} rows={3} /></label>
        </EquipmentRequirementsFields>
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



        {error && pending===null && <p role="alert" className="error-text">{error}</p>}
        <EventAttachments value={attachments} onChange={(field,file)=>setAttachments(current=>({...current,[field]:file}))} onBusy={delta=>setReading(current=>current+delta)}/>
        <div className="form-actions">
          <button className="button-secondary" type="button" value="draft" onClick={() => { const problem = equipmentError(equipment); setError(problem); if (!problem) setPending(true); }} disabled={busy || reading>0 || pending!==null}>Save as draft</button>
          <button type="submit" value="submitted" disabled={busy || reading>0 || pending!==null}>{busy ? 'Saving...' : 'Submit'}</button>
        </div>
      </form>
      {pending!==null&&<ActionConfirmation action={pending?'save this draft':'submit this event request'} busy={busy} error={error} success={saved?.message} onConfirm={()=>submit(pending)} onClose={()=>{if(saved)navigate(`/organizer/events/${saved.event.id}`,{state:{message:saved.message}});else setPending(null);}}/>}


    </div>
  );
}
