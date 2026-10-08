// File: Validates organiser equipment, technical-support and technical-specification requirements for event requests.

const MAX_ITEMS = 50;
const MAX_ITEM_NAME = 255;
// Implementation guard agreed for this story; not a customer-prescribed stock limit.
const MAX_QUANTITY = 9999;
const MAX_TEXT = 10000;

/**
 * Validates the equipment block of an event request and normalises it for storage.
 * Missing fields default to "nothing requested" so callers that predate this story keep working.
 * @param {object} input request body containing equipmentItems, technicalSupportRequired,
 *   technicalSupportDetails, videoConferencingRequired and technicalSpecifications.
 * @returns {{ data: object } | { error: string }} normalised values or the first validation message.
 */
function validateEquipmentRequirements(input) {
  const items = input.equipmentItems ?? [];
  if (!Array.isArray(items) || items.length > MAX_ITEMS) {
    return { error: `Equipment items must be a list of at most ${MAX_ITEMS} entries.` };
  }
  const equipmentItems = [];
  const seenNames = new Set();
  for (const entry of items) {
    const name = typeof entry?.item === 'string' ? entry.item.trim() : '';
    if (!name || name.length > MAX_ITEM_NAME) {
      return { error: `Each equipment item needs a name of at most ${MAX_ITEM_NAME} characters.` };
    }
    // Quantities must be whole units; zero would request nothing and strings must not be coerced.
    if (!Number.isInteger(entry.quantity) || entry.quantity < 1 || entry.quantity > MAX_QUANTITY) {
      return { error: `Quantity for ${name} must be a whole number from 1 to ${MAX_QUANTITY}.` };
    }
    // Case-insensitive duplicates would double-count the same equipment when Technical Support checks availability.
    const key = name.toLowerCase();
    if (seenNames.has(key)) return { error: `Each equipment item can be listed once (${name} is repeated).` };
    seenNames.add(key);
    equipmentItems.push({ item: name, quantity: entry.quantity });
  }

  for (const field of ['technicalSupportRequired', 'videoConferencingRequired']) {
    if (input[field] !== undefined && typeof input[field] !== 'boolean') {
      return { error: `${field} must be true or false.` };
    }
  }
  const technicalSupportRequired = input.technicalSupportRequired ?? false;
  const details = input.technicalSupportDetails;
  if (details != null && (typeof details !== 'string' || details.length > MAX_TEXT)) {
    return { error: `technicalSupportDetails must be text of at most ${MAX_TEXT} characters.` };
  }
  const technicalSupportDetails = details?.trim() || null;
  // Technical Support needs to know what help is wanted; details without a request contradict the flag.
  if (technicalSupportRequired && !technicalSupportDetails) {
    return { error: 'Describe the technical support your event requires.' };
  }
  if (!technicalSupportRequired && technicalSupportDetails) {
    return { error: 'Technical support details apply only when technical support is required.' };
  }

  const specifications = input.technicalSpecifications;
  if (specifications != null && (typeof specifications !== 'string' || specifications.length > MAX_TEXT)) {
    return { error: `technicalSpecifications must be text of at most ${MAX_TEXT} characters.` };
  }

  return {
    data: {
      equipmentItems,
      technicalSupportRequired,
      technicalSupportDetails,
      videoConferencingRequired: input.videoConferencingRequired ?? false,
      technicalSpecifications: specifications?.trim() || null,
    },
  };
}

module.exports = { validateEquipmentRequirements, MAX_ITEMS, MAX_ITEM_NAME, MAX_QUANTITY, MAX_TEXT };
