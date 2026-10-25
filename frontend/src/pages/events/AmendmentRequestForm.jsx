// File: The organiser's amendment request for a submitted event (Request All Post-Submission Amendments Through the
// Coordinator, AC2). One form proposes changes to any recorded information plus a required explanation; nothing on the
// event changes until the assigned Event Coordinator approves (AC3).
import { useState } from 'react';
import { api } from '../../api/client';
import ActionConfirmation from '../../components/ActionConfirmation';
import EventAttachments from '../../components/EventAttachments';
import EquipmentRequirementsFields from './EquipmentRequirementsFields';
import EventFieldInput from './EventFieldInput';
import { changedValues, toEditValues } from './eventEditValues';
import { equipmentError, equipmentFromEvent, equipmentPayload } from './equipmentRequirements';

/** Longest explanation the server accepts. */
export const EXPLANATION_LIMIT = 2000;

// The recorded fields, grouped as on the event page and labelled the same way.
const GROUPS = [
  ['Overview', [['name', 'Event name'], ['purpose', 'Purpose'], ['description', 'Description'], ['eventType', 'Event type']]],
  ['Logistics', [['proposedDate', 'Date'], ['proposedStartTime', 'Start time'], ['proposedEndTime', 'End time'],
    ['expectedAttendance', 'Expected attendance'], ['roomLayoutPreference', 'Layout requirements']]],
  ['Requirements', [['programmeDetails', 'Programme'], ['accessibilityText', 'Accessibility needs (one per line)'],
    ['specialArrangements', 'Special arrangements']]],
  ['Registration', [['registrationRequired', 'Registration required'], ['registrationCapacity', 'Registration capacity']]],
];

/**
 * Builds the API changes from the form: edited fields, the whole equipment block if any part of it changed (the server
 * validates it as a unit), and replaced attachments.
 */
function proposedChanges(values, initial, equipment, initialEquipment, files) {
  const changes = changedValues(values, initial);
  const nextEquipment = equipmentPayload(equipment);
  if (JSON.stringify(nextEquipment) !== JSON.stringify(equipmentPayload(initialEquipment))) Object.assign(changes, nextEquipment);
  if (Object.keys(files).length) changes.attachments = files;
  return changes;
}

/**
 * Amendment request form, prefilled with the event's accepted information.
 * @param {{ event: object, token: string, onSubmitted: (message: string) => void, onCancel: () => void }} props
 *   `onSubmitted` receives the server's confirmation once the request is stored.
 */
export default function AmendmentRequestForm({ event, token, onSubmitted, onCancel }) {
  const [initial] = useState(() => toEditValues(event));
  const [values, setValues] = useState(initial);
  const [initialEquipment] = useState(() => equipmentFromEvent(event));
  const [equipment, setEquipment] = useState(initialEquipment);
  const [files, setFiles] = useState({});
  const [readingFiles, setReadingFiles] = useState(0);
  const [explanation, setExplanation] = useState('');
  const [problem, setProblem] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const changes = proposedChanges(values, initial, equipment, initialEquipment, files);

  // Checks what the server would refuse before asking the organiser to confirm, so mistakes are shown in the form.
  function review(submitEvent) {
    submitEvent.preventDefault();
    const issue = !Object.keys(changes).length ? 'Change at least one detail before requesting an amendment.'
      : !explanation.trim() ? 'Explain why you need these changes.'
        : equipmentError(equipment);
    setProblem(issue);
    if (!issue) { setError(''); setReviewing(true); }
  }

  // Sends the request after confirmation; the form keeps every input if the server refuses it.
  async function submit() {
    setSaving(true); setError('');
    try {
      const data = await api.post(`/events/${event.id}/amendment-requests`, { changes, explanation: explanation.trim() }, token);
      setSuccess(data.message);
    } catch (err) {
      setError(err.message || 'Unable to submit the amendment request.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="ed-card amendment-form" aria-labelledby="amendment-form-title" onSubmit={review}>
      <h2 id="amendment-form-title" className="ed-card-title">Request an amendment</h2>
      <p className="ed-muted">Change the details you need, then explain why. Your Event Coordinator reviews the request; the current details stay in effect until then.</p>
      {GROUPS.map(([group, fields]) => (
        <fieldset key={group} className="amendment-group">
          <legend>{group}</legend>
          {fields.map(([field, label]) => (
            <div key={field} className="amendment-field">
              {field !== 'registrationRequired' && <label htmlFor={`amend-${field}`}>{label}</label>}
              <EventFieldInput field={field} label={label} id={`amend-${field}`} value={values[field]} disabled={saving}
                onChange={(next) => setValues((current) => ({ ...current, [field]: next }))} />
            </div>
          ))}
        </fieldset>
      ))}
      <fieldset className="amendment-group">
        <legend>Equipment &amp; technical support</legend>
        <EquipmentRequirementsFields value={equipment} onChange={setEquipment} disabled={saving} />
        <div className="amendment-field">
          <label htmlFor="amend-equipmentNotes">Other equipment notes</label>
          <EventFieldInput field="equipmentNotes" label="Other equipment notes" id="amend-equipmentNotes" value={values.equipmentNotes}
            disabled={saving} onChange={(next) => setValues((current) => ({ ...current, equipmentNotes: next }))} />
        </div>
      </fieldset>
      <fieldset className="amendment-group">
        <legend>Supporting documents</legend>
        <EventAttachments value={{ ...(event.attachments || {}), ...files }} onBusy={(delta) => setReadingFiles((count) => count + delta)}
          onChange={(field, file) => setFiles((current) => ({ ...current, [field]: file }))} />
      </fieldset>
      <div className="amendment-field">
        <label htmlFor="amend-explanation">Explanation (required)</label>
        <textarea id="amend-explanation" className="ed-input" rows={4} maxLength={EXPLANATION_LIMIT} value={explanation}
          aria-describedby="amend-explanation-count" disabled={saving} onChange={(changeEvent) => setExplanation(changeEvent.target.value)} />
        <span id="amend-explanation-count" className="ed-muted">{explanation.length} / {EXPLANATION_LIMIT} characters</span>
      </div>
      {problem && <p role="alert" className="ed-notice ed-notice--bad">{problem}</p>}
      <div className="ed-editor-actions">
        <button type="submit" className="button-primary" disabled={saving || readingFiles > 0}>Submit amendment request</button>
        <button type="button" className="button-secondary" disabled={saving} onClick={onCancel}>Cancel</button>
      </div>
      {reviewing && <ActionConfirmation action="submit this amendment request" busy={saving} error={error} success={success} onConfirm={submit}
        onClose={() => { setReviewing(false); if (success) onSubmitted(success); }} />}
    </form>
  );
}
