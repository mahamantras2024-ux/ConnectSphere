// File: Unit tests for the Check Venue Suitability rules.
// Test scope: Pure rules only. Expected outcomes come from the ACs and the agreed rules: a venue is suitable when it holds
// the expected attendance (AC2) and lists the organiser's room layout and every accessibility need (AC3, "required
// facility" = venue requirement), matched word-by-word ignoring case, punctuation and a plural "s"; each requirement
// says what matched or is missing (AC5).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { words, isPlaceholder, wordMatch, requirementsOf, assessVenue, rankVenues } = require('../../backend/src/services/venueSuitability');

// Organiser requirements: 100 guests, Banquet, a wheelchair ramp. A venue that satisfies all three.
const required = Object.freeze({ expectedAttendance: 100, layout: 'Banquet', accessibility: ['Wheelchair ramps'] });
const venue = Object.freeze({ name: 'Hall A', capacity: 100, supported_layouts: ['Banquet', 'Theatre'], accessibility_features: ['Wheelchair ramp', 'Lift'] });
const assess = (changes, venueChanges = {}) => assessVenue({ ...required, ...changes }, { ...venue, ...venueChanges });
const outcome = (result) => result.checks.map((check) => [check.requirement, check.met]);

// AC2 boundary: just below, exactly at and just above capacity.
for (const [attendance, met, message] of [
  [99, true, 'Holds 99 expected guests (capacity 100).'], [100, true, 'Holds 100 expected guests (capacity 100).'],
  [101, false, 'Expected attendance 101 exceeds capacity 100.'],
]) {
  // Test case: One attendance figure against a capacity of 100.
  test(`VS AC2 - ${attendance} expected guests in a 100-person venue ${met ? 'fit' : 'make it unsuitable'}`, () => {
    const result = assess({ expectedAttendance: attendance });
    assert.equal(result.suitable, met);
    assert.deepEqual(result.checks[0], { requirement: 'capacity', requested: attendance, met, message });
  });
}
// Test case: Without an attendance figure capacity cannot be judged, so it is reported as not checked, not failed.
test('VS AC2 - unknown attendance is reported as not checked and does not make the venue unsuitable', () => {
  const result = assess({ expectedAttendance: null }, { capacity: 10 });
  assert.equal(result.suitable, true);
  assert.deepEqual(result.checks[0], { requirement: 'capacity', requested: null, met: null, message: 'Expected attendance is not recorded, so capacity was not checked.' });
});

// AC3 layout: word-based match against the venue's supported layouts.
for (const [label, layout, layouts, met, message] of [
  ['the same layout in different case', 'banquet', ['Banquet'], true, 'Room layout "banquet" is available as "Banquet".'],
  ['a one-word layout inside a longer venue entry', 'Hall', ['Conference hall'], true, 'Room layout "Hall" is available as "Conference hall".'],
  ['a layout the venue does not list', 'Boardroom', ['Banquet', 'Theatre'], false, 'Room layout "Boardroom" is not listed (venue lists: Banquet, Theatre).'],
  ['a layout at a venue with none recorded', 'Banquet', null, false, 'Room layout "Banquet" is not listed (venue lists: none).'],
]) {
  // Test case: One requested layout against one venue.
  test(`VS AC3/AC5 - ${label} ${met ? 'matches' : 'makes the venue unsuitable and is named'}`, () => {
    const result = assess({ layout, accessibility: [] }, { supported_layouts: layouts });
    assert.equal(result.suitable, met);
    assert.deepEqual(result.checks[1], { requirement: 'layout', requested: layout, met, message });
  });
}
// Test case: No layout preference means nothing to check.
test('VS AC3 - an event with no layout preference has no layout check', () => {
  assert.deepEqual(outcome(assess({ layout: null })), [['capacity', true], ['accessibility', true]]);
});

