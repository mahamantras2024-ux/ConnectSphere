// File: Validates and normalises venue catalogue fields before persistence.
// Rejects incomplete or malformed venue records and returns a normalised insert payload.
function validateVenue(input = {}) {
  // Whitelists persisted fields so confirmation tokens and arbitrary client fields cannot affect hashes.
  const data = {};
  data.latitude = input.latitude ?? null;
  data.longitude = input.longitude ?? null;
  data.availabilityStatus = input.availabilityStatus ?? 'Available';
  data.image = input.image ?? null;
  data.capacity = input.capacity;
  for (const field of ['name', 'location', 'operatingHours']) {
    if (typeof input[field] !== 'string' || !input[field].trim() || input[field].length > 255) throw new Error(`${field} is required and must be text of at most 255 characters.`);
    data[field] = input[field].trim();
  }
  if (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 2147483647) throw new Error('Capacity must be a positive whole number.');
  for (const field of ['supportedLayouts', 'accessibilityFeatures', 'facilities']) {
    if (!Array.isArray(input[field]) || !input[field].length || input[field].length > 50 ||
      input[field].some(value =>
      // Handles this operation using the surrounding screen or request state.
      typeof value !== 'string' || !value.trim() || value.length > 255)) throw new Error(`${field} must contain at least one non-empty entry.`);
    data[field] = [...new Set(input[field].map(value =>
      // Converts each record into its displayed or submitted representation.
      value.trim()))];
  }
  const hours = /^(\d{2}:\d{2}) - (\d{2}:\d{2})$/.exec(data.operatingHours);
  if (!hours || hours.slice(1).some(time =>
      // Handles this operation using the surrounding screen or request state.
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) || hours[1] >= hours[2]) throw new Error('Operating hours must have a valid opening time before closing time.');
  for (const field of ['setupMinutes', 'turnaroundMinutes']) {
    data[field] = input[field] ?? 0;
    if (!Number.isInteger(data[field]) || data[field] < 0 || data[field] > 10080) throw new Error(`${field} must be whole minutes between 0 and 10080.`);
  }
  for (const field of ['mrt']) {
    if (input[field] != null && (typeof input[field] !== 'string' || input[field].length > 255)) throw new Error(`${field} must be text of at most 255 characters.`);
    data[field] = input[field]?.trim() || null;
  }
  // Persists an optional canonical hourly amount instead of accepting ambiguous descriptive pricing.
  data.pricing=null;
  if(input.pricing!=null && input.pricing!=='') {
    if(typeof input.pricing!=='string' || !/^\d+(?:\.\d{1,2})?$/.test(input.pricing.trim()) || Number(input.pricing)>99999999.99)throw new Error('Enter a non-negative hourly rate with up to two decimal places.');
    data.pricing=Number(input.pricing).toFixed(2);
  }
  if (input.availabilityStatus != null && !['Available', 'Unavailable', 'Maintenance'].includes(input.availabilityStatus)) throw new Error('Choose a recognised availability status.');
  if (input.image != null && (typeof input.image !== 'string' || input.image.length > 7_000_000 ||
      !/^(data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+|https?:\/\/[^\s]+)$/.test(input.image))) throw new Error('Choose a valid PNG, JPEG or WEBP image.');
  return data;
}
module.exports = { validateVenue };
