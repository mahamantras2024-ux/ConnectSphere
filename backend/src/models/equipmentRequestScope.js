/** Shared SQL for substantive equipment review needs; every consumer uses the fixed event alias e. */
const EQUIPMENT_REVIEW_SCOPE = `(jsonb_array_length(e.equipment_items) > 0
  OR COALESCE(length(trim(e.equipment_notes)), 0) > 0
  OR e.video_conferencing_required
  OR COALESCE(length(trim(e.technical_specifications)), 0) > 0)`;
// On-site staffing is an additional technical request, never a prerequisite for equipment review.
const TECHNICAL_REQUEST_SCOPE = `(e.technical_support_required OR ${EQUIPMENT_REVIEW_SCOPE})`;
module.exports = { EQUIPMENT_REVIEW_SCOPE, TECHNICAL_REQUEST_SCOPE };
