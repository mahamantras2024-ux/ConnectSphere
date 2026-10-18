// File: The requested items of one equipment request, keyed exactly as the server keys them
// (backend/src/services/equipmentStatus.js requestedItems) so a partial review can name the affected ones.

/**
 * Lists equipment items by position, then other technical needs by kind, only when present.
 * @param {object} request an equipment request from GET /api/events/equipment-requests.
 * @returns {{ key: string, label: string, quantity: number|null }[]}
 */
export function requestedItems(request) {
  const items = (Array.isArray(request.equipment_items) ? request.equipment_items : [])
    .map(({ item, quantity }, index) => ({ key: `equipment:${index}`, label: item, quantity }));
  if (request.technical_support_required) items.push({ key: 'technical_support', label: 'On-site technical support', quantity: null });
  if (request.video_conferencing_required) items.push({ key: 'video_conferencing', label: 'Video-conferencing / hybrid', quantity: null });
  if (request.technical_specifications?.trim()) items.push({ key: 'technical_specifications', label: 'Special technical specifications', quantity: null });
  if (request.equipment_notes?.trim()) items.push({ key: 'other_notes', label: 'Other equipment notes', quantity: null });
  return items;
}