// AC3 accessibility: each need is checked separately and must match some feature.
test('VS AC3/AC5 - each accessibility need is checked on its own and the missing one is named', () => {
  const result = assess({ accessibility: ['Wheelchair ramps', 'Hearing loop'] });
  assert.equal(result.suitable, false);
  assert.deepEqual(result.checks.slice(2).map((check) => [check.requested, check.met, check.message]), [
    ['Wheelchair ramps', true, 'Accessibility need "Wheelchair ramps" is listed as "Wheelchair ramp".'],
    ['Hearing loop', false, 'Accessibility need "Hearing loop" is not listed (venue lists: Wheelchair ramp, Lift).'],
  ]);
  assert.deepEqual(result.unmet.map((check) => check.requested), ['Hearing loop']);
});
// Test case: A detailed description is not matched to a short venue entry - every word must be present.
test('VS AC3 - a long accessibility description does not match a shorter venue entry', () => {
  const result = assess({ accessibility: ['Wheelchair-accessible entrance and seating'] }, { accessibility_features: ['Wheelchair ramp'] });
  assert.equal(result.suitable, false);
  assert.equal(result.unmet[0].message, 'Accessibility need "Wheelchair-accessible entrance and seating" is not listed (venue lists: Wheelchair ramp).');
});
// Test case: A venue with no features recorded cannot satisfy an accessibility need.
test('VS AC3 - a venue with no accessibility features recorded fails an accessibility need', () => {
  assert.equal(assess({}, { accessibility_features: null }).unmet[0].message, 'Accessibility need "Wheelchair ramps" is not listed (venue lists: none).');
});
// Test case: Every failure is listed together, in requirement order.
test('VS AC5 - a venue failing capacity, layout and accessibility lists all three', () => {
  assert.deepEqual(assess({ expectedAttendance: 150, layout: 'Boardroom' }, { accessibility_features: [] }).unmet.map((check) => check.requirement),
    ['capacity', 'layout', 'accessibility']);
});

// Word comparison: case, punctuation and a plural "s" are ignored; other differences are not.
for (const [text, expected] of [
  ['  Wheelchair-RAMPS ', ['wheelchair', 'ramp']], ['Glass doors', ['glass', 'door']], ['Bus stop', ['bus', 'stop']], ['Lift', ['lift']],
]) {
  test(`VS AC1 - "${text}" is compared as ${JSON.stringify(expected)}`, () => assert.deepEqual(words(text), expected));
}
// Word match: every requirement word must be in one entry; different words in different entries do not combine.
for (const [requirement, entries, expected] of [
  ['Ramp', ['Wheelchair ramp'], 'Wheelchair ramp'], ['Wheelchair ramps', ['Ramp', 'Wheelchair access'], undefined],
  ['Hearing loop', ['Hearing aid loop system'], 'Hearing aid loop system'], ['Projector screen', ['Projector'], undefined],
]) {
  test(`VS AC3 - "${requirement}" ${expected ? 'matches' : 'does not match'} ${JSON.stringify(entries)}`, () => assert.equal(wordMatch(requirement, entries), expected));
}

// Placeholder entries such as "NA" are not requirements (they appear in real requests).
for (const [text, placeholder] of [['NA', true], ['N/A', true], [' none ', true], ['-', true], ['Nil', true], ['Not applicable', true], ['Nap room', false]]) {
  test(`VS AC1 - "${text}" ${placeholder ? 'is' : 'is not'} treated as "no requirement"`, () => assert.equal(isPlaceholder(text), placeholder));
}
// Test case: The compared requirements come from the event, trimmed, without placeholders; older rows may hold null lists.
test('VS AC1 - requirements are read from the organiser\'s event fields without placeholders', () => {
  assert.deepEqual(requirementsOf({ expected_attendance: 80, room_layout_preference: ' Banquet ', accessibility_requirements: [' Ramp ', 'NA'] }),
    { expectedAttendance: 80, layout: 'Banquet', accessibility: ['Ramp'] });
  assert.deepEqual(requirementsOf({ expected_attendance: null, room_layout_preference: 'N/A', accessibility_requirements: null }),
    { expectedAttendance: null, layout: null, accessibility: [] });
  assert.deepEqual(requirementsOf({ expected_attendance: 5, room_layout_preference: null, accessibility_requirements: [] }).layout, null);
});

// Test case: Suitable venues come first, then by how closely capacity fits the attendance, then by name.
test('VS AC4 - venues are ordered suitable first, then by closest capacity, then by name', () => {
  const venues = [
    { ...venue, name: 'Too small', capacity: 50 }, { ...venue, name: 'Roomy', capacity: 300 },
    { ...venue, name: 'Snug B', capacity: 120 }, { ...venue, name: 'Snug A', capacity: 120 }, { ...venue, name: 'Also small', capacity: 90 },
  ];
  assert.deepEqual(rankVenues(required, venues).map((v) => [v.name, v.suitable]),
    [['Snug A', true], ['Snug B', true], ['Roomy', true], ['Also small', false], ['Too small', false]]);
});
// Test case: With no attendance figure, ordering still works (closest to zero = smallest first).
test('VS AC4 - venues for an event without attendance are ordered by capacity', () => {
  assert.deepEqual(rankVenues({ ...required, expectedAttendance: null }, [{ ...venue, name: 'Big', capacity: 500 }, { ...venue, name: 'Small', capacity: 20 }]).map((v) => v.name), ['Small', 'Big']);
});
