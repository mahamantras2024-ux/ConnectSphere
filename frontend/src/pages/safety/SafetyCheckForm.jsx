import { STAGE_LABELS } from './SafetyEventFacts';

const OUTCOMES = [['approved', 'Approve'], ['rejected', 'Reject'], ['changes_requested', 'Request changes']];

/** A technical stage can be reopened only when the event requested technical arrangements. */
function needsTechnical(event) {
  return Boolean(event.equipment_items?.length || event.technical_support_required || event.video_conferencing_required || event.equipment_notes?.trim());
}

/** Presents one controlled review draft; the parent owns validation, persistence and the authoritative queue refresh. */
export default function SafetyCheckForm({ event, form, saving, onFieldChange, onStageToggle, onSubmit }) {
  const needsNotes = form.outcome === 'changes_requested' || form.outcome === 'rejected';
  return <form className="grid gap-2" onSubmit={submitEvent => onSubmit(submitEvent, event)}>
    <fieldset className="flex flex-wrap gap-4" disabled={saving === event.id}>
      <legend className="mb-1 font-medium">Outcome for {event.name}</legend>
      {OUTCOMES.map(([value, label]) => <label key={value} className="flex items-center gap-2">
        <input className="!w-4" type="radio" name={`safety-outcome-${event.id}`} value={value} checked={form.outcome === value}
          onChange={() => onFieldChange(event.id, 'outcome', value)} />{label}
      </label>)}
    </fieldset>
    {needsNotes && <>
      <fieldset className="flex flex-wrap gap-4" disabled={saving === event.id}>
        <legend className="mb-1 font-medium">Planning stages to reopen for {event.name}</legend>
        {Object.entries(STAGE_LABELS).map(([area, label]) => <label key={area} className="flex items-center gap-2">
          <input className="!w-4" type="checkbox" checked={(form.stages || []).includes(area)}
            disabled={area === 'technical' && !needsTechnical(event)} onChange={change => onStageToggle(event.id, area, change.target.checked)} />{label}
        </label>)}
      </fieldset>
      {/* Notes are relevant only to negative outcomes; retain their draft while another outcome is selected. */}
      <label className="grid gap-1" htmlFor={`safety-notes-${event.id}`}>Notes (required unless approving)
        <textarea id={`safety-notes-${event.id}`} aria-required="true" rows={3} maxLength={4000} value={form.notes || ''} disabled={saving === event.id}
          onChange={change => onFieldChange(event.id, 'notes', change.target.value)} />
      </label>
    </>}
    <button type="submit" className="justify-self-start" disabled={saving !== null}>{saving === event.id ? 'Recording…' : 'Record safety check'}</button>
  </form>;
}
