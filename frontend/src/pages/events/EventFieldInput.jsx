// File: One editable event field's input, shared by the draft editor and the amendment request form so a field is
// always entered the same way (dates, times, numbers, multi-line text and the registration checkbox).

// Fields whose answers can run to several lines (accessibility needs are entered one per line).
const MULTILINE = ['description', 'programmeDetails', 'accessibilityText', 'equipmentNotes', 'specialArrangements'];

/**
 * Renders the input for one editor value.
 * @param {{ field: string, label: string, value: *, disabled?: boolean, onChange: (value: *) => void,
 *   ariaLabel?: string, id?: string }} props `ariaLabel` names the input when no visible label is attached; `id`
 *   lets a visible `<label htmlFor>` name it instead.
 */
export default function EventFieldInput({ field, label, value, disabled = false, onChange, ariaLabel, id }) {
  if (field === 'registrationRequired') {
    return (
      <label className="ed-check">
        <span>Registration required?</span>
        <input className="registration-required-checkbox" type="checkbox" id={id} aria-label={ariaLabel ?? label}
          checked={Boolean(value)} disabled={disabled} onChange={(changeEvent) => onChange(changeEvent.target.checked)} />
      </label>
    );
  }
  if (MULTILINE.includes(field)) {
    return (
      <textarea className="ed-input" id={id} aria-label={ariaLabel} value={value} disabled={disabled} rows={3}
        onChange={(changeEvent) => onChange(changeEvent.target.value)} />
    );
  }
  const type = field === 'proposedDate' ? 'date' : ['proposedStartTime', 'proposedEndTime'].includes(field) ? 'time'
    : ['expectedAttendance', 'registrationCapacity'].includes(field) ? 'number'
      // Attendee deadlines are a Singapore date and time.
      : ['registrationDeadline', 'withdrawalDeadline'].includes(field) ? 'datetime-local' : 'text';
  return (
    <input className="ed-input" id={id} aria-label={ariaLabel} type={type} min={type === 'number' ? 0 : undefined}
      value={value} disabled={disabled} onChange={(changeEvent) => onChange(changeEvent.target.value)} />
  );
}
