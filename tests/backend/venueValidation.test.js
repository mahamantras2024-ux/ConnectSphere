// File: Exercises mandatory venue fields, malformed arrays, capacity, timing, and optional data boundaries.
// Test scope: Uses real handlers/services with controlled database/email/provider boundaries where configured.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateVenue } = require('../../backend/src/services/venueValidation');
const valid = { name: ' Hall ', location: ' Marina ', capacity: 80, supportedLayouts: [' Theatre ', 'Theatre'], facilities: ['Wi-Fi'], accessibilityFeatures: ['Ramp'], operatingHours: '09:00 - 18:00' };
// Test case: Validates a complete venue and checks trimmed names, deduplicated layouts, optional-price defaults and accepted time buffers.
test('complete venues normalise lists and allow optional imagery, pricing, and transit information', () => {
  // Confirms required fields are normalised and a record can be created without optional extras.
  const data = validateVenue(valid); assert.equal(data.name, 'Hall'); assert.deepEqual(data.supportedLayouts, ['Theatre']);
  assert.equal(data.pricing, null); assert.equal(data.setupMinutes, 0); assert.equal(data.turnaroundMinutes, 0);
  assert.equal(validateVenue({ ...valid, setupMinutes: 30, turnaroundMinutes: 45 }).setupMinutes, 30);
});
// Test case: Tries malformed required fields, arrays, capacity, hours, buffers and image URLs and checks validation throws.
test('incomplete or invalid venues are rejected before database insertion', () => {
  // Covers whitespace, wrong types, numeric boundaries, empty entries, invalid hours, and bad images.
  for (const invalid of [{ name: ' ' }, { location: 42 }, { operatingHours: '' }, { name: 'a'.repeat(256) }, { capacity: -1 }, { capacity: 0 }, { capacity: 1.5 }, { capacity: '80' }, { capacity: 2147483648 },
    { facilities: [] }, { facilities: 'Wi-Fi' }, { facilities: [' '] }, { supportedLayouts: [42] }, { accessibilityFeatures: ['a'.repeat(256)] },
    { operatingHours: '25:00 - 26:00' }, { operatingHours: '18:00 - 09:00' }, { setupMinutes: -1 }, { turnaroundMinutes: 1.5 }, { turnaroundMinutes: 10081 }, { pricing: 42 }, { mrt: 42 }, { availabilityStatus: 'Invented' }, { image: 'javascript:alert(1)' }]) {
    assert.throws(() =>
      // Handles this operation using the surrounding screen or request state.
      validateVenue({ ...valid, ...invalid }));
  }
});
// Test case: Checks canonical zero/decimal hourly prices and rejection of descriptive text, negatives, excess precision and out-of-range prices.
test('hourly rates accept zero and decimal amounts but reject ambiguous prices and invalid precision',()=> {
  // Keeps hourly amounts canonical and prevents free-text prices from being saved as rates.
  assert.equal(validateVenue({...valid,pricing:'500'}).pricing,'500.00');
  assert.equal(validateVenue({...valid,pricing:'75.50'}).pricing,'75.50');
  assert.equal(validateVenue({...valid,pricing:'0'}).pricing,'0.00');
  for(const pricing of ['from $500','$500/hr','-1','1.234','1e3','100000000','NaN'])assert.throws(()=>validateVenue({...valid,pricing}),/hourly rate/);
});
