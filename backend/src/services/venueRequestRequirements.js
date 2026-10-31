// SCRUM-61: validates the immutable requirements accompanying a venue booking request.

/** Rejects invalid client input before any booking hold or database write is attempted. */
function requirements(body) {
  const invalid = () => Object.assign(new Error('Use a positive whole-number capacity, a layout of at most 200 characters, and text requirement lists of at most 2000 characters.'), { status: 400 });
  const capacity = body.capacity ?? null;
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 2147483647)) throw invalid();
  if (body.layout !== undefined && (typeof body.layout !== 'string' || body.layout.length > 200)) throw invalid();
  const result = { capacity, layout: (body.layout || '').trim() };
  // A named session owns its own attendance snapshot; the event total must never substitute for it.
  if (body.sessionName !== undefined) {
    if (typeof body.sessionName !== 'string' || body.sessionName.trim().length > 120) throw invalid();
    if (body.sessionName.trim()) {
      if (capacity === null) throw Object.assign(new Error('Enter the expected attendance for this session.'), {status:400});
      result.sessionName = body.sessionName.trim();
    }
  }
  for (const key of ['accessibility', 'requiredFacilities']) {
    const items = body[key] === undefined ? [] : body[key];
    if (!Array.isArray(items) || items.some(item => typeof item !== 'string') || items.join(', ').length > 2000) throw invalid();
    result[key] = [...new Set(items.map(item => item.trim()).filter(Boolean))];
  }
  if (body.cancelOtherPending !== undefined && typeof body.cancelOtherPending !== 'boolean') throw invalid();
  return { requirements: result, cancelOtherPending: !result.sessionName && body.cancelOtherPending === true };
}

module.exports = { requirements };
