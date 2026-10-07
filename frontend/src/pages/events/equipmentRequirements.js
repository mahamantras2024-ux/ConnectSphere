// File: Converts equipment and technical-support requirements between API records, form state and request payloads.

// Mirrors the server guard so organisers get immediate feedback; the API remains the authority.
export const MAX_EQUIPMENT_QUANTITY = 9999;
let nextRowKey = 0;

/** Creates an equipment row with a stable React key so removing a middle row keeps the other inputs intact. */
export function newEquipmentRow(item = '', quantity = '1') {
  nextRowKey += 1;
  return { key: nextRowKey, item, quantity };
}

/** Returns form state for an event request that has not asked for any equipment yet. */
export function emptyEquipment() {
  return { items: [], technicalSupportRequired: false, technicalSupportDetails: '', videoConferencingRequired: false, technicalSpecifications: '' };
}

/** Builds editable form state from a stored event; events saved before this story have no equipment fields. */
export function equipmentFromEvent(event) {
  return {
    items: (event.equipment_items || []).map(({ item, quantity }) => newEquipmentRow(item, String(quantity))),
    technicalSupportRequired: Boolean(event.technical_support_required),
    technicalSupportDetails: event.technical_support_details || '',
    videoConferencingRequired: Boolean(event.video_conferencing_required),
    technicalSpecifications: event.technical_specifications || '',
  };
}

/**
 * Converts form state into the API payload. Untouched blank rows are dropped, and support details
 * are only sent when support is requested because the API rejects details that contradict the flag.
 */
export function equipmentPayload(form) {
  return {
    equipmentItems: form.items.filter((row) => row.item.trim() || row.quantity !== '')
      .map((row) => ({ item: row.item.trim(), quantity: Number(row.quantity) })),
    technicalSupportRequired: form.technicalSupportRequired,
    technicalSupportDetails: form.technicalSupportRequired ? form.technicalSupportDetails : null,
    videoConferencingRequired: form.videoConferencingRequired,
    technicalSpecifications: form.technicalSpecifications,
  };
}

/** Returns the first problem that would stop the request being saved, or an empty string when it is valid. */
export function equipmentError(form) {
  for (const { item, quantity } of equipmentPayload(form).equipmentItems) {
    if (!item) return 'Name each equipment item or remove the empty row.';
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_EQUIPMENT_QUANTITY) {
      return `Quantity for ${item} must be a whole number from 1 to ${MAX_EQUIPMENT_QUANTITY}.`;
    }
  }
  if (form.technicalSupportRequired && !form.technicalSupportDetails.trim()) return 'Describe the technical support your event requires.';
  return '';
}

/** Formats stored items for reading, e.g. "Wireless microphone × 2, Projector × 1". */
export function formatEquipmentItems(items) {
  return items?.length ? items.map(({ item, quantity }) => `${item} × ${quantity}`).join(', ') : 'No equipment items requested';
}
