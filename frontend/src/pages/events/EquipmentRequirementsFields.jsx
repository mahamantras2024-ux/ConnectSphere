// File: Controlled inputs for equipment items, quantities, technical-support needs and special technical specifications.
import { MAX_EQUIPMENT_QUANTITY, newEquipmentRow } from './equipmentRequirements';

/**
 * Renders the shared equipment fieldset used by the new-request form and the event-detail editor.
 * @param {{ value: object, onChange: (next: object) => void, disabled: boolean }} props form state from equipmentRequirements.js;
 *   `disabled` locks every input while a save is in flight.
 */
export default function EquipmentRequirementsFields({ value, onChange, disabled }) {
  // Replaces one top-level field while keeping the rest of the equipment state.
  const setField = (field, fieldValue) => onChange({ ...value, [field]: fieldValue });
  // Updates one row's item or quantity, matched by position in the current list.
  const setRow = (index, field, fieldValue) =>
    setField('items', value.items.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: fieldValue } : row)));

  return (
    <fieldset className="equipment-fields" disabled={disabled}>
      <legend>Equipment &amp; technical support</legend>
      {value.items.length === 0 && <p className="text-slate-600">No equipment items added.</p>}
      {value.items.map((row, index) => (
        <div className="equipment-row" key={row.key}>
          <label>Equipment item {index + 1}
            <input value={row.item} maxLength={255} placeholder="e.g. Wireless microphone"
              onChange={(changeEvent) => setRow(index, 'item', changeEvent.target.value)} />
          </label>
          <label>Quantity for item {index + 1}
            <input type="number" min="1" max={MAX_EQUIPMENT_QUANTITY} step="1" value={row.quantity}
              onChange={(changeEvent) => setRow(index, 'quantity', changeEvent.target.value)} />
          </label>
          <button type="button" className="button-secondary"
            onClick={() => setField('items', value.items.filter((_, rowIndex) => rowIndex !== index))}>
            Remove equipment item {index + 1}
          </button>
        </div>
      ))}
      <button type="button" className="button-secondary justify-self-start"
        onClick={() => setField('items', [...value.items, newEquipmentRow()])}>Add equipment item</button>

      <label className="checkbox-label">
        <input type="checkbox" checked={value.technicalSupportRequired}
          onChange={(changeEvent) => setField('technicalSupportRequired', changeEvent.target.checked)} />
        Technical support required
      </label>
      {/* Details are only meaningful (and only accepted by the API) when support is requested. */}
      {value.technicalSupportRequired && (
        <label>Technical support details
          <textarea rows={3} maxLength={10000} value={value.technicalSupportDetails} placeholder="e.g. On-site AV technician from 09:00 to 12:00"
            onChange={(changeEvent) => setField('technicalSupportDetails', changeEvent.target.value)} />
        </label>
      )}
      <label className="checkbox-label">
        <input type="checkbox" checked={value.videoConferencingRequired}
          onChange={(changeEvent) => setField('videoConferencingRequired', changeEvent.target.checked)} />
        Video-conferencing / hybrid facilities required
      </label>
      <label>Special technical specifications
        <textarea rows={3} maxLength={10000} value={value.technicalSpecifications} placeholder="e.g. Zoom for 50 remote participants; record the keynote"
          onChange={(changeEvent) => setField('technicalSpecifications', changeEvent.target.value)} />
      </label>
    </fieldset>
  );
}
