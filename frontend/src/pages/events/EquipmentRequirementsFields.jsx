// File: Controlled inputs for equipment items, quantities, technical-support needs and special technical specifications.
import { MAX_EQUIPMENT_QUANTITY, newEquipmentRow } from './equipmentRequirements';

/**
 * Renders the shared equipment section used by the new-request form and the event-detail editor.
 * It is laid out like the rest of the request form: a titled section, plain labelled inputs, and one
 * Item/Quantity table whose inputs keep numbered accessible names ("Equipment item 2", "Quantity for item 2").
 * @param {{ value: object, onChange: (next: object) => void, disabled: boolean, children?: import('react').ReactNode }} props
 *   form state from equipmentRequirements.js; `disabled` locks every input while a save is in flight; `children`
 *   adds related fields (the request form's "Other equipment notes") at the end of the section.
 */
export default function EquipmentRequirementsFields({ value, onChange, disabled, children }) {
  // Replaces one top-level field while keeping the rest of the equipment state.
  const setField = (field, fieldValue) => onChange({ ...value, [field]: fieldValue });
  // Updates one row's item or quantity, matched by position in the current list.
  const setRow = (index, field, fieldValue) =>
    setField('items', value.items.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: fieldValue } : row)));

  return (
    <fieldset className="equipment-fields" disabled={disabled}>
      <legend>Equipment &amp; technical support</legend>
      <p className="field-help">List each item and how many you need. Technical Support Staff use this to arrange equipment and on-site help.</p>
      <div className="equipment-items">
        {value.items.length === 0 ? <p className="equipment-empty">No equipment items added.</p> : (
          <>
            {/* Visual column headings; each input carries its own numbered accessible name. */}
            <div className="equipment-row equipment-row-head" aria-hidden="true"><span>Item</span><span>Quantity</span><span /></div>
            {value.items.map((row, index) => (
              <div className="equipment-row" key={row.key}>
                <input aria-label={`Equipment item ${index + 1}`} value={row.item} maxLength={255} placeholder="e.g. Wireless microphone"
                  onChange={(changeEvent) => setRow(index, 'item', changeEvent.target.value)} />
                <input aria-label={`Quantity for item ${index + 1}`} type="number" min="1" max={MAX_EQUIPMENT_QUANTITY} step="1" value={row.quantity}
                  onChange={(changeEvent) => setRow(index, 'quantity', changeEvent.target.value)} />
                <button type="button" className="equipment-remove" aria-label={`Remove equipment item ${index + 1}`}
                  onClick={() => setField('items', value.items.filter((_, rowIndex) => rowIndex !== index))}>Remove</button>
              </div>
            ))}
          </>
        )}
        <button type="button" className="button-secondary equipment-add"
          onClick={() => setField('items', [...value.items, newEquipmentRow()])}><span aria-hidden="true">+ </span>Add equipment item</button>
      </div>

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
      {children}
    </fieldset>
  );
}
